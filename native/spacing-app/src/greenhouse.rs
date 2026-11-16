//! A estufa no jogo (porte de `src/app/GreenhouseDirector.ts`, `src/render/greenhouseModel.ts` e `farmModel.ts`,
//! docs/design/ESTUFA.md): o projeto na barra mostra o holograma (verde cabe, vermelho não), tocar assenta a obra e nivela o
//! chão, o botão de ação entrega as peças uma de cada vez e finaliza; depois, canteiros, solo, batata, água e colheita.
use glam::{Mat4, Vec3};
use spacing_core::blocks::{BlockId, AIR, ICE, LAVA, MARS_DUST, REGOLITH};
use spacing_core::interaction::Target;
use spacing_core::planet::PlanetId;
use spacing_core::rules::greenhouse::{anchor_at, apply_parts, door_apron, greenhouse_structure, growth_stage, BedAction, BlockBox, SpotReason};
use spacing_core::rules::{rules, Counts, Events, ItemId};
use spacing_render::astronaut::NamedModel;
use spacing_render::{load_glb, Material, MeshId, PartDraw, Renderer};

use crate::game::Game;

static GREENHOUSE_GLB: &[u8] = include_bytes!("../../assets/models/greenhouse.glb");
static FARM_GLB: &[u8] = include_bytes!("../../assets/models/farm.glb");

const PARTS: [&str; 7] = ["floor", "wallS", "wallW", "wallE", "wallN", "frame", "glass"];

pub struct GreenhouseModels {
    /// (peça, baixa qualidade, alta qualidade)
    parts: Vec<(&'static str, NamedModel, NamedModel)>,
    farm: Vec<(String, NamedModel)>,
}

impl GreenhouseModels {
    pub fn load(r: &mut Renderer) -> Self {
        let mut parts = Vec::new();
        if let Ok(m) = load_glb(GREENHOUSE_GLB) {
            let ids = r.upload_model(&m);
            for p in PARTS {
                if let (Some(lo), Some(hi)) = (NamedModel::subtree(&m, &ids, &format!("{p}_low")), NamedModel::subtree(&m, &ids, &format!("{p}_high"))) {
                    parts.push((p, lo, hi));
                }
            }
        }
        let mut farm = Vec::new();
        if let Ok(m) = load_glb(FARM_GLB) {
            let ids = r.upload_model(&m);
            for n in ["planter", "soil_dry", "soil_wet", "potato_0", "potato_1", "potato_2", "potato_3", "potato_4", "potato_dry"] {
                if let Some(p) = NamedModel::subtree(&m, &ids, n) {
                    farm.push((n.to_string(), p));
                }
            }
        }
        Self { parts, farm }
    }
}

fn reason_text(r: SpotReason) -> &'static str {
    match r {
        SpotReason::Exists => "Você já tem uma estufa em obra.",
        SpotReason::Uneven => "O chão é desnivelado demais aqui (mais de 1 bloco de diferença).",
        SpotReason::Base => "Perto demais da base. Afaste a estufa uns blocos.",
        SpotReason::Lander => "Perto demais do módulo de pouso. Afaste a estufa uns blocos.",
        SpotReason::Lava => "Há lava debaixo. Escolha outro lugar.",
        SpotReason::Door => "A porta ficaria presa num paredão. Procure chão mais aberto na frente (lado sul).",
        SpotReason::High => "Alto demais para a cúpula.",
        SpotReason::Player => "Você está em cima do lugar. Dê um passo para fora.",
    }
}

fn bed_label(a: BedAction, pct: f64) -> String {
    match a {
        BedAction::Soil => "Encher com solo".into(),
        BedAction::Plant => "Plantar batata".into(),
        BedAction::Water => "Regar (gelo)".into(),
        BedAction::Harvest => "Colher batatas".into(),
        BedAction::NeedSoil => "Canteiro: falta solo".into(),
        BedAction::NeedSeed => "Canteiro: falta batata".into(),
        BedAction::NeedWater => "Com sede: falta gelo".into(),
        BedAction::Growing => format!("Crescendo: {:.0}%", pct * 100.0),
    }
}

fn costs(c: &[(ItemId, u32)]) -> String {
    c.iter().map(|(i, n)| format!("{n} {}", i.data().name)).collect::<Vec<_>>().join(", ")
}

