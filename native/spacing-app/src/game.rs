//! O jogo do M2 (docs/design/PORTE_RUST.md): andar na Lua (ou em Marte). Mundo em chunks com threads, astronauta com física e
//! animação, câmera isométrica, módulo de pouso. Mesmas regras do `src/app/Game.ts` para o que existe aqui.
use glam::{Mat4, Vec3, Vec4};
use spacing_core::camera::{base_fov, IsoRig};
use spacing_core::planet::{planet, PlanetId};
use spacing_core::fx::{dust_of, signal_lamp, takes_footprint, DustFx, Footprints, Particles, Puffs, Rng, Sprite};
use spacing_core::mars_life::MarsLife;
use spacing_core::meteors::{self, Meteors};
use spacing_core::player::{MoveInput, Player, PlayerEvent};
use spacing_core::terrain::{LANDER, SPAWN};
use spacing_core::world::{World, SYNC_BUDGET};
use spacing_render::astronaut::{Astronaut, StaticModel};
use spacing_core::blocks::{hex_to_linear, is_hot, registry};
use spacing_core::debris::Debris;
use spacing_core::drops::{ItemDrops, LootPiles, DROP_SIZE};
use spacing_core::interaction::{self, Ctx, Interaction, Target};
use spacing_core::rules::equipment::Equipment;
use spacing_core::rules::events::DeathCause;
use spacing_core::rules::inventory::Inventory;
use spacing_core::rules::survival::{SuitInput, Survival};
use spacing_core::rules::{rules, Events, GameEvent, ItemId};
use spacing_render::{camera_matrix, item_mesh, load_glb, prop_mesh, Frame, PartDraw, PropDraw, PropInstance, Renderer, ScreenFx, MESH_CUBE, MESH_SHARD};

use crate::base::{BaseModels, BaseState};
use crate::controls::{Controls, Pointer};
use spacing_core::rules::crafting::Crafting;
use spacing_core::rules::greenhouse::Greenhouse;
use spacing_core::rules::power::{Load, PanelSpot, Power, PowerWorld};
use spacing_core::rules::StationId;
use spacing_core::rules::exploration::{Exploration, REVEAL_RADIUS};
use spacing_core::rules::missions::{MissionInput, Missions};
use spacing_core::save::{BaseSave, Pos, PowerSave, SaveData, SAVE_VERSION};
use spacing_core::terrain::{CH, WORLD_GEN_LUA, WORLD_GEN_MARTE};

/// a tela aberta por cima do jogo
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Screen {
    Station(StationId),
    /// o console: energia da base
    Power,
    /// a mochila (tela de itens com o traje à esquerda)
    Bag,
    /// menu: salvar, novo jogo
    Menu,
    /// mapa do tablet (só com o Mapa equipado)
    Map,
}

/// o que a energia vê do jogo (Game.ts: painéis colocados, sombra, consumidores, poeira)
struct PowerView<'a> {
    world: &'a World,
    crafting: &'a Crafting,
    charging: bool,
    dust: f64,
}

impl PowerWorld for PowerView<'_> {
    fn panels(&self) -> Vec<PanelSpot> {
        self.world.placed_props("solarPanel").into_iter().map(|(key, x, z)| PanelSpot { key, x, z }).collect()
    }
    fn exposure(&self, x: i32, z: i32) -> Option<f64> {
        self.world.sun_exposure(x, z, rules().sun_direction)
    }
    fn loads(&self) -> Vec<Load> {
        let mut out: Vec<Load> = StationId::all().filter(|s| self.crafting.working(*s)).map(|s| Load { id: s.key().into(), kw: s.data().kw }).collect();
        if self.charging {
            out.push(Load { id: "suit".into(), kw: rules().power.suit_charge_kw });
        }
        out
    }
    fn dust(&self) -> f64 {
        self.dust
    }
}

/// lava de Marte: dano por segundo em pé nela (MarsDirector, MARS.lavaDps)
const LAVA_DPS: f64 = 22.0;
/// segundos da morte até o cartão (SurvivalDirector)
const DEATH_CARD_DELAY: f64 = 1.6;

/// a cor de um item: a do bloco que ele é, senão a de destaque (linear)
pub fn item_color(item: ItemId) -> [f64; 3] {
    let d = item.data();
    match d.block.or(d.icon_block) {
        Some(b) => registry()[b as usize].side,
        None => hex_to_linear(&d.tint, 1.0),
    }
}

/// a morte em andamento
#[derive(Clone, Copy, Debug)]
pub struct Death {
    pub t: f64,
    pub cause: DeathCause,
    /// perdeu itens (ficaram numa pilha no chão)
    pub lost: bool,
}

/// passo fixo da simulação e limite de passos por quadro (src/app/config.ts)
const FIXED_STEP: f64 = 1.0 / 60.0;
const MAX_STEPS: u32 = 5;

static ASTRONAUT_GLB: &[u8] = include_bytes!("../../assets/models/astronaut.glb");
static LANDER_GLB: &[u8] = include_bytes!("../../assets/models/lander.glb");
static METEOR_GLB: &[u8] = include_bytes!("../../assets/models/meteor.glb");

/// os modelos já na GPU (refeitos quando o Android recria a superfície)
pub struct Models {
    astronaut: Option<Astronaut>,
    lander: Option<StaticModel>,
    /// as três rochas do meteor.glb (rock_a, rock_b, rock_c)
    rocks: Vec<StaticModel>,
    pub base: BaseModels,
    pub greenhouse: crate::greenhouse::GreenhouseModels,
}

/// cor das luzes do módulo de pouso avariado (models.ts: vermelho; verde quando reparado)
const LAMP_RED: [f32; 3] = [2.2, 0.25, 0.15];

impl Models {
    pub fn load(r: &mut Renderer) -> Self {
        let astronaut = load_glb(ASTRONAUT_GLB).ok().and_then(|m| {
            let ids = r.upload_model(&m);
            Astronaut::new(&m, &ids)
        });
        let lander = load_glb(LANDER_GLB).ok().map(|m| {
            let ids = r.upload_model(&m);
            StaticModel::new(&m, &ids)
        });
        let rocks = load_glb(METEOR_GLB)
            .ok()
            .map(|m| {
                let ids = r.upload_model(&m);
                ["rock_a", "rock_b", "rock_c"].iter().filter_map(|n| StaticModel::subtree(&m, &ids, n)).collect()
            })
            .unwrap_or_default();
        if astronaut.is_none() {
            log::warn!("astronauta não carregou");
        }
        let base = BaseModels::load(r);
        let greenhouse = crate::greenhouse::GreenhouseModels::load(r);
        Self { astronaut, lander, rocks, base, greenhouse }
    }
}

