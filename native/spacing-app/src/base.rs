//! A base no jogo (porte de `src/app/BaseDirector.ts` e da parte de desenho de `src/render/baseModel.ts`, docs/design/BASE.md):
//! entrar pela câmara de pressurização, a vista de dentro (só a base, luz própria, mundo de fora travado), sair, descansar
//! no beliche (traje cheio e renascer na base) e o botão de ação dos móveis.
use glam::{Mat4, Vec3};
use spacing_core::base::{hab_layout, ModuleLayout, Side};
use spacing_core::fx::signal_lamp;
use spacing_core::rules::rules;
use spacing_core::rules::StationId;
use spacing_render::astronaut::{AnimatedModel, NamedModel};
use spacing_render::{load_glb, Material, MeshId, PartDraw, Renderer};
use spacing_render::model::{MeshData, ModelData, ModelVertex, Node};

use crate::game::Game;

static HABITAT_GLB: &[u8] = include_bytes!("../../../src/assets/models/habitat.glb");
static INTERIOR_GLB: &[u8] = include_bytes!("../../../src/assets/models/habitat_interior.glb");
static FURNITURE_GLB: &[u8] = include_bytes!("../../../src/assets/models/furniture.glb");
pub(crate) static WORKBENCH_GLB: &[u8] = include_bytes!("../../../src/assets/models/workbench.glb");
pub(crate) static FURNACE_GLB: &[u8] = include_bytes!("../../../src/assets/models/furnace.glb");
pub(crate) static ELECTROLYZER_GLB: &[u8] = include_bytes!("../../../src/assets/models/electrolyzer.glb");

const DOOR_RED: [f32; 3] = [2.2, 0.25, 0.15];
const DOOR_GREEN: [f32; 3] = [0.4, 2.4, 0.8];

/// os modelos da base na GPU
pub struct BaseModels {
    shell: Option<NamedModel>,
    interior: Option<NamedModel>,
    /// um por tipo de móvel
    furniture: Vec<(String, NamedModel)>,
    /// as máquinas, com o laço do Blender (bancada, forno, eletrolisador)
    machines: Vec<(StationId, AnimatedModel)>,
    /// cubo de lado 1 (pernas do casco)
    pub cube: MeshId,
}

fn cube_model() -> ModelData {
    let c = [[-0.5, 0.0, -0.5], [0.5, 0.0, -0.5], [0.5, 1.0, -0.5], [-0.5, 1.0, -0.5], [-0.5, 0.0, 0.5], [0.5, 0.0, 0.5], [0.5, 1.0, 0.5], [-0.5, 1.0, 0.5]];
    let faces = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]];
    let mut verts = Vec::new();
    for f in faces {
        for i in [0, 1, 2, 0, 2, 3] {
            verts.push(ModelVertex { pos: c[f[i]], color: [1.0; 4] });
        }
    }
    let n = verts.len() as u32;
    ModelData {
        meshes: vec![MeshData { verts, indices: (0..n).collect() }],
        nodes: vec![Node { name: "cubo".into(), translation: Vec3::ZERO, rotation: glam::Quat::IDENTITY, scale: Vec3::ONE, mesh: Some(0), children: Vec::new(), parent: None }],
        roots: vec![0],
        clips: Vec::new(),
    }
}