/// etiqueta da obra: onde fica, peças entregues, a próxima (nome e custo) e o rodapé
pub type SiteLabel = ([f64; 3], Vec<bool>, Option<(String, String)>, String);

/// o que o botão de ação faz na estufa
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SiteUse {
    /// entregar a próxima peça ou finalizar
    Build,
    /// o canteiro (índice)
    Bed(usize),
}

impl Game {
    fn base_box(&self) -> BlockBox {
        let b = self.base.layout.structure.bx;
        BlockBox { x0: b.x0, y0: b.y0, z0: b.z0, x1: b.x1, y1: b.y1, z1: b.z1 }
    }

    /// a estrutura da estufa no mundo (a segunda, depois da base)
    fn gh_structure_sync(&mut self) {
        let Some(site) = &self.greenhouse.site else { return };
        match self.world.structures.iter_mut().find(|s| s.id == "greenhouse") {
            Some(s) => apply_parts(s, site),
            None => self.world.structures.push(greenhouse_structure(site)),
        }
        // as malhas dos chunks não mudam (a estrutura não entra nelas), mas pedaços em cima acordam
        let (x, y, z) = (site.x, site.floor_y, site.z);
        self.debris.disturb(x + 3, y + 1, z + 3);
    }

    /// tocou um bloco com um projeto na mão (estufa ou canteiro)
    pub(crate) fn site_tap(&mut self, pos: [i32; 3], item: ItemId) {
        let mut ev = Events::new();
        if item.key() == "planter" {
            let (x, z) = (pos[0], pos[2]);
            if let Some(why) = self.greenhouse.bed_spot(x, z) {
                self.toast(match why {
                    "notDone" => "Canteiro só dentro da estufa pronta.",
                    "outside" => "Ponha o canteiro no piso, dentro das paredes e fora do caminho da porta.",
                    _ => "Já há um canteiro aí.",
                });
                return;
            }
            self.greenhouse.place_bed(x, z);
            self.inv.remove_selected(1, &mut ev);
            self.gh_structure_sync();
            self.toast("Canteiro no lugar. Encha de solo fértil, plante uma batata e mantenha úmido.");
            return;
        }
        let (ax, az) = anchor_at(pos[0], pos[2]);
        let p = self.player.pos;
        let chk = self.greenhouse.check(&self.world, Some(self.base_box()), ax, az, Some((p[0], p[2])));
        if !chk.ok {
            self.toast(reason_text(chk.reason.unwrap_or(SpotReason::Uneven)));
            return;
        }
        self.level(chk.x, chk.z, chk.floor_y);
        self.greenhouse.place_site(chk.x, chk.z, chk.floor_y);
        self.inv.remove_selected(1, &mut ev);
        self.gh_structure_sync();
        let n = rules().greenhouse.size as f64;
        let c = [chk.x as f64 + n / 2.0, chk.floor_y as f64 + 1.0, chk.z as f64 + n / 2.0];
        spacing_core::interaction::dust(&mut self.particles, c[0], c[1], c[2], 14, n / 2.0);
        self.toast("Holograma assentado. Chegue perto e entregue o material, uma peça de cada vez.");
    }

    /// nivela o chão: a pegada fica rente ao piso e a faixa de fora da porta rente ao piso de dentro
    fn level(&mut self, x: i32, z: i32, floor_y: i32) {
        let fallback: BlockId = if self.planet == PlanetId::Marte { MARS_DUST } else { REGOLITH };
        let n = rules().greenhouse.size;
        let mut edits = Vec::new();
        let mut cols: Vec<(i32, i32, i32)> = Vec::new();
        for dz in 0..n {
            for dx in 0..n {
                cols.push((x + dx, z + dz, floor_y - 1));
            }
        }
        for (ax, az) in door_apron(x, z) {
            cols.push((ax, az, floor_y));
        }
        for (wx, wz, target) in cols {
            let top = self.world.top_y(wx, wz);
            let mut ground = self.world.get_block(wx, top, wz);
            if ground == AIR || ground == LAVA || ground == ICE {
                ground = fallback;
            }
            for y in (target + 1..=top).rev() {
                edits.push((wx, y, wz, AIR));
            }
            for y in top + 1..=target {
                edits.push((wx, y, wz, ground));
            }
            self.world.remove_prop_at(wx, wz);
        }
        self.world.set_blocks(&edits);
    }