pub struct Game {
    pub planet: PlanetId,
    pub seed: u32,
    pub world: World,
    pub player: Player,
    pub rig: IsoRig,
    input: MoveInput,
    acc: f64,
    pub time: f64,
    dark: f64,
    cover_t: f64,
    lander_y: f64,
    base_y: f64,
    pub(crate) parts: Vec<PartDraw>,
    props: Vec<PropDraw>,
    pub(crate) sprites: Vec<Sprite>,
    pub puffs: Puffs,
    pub particles: Particles,
    pub footprints: Footprints,
    dust: DustFx,
    rng: Rng,
    step_side: f64,
    /// clima, redemoinhos, lava e vulcão (só em Marte)
    pub mars: Option<MarsLife>,
    pub meteors: Meteors,
    shocks: Vec<([f32; 4], [f32; 4])>,
    /// clarão de tela (0..1), pausa de impacto e câmera lenta (MeteorDirector)
    flash: f64,
    hit_stop: f64,
    slow_mo: (f64, f64),
    draw_pos: [f64; 3],
    pub inv: Inventory,
    pub equip: Equipment,
    pub survival: Survival,
    pub interaction: Interaction,
    pub debris: Debris,
    pub drops: ItemDrops,
    pub loot: LootPiles,
    /// avisos na tela (texto, segundos restantes)
    pub toasts: Vec<(String, f64)>,
    pub death: Option<Death>,
    /// vermelho de dano na tela (0..1)
    hurt: f64,
    burn_toast: f64,
    /// a mira de agora (para o HUD) e a matriz da câmera do último quadro
    pub pointer: Option<(Pointer, bool)>,
    pub view_proj: Mat4,
    pub screen: (f32, f32),
    pub base: BaseState,
    pub crafting: Crafting,
    /// tela aberta por cima do jogo (estação, energia)
    pub screen_open: Option<Screen>,
    pub power: Power,
    pub greenhouse: Greenhouse,
    /// tempo do laço de cada máquina e quanto ela está trabalhando (0..1, suave)
    pub machine: [(f64, f64); 3],
    pub missions: Missions,
    pub exploration: Exploration,
    reveal_t: f64,
    /// banner de objetivo concluído (título, segundos restantes)
    pub banner: Option<(String, f64)>,
    /// topo das colunas descobertas, para o mapa do tablet
    pub map: crate::map::MapSurface,
    /// chunks perto do jogador que ainda não têm malha (a tela de carregamento espera chegar a zero)
    pub chunks_left: usize,
}

/// versão do gerador de mundo de cada planeta (WORLD_GEN do TS)
pub fn world_gen(p: PlanetId) -> i64 {
    match p {
        PlanetId::Lua => WORLD_GEN_LUA as i64,
        PlanetId::Marte => WORLD_GEN_MARTE as i64,
    }
}

impl Game {
    /// Jogo novo com esta semente.
    pub fn new(planet_id: PlanetId, seed: u32, threads: usize) -> Self {
        Self::load(planet_id, None, seed, threads)
    }

    /// Do salvamento (já migrado; ver `spacing_core::save`), ou jogo novo com `seed` se None (Game.ts monta igual).
    pub fn load(planet_id: PlanetId, save: Option<&SaveData>, seed: u32, threads: usize) -> Self {
        let seed = save.map_or(seed, |s| s.seed.max(0.0) as u32);
        let mut world = World::new(planet_id, seed);
        world.radius = 3;
        // edições e objetos do salvamento entram antes de qualquer chunk ser gerado
        if let Some(s) = save {
            world.load(&s.world);
        }
        let mut base = BaseState::new(world.terrain.as_ref());
        world.structures.push(base.layout.structure.clone());
        let greenhouse = save.map_or_else(Greenhouse::new, |s| Greenhouse::from_save(&s.greenhouse));
        if let Some(site) = &greenhouse.site {
            world.structures.push(spacing_core::rules::greenhouse::greenhouse_structure(site));
        }
        let crafting = save.map_or_else(Crafting::new, |s| Crafting::from_save(&s.crafting));
        let power = Power::new(
            (base.layout.center[0], base.layout.center[2]),
            planet(planet_id).solar,
            if planet_id == PlanetId::Marte { rules().power.shade_marte } else { rules().power.shade_lua },
            save.and_then(|s| s.power.map(|p| p.battery)),
            &PowerView { world: &world, crafting: &crafting, charging: false, dust: 0.0 },
        );
        // carregamento inicial: tudo na hora, em volta do pouso (Game.ts faz o mesmo)
        world.update(0.0, 0.0, SYNC_BUDGET);
        world.enable_threads(threads);
        let mut player = Player::new(planet(planet_id).physics);
        match save.and_then(|s| s.player) {
            Some(p) => {
                player.pos = [p.x, p.y + 0.05, p.z];
                // garante que não nasce dentro de um bloco
                while Player::collides(&mut world, player.pos[0], player.pos[1], player.pos[2]) && player.pos[1] < CH as f64 {
                    player.pos[1] += 1.0;
                }
                player.prev_pos = player.pos;
            }
            None => player.spawn(&mut world, SPAWN.0, SPAWN.1),
        }
        if let Some(s) = save {
            base.respawn_base = s.base.respawn == "base";
            base.visited = s.base.visited;
        }
        let mut inv = save.map_or_else(Inventory::new, |s| Inventory::from_save(&s.inventory));
        if save.is_none() {
            // jogo novo: a placa de circuito do Mapa vem aproveitada do módulo de pouso
            inv.add(ItemId::of("circuit"), 1, false, &mut Events::new());
        }
        let mut exploration = Exploration::new(save.map(|s| &s.explored));
        exploration.reveal_around(player.pos[0], player.pos[2], REVEAL_RADIUS, &mut Events::new());
        let mut loot = LootPiles::new(planet(planet_id).physics.loot_gravity, seed as u64 ^ 0x100);
        if let Some(s) = save {
            loot.load(&s.loot);
        }
        let lander_y = world.top_y(LANDER.0 as i32, LANDER.1 as i32) as f64 + 1.0;
        let base_y = world.terrain.spawn_h();
        let pd = planet(planet_id);
        let mut rig = IsoRig::default();
        rig.snap(focus(player.pos));
        let draw_pos = player.pos;
        Self {
            planet: planet_id,
            seed,
            world,
            player,
            rig,
            input: MoveInput::default(),
            acc: 0.0,
            time: 0.0,
            dark: 0.0,
            cover_t: 0.0,
            lander_y,
            base_y,
            parts: Vec::new(),
            props: Vec::new(),
            sprites: Vec::new(),
            puffs: Puffs::default(),
            particles: Particles::default(),
            footprints: Footprints::new(pd.footprint_life, pd.footprint_color),
            dust: DustFx { gravity: pd.physics.gravity },
            rng: Rng::new(seed as u64),
            step_side: 1.0,
            mars: (planet_id == spacing_core::planet::PlanetId::Marte).then(MarsLife::new),
            meteors: Meteors::new(seed as u64),
            shocks: Vec::new(),
            flash: 0.0,
            hit_stop: 0.0,
            slow_mo: (0.0, 1.0),
            draw_pos,
            inv,
            equip: save.map_or_else(Equipment::new, |s| Equipment::from_save(&s.equipment)),
            survival: Survival::new(pd.physics.fall_safe_speed, save.and_then(|s| s.suit.as_ref())),
            interaction: Interaction::default(),
            debris: Debris::new(pd.physics.debris_gravity, pd.physics.debris_drag, seed as u64 ^ 0x5eed),
            drops: ItemDrops::new(pd.physics.debris_gravity, seed as u64 ^ 0xd0),
            loot,
            toasts: Vec::new(),
            death: None,
            hurt: 0.0,
            burn_toast: 0.0,
            pointer: None,
            view_proj: Mat4::IDENTITY,
            screen: (1.0, 1.0),
            base,
            crafting,
            screen_open: None,
            power,
            greenhouse,
            machine: [(0.0, 0.0); 3],
            missions: Missions::new(planet_id == PlanetId::Marte, save.map(|s| s.missions)),
            exploration,
            reveal_t: 0.0,
            banner: None,
            map: Default::default(),
            // ainda não se sabe: o primeiro `update` conta
            chunks_left: usize::MAX,
        }
        .placed(save.is_some_and(|s| s.base.inside))
    }