impl BaseModels {
    pub fn load(r: &mut Renderer) -> Self {
        let mut whole = |bytes: &[u8]| load_glb(bytes).ok().map(|m| {
            let ids = r.upload_model(&m);
            NamedModel::new(&m, &ids)
        });
        let shell = whole(HABITAT_GLB);
        let interior = whole(INTERIOR_GLB);
        let mut furniture = Vec::new();
        if let Ok(m) = load_glb(FURNITURE_GLB) {
            let ids = r.upload_model(&m);
            for kind in ["bed", "locker", "console", "shelf", "plants", "table", "tank", "crates"] {
                if let Some(p) = NamedModel::subtree(&m, &ids, kind) {
                    furniture.push((kind.to_string(), p));
                }
            }
        }
        let mut machines = Vec::new();
        for (kind, bytes) in [("workbench", WORKBENCH_GLB), ("furnace", FURNACE_GLB), ("electrolyzer", ELECTROLYZER_GLB)] {
            if let (Ok(m), Some(s)) = (load_glb(bytes), StationId::parse(kind)) {
                let ids = r.upload_model(&m);
                machines.push((s, AnimatedModel::new(&m, &ids)));
            }
        }
        let cube = r.upload_model(&cube_model())[0];
        if shell.is_none() || interior.is_none() {
            log::warn!("modelos da base não carregaram");
        }
        Self { shell, interior, furniture, machines, cube }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Outside,
    Entering,
    Inside,
    Exiting,
    Resting,
}

/// o que o botão de ação faz
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UseKind {
    Enter,
    Exit,
    Bed,
    Console,
    Chest,
    Station(StationId),
    /// a obra da estufa ou um canteiro
    Site(crate::greenhouse::SiteUse),
    /// comer o item da barra
    Eat,
}

/// o que acontece ao chegar no fim de uma caminhada da cena
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Then {
    /// entrou: fecha a porta e pressuriza
    Airlock,
    /// saindo: chegou na câmara
    ExitAirlock,
    /// saiu: fecha a porta
    Outside,
}

pub struct BaseState {
    pub layout: ModuleLayout,
    pub mode: Mode,
    seq_t: f64,
    step: u8,
    /// caminhada da cena: pontos e duração de cada trecho
    walk: Vec<([f64; 3], f64)>,
    walk_t: f64,
    walk_from: [f64; 3],
    then: Option<Then>,
    outside_zoom: f64,
    /// 0 fechada, 1 aberta
    pub door: f64,
    pub door_target: f64,
    /// 0 visto de fora, 1 corte completo
    pub inside: f64,
    pub inside_target: f64,
    /// câmera desenhando o interior (troca atrás das portas da câmara)
    pub indoor_view: bool,
    door_green: bool,
    /// renasce na base (descansou no beliche)
    pub respawn_base: bool,
    pub visited: bool,
    pub use_kind: Option<UseKind>,
    pub use_label: Option<String>,
    /// câmara: título, subtítulo e progresso
    pub airlock: Option<(&'static str, &'static str, f64)>,
    /// tela escura de descanso
    pub fade: Option<&'static str>,
}

impl BaseState {
    pub fn new(terrain: &dyn spacing_core::terrain::TerrainGen) -> Self {
        Self {
            layout: hab_layout(terrain),
            mode: Mode::Outside,
            seq_t: 0.0,
            step: 0,
            walk: Vec::new(),
            walk_t: 0.0,
            walk_from: [0.0; 3],
            then: None,
            outside_zoom: 30.0,
            door: 0.0,
            door_target: 0.0,
            inside: 0.0,
            inside_target: 0.0,
            indoor_view: false,
            door_green: false,
            respawn_base: false,
            visited: false,
            use_kind: None,
            use_label: None,
            airlock: None,
            fade: None,
        }
    }

    /// dentro: pressurizado e protegido de meteoros
    pub fn inside(&self) -> bool {
        matches!(self.mode, Mode::Inside | Mode::Resting)
    }

    /// uma cena está acontecendo (sem mineração nem andar)
    pub fn busy(&self) -> bool {
        matches!(self.mode, Mode::Entering | Mode::Exiting | Mode::Resting)
    }

    fn door_point(&self) -> [f64; 3] {
        let (x, z, _) = self.layout.door;
        [x as f64 + 0.5, self.layout.floor_y as f64 + 1.02, z as f64 + 0.5]
    }
}

impl Game {
    fn set_inside_view(&mut self, on: bool, instant: bool) {
        let b = &mut self.base;
        b.indoor_view = on;
        b.inside_target = if on { 1.0 } else { 0.0 };
        b.door_green = on;
        if let Some(s) = self.world.structures.first_mut() {
            s.cutaway = on;
        }
        self.rig.dist_target = if on { rules().base.inside_zoom } else { b.outside_zoom };
        if instant {
            b.inside = b.inside_target;
            b.door = b.door_target;
            self.rig.dist = self.rig.dist_target;
        }
    }

    fn set_door(&mut self, open: bool) {
        self.base.door_target = if open { 1.0 } else { 0.0 };
        if let Some(s) = self.world.structures.first_mut() {
            s.door_open = open;
        }
    }