    /// o botão de ação na estufa: o que der para fazer e a distância (menor ganha das outras opções)
    pub(crate) fn site_option(&self) -> Option<(SiteUse, f64, String)> {
        let s = self.greenhouse.site.as_ref()?;
        let g = &rules().greenhouse;
        let p = self.player.pos;
        if s.done {
            if (p[1] - (s.floor_y as f64 + 1.0)).abs() >= 2.0 {
                return None;
            }
            let i = self.greenhouse.bed_near(p[0], p[2])?;
            let b = self.greenhouse.bed(i);
            let dist = (spacing_core::js::hypot(p[0] - (b.x as f64 + 0.5), p[2] - (b.z as f64 + 0.5)) - 0.5).max(0.0);
            let pct = b.crop.map_or(0.0, |c| c.growth);
            return Some((SiteUse::Bed(i), dist, bed_label(self.greenhouse.bed_action(i, &self.inv), pct)));
        }
        let n = g.size as f64;
        let (cx, cz) = (s.x as f64 + n / 2.0, s.z as f64 + n / 2.0);
        let dist = spacing_core::js::hypot(((p[0] - cx).abs() - n / 2.0).max(0.0), ((p[2] - cz).abs() - n / 2.0).max(0.0));
        if dist > g.reach || (p[1] - (s.floor_y as f64 + 1.0)).abs() > 3.5 {
            return None;
        }
        let label = match self.greenhouse.next_part() {
            Some(i) => format!("Entregar: {}", g.parts[i].name),
            None => "Finalizar a estufa".into(),
        };
        Some((SiteUse::Build, dist, label))
    }

    pub(crate) fn site_use(&mut self, u: SiteUse) {
        let mut ev = Events::new();
        match u {
            SiteUse::Build => {
                if self.greenhouse.complete() {
                    if self.greenhouse.finish() {
                        self.toast("Estufa pronta: cápsula de vidro finalizada");
                    }
                    return;
                }
                match self.greenhouse.deliver(&mut self.inv, &mut ev) {
                    Ok(id) => {
                        let name = &rules().greenhouse.parts.iter().find(|p| p.id == id).expect("peça").name;
                        self.toast(format!("{name} entregue"));
                        if self.greenhouse.complete() {
                            self.toast("Todas as peças estão no lugar. Aperte o botão para finalizar a estufa.");
                        }
                        self.gh_structure_sync();
                    }
                    Err(m) => self.toast(format!("Faltam {}", costs(m.pairs()))),
                }
            }
            SiteUse::Bed(i) => {
                let before = self.greenhouse.bed_action(i, &self.inv);
                match self.greenhouse.use_bed(i, &mut self.inv, &mut ev) {
                    Some((BedAction::Harvest, n)) => self.toast(format!("+{} batatas", n.unwrap_or(0))),
                    Some((a, _)) => self.toast(match a {
                        BedAction::Soil => "Solo no canteiro",
                        BedAction::Plant => "Batata plantada",
                        _ => "Canteiro regado",
                    }),
                    None => self.toast(match before {
                        BedAction::NeedSoil => "Precisa de solo fértil: faça na bancada (regolito e gelo) ou pegue no baú.",
                        BedAction::NeedSeed => "Precisa de uma batata para plantar (a batata é a semente).",
                        BedAction::NeedWater => "Traga gelo: ele derrete no canteiro e rega a planta.",
                        _ => "A batata está crescendo. Volte daqui a pouco.",
                    }),
                }
            }
        }
        self.react(ev);
    }

    /// comer o item da barra: o texto do botão, ou None se não dá agora
    pub(crate) fn eat_label(&self) -> Option<String> {
        let it = self.inv.selected_item()?;
        let food = it.data().food?;
        (self.survival.energy <= rules().needs.energy.max - 5.0).then(|| format!("Comer {} (+{food:.0})", it.data().name.to_lowercase()))
    }

    pub(crate) fn eat(&mut self) {
        let Some(it) = self.inv.selected_item() else { return };
        if !self.survival.eat(it) {
            return;
        }
        let mut ev = Events::new();
        self.inv.remove_selected(1, &mut ev);
        self.toast(format!("{}: +{:.0} de energia", it.data().name, it.data().food.unwrap_or(0.0)));
    }