    /// salvo dentro da base: volta dentro, sem transição
    fn placed(mut self, inside: bool) -> Self {
        if inside {
            self.place_inside();
            self.rig.snap(focus(self.player.pos));
            self.draw_pos = self.player.pos;
        }
        self
    }

    /// o jogo inteiro no formato do salvamento (Game.persist)
    pub fn to_save(&self) -> SaveData {
        let p = self.player.pos;
        SaveData {
            version: SAVE_VERSION,
            seed: self.seed as f64,
            world_gen: world_gen(self.planet),
            saved_at: 0.0,
            world: self.world.serialize(),
            inventory: self.inv.serialize(),
            player: Some(Pos { x: p[0], y: p[1], z: p[2] }),
            missions: self.missions.serialize(),
            suit: Some(self.survival.serialize()),
            loot: self.loot.serialize(),
            equipment: self.equip.serialize(),
            base: BaseSave {
                inside: self.base.inside(),
                respawn: if self.base.respawn_base { "base" } else { "lander" }.into(),
                visited: self.base.visited,
            },
            explored: self.exploration.serialize(),
            crafting: self.crafting.serialize(),
            power: Some(PowerSave { battery: self.power.serialize() }),
            greenhouse: self.greenhouse.serialize(),
        }
    }

    /// dá para salvar agora (não no meio de uma cena nem morto)
    pub fn can_save(&self) -> bool {
        self.death.is_none() && !self.base.busy()
    }

    /// energia que a estação recebe agora: o forno usa o sol dos espelhos, as outras a rede
    pub fn station_speed(&self, s: StationId) -> f64 {
        if s.data().energy == "sun" {
            self.power.sun
        } else {
            self.power.satisfaction
        }
    }

    /// energia e fabricação, a cada quadro
    fn run_base_systems(&mut self, dt: f64, ev: &mut Events) {
        let view = PowerView {
            world: &self.world,
            crafting: &self.crafting,
            charging: self.base.inside() && self.survival.battery < 100.0 && !self.survival.dead,
            dust: self.mars.as_ref().map_or(0.0, |m| m.dust()),
        };
        self.power.update(dt, &view);
        let (sun, grid) = (self.power.sun, self.power.satisfaction);
        let speed = move |s: StationId| if s.data().energy == "sun" { sun } else { grid };
        self.crafting.update(dt, &speed, ev);
        for (i, s) in StationId::all().enumerate() {
            let want = if self.crafting.is_built(s) && self.crafting.working(s) && !self.crafting.has_ready(s) { 1.0 } else { 0.0 };
            let m = &mut self.machine[i];
            m.1 += (want - m.1) * (1.0 - (-dt * 3.0).exp());
            m.0 += dt * m.1;
        }
    }

    /// o jogador apertou algo na tela da estação (hud::UiAction)
    pub fn ui_action(&mut self, a: crate::hud::UiAction) {
        use crate::hud::UiAction as A;
        let mut ev = Events::new();
        match a {
            A::Start(r, batch) => {
                let rng = &mut self.rng;
                if self.crafting.start(r, batch, &mut self.inv, &self.equip, &mut || rng.f(), &mut ev) {
                    let name = crate::hud::output_name(r.data().outputs[0]);
                    let n = if batch > 1 { format!("{batch}× {name}") } else { name };
                    self.toast(format!("{}: {n}", r.data().station.data().name));
                }
            }
            A::Take(s, slot) => {
                if let Some(res) = self.crafting.take(s, slot, &mut self.inv, &mut self.equip, &mut ev) {
                    for o in &res.delivered {
                        match o {
                            spacing_core::rules::data::Output::Equip { equip } => self.toast(format!("Equipado: {}", equip.data().name)),
                            spacing_core::rules::data::Output::Station { station } => self.toast(format!("Instalado: {}", station.data().name)),
                            _ => {}
                        }
                    }
                    if res.recipes.iter().any(|r| r.key() == "solar_panel") {
                        self.toast("Painel solar: escolha na barra, ligue o modo construir e toque no chão, ao sol e perto da base");
                    }
                    if res.partial {
                        self.toast("Mochila cheia: o resto ficou na estação");
                    }
                }
            }
            A::Pause(s, slot) => {
                self.crafting.toggle_pause(s, slot, &mut ev);
            }
            A::Cancel(s, slot) => {
                if self.crafting.cancel(s, slot, &mut self.inv, &mut ev).is_some() {
                    self.toast("Trabalho cancelado: o material voltou");
                }
            }
            A::Close => self.screen_open = None,
            A::Move { from, to, n } => {
                self.inv.move_n(from as i64, to as i64, n as i64, &mut ev);
            }
            A::QuickMove(from) => {
                self.inv.quick_move(from as i64, &mut ev);
            }
            A::Sort => self.inv.sort_bag(&mut ev),
        }
        self.react(ev);
    }

    /// o raio da câmera por um ponto da tela (pixels)
    fn ray(&self, x: f32, y: f32) -> ([f64; 3], [f64; 3]) {
        let inv = self.view_proj.inverse();
        let nx = x / self.screen.0 * 2.0 - 1.0;
        let ny = 1.0 - y / self.screen.1 * 2.0;
        let a = inv.project_point3(Vec3::new(nx, ny, 0.0));
        let b = inv.project_point3(Vec3::new(nx, ny, 1.0));
        let d = (b - a).normalize();
        ([a.x as f64, a.y as f64, a.z as f64], [d.x as f64, d.y as f64, d.z as f64])
    }