    fn walk_to(&mut self, path: Vec<([f64; 3], f64)>, then: Then) {
        self.base.walk = path;
        self.base.walk_t = 0.0;
        self.base.walk_from = self.player.pos;
        self.base.then = Some(then);
        self.player.frozen = true;
    }

    /// coloca o astronauta dentro, sem cena (renascer na base)
    pub(crate) fn place_inside(&mut self) {
        let l = &self.base.layout;
        let p = l.furniture.iter().find(|f| f.def.kind == "bed").map_or(l.inside, |f| f.use_at);
        self.player.pos = [p[0], p[1] + 0.02, p[2]];
        self.player.prev_pos = self.player.pos;
        self.player.vel = [0.0; 3];
        if self.base.mode != Mode::Inside {
            self.base.outside_zoom = self.rig.dist_target;
        }
        self.set_door(false);
        self.set_inside_view(true, true);
        self.base.mode = Mode::Inside;
    }

    /// o jogador apertou o botão de ação
    pub(crate) fn base_use(&mut self) {
        if self.base.busy() || self.death.is_some() {
            return;
        }
        let Some(kind) = self.base.use_kind else { return };
        match kind {
            UseKind::Enter => {
                self.base.mode = Mode::Entering;
                self.base.seq_t = 0.0;
                self.base.step = 0;
                self.interaction.cancel(&mut self.player);
                self.base.outside_zoom = self.rig.dist_target;
                self.set_door(true);
                let door = self.base.door_point();
                let inside = self.base.layout.inside;
                let d = spacing_core::js::hypot(self.player.pos[0] - door[0], self.player.pos[2] - door[2]);
                self.walk_to(vec![(door, (d / 3.0).max(0.35)), ([inside[0], inside[1] + 0.02, inside[2]], 0.5)], Then::Airlock);
            }
            UseKind::Exit => {
                self.base.mode = Mode::Exiting;
                self.base.seq_t = 0.0;
                self.base.step = 0;
                self.interaction.cancel(&mut self.player);
                let inside = self.base.layout.inside;
                let d = spacing_core::js::hypot(self.player.pos[0] - inside[0], self.player.pos[2] - inside[2]);
                self.walk_to(vec![([inside[0], inside[1] + 0.02, inside[2]], (d / 3.0).max(0.2))], Then::ExitAirlock);
            }
            UseKind::Bed => {
                self.base.mode = Mode::Resting;
                self.base.seq_t = 0.0;
                self.player.frozen = true;
                self.base.fade = Some("Descansando…");
            }
            UseKind::Console => self.screen_open = Some(crate::game::Screen::Power),
            UseKind::Chest => {
                let mut ev = Vec::new();
                match self.greenhouse.open_chest(&mut self.inv, &mut ev) {
                    Ok(_) => self.toast("Baú aberto: o kit da estufa e do cultivo foi para a mochila"),
                    Err("full") => self.toast("Mochila cheia: abra espaço para pegar o kit do baú"),
                    Err(_) => self.toast("O baú está vazio"),
                }
            }
            UseKind::Station(s) => {
                self.screen_open = Some(crate::game::Screen::Station(s));
            }
            UseKind::Site(u) => self.site_use(u),
            UseKind::Eat => self.eat(),
        }
    }