    /// o tempo passa nos canteiros
    pub(crate) fn greenhouse_update(&mut self, dt: f64) {
        if self.death.is_none() {
            let light = spacing_core::planet::planet(self.planet).solar.sqrt();
            self.greenhouse.step(dt, light);
        }
    }

    /// a etiqueta da obra para o HUD (perto e não finalizada): título, peças entregues, próxima peça e o que falta
    pub fn site_label(&self) -> Option<SiteLabel> {
        let s = self.greenhouse.site.as_ref()?;
        if s.done {
            return None;
        }
        let g = &rules().greenhouse;
        let n = g.size as f64;
        let c = [s.x as f64 + n / 2.0, s.floor_y as f64 + 5.5, s.z as f64 + n / 2.0];
        let p = self.player.pos;
        if spacing_core::js::hypot(p[0] - c[0], p[2] - c[2]) >= 15.0 || self.base.indoor_view {
            return None;
        }
        let pips = g.parts.iter().map(|q| s.parts.contains(&q.id)).collect();
        let next = self.greenhouse.next_part().map(|i| (g.parts[i].name.clone(), costs(&g.parts[i].cost)));
        let lack: Counts = self.greenhouse.missing(&self.inv);
        let foot = if self.greenhouse.complete() {
            "Tudo entregue: finalize".to_string()
        } else if !lack.is_empty() {
            format!("Faltam {}", costs(lack.pairs()))
        } else {
            "Material completo para a próxima peça".to_string()
        };
        Some((c, pips, next, foot))
    }

    /// desenha a obra, o holograma de onde ela assentaria e os canteiros
    pub(crate) fn greenhouse_draw(&mut self, m: &GreenhouseModels, cube: MeshId) {
        let n = rules().greenhouse.size as f32;
        let t = self.time as f32;
        let ground = if self.planet == PlanetId::Marte { [0.19, 0.07, 0.04] } else { [0.27, 0.24, 0.2] };
        let holo = |ok: bool| Material::Glass { alpha: 0.11 + 0.06 * (t * 2.2).sin(), color: Some(if ok { [0.1, 0.6, 0.15] } else { [0.9, 0.12, 0.08] }) };
        let parts = &mut self.parts;
        // fantasma: projeto na mão, modo construir, mirando um bloco
        let holding = self.inv.selected_item().is_some_and(|i| i.key() == "greenhouse_plan") && self.interaction.build_mode && self.greenhouse.site.is_none();
        if let (true, Some(Target::Block(h))) = (holding, &self.interaction.target) {
            let (ax, az) = anchor_at(h.x, h.z);
            let p = self.player.pos;
            let bb = { let b = self.base.layout.structure.bx; BlockBox { x0: b.x0, y0: b.y0, z0: b.z0, x1: b.x1, y1: b.y1, z1: b.z1 } };
            let chk = self.greenhouse.check(&self.world, Some(bb), ax, az, Some((p[0], p[2])));
            let at = Mat4::from_translation(Vec3::new(ax as f32, chk.floor_y as f32, az as f32));
            for (_, lo, _) in &m.parts {
                lo.draw_with(at, parts, |_| Some(Mat4::IDENTITY));
                let len = parts.len();
                let k = lo.pieces.len();
                for pd in &mut parts[len - k..] {
                    pd.material = holo(chk.ok);
                }
            }
        }
        let Some(s) = &self.greenhouse.site else { return };
        let at = Mat4::from_translation(Vec3::new(s.x as f32, s.floor_y as f32, s.z as f32));
        // o chão nivelado da obra
        parts.push(PartDraw { mesh: cube, world: at * Mat4::from_translation(Vec3::new(n / 2.0, 0.0, n / 2.0)) * Mat4::from_scale(Vec3::new(n, 0.93, n)), material: Material::Flat(ground) });
        for (id, lo, hi) in &m.parts {
            let has = s.parts.iter().any(|p| p == id);
            if !has {
                // peça que falta: holograma ciano
                lo.draw_with(at, parts, |_| Some(Mat4::IDENTITY));
                let len = parts.len();
                for pd in &mut parts[len - lo.pieces.len()..] {
                    pd.material = Material::Glass { alpha: 0.11 + 0.06 * (t * 2.2).sin(), color: Some([0.1, 0.45, 0.55]) };
                }
            } else if s.done {
                hi.draw(at, parts);
            } else {
                lo.draw(at, parts);
            }
        }
        // canteiros (farmModel.ts)
        let farm = |name: &str| m.farm.iter().find(|(k, _)| k == name).map(|(_, p)| p);
        let thirsty = rules().greenhouse.farm.thirsty;
        for b in &s.beds {
            let bw = Mat4::from_translation(Vec3::new(b.x as f32 + 0.5, (s.floor_y + 1) as f32, b.z as f32 + 0.5));
            let ready = b.crop.is_some_and(|c| c.growth >= 1.0);
            let led = if !b.soil || b.crop.is_none() {
                [0.08, 0.08, 0.1]
            } else if ready {
                [0.5, 1.6, 2.6]
            } else if b.water < thirsty {
                [2.4, 1.3, 0.2]
            } else {
                [0.4, 2.2, 0.6]
            };
            if let Some(p) = farm("planter") {
                p.draw_with(bw, parts, |_| Some(Mat4::IDENTITY));
                let len = parts.len();
                // a luz do canteiro: a última parte com nome fx_led
                for (pd, piece) in parts[len - p.pieces.len()..].iter_mut().zip(&p.pieces) {
                    if piece.path.iter().any(|n| n.starts_with("fx_led")) {
                        pd.material = Material::Glow(led);
                    }
                }
            }
            if b.soil {
                if let Some(p) = farm(if b.water > thirsty { "soil_wet" } else { "soil_dry" }) {
                    p.draw(bw, parts);
                }
            }
            if let Some(c) = b.crop {
                let stage = growth_stage(c.growth);
                let wilted = b.water <= 0.0 && !ready && (1..4).contains(&stage);
                let name = if wilted { "potato_dry".to_string() } else { format!("potato_{stage}") };
                if let Some(p) = farm(&name) {
                    p.draw(bw, parts);
                }
            }
        }
    }
}