    fn pick(&self, x: f32, y: f32) -> Option<Target> {
        let (o, d) = self.ray(x, y);
        interaction::pick(&self.world, o, d)
    }

    pub fn toast(&mut self, msg: impl Into<String>) {
        let msg = msg.into();
        self.toasts.retain(|(m, _)| *m != msg);
        self.toasts.push((msg, 3.5));
        if self.toasts.len() > 3 {
            self.toasts.remove(0);
        }
    }

    /// o que a mira, o toque e o modo construir fazem neste quadro (Interaction.update)
    fn interact(&mut self, dt: f64, c: &mut Controls, taps: &[(f32, f32, bool)], ev: &mut Events) {
        self.screen = c.screen;
        // dentro da base (e nas cenas) o mundo de fora fica travado
        let locked = self.base.indoor_view || self.base.busy() || self.screen_open.is_some();
        self.pointer = if self.death.is_some() || locked { None } else { c.pointer() };
        let alive = self.death.is_none() && !locked;
        let target = match self.pointer {
            // construir mira no dedo, minerar na mira acima dele
            Some((p, _)) if alive => if self.interaction.build_mode { self.pick(p.fx, p.fy) } else { self.pick(p.x, p.y) },
            _ => None,
        };
        let holding = alive && self.pointer.is_some_and(|(_, h)| h);
        let touch = self.pointer.is_some_and(|(p, _)| p.touch);
        let tap_targets: Vec<(Option<Target>, bool)> = taps.iter().map(|&(x, y, place)| (self.pick(x, y), place)).collect();
        let rate = self.survival.drill_rate() * self.equip.drill().data().speed;
        let tier = self.equip.drill().data().tier;
        let mut cx = Ctx {
            world: &mut self.world,
            player: &mut self.player,
            inv: &mut self.inv,
            debris: &mut self.debris,
            drops: &mut self.drops,
            particles: &mut self.particles,
            ev,
        };
        if alive {
            for (t, place) in tap_targets {
                self.interaction.tap(t, place, &mut cx);
            }
        }
        self.interaction.update(dt, target, holding, touch, rate, tier, &mut cx);
    }

    /// as respostas aos fatos do passo: primeiro as missões (elas também reagem a eventos), depois o resto
    pub(crate) fn react(&mut self, ev: Events) {
        let ev = self.missions.react(ev);
        self.respond(ev);
    }

    /// as respostas aos fatos (Game.wireEvents, SurvivalDirector)
    fn respond(&mut self, ev: Events) {
        for e in ev {
            match e {
                GameEvent::MissionStarted { hint: Some(h), .. } => self.toast(h),
                GameEvent::MissionCompleted { title, .. } => self.banner = Some((title.to_string(), 3.2)),
                GameEvent::MissionMissing { items } => {
                    let list: Vec<String> = items.iter().map(|(i, n)| format!("{n} {}", i.data().name.to_lowercase())).collect();
                    self.toast(format!("Faltam: {}", list.join(", ")));
                }
                GameEvent::PlayerDamaged { amount, .. } => {
                    self.rig.shake((0.2 + amount / 60.0).min(0.7));
                    self.hurt = (self.hurt + 0.4 + amount / 60.0).min(1.0);
                }
                GameEvent::PlayerDied { cause, .. } => self.die(cause),
                GameEvent::DrillWeak { tier, target } => self.toast(format!("{target}: precisa da broca de nível {tier}")),
                GameEvent::InventoryFull { .. } => self.toast("Mochila cheia"),
                GameEvent::ActionDenied { reason, .. } => self.toast(match reason {
                    "emptySlot" => "Escolha um item na barra para construir",
                    "notBlock" => "Esse item não é um bloco",
                    "blocked" => "Não dá para colocar aí",
                    _ => "Não dá",
                }),
                GameEvent::SuitWarning { meter, level } if level > 0 => {
                    use spacing_core::rules::events::Meter;
                    self.toast(match (meter, level) {
                        (Meter::O2, 2) => "Oxigênio crítico! Volte ao módulo",
                        (Meter::O2, _) => "Oxigênio baixo",
                        (Meter::Battery, _) => "Bateria do traje fraca: a broca fica lenta",
                        (Meter::Energy, 2) => "Fome forte: coma alguma coisa",
                        (Meter::Energy, _) => "Com fome",
                        _ => "Traje danificado",
                    });
                }
                GameEvent::SuitRecharge { on: true } => {
                    let s = &self.survival;
                    if s.o2.min(s.battery).min(s.integrity) < 95.0 {
                        self.toast("Recarregando o traje");
                    }
                }
                GameEvent::CraftReady { station, recipe, .. } => {
                    let name = crate::hud::output_name(recipe.data().outputs[0]);
                    self.toast(if self.base.inside() { format!("{} pronto: {name}", station.data().name) } else { format!("{} terminou: {name} espera na base", station.data().name) });
                }
                GameEvent::SiteTap { pos, item } => self.site_tap(pos, item),
                GameEvent::BuildMode { on } => self.toast(if on { "Modo construir: toque para colocar o item da barra" } else { "Modo minerar: segure para minerar" }),
                _ => {}
            }
        }
    }

    fn die(&mut self, cause: DeathCause) {
        let mut ev = Events::new();
        self.interaction.cancel(&mut self.player);
        self.player.dead = true;
        let items = self.inv.take_everything(&mut ev);
        let lost = !items.is_empty();
        self.loot.drop(self.player.pos, &items);
        self.death = Some(Death { t: 0.0, cause, lost });
        self.rig.shake(0.5);
        self.slow_mo = (1.1, 0.3);
    }

    /// traje novo no módulo de pouso (SurvivalDirector.respawn)
    fn respawn(&mut self) {
        let mut ev = Events::new();
        let lost = self.death.is_some_and(|d| d.lost);
        self.death = None;
        self.survival.respawn(&mut ev);
        self.player.dead = false;
        self.player.vel = [0.0; 3];
        self.player.frozen = false;
        if self.base.respawn_base {
            self.place_inside();
        } else {
            self.player.spawn(&mut self.world, SPAWN.0, SPAWN.1);
        }
        self.rig.snap(focus(self.player.pos));
        self.draw_pos = self.player.pos;
        let c = self.player.pos;
        for _ in 0..46 {
            let g = &mut self.particles.rng;
            let (a, r) = (g.f() * std::f64::consts::TAU, g.f() * 0.9);
            let (vy, size, life, up) = (3.0 + g.f() * 6.0, 0.07 + g.f() * 0.08, 0.8 + g.f() * 0.8, g.f() * 0.5);
            self.particles.spawn([c[0] + a.cos() * r, c[1] + up, c[2] + a.sin() * r], [a.cos() * 0.3, vy, a.sin() * 0.3], size, [0.6, 2.0, 2.4], life, -1.0);
        }
        if lost {
            self.toast("Seus itens ficaram onde você caiu: o brilho azul");
        }
    }