    /// a cada quadro (dt do jogo)
    pub(crate) fn base_update(&mut self, dt: f64) {
        let a = rules().base.airlock_seconds;
        // caminhada da cena (Player.walkTo): reta de um ponto a outro no tempo dado
        if let Some(&(to, dur)) = self.base.walk.first() {
            self.base.walk_t += dt;
            let k = (self.base.walk_t / dur.max(1e-3)).min(1.0);
            let f = self.base.walk_from;
            let p = [f[0] + (to[0] - f[0]) * k, f[1] + (to[1] - f[1]) * k, f[2] + (to[2] - f[2]) * k];
            let v = [(to[0] - f[0]) / dur, 0.0, (to[2] - f[2]) / dur];
            self.player.prev_pos = self.player.pos;
            self.player.pos = p;
            self.player.vel = v;
            if k >= 1.0 {
                self.base.walk.remove(0);
                self.base.walk_t = 0.0;
                self.base.walk_from = p;
                if self.base.walk.is_empty() {
                    self.player.vel = [0.0; 3];
                    match self.base.then.take() {
                        Some(Then::Airlock) | Some(Then::ExitAirlock) => self.base.step = 1,
                        Some(Then::Outside) => {
                            self.player.frozen = false;
                            self.set_door(false);
                            self.base.mode = Mode::Outside;
                            self.toast("Traje em modo externo. Oxigênio em uso.");
                        }
                        None => {}
                    }
                }
            }
        }
        match self.base.mode {
            Mode::Entering if self.base.step == 1 => {
                self.base.step = 2;
                self.base.seq_t = 0.0;
                self.player.frozen = true;
                self.set_door(false);
                self.base.airlock = Some(("Câmara de pressurização", "Equalizando pressão", 0.0));
            }
            Mode::Entering if self.base.step == 2 => {
                let t0 = self.base.seq_t;
                self.base.seq_t += dt;
                let t = self.base.seq_t;
                let f = ((t - 0.4) / (a - 0.9)).clamp(0.0, 1.0);
                self.base.airlock = Some(("Câmara de pressurização", if f >= 1.0 { "Pressão estável" } else { "Equalizando pressão" }, f));
                if t > 0.5 && t0 <= 0.5 {
                    // troca atrás das portas
                    self.set_inside_view(true, true);
                }
                if t >= a {
                    self.base.step = 3;
                    self.base.airlock = None;
                    self.player.frozen = false;
                    self.base.mode = Mode::Inside;
                    self.base.visited = true;
                    self.toast("Base pressurizada. Traje recarregando.");
                }
            }
            Mode::Exiting if self.base.step == 1 => {
                self.base.step = 2;
                self.base.seq_t = 0.0;
                self.player.frozen = true;
                self.base.airlock = Some(("Despressurizando", "Liberando o ar", 1.0));
            }
            Mode::Exiting if self.base.step == 2 => {
                let t0 = self.base.seq_t;
                self.base.seq_t += dt;
                let t = self.base.seq_t;
                let f = 1.0 - ((t - 0.4) / (a - 0.9)).clamp(0.0, 1.0);
                self.base.airlock = Some(("Despressurizando", if f <= 0.0 { "Vácuo lá fora. Boa sorte" } else { "Liberando o ar" }, f));
                if t >= a - 0.35 && t0 < a - 0.35 {
                    self.set_inside_view(false, true);
                }
                if t >= a {
                    self.base.step = 3;
                    self.base.airlock = None;
                    self.set_door(true);
                    let o = self.base.layout.outside;
                    let gy = self.world.top_y(o[0].floor() as i32, o[2].floor() as i32) as f64 + 1.02;
                    let door = self.base.door_point();
                    self.walk_to(vec![(door, 0.45), ([o[0], gy, o[2]], 0.55)], Then::Outside);
                }
            }
            Mode::Resting => {
                let t0 = self.base.seq_t;
                self.base.seq_t += dt;
                if self.base.seq_t >= 1.7 && t0 < 1.7 {
                    let mut ev = Vec::new();
                    self.survival.rest(&mut ev);
                    self.base.respawn_base = true;
                    self.base.fade = None;
                    self.player.frozen = false;
                    self.base.mode = Mode::Inside;
                    self.toast("Traje recarregado. Se algo der errado, você acorda aqui na base.");
                }
            }
            _ => {}
        }
        // porta e corte, suaves
        let k = |rate: f64| 1.0 - (-rate * dt).exp();
        self.base.door += (self.base.door_target - self.base.door) * k(9.0);
        self.base.inside += (self.base.inside_target - self.base.inside) * k(5.0);

        // botão de ação: o que estiver mais perto
        let p = self.player.pos;
        let near = |q: [f64; 3], r: f64| {
            let d = spacing_core::js::hypot(p[0] - q[0], p[2] - q[2]);
            if d < r && (p[1] - q[1]).abs() < 2.2 {
                d
            } else {
                f64::INFINITY
            }
        };
        let ur = rules().base.use_radius;
        let mut options: Vec<(UseKind, f64)> = Vec::new();
        let site = self.site_option();
        let eat = self.eat_label();
        let l = &self.base.layout;
        if self.death.is_none() && !self.base.busy() && self.screen_open.is_none() {
            if eat.is_some() {
                options.push((UseKind::Eat, 50.0));
            }
            match self.base.mode {
                Mode::Outside => {
                    options.push((UseKind::Enter, near(l.outside, 1.6)));
                    if let Some((u, d, _)) = &site {
                        options.push((UseKind::Site(*u), *d));
                    }
                }
                Mode::Inside => {
                    options.push((UseKind::Exit, near(l.inside, ur)));
                    for f in &l.furniture {
                        let k = match f.def.kind.as_str() {
                            "workbench" | "furnace" | "electrolyzer" => StationId::parse(&f.def.kind).map(UseKind::Station),
                            "bed" => Some(UseKind::Bed),
                            "console" => Some(UseKind::Console),
                            "crates" if self.greenhouse.chest_full() => Some(UseKind::Chest),
                            _ => None,
                        };
                        if let Some(k) = k {
                            options.push((k, near(f.use_at, ur)));
                        }
                    }
                }
                _ => {}
            }
        }
        let best = options.into_iter().filter(|o| o.1.is_finite()).min_by(|a, b| a.1.total_cmp(&b.1)).map(|o| o.0);
        self.base.use_kind = best;
        self.base.use_label = best.map(|k| match k {
            UseKind::Enter => "Entrar na base".to_string(),
            UseKind::Exit => "Sair da base".to_string(),
            UseKind::Bed => "Descansar".to_string(),
            UseKind::Console => "Energia da base".to_string(),
            UseKind::Chest => "Abrir o baú".to_string(),
            UseKind::Site(_) => site.as_ref().map_or_else(String::new, |s| s.2.clone()),
            UseKind::Eat => eat.clone().unwrap_or_default(),
            UseKind::Station(s) => {
                let name = &s.data().name;
                if !self.crafting.is_built(s) {
                    format!("Lugar do {name}")
                } else if self.crafting.has_ready(s) {
                    format!("{name}: pegar")
                } else {
                    name.clone()
                }
            }
        });
        if !self.base.visited && self.base.mode == Mode::Outside && spacing_core::js::hypot(p[0] - l.center[0], p[2] - l.center[2]) < 11.0 {
            self.base.visited = true;
            self.toast("Esta é a base. Entre pela porta para descansar e fabricar.");
        }
    }