impl Game {
    /// Só para testes e capturas (como o `testPlace` do modo de teste web): assenta a obra no primeiro lugar que serve perto
    /// do astronauta. Devolve se assentou.
    pub fn test_place_site(&mut self) -> bool {
        if self.greenhouse.site.is_some() {
            return false;
        }
        let p = self.player.pos;
        let (px, pz) = (p[0].floor() as i32, p[2].floor() as i32);
        let mut best: Option<(i32, i32, i32, i32)> = None;
        for dz in (-16..=16).step_by(2) {
            for dx in (-16..=16).step_by(2) {
                let (ax, az) = anchor_at(px + dx, pz + dz);
                let c = self.greenhouse.check(&self.world, Some(self.base_box()), ax, az, Some((p[0], p[2])));
                let d = dx * dx + dz * dz;
                if c.ok && best.is_none_or(|b| d < b.3) {
                    best = Some((ax, az, c.floor_y, d));
                }
            }
        }
        let Some((x, z, fy, _)) = best else { return false };
        self.level(x, z, fy);
        self.greenhouse.place_site(x, z, fy);
        self.gh_structure_sync();
        true
    }

    /// Só para testes e capturas: entrega tudo, finaliza e planta canteiros com solo, água e batata.
    pub fn test_build_and_farm(&mut self, growth: f64) {
        let mut ev = Events::new();
        for _ in 0..8 {
            if let Some(i) = self.greenhouse.next_part() {
                for &(item, n) in &rules().greenhouse.parts[i].cost {
                    self.inv.add(item, n, false, &mut ev);
                }
            }
            self.site_use(SiteUse::Build);
        }
        let Some(s) = self.greenhouse.site.clone() else { return };
        for (dx, dz) in [(1, 1), (2, 1), (4, 1), (5, 1)] {
            self.greenhouse.place_bed(s.x + dx, s.z + dz);
        }
        if let Some(site) = &mut self.greenhouse.site {
            for b in &mut site.beds {
                b.soil = true;
                b.water = 1.0;
                b.crop = Some(spacing_core::rules::greenhouse::Crop { growth });
            }
            if let Some(b) = site.beds.last_mut() {
                b.water = 0.2;
            }
        }
        self.gh_structure_sync();
    }
}