    /// Dano direto (capturas de teste): passa pelos mesmos eventos da sobrevivência.
    pub fn hurt_player(&mut self, amount: f64) {
        let mut ev = Events::new();
        self.survival.damage(amount, DeathCause::Meteor, false, self.player.pos, &mut ev);
        self.react(ev);
    }

    /// o texto da causa da morte
    pub fn death_text(c: DeathCause) -> &'static str {
        match c {
            DeathCause::Asphyxia => "Acabou o oxigênio",
            DeathCause::Meteor => "Atingido por um meteoro",
            DeathCause::Fall => "Queda forte demais",
            DeathCause::Heat => "Queimado na lava",
            DeathCause::Hunger => "Fome",
        }
    }

    /// a cada quadro: morte, reserva de O₂, lava, itens soltos
    fn survive(&mut self, real_dt: f64, dt: f64, ev: &mut Events, respawn: bool) {
        if let Some(d) = &mut self.death {
            d.t += real_dt;
            if d.t >= DEATH_CARD_DELAY && respawn {
                self.respawn();
            }
        }
        let playing = self.death.is_none();
        // reserva: cilindro de O₂ conecta sozinho
        let r = &rules().survival.o2_reserve;
        let o2 = ItemId::of("o2");
        if playing && !self.survival.in_pressure && self.survival.o2 / 100.0 <= r.at && self.inv.has(o2, 1) {
            self.inv.remove(o2, 1, ev);
            self.survival.o2 = (self.survival.o2 + r.amount).min(100.0);
            let left = self.inv.count(o2);
            self.toast(format!("Cilindro de O₂ conectado (+{:.0}%). Restam {left}", r.amount));
        }
        // lava (Marte): em pé em cima ou dentro
        let p = self.player.pos;
        let (fx, fy, fz) = (p[0].floor() as i32, p[1].floor() as i32, p[2].floor() as i32);
        let mut hot = false;
        for dx in -1..=1 {
            for dz in -1..=1 {
                let (nx, nz) = (p[0] + dx as f64 * 0.45, p[2] + dz as f64 * 0.45);
                let (bx, bz) = (nx.floor() as i32, nz.floor() as i32);
                if (dx != 0 || dz != 0) && bx == fx && bz == fz {
                    continue;
                }
                if is_hot(self.world.peek_block(bx, fy - 1, bz)) || is_hot(self.world.peek_block(bx, fy, bz)) {
                    hot = true;
                }
            }
        }
        self.burn_toast -= real_dt;
        if hot && playing {
            self.survival.damage(LAVA_DPS * dt, DeathCause::Heat, true, p, ev);
            if self.burn_toast <= 0.0 {
                self.burn_toast = 4.0;
                self.toast("A lava está queimando o traje!");
                self.rig.shake(0.25);
            }
        }
        // pedaços, itens voando, pilhas
        self.debris.update(dt, &self.world, self.player.pos, self.player.vel);
        let over = self.drops.update(dt, self.player.center(), &mut self.inv, ev);
        for (item, n, at) in over {
            self.loot.drop(at, &spacing_core::rules::Counts::from_pairs(&[(item, n)]));
        }
        self.loot.update(dt, self.time, &mut self.world, self.player.center(), playing, &self.inv, &mut self.drops);
        self.hurt = (self.hurt - real_dt * 1.5).max(0.0);
        for t in &mut self.toasts {
            t.1 -= real_dt;
        }
        self.toasts.retain(|t| t.1 > 0.0);
    }

    /// Um quadro: entrada, passos fixos de física, câmera, chunks.
    pub fn update(&mut self, real_dt: f64, c: &mut Controls) {
        let real_dt = real_dt.min(0.25);
        // pausa de impacto e câmera lenta do meteoro: o jogo para um instante e corre devagar; a câmera continua
        let dt = if self.hit_stop > 0.0 {
            self.hit_stop -= real_dt;
            0.0
        } else if self.slow_mo.0 > 0.0 {
            self.slow_mo.0 -= real_dt;
            real_dt * self.slow_mo.1
        } else {
            real_dt
        };
        self.time += dt;
        let a = c.take_actions();
        let mut ev = Events::new();
        if a.toggle_build {
            let on = !self.interaction.build_mode;
            self.interaction.set_build_mode(on, &mut ev);
        }
        if let Some(i) = a.select {
            self.inv.select(i as i64, &mut ev);
        }
        let taps: Vec<(f32, f32, bool)> = a.taps.iter().flatten().copied().collect();
        if a.use_ {
            self.base_use();
        }
        if a.menu {
            self.screen_open = if self.screen_open == Some(Screen::Menu) { None } else { Some(Screen::Menu) };
        }
        if a.map {
            self.toggle_map();
        }
        if a.bag {
            self.screen_open = match self.screen_open {
                Some(Screen::Bag) => None,
                None if !self.base.busy() && self.death.is_none() => Some(Screen::Bag),
                other => other,
            };
        }
        if a.close {
            self.screen_open = None;
        }
        // morto: qualquer toque (ou o pulo) depois do cartão renasce
        let respawn = self.death.is_some() && (a.jump || !taps.is_empty());
        if a.meteor {
            let p = self.player.pos;
            self.meteors.launch_random(&mut self.world, p, self.rig.yaw);
        }
        if a.jump {
            self.input.jump = true;
        }
        if a.rotate != 0.0 {
            self.rig.rotate(a.rotate);
        }
        if a.zoom != 0.0 {
            self.rig.zoom(a.zoom);
        }
        let hz = c.held_zoom(dt);
        if hz != 1.0 {
            self.rig.zoom(hz);
        }
        let (mut mx, mut my) = c.move_dir();
        if self.base.busy() || self.screen_open.is_some() {
            (mx, my) = (0.0, 0.0);
            self.input.jump = false;
        }
        self.input.move_x = mx;
        self.input.move_y = my;
        self.interact(dt, c, &taps, &mut ev);
        let has_input = mx != 0.0 || my != 0.0;
        self.interaction.steer(&mut self.input, has_input, &self.player, self.rig.yaw, dt);

        self.acc += dt;
        let mut n = (self.acc / FIXED_STEP).floor() as u32;
        if n > MAX_STEPS {
            n = MAX_STEPS;
            self.acc = 0.0;
        } else {
            self.acc -= n as f64 * FIXED_STEP;
        }
        let pressure = [LANDER.0 + 0.5, self.lander_y, LANDER.1 + 0.5];
        for _ in 0..n {
            self.player.step(&mut self.world, FIXED_STEP, &mut self.input, self.rig.yaw);
            let v = self.player.vel;
            let suit = SuitInput {
                pos: self.player.pos,
                moving: spacing_core::js::hypot(v[0], v[2]) > 0.3,
                mining: self.player.mining,
                pressure_center: pressure,
                sheltered: self.base.inside(),
                drill_drain: self.equip.drill().data().drain,
                base_charge: 1.0,
            };
            self.survival.step(FIXED_STEP, &suit, &mut ev);
        }
        self.player_fx(&mut ev);
        self.base_update(dt);
        self.run_base_systems(dt, &mut ev);
        self.greenhouse_update(dt);
        let alpha = self.acc / FIXED_STEP;
        self.draw_pos = self.player.animate(dt, alpha);

        let mut wind = 0.0;
        if let Some(m) = &mut self.mars {
            let focus = self.rig.target;
            let ((push, hit), shake) = m.update(dt, &mut self.world, self.player.pos, focus, &mut self.puffs, &mut self.particles);
            self.player.push = push;
            if let Some(h) = hit {
                self.rig.shake(0.35);
                self.player.vel[0] += h.vx * 1.2;
                self.player.vel[2] += h.vz * 1.2;
                self.player.vel[1] += 2.5;
            }
            if shake > 0.0 {
                self.rig.shake(shake);
            }
            wind = m.dust() * 15.0;
        }
        let impacts = self.meteors.update(dt, &mut self.world, self.player.pos, self.rig.yaw, &mut self.puffs, &mut self.particles);
        for e in impacts {
            self.survival.on_meteor(e.distance, self.base.inside(), self.player.pos, &mut ev);
            self.impact(e);
        }
        self.survive(real_dt, dt, &mut ev, respawn);
        if let Some(b) = &mut self.banner {
            b.1 -= real_dt;
            if b.1 <= 0.0 {
                self.banner = None;
            }
        }
        self.flash = (self.flash - real_dt * meteors::camera::FLASH_DECAY).max(0.0);
        self.puffs.update(dt);
        self.particles.update(dt);
        self.footprints.update(dt, wind);
        self.cover(dt);
        self.rig.update(real_dt, focus(self.draw_pos), false);
        self.world.radius = self.rig.chunk_radius();
        self.chunks_left = self.world.update(self.player.pos[0], self.player.pos[2], 2);
        for e in self.world.events.drain(..) {
            let spacing_core::world::WorldEvent::BlockChanged { x, y, z, .. } = e;
            self.footprints.clear_at(x, y, z);
            self.debris.disturb(x, y, z);
            self.map.invalidate(x, z);
        }
        // o mapa lê aos poucos o topo do que foi descoberto (de uma vez quando está aberto)
        self.prepare_map(if self.screen_open == Some(Screen::Map) { 6 } else { 1 });
        // missões: reagem ao que aconteceu e depois andam (Missions.update); o mapa é descoberto ao andar
        let mut ev = self.missions.react(ev);
        if self.death.is_none() {
            let prop = self.missions.wanted_prop().and_then(|k| self.world.find_prop(k));
            let inp = MissionInput { player: self.player.pos, prop, meteors_active: !self.meteors.active.is_empty(), lander_y: self.lander_y };
            if let Some(r) = self.missions.update(dt, &inp, &mut self.inv, &mut ev) {
                if let Some(t) = self.meteors.pick_target(&mut self.world, self.player.pos, self.rig.yaw, r.min, r.max) {
                    self.meteors.launch(t, r.radius, true, self.rig.yaw);
                }
            }
            self.reveal_t -= dt;
            if self.reveal_t <= 0.0 {
                self.reveal_t = 0.3;
                self.exploration.reveal_around(self.player.pos[0], self.player.pos[2], REVEAL_RADIUS, &mut ev);
            }
        }
        self.respond(ev);
    }

    /// altura do planalto do pouso (o mapa clareia acima dela e escurece abaixo)
    pub fn base_height(&self) -> f64 {
        self.base_y
    }

    /// abre ou fecha o mapa do tablet (precisa do Mapa, fabricado na bancada)
    pub fn toggle_map(&mut self) {
        if self.screen_open == Some(Screen::Map) {
            self.screen_open = None;
        } else if !self.equip.has(spacing_core::rules::EquipId::of("map")) {
            self.toast("Fabrique o Mapa na bancada da base para usar o tablet.");
        } else if self.screen_open.is_none() && !self.base.busy() && self.death.is_none() {
            self.screen_open = Some(Screen::Map);
        }
    }

    /// onde o marcador de objetivo aponta (o meteorito, o módulo), se houver
    pub fn mission_target(&self) -> Option<[f64; 3]> {
        let prop = self.missions.wanted_prop().and_then(|k| self.world.find_prop(k));
        self.missions.target(prop, self.lander_y)
    }

    pub fn sprite_count(&self) -> usize {
        self.sprites.len()
    }

    /// O que o jogador sente num impacto (MeteorDirector): tremor, onda, soco de zoom, clarão, pausa e câmera lenta.
    fn impact(&mut self, e: meteors::Impact) {
        use meteors::camera as C;
        // a velocidade do empurrão perto (Meteors.impact)
        if e.distance < 7.0 {
            let p = self.player.pos;
            let (dx, dz) = (p[0] - e.pos[0], p[2] - e.pos[2]);
            let l = spacing_core::js::hypot(dx, dz).max(1e-6);
            let k = 1.0 - e.distance / 7.0;
            self.player.vel[0] += dx / l * 6.0 * k;
            self.player.vel[2] += dz / l * 6.0 * k;
            self.player.vel[1] = self.player.vel[1].max(4.0 * k);
        }
        self.rig.shake((C::SHAKE_MAX - e.distance / C::SHAKE_RANGE).max(C::SHAKE_MIN));
        self.meteors.waves.add([e.pos[0], e.pos[1] + 0.5, e.pos[2]], e.radius / meteors::RADIUS_REF);
        if e.distance < C::PUNCH_RANGE {
            self.rig.punch(C::PUNCH * (1.0 - e.distance / C::PUNCH_RANGE));
        }
        self.flash = self.flash.max(C::FLASH_MAX * (1.0 - e.distance / C::FLASH_RANGE).max(0.0).powf(1.5));
        if e.distance < C::NEAR_RANGE {
            self.hit_stop = self.hit_stop.max(C::HIT_STOP);
            self.slow_mo = C::SLOW_MO;
        }
        // pegadas sobre a cratera somem junto (os blocos mudaram)
    }

    /// o chão sob os pés (o astronauta pode estar um tico acima no fim de um degrau)
    fn ground(&self) -> u8 {
        let p = self.player.pos;
        self.world.peek_block(p[0].floor() as i32, spacing_core::js::round(p[1]) as i32 - 1, p[2].floor() as i32)
    }

    /// poeira e pegadas dos eventos do astronauta (Game.wireEvents)
    fn player_fx(&mut self, ev: &mut Events) {
        let events: Vec<PlayerEvent> = self.player.events.drain(..).collect();
        for e in events {
            let dust = dust_of(self.ground());
            match e {
                PlayerEvent::Step(p) => {
                    if let Some(d) = dust {
                        let v = self.player.vel;
                        let run = ((spacing_core::js::hypot(v[0], v[2]) - 2.0) / 2.4).clamp(0.0, 1.0);
                        self.dust.step(&mut self.puffs, &mut self.particles, p, v[0], v[2], d, run);
                    }
                    self.footstep(false);
                }
                PlayerEvent::Land(p, speed) => {
                    self.survival.on_land(speed, p, ev);
                    if let Some(d) = dust {
                        self.dust.land(&mut self.puffs, &mut self.particles, p, d, ((speed - 7.0) / 8.0).min(1.0));
                    }
                    self.footstep(true);
                    self.rig.shake(0.12);
                }
                PlayerEvent::Jump(p) => {
                    if let Some(d) = dust {
                        self.dust.jump(&mut self.puffs, &mut self.rng, p, d);
                    }
                }
            }
        }
    }

    fn footstep(&mut self, both: bool) {
        let p = self.player.pos;
        if !takes_footprint(self.ground()) || (p[1] - spacing_core::js::round(p[1])).abs() > 0.05 {
            return;
        }
        let a = self.player.facing;
        let (rx, rz) = (a.cos(), -a.sin());
        let sides: Vec<f64> = if both {
            vec![-1.0, 1.0]
        } else {
            self.step_side = -self.step_side;
            vec![self.step_side]
        };
        for side in sides {
            self.footprints.place(p[0] + rx * side * 0.13, spacing_core::js::round(p[1]), p[2] + rz * side * 0.13, a + std::f64::consts::PI);
        }
    }

    /// caverna: a câmera chega perto quando há rocha em cima; escurece quando o céu some (Game.updateCover)
    fn cover(&mut self, dt: f64) {
        let p = self.player.pos;
        self.cover_t -= dt;
        if self.cover_t <= 0.0 {
            self.cover_t = 0.1;
            let mut n = 0;
            let y = p[1] + 1.9;
            let surface = self.world.terrain.column(p[0].floor(), p[2].floor()).0;
            if surface > p[1] + 3.0 {
                for dz in -1..=1 {
                    for dx in -1..=1 {
                        if self.world.roofed(p[0] + dx as f64 * 4.0, y, p[2] + dz as f64 * 4.0) {
                            n += 1;
                        }
                    }
                }
            }
            self.rig.cave_target = spacing_core::js::smoothstep(0.3, 0.7, n as f64 / 9.0);
        }
        let sky = self.world.sky_at(p[0], p[1] + 1.2, p[2]);
        let dark = 1.0 - spacing_core::js::smoothstep(0.2, 0.85, sky);
        self.dark += (dark - self.dark) * (1.0 - (-2.5 * dt).exp());
    }

    /// Sobe para a GPU as malhas novas e tira as que saíram.
    pub fn sync(&mut self, r: &mut Renderer) {
        for k in self.world.take_unloaded() {
            r.remove_chunk(k);
        }
        for m in self.world.take_meshes() {
            r.upload_chunk(&m);
        }
    }

    pub fn frame<'a>(&'a mut self, models: &Models, aspect: f64) -> Frame<'a> {
        self.parts.clear();
        let p = self.draw_pos;
        if let Some(a) = &models.astronaut {
            a.draw(Vec3::new(p[0] as f32, p[1] as f32, p[2] as f32), self.player.facing as f32, &self.player.anim.pose, self.player.mining, true, &mut self.parts);
        }
        self.sprites.clear();
        // dentro da base só a base, o astronauta e as partículas (ADR 0006)
        let indoor = self.base.indoor_view;
        self.base_draw(&models.base);
        if !indoor {
            self.greenhouse_draw(&models.greenhouse, models.base.cube);
        }
        if let (Some(l), false) = (&models.lander, indoor) {
            let base = Vec3::new(LANDER.0 as f32 + 0.5, self.lander_y as f32, LANDER.1 as f32 + 0.5);
            l.draw(Mat4::from_translation(base), &mut self.parts);
            for (name, at) in &l.markers {
                if name.starts_with("lamp_") {
                    let pos = base + *at;
                    signal_lamp(pos.to_array(), LAMP_RED, 0.07, 1.3, 1.0, &mut self.sprites);
                }
            }
        }
        if !indoor {
            self.footprints.draw(&mut self.sprites);
            self.meteors.draw(self.time, &mut self.sprites);
        }
        for m in self.meteors.active.iter().filter(|m| m.flying() && !indoor) {
            if let Some(rock) = models.rocks.get(m.rock) {
                let h = Vec3::new(m.head[0] as f32, m.head[1] as f32, m.head[2] as f32);
                let rot = glam::Quat::from_euler(glam::EulerRot::XYZ, m.rot[0] as f32, m.rot[1] as f32, m.rot[2] as f32);
                rock.draw(Mat4::from_scale_rotation_translation(Vec3::splat(m.rock_scale() as f32), rot, h), &mut self.parts);
            }
        }
        if let (Some(m), false) = (&self.mars, indoor) {
            m.draw(&mut self.sprites);
        }
        self.particles.draw(&mut self.sprites);
        self.puffs.draw(&mut self.sprites);
        // pedras e minérios soltos dos chunks que já têm malha
        self.props.clear();
        for c in self.world.chunks.values().filter(|c| c.meshed && !indoor) {
            for p in &c.props {
                if let Some(mesh) = prop_mesh(p.kind, p.variant) {
                    let inst = PropInstance::still([p.wx as f32 + 0.5, p.y as f32, p.wz as f32 + 0.5], p.rot as f32, p.scale as f32);
                    self.props.push(PropDraw { mesh, inst });
                }
            }
        }
        // pedaços que quicam, itens voando e pilhas da morte
        for it in &self.debris.items {
            let c = it.color();
            let inst = PropInstance {
                pos: [it.pos[0] as f32, it.pos[1] as f32, it.pos[2] as f32],
                rot: it.rot[1] as f32,
                scale: [it.draw_size() as f32, it.rot[0] as f32, it.rot[2] as f32, 0.0],
                tint: [c[0] as f32, c[1] as f32, c[2] as f32, 1.0],
            };
            self.props.push(PropDraw { mesh: if it.kind == 0 { MESH_CUBE } else { MESH_SHARD }, inst });
        }
        // itens voando e pilhas da morte: o modelo do item (itemModels.ts); minérios e peças um pouco maiores que os blocos
        let item_scale = |i: ItemId| if i.data().block.or(i.data().icon_block).is_some() { 1.0 } else { 1.4 };
        for d in &self.drops.drops {
            if d.age < 0.0 {
                continue;
            }
            let s = (DROP_SIZE * d.scale) as f32 * item_scale(d.item);
            let inst = PropInstance {
                pos: [d.pos[0] as f32, d.pos[1] as f32 - s * 0.5, d.pos[2] as f32],
                rot: d.spin[1] as f32,
                scale: [s, d.spin[0] as f32, 0.0, 0.0],
                tint: [1.0; 4],
            };
            self.props.push(PropDraw { mesh: item_mesh(d.item), inst });
        }
        for p in &self.loot.pieces {
            let t = self.time + p.phase;
            let s = DROP_SIZE as f32 * 1.15 * item_scale(p.item);
            let inst = PropInstance {
                pos: [p.pos[0] as f32, p.pos[1] as f32 - s * 0.5, p.pos[2] as f32],
                rot: (t * 1.4) as f32,
                scale: [s, (t.sin() * 0.3) as f32, 0.0, 0.0],
                tint: [1.0; 4],
            };
            self.props.push(PropDraw { mesh: item_mesh(p.item), inst });
            let pulse = 1.0 + ((self.time * 3.0 + p.phase).sin() * 0.12) as f32;
            signal_lamp([p.pos[0] as f32, p.pos[1] as f32, p.pos[2] as f32], [0.5, 1.5, 1.9], 0.0, 1.1 * pulse, 0.6, &mut self.sprites);
        }
        let r = &self.rig;
        let d = self.dark as f32;
        // ondas de choque na tela (shockwave.fill): projeta com a mesma câmera do desenho
        let eye = Vec3::new(r.eye[0] as f32, r.eye[1] as f32, r.eye[2] as f32);
        let target = Vec3::new(r.target[0] as f32, r.target[1] as f32, r.target[2] as f32);
        let fov = base_fov(aspect) as f32;
        let vp = camera_matrix(eye, target, r.roll as f32, fov, aspect as f32);
        self.view_proj = vp;
        let right = (target - eye).normalize().cross(Vec3::Y).normalize();
        let project = |p: [f64; 3]| {
            let c = vp * glam::Vec4::new(p[0] as f32, p[1] as f32, p[2] as f32, 1.0);
            if c.w <= 0.0 {
                return None;
            }
            Some([(c.x / c.w) as f64, (c.y / c.w) as f64, (c.z / c.w) as f64])
        };
        self.shocks = self.meteors.waves.fill(&project, [right.x as f64, right.y as f64, right.z as f64], aspect);
        let point = if indoor {
            // a luz do teto da base acende com o corte (baseModel: PointLight de intensidade 22 × dentro)
            let bx = self.base.layout.structure.bx;
            let c = Vec3::new((bx.x0 + bx.x1 + 1) as f32 / 2.0, self.base.layout.floor_y as f32 + 4.6, (bx.z0 + bx.z1 + 1) as f32 / 2.0);
            Some((c, 22.0 * self.base.inside as f32, [1.0, 0.88, 0.72]))
        } else {
            self.meteors.light().map(|(p, i, c)| (Vec3::new(p[0] as f32, p[1] as f32, p[2] as f32), i as f32, [c[0] as f32, c[1] as f32, c[2] as f32]))
        };
        // neblina: acompanha a distância da câmera (Game.ts), nunca perto demais dentro de caverna
        let fog_dist = r.eye_dist.max(16.0) as f32;
        let (fog_near, fog_far) = self.mars.as_ref().map(|m| m.fog(1.15, 2.1)).unwrap_or((1.15, 2.1));
        Frame {
            eye,
            target,
            roll: r.roll as f32,
            fov_deg: fov,
            time: self.time as f32,
            dark: d,
            lamp: Vec4::new(p[0] as f32, p[1] as f32 + 1.5, p[2] as f32, d * 1.15),
            mist_y: if indoor { -100.0 } else { (self.base_y.floor() - 6.0) as f32 },
            fog: if indoor { (300.0, 400.0) } else { (fog_dist * fog_near as f32, fog_dist * fog_far as f32) },
            parts: &self.parts,
            props: &self.props,
            sprites: &self.sprites,
            screen: {
                let s = &self.survival;
                // pouco oxigênio tira a cor; morto, a tela escurece
                let desat = (1.0 - s.o2 / 30.0).clamp(0.0, 1.0) as f32 * 0.7;
                let dark = self.death.map_or(0.0, |d| (d.t / DEATH_CARD_DELAY).min(1.0) as f32 * 0.55);
                ScreenFx { flash: self.flash as f32, hurt: self.hurt as f32, desat, dark }
            },
            point,
            shocks: &self.shocks,
            storm: self.mars.as_ref().map(|m| m.dust() as f32).unwrap_or(0.0),
            indoor,
        }
    }
}