    /// Desenha a base: o casco por fora; por dentro, o interior com as paredes da frente tiradas pelo corte.
    pub(crate) fn base_draw(&mut self, m: &BaseModels) {
        let b = &self.base;
        let l = &b.layout;
        let bx = l.structure.bx;
        let at = Mat4::from_translation(Vec3::new(bx.x0 as f32, l.floor_y as f32, bx.z0 as f32));
        let door = b.door as f32;
        let t = self.time as f32;
        let red = !b.door_green;
        let blink = if red && door > 0.05 { if (t * 14.0).sin() > 0.0 { 1.0 } else { 0.2 } } else { 1.0 };
        let door_col = if red { DOOR_RED } else { DOOR_GREEN };
        let slide = |p: &spacing_render::astronaut::NamedPiece| {
            let dir = if p.under("door_l") || p.under("door_in_l") {
                -1.0
            } else if p.under("door_r") || p.under("door_in_r") {
                1.0
            } else {
                return Some(Mat4::IDENTITY);
            };
            (door < 0.97).then(|| Mat4::from_translation(Vec3::new(dir * 0.5 * door, 0.0, 0.0)))
        };
        let parts = &mut self.parts;
        let sprites = &mut self.sprites;
        if !b.indoor_view {
            if let Some(sh) = &m.shell {
                sh.draw_with(at, parts, slide);
                // pernas até o chão
                for (name, p) in &sh.markers {
                    if !name.starts_with("leg_") {
                        continue;
                    }
                    let wx = bx.x0 as f32 + p.x;
                    let wz = bx.z0 as f32 + p.z;
                    let ground = self.world.top_y(wx.floor() as i32, wz.floor() as i32) as f32 + 1.0;
                    let top = l.floor_y as f32 + p.y;
                    if top - ground < 0.05 {
                        continue;
                    }
                    let leg = Mat4::from_translation(Vec3::new(wx, ground, wz)) * Mat4::from_scale(Vec3::new(0.24, top - ground, 0.24));
                    parts.push(PartDraw { mesh: m.cube, world: leg, material: Material::Flat([0.18, 0.19, 0.24]) });
                    let foot = Mat4::from_translation(Vec3::new(wx, ground, wz)) * Mat4::from_scale(Vec3::new(0.6, 0.12, 0.6));
                    parts.push(PartDraw { mesh: m.cube, world: foot, material: Material::Flat([0.12, 0.12, 0.16]) });
                }
                let world_of = |p: Vec3| at.transform_point3(p).to_array();
                if let Some(p) = sh.marker("door_lamp") {
                    signal_lamp(world_of(p), door_col, 0.08, 1.4, blink, sprites);
                }
                if let Some(p) = sh.marker("antenna_lamp") {
                    signal_lamp(world_of(p), [2.4, 0.3, 0.2], 0.08, 1.3, if (t * 2.4).sin() > 0.6 { 1.0 } else { 0.0 }, sprites);
                }
                for (name, p) in &sh.markers {
                    if let Some(i) = name.strip_prefix("beacon_").and_then(|n| n.parse::<f32>().ok()) {
                        signal_lamp(world_of(*p), [0.55, 1.9, 2.3], 0.06, 0.9, 0.75 + 0.25 * (t * 1.6 + i * 1.7).sin(), sprites);
                    }
                }
            }
        } else if let Some(inner) = &m.interior {
            // corte: as paredes viradas para a câmera saem
            let c = Vec3::new((bx.x0 + bx.x1 + 1) as f32 / 2.0, 0.0, (bx.z0 + bx.z1 + 1) as f32 / 2.0);
            let (vx, vz) = (self.rig.eye[0] as f32 - c.x, self.rig.eye[2] as f32 - c.z);
            let vl = vx.hypot(vz).max(1e-3);
            let away = |side: Side| {
                let (nx, nz) = side.normal();
                (nx as f32 * vx + nz as f32 * vz) / vl > 0.2 && b.inside_target > 0.5
            };
            inner.draw_with(at, parts, |p| {
                for (side, s) in [(Side::North, "n"), (Side::South, "s"), (Side::West, "w"), (Side::East, "e")] {
                    let lo = format!("wall_{s}_lo");
                    let hi = format!("wall_{s}_hi");
                    if p.path.iter().any(|n| n.ends_with(&lo) || n.ends_with(&hi)) && away(side) {
                        return None;
                    }
                }
                if (p.under("door_in_l") || p.under("door_in_r")) && away(l.door.2) {
                    return None;
                }
                slide(p)
            });
            if let Some(p) = inner.marker("door_in_lamp") {
                if !away(l.door.2) {
                    signal_lamp(at.transform_point3(p).to_array(), door_col, 0.07, 1.1, blink, sprites);
                }
            }
        }
        // móveis e estações: dentro, ou vistos pela porta aberta
        if b.indoor_view || b.door > 0.02 {
            for f in &l.furniture {
                let kind = f.def.kind.as_str();
                let fw = Mat4::from_translation(Vec3::new(f.center[0] as f32, f.center[1] as f32, f.center[2] as f32)) * Mat4::from_rotation_y(f.facing as f32);
                if let Some(s) = StationId::parse(kind) {
                    // a máquina só aparece depois de fabricada (a bancada já vem pronta)
                    let Some((_, model)) = m.machines.iter().find(|(id, _)| *id == s) else { continue };
                    if !self.crafting.is_built(s) {
                        continue;
                    }
                    // luz de estado: verde piscando = pronto, âmbar = trabalhando, azul fraco = livre (stationModels.ts)
                    let blink = if (t * 6.0).sin() > 0.0 { 1.0 } else { 0.35 };
                    let lamp = if self.crafting.has_ready(s) {
                        [0.3 * blink, 2.4 * blink, 0.8 * blink]
                    } else if self.crafting.working(s) {
                        [2.4, 1.1, 0.25]
                    } else {
                        [0.25, 0.6, 0.9]
                    };
                    let work = self.machine[s.0 as usize];
                    model.draw(fw, work.0 as f32, parts, |name| (name == "lamp").then_some(Material::Glow(lamp)));
                    continue;
                }
                let Some((_, model)) = m.furniture.iter().find(|(k, _)| k == kind) else { continue };
                model.draw(fw, parts);
            }
        }
    }
}