fn focus(p: [f64; 3]) -> [f64; 3] {
    [p[0], p[1] + 0.8, p[2]]
}

#[cfg(test)]
mod tests {
    use super::*;
    use spacing_core::save;

    /// salvar, ler o texto de volta e montar o jogo de novo dá o mesmo salvamento
    #[test]
    fn salvar_e_carregar_volta_igual() {
        let mut g = Game::new(PlanetId::Lua, 4242, 1);
        let mut ev = Events::new();
        g.inv.add(ItemId::of("iron"), 7, true, &mut ev);
        g.inv.add(ItemId::of("ice"), 3, true, &mut ev);
        g.react(ev);
        g.world.set_block(2, 30, 3, spacing_core::blocks::ROCK);
        g.test_place_site();
        g.test_build_and_farm(0.4);
        g.base.respawn_base = true;
        g.survival.o2 = 61.5;
        for _ in 0..30 {
            g.update(1.0 / 30.0, &mut Controls::default());
        }
        let a = g.to_save();
        assert!(!a.explored.is_empty(), "o mapa em volta foi descoberto");
        assert!(a.greenhouse.site.is_some());
        let text = save::to_text(&a, 1.0);
        let back = save::parse(&text, 1.0).expect("lê o próprio salvamento");
        let h = Game::load(PlanetId::Lua, Some(&back), 1, 1);
        let mut b = h.to_save();
        assert_eq!(b.seed, 4242.0);
        // o astronauta volta um pouco acima (não nasce dentro do chão)
        let (pa, pb) = (a.player.unwrap(), b.player.unwrap());
        assert!((pa.x - pb.x).abs() < 1e-9 && (pa.z - pb.z).abs() < 1e-9 && (pb.y - pa.y - 0.05).abs() < 1.1);
        b.player = a.player;
        // as pilhas da morte assentam de novo ao carregar
        assert_eq!(a.loot.len(), b.loot.len());
        b.loot = a.loot.clone();
        assert_eq!(serde_json::to_value(&a).unwrap(), serde_json::to_value(&b).unwrap());
    }
}
