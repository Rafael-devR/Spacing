//! Mirar, minerar e construir (porte de `src/systems/Interaction.ts`). O jogo diz onde a mira aponta (um raio da câmera)
//! e se o dedo está segurando; aqui ficam as regras: alcance, dureza e nível da broca, golpes, quebrar (pedaços, poeira,
//! itens que voam até o astronauta) e colocar blocos ou objetos (painel solar) do espaço selecionado da barra.
use crate::blocks::{block_data, registry, Rgb, AIR, HULL};
use crate::debris::{BurstOpts, Debris, SpawnOpts};
use crate::drops::ItemDrops;
use crate::fx::Particles;
use crate::player::Player;
use crate::rules::inventory::Inventory;
use crate::rules::{rules, Events, GameEvent, ItemId};
use crate::terrain::{PropSpawn, CH};
use crate::world::{VoxelHit, World};

/// alcance da broca e de construir (blocos, do centro do astronauta)
pub const REACH: f64 = 4.4;

#[derive(Clone, Debug)]
pub enum Target {
    Block(VoxelHit),
    Prop(PropSpawn),
}

impl Target {
    pub fn center(&self) -> [f64; 3] {
        match self {
            Target::Block(h) => [h.x as f64 + 0.5, h.y as f64 + 0.5, h.z as f64 + 0.5],
            Target::Prop(p) => [p.wx as f64 + 0.5, p.y as f64 + 0.45 * p.scale.max(0.4), p.wz as f64 + 0.5],
        }
    }

    /// tamanho da caixa de destaque
    pub fn size(&self) -> f64 {
        match self {
            Target::Block(_) => 1.03,
            Target::Prop(p) => 0.9 * p.scale.max(0.4) * 1.08,
        }
    }

    /// segundos com a broca inicial (infinito = não quebra)
    pub fn hardness(&self) -> f64 {
        match self {
            Target::Block(h) => block_data(h.id).map_or(f64::INFINITY, |d| d.hardness),
            Target::Prop(p) => rules().prop(p.kind).map_or(f64::INFINITY, |d| d.hardness),
        }
    }

    /// nível mínimo de broca
    pub fn tier(&self) -> u32 {
        match self {
            Target::Block(h) => block_data(h.id).map_or(0, |d| d.tier as u32),
            Target::Prop(p) => rules().prop(p.kind).map_or(0, |d| d.tier),
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Target::Block(h) => block_data(h.id).map_or("?", |d| d.name),
            Target::Prop(p) => rules().prop(p.kind).map_or("?", |d| d.name.as_str()),
        }
    }

    /// identidade (o progresso recomeça ao trocar de alvo)
    pub fn key(&self) -> (bool, i32, i32, i32) {
        match self {
            Target::Block(h) => (true, h.x, h.y, h.z),
            Target::Prop(p) => (false, p.wx, p.y, p.wz),
        }
    }

    /// cor principal dos pedaços
    fn chip_color(&self) -> Rgb {
        match self {
            Target::Block(h) => registry()[h.id as usize].side,
            Target::Prop(p) => rules().prop(p.kind).and_then(|d| d.debris.first().copied()).unwrap_or([0.29, 0.26, 0.23]),
        }
    }
}

/// O que a mira acha: o objeto solto mais perto ou o bloco. O casco da base não conta.
pub fn pick(world: &World, origin: [f64; 3], dir: [f64; 3]) -> Option<Target> {
    let hit = world.raycast(origin, dir, 220.0);
    if let Some((p, t)) = world.pick_prop(origin, dir, 220.0) {
        if hit.is_none_or(|h| t < h.t) {
            return Some(Target::Prop(p));
        }
    }
    hit.filter(|h| h.id != HULL).map(Target::Block)
}

pub fn in_reach(player: &Player, t: &Target) -> bool {
    let (c, p) = (player.center(), t.center());
    crate::js::hypot3(c[0] - p[0], c[1] - p[1], c[2] - p[2]) <= REACH
}

/// o que precisa ser mexido ao minerar ou construir
pub struct Ctx<'a> {
    pub world: &'a mut World,
    pub player: &'a mut Player,
    pub inv: &'a mut Inventory,
    pub debris: &'a mut Debris,
    pub drops: &'a mut ItemDrops,
    pub particles: &'a mut Particles,
    pub ev: &'a mut Events,
}

/// poeira cinza que sobe de onde algo quebrou ou foi colocado (particles.dust do TS)
pub fn dust(parts: &mut Particles, x: f64, y: f64, z: f64, n: usize, spread: f64) {
    for _ in 0..n {
        let g = &mut parts.rng;
        let a = g.f() * std::f64::consts::TAU;
        let (vy, size, life) = (0.4 + g.f() * 0.6, 0.12 + g.f() * 0.1, 0.6 + g.f() * 0.4);
        parts.spawn([x + a.cos() * spread, y + 0.05, z + a.sin() * spread], [a.cos() * 0.8, vy, a.sin() * 0.8], size, [0.62, 0.58, 0.56], life, -0.2);
    }
}

/// O que está aparecendo na mira, para o HUD.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AimState {
    None,
    /// ao alcance
    Ok,
    /// longe: o astronauta vai até lá
    Far,
    /// não dá para minerar (ou a broca é fraca)
    Hard,
}

#[derive(Default)]
pub struct Interaction {
    pub build_mode: bool,
    /// alvo da mira neste quadro
    pub target: Option<Target>,
    /// 0..1 da mineração atual (None = não está minerando)
    pub progress: Option<f64>,
    pub aim: Option<AimState>,
    mine_key: Option<(bool, i32, i32, i32)>,
    mine: f64,
    tick: f64,
    weak_key: Option<(bool, i32, i32, i32)>,
    /// ir até um ponto (toque longe); true = parar ao ficar ao alcance
    walk_goal: Option<([f64; 3], bool, u32)>,
    stuck: f64,
}

impl Interaction {
    pub fn set_build_mode(&mut self, on: bool, ev: &mut Events) {
        if self.build_mode != on {
            self.build_mode = on;
            ev.push(GameEvent::BuildMode { on });
        }
    }

    /// cancela o que estiver em andamento (pausa, morte)
    pub fn cancel(&mut self, player: &mut Player) {
        self.walk_goal = None;
        self.mine_key = None;
        self.mine = 0.0;
        self.progress = None;
        self.aim = None;
        player.mining = false;
        player.face_target = None;
    }

    /// Toque rápido: constrói (modo construir), ou anda até lá se estiver longe.
    pub fn tap(&mut self, t: Option<Target>, place: bool, c: &mut Ctx) {
        let Some(t) = t else { return };
        let placing = place || self.build_mode;
        let reach = in_reach(c.player, &t);
        if placing {
            if let Target::Block(h) = &t {
                if reach {
                    Self::place(h, c);
                } else {
                    self.walk_goal = Some((t.center(), true, 0));
                }
                return;
            }
        }
        if !reach {
            self.walk_goal = Some((t.center(), matches!(t, Target::Prop(_)) || placing, 0));
        }
    }

    fn place(t: &VoxelHit, c: &mut Ctx) {
        let Some(item) = c.inv.selected_item() else {
            c.ev.push(GameEvent::ActionDenied { reason: "emptySlot", item: None });
            return;
        };
        let d = item.data();
        if d.site.is_some() {
            // estufa e canteiros entram com a base (M4c)
            c.ev.push(GameEvent::ActionDenied { reason: "notBlock", item: Some(item) });
            return;
        }
        let (x, y, z) = (t.x + t.normal[0], t.y + t.normal[1], t.z + t.normal[2]);
        if let Some(kind) = d.place.as_deref() {
            Self::place_prop(t, item, kind, (x, y, z), c);
            return;
        }
        let Some(block) = d.block else {
            c.ev.push(GameEvent::ActionDenied { reason: "notBlock", item: Some(item) });
            return;
        };
        let prop_here = c.world.prop_at(x, z).is_some_and(|p| p.y == y);
        if y <= 0 || y >= CH as i32 || c.world.get_block(x, y, z) != AIR || c.player.intersects_block(x, y, z) || prop_here {
            c.ev.push(GameEvent::ActionDenied { reason: "blocked", item: Some(item) });
            return;
        }
        c.world.set_block(x, y, z, block);
        c.debris.disturb(x, y, z);
        c.inv.remove_selected(1, c.ev);
        dust(c.particles, x as f64 + 0.5, y as f64, z as f64 + 0.5, 5, 0.5);
        c.ev.push(GameEvent::BlockPlaced { pos: [x, y, z], id: block });
    }

    /// objeto (painel solar) em cima do bloco mirado, virado para o sol
    fn place_prop(t: &VoxelHit, item: ItemId, kind: &str, (x, y, z): (i32, i32, i32), c: &mut Ctx) {
        let Some(&kind) = crate::terrain::PROP_TYPES.iter().find(|k| **k == kind) else { return };
        if t.normal[1] != 1 || y >= CH as i32 - 2 || c.world.get_block(x, y, z) != AIR || c.world.get_block(x, y + 1, z) != AIR || c.player.intersects_block(x, y, z) || c.world.prop_at(x, z).is_some() {
            c.ev.push(GameEvent::ActionDenied { reason: "blocked", item: Some(item) });
            return;
        }
        let sd = rules().sun_direction;
        c.world.add_extra_prop(x, z, kind, sd[0].atan2(sd[2]), 1.0);
        c.inv.remove_selected(1, c.ev);
        dust(c.particles, x as f64 + 0.5, y as f64, z as f64 + 0.5, 6, 0.5);
        c.ev.push(GameEvent::PropPlaced { pos: [x, y, z], kind });
    }

    /// Quebra o alvo: pedaços, poeira, itens que voam até o astronauta e o evento.
    pub fn break_target(t: &Target, c: &mut Ctx) {
        let ctr = t.center();
        match t {
            Target::Block(h) => {
                let def = registry()[h.id as usize];
                let data = block_data(h.id);
                c.world.set_block(h.x, h.y, h.z, AIR);
                c.debris.disturb(h.x, h.y, h.z);
                let pal: Vec<Rgb> = match def.ore {
                    Some(o) => vec![def.side, o, def.side, def.top],
                    None => vec![def.side, def.side, def.top],
                };
                let n = if def.ore.is_some() { 18 } else { 15 };
                c.debris.burst(ctr, n, &pal, BurstOpts { power: 1.6, up: 1.1, ..Default::default() });
                dust(c.particles, ctr[0], ctr[1] - 0.3, ctr[2], 6, 0.4);
                if let Some(item) = data.and_then(|d| d.drop).and_then(ItemId::parse) {
                    c.drops.spawn(item, ctr, 1);
                }
                c.ev.push(GameEvent::BlockBroken { pos: [h.x, h.y, h.z], id: h.id });
            }
            Target::Prop(p) => {
                c.world.remove_prop_at(p.wx, p.wz);
                let pd = rules().prop(p.kind);
                let pal = pd.map_or(vec![[0.29, 0.26, 0.23]], |d| d.debris.clone());
                let n = if p.kind == "meteorite" { 26 } else { 16 };
                c.debris.burst(ctr, n, &pal, BurstOpts { power: 1.8, up: 1.2, spread: 0.4, max_size: 0.26, ..Default::default() });
                dust(c.particles, ctr[0], ctr[1] - 0.3, ctr[2], 8, 0.5);
                if let Some(d) = pd {
                    c.drops.spawn(d.drop, ctr, d.amount);
                    for &(item, n) in &d.bonus {
                        c.drops.spawn(item, ctr, n);
                    }
                }
                c.ev.push(GameEvent::PropBroken { pos: ctr, kind: p.kind });
            }
        }
    }

    /// Um passo. `target`: o que a mira acha agora (None = dedo fora). `holding`: segurando para minerar. `touch`:
    /// toque (longe = anda até lá). `drill_rate` cai sem bateria; `drill_tier` é o nível da broca em uso.
    #[allow(clippy::too_many_arguments)]
    pub fn update(&mut self, dt: f64, target: Option<Target>, holding: bool, touch: bool, drill_rate: f64, drill_tier: u32, c: &mut Ctx) {
        let reach = target.as_ref().is_some_and(|t| in_reach(c.player, t));
        let weak = target.as_ref().is_some_and(|t| t.hardness().is_finite() && t.tier() > drill_tier);
        let can = target.as_ref().is_some_and(|t| t.hardness().is_finite()) && !weak && !self.build_mode;
        if !holding {
            self.weak_key = None;
        } else if let (true, Some(t)) = (weak && !self.build_mode && reach, &target) {
            if self.weak_key != Some(t.key()) {
                self.weak_key = Some(t.key());
                c.ev.push(GameEvent::DrillWeak { tier: t.tier(), target: t.name() });
            }
        }
        let mut mining = false;
        match &target {
            Some(t) if holding && can && reach => {
                if self.mine_key != Some(t.key()) {
                    self.mine_key = Some(t.key());
                    self.mine = 0.0;
                }
                self.mine += dt / t.hardness() * drill_rate;
                self.tick -= dt;
                mining = true;
                self.walk_goal = None;
                let pc = c.player.center();
                let ctr = t.center();
                c.player.face_target = Some((ctr[0] - pc[0]).atan2(ctr[2] - pc[2]));
                if self.tick <= 0.0 {
                    self.tick = 0.13;
                    let rgb = t.chip_color();
                    let d = [pc[0] - ctr[0], pc[1] - ctr[1], pc[2] - ctr[2]];
                    let l = crate::js::hypot3(d[0], d[1], d[2]).max(1e-9);
                    let n = [d[0] / l * 0.55, d[1] / l * 0.55, d[2] / l * 0.55];
                    let hp = [ctr[0] + n[0], ctr[1] + n[1], ctr[2] + n[2]];
                    for _ in 0..2 {
                        let g = &mut c.particles.rng;
                        let a = g.f() * std::f64::consts::TAU;
                        let sp = (0.4 + g.f()) * 1.4;
                        let shade = 0.8 + g.f() * 0.35;
                        let (vy, size, life) = (0.4 + g.f() * 1.4 * 0.35, 0.09 + g.f() * 0.12, 1.2 + g.f() * 1.2);
                        c.particles.spawn(hp, [a.cos() * sp * 0.6, vy, a.sin() * sp * 0.6], size, [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade], life, 0.45);
                    }
                    // lascas que ficam no chão
                    if c.debris.rand() < 0.5 {
                        let r = c.debris.rand();
                        let s = 0.07 + c.debris.rand() * 0.06;
                        c.debris.spawn(hp, [n[0] * 1.3, 0.5 + r * 0.9, n[2] * 1.3], s, rgb, 1, SpawnOpts::default());
                    }
                    // faísca
                    let g = &mut c.particles.rng;
                    let v = [n[0] * 3.0 + (g.f() - 0.5) * 2.0, 1.0 + g.f() * 1.5, n[2] * 3.0 + (g.f() - 0.5) * 2.0];
                    c.particles.spawn(hp, v, 0.05, [2.4, 1.6, 0.6], 0.25, 6.0);
                    c.ev.push(GameEvent::MineHit { pos: hp, block: matches!(t, Target::Block(_)) });
                }
                if self.mine >= 1.0 {
                    Self::break_target(t, c);
                    self.mine_key = None;
                    self.mine = 0.0;
                }
            }
            _ => {
                if let Some(t) = &target {
                    if holding && can && !reach && touch {
                        self.walk_goal = Some((t.center(), true, 0));
                    }
                }
                if !holding {
                    self.mine_key = None;
                    self.mine = 0.0;
                }
                c.player.face_target = None;
            }
        }
        c.player.mining = mining;
        self.aim = target.as_ref().map(|t| {
            if !t.hardness().is_finite() || weak {
                AimState::Hard
            } else if reach {
                AimState::Ok
            } else {
                AimState::Far
            }
        });
        self.progress = mining.then_some(self.mine.min(1.0));
        self.target = target;
    }

    /// Converte o objetivo de caminhada em direção (relativa à câmera de giro `yaw`). Movimento do jogador cancela.
    pub fn steer(&mut self, mv: &mut crate::player::MoveInput, has_input: bool, player: &Player, yaw: f64, dt: f64) {
        let Some((goal, reach, jumps)) = &mut self.walk_goal else { return };
        if has_input {
            self.walk_goal = None;
            return;
        }
        let pc = player.center();
        let (dx, dz) = (goal[0] - pc[0], goal[2] - pc[2]);
        let flat = dx.hypot(dz);
        let done = if *reach { crate::js::hypot3(dx, goal[1] - pc[1], dz) < REACH - 0.6 } else { flat < 0.5 };
        if done {
            self.walk_goal = None;
            return;
        }
        // as mesmas direções de Player::step
        let (fx, fz) = (-yaw.sin(), -yaw.cos());
        let (rx, rz) = (yaw.cos(), -yaw.sin());
        mv.move_x = (dx * rx + dz * rz) / flat;
        mv.move_y = (dx * fx + dz * fz) / flat;
        let v = player.vel;
        if v[0].hypot(v[2]) < 0.6 && player.on_ground {
            self.stuck += dt;
            if self.stuck > 0.25 {
                self.stuck = 0.0;
                *jumps += 1;
                if *jumps > 2 {
                    self.walk_goal = None;
                } else {
                    mv.jump = true;
                }
            }
        } else {
            self.stuck = 0.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planet::{planet, PlanetId};

    fn setup() -> (World, Player) {
        let mut w = World::new(PlanetId::Lua, 12345);
        w.update(1.0, 0.8, crate::world::SYNC_BUDGET);
        let mut p = Player::new(planet(PlanetId::Lua).physics);
        p.spawn(&mut w, 1.0, 0.8);
        (w, p)
    }

    #[test]
    fn minera_o_bloco_e_o_item_chega() {
        let (mut w, mut p) = setup();
        let (mut inv, mut debris, mut drops, mut parts, mut ev) = (Inventory::new(), Debris::new(0.45, 0.0, 1), ItemDrops::new(0.45, 2), Particles::default(), Events::new());
        let mut it = Interaction::default();
        // olhando para baixo, do lado do astronauta
        let c = p.center();
        let o = [c[0] + 1.6, c[1] + 2.0, c[2]];
        let t = pick(&w, o, [0.0, -1.0, 0.0]).expect("chão");
        let Target::Block(h) = t.clone() else { panic!("bloco") };
        let item = block_data(h.id).unwrap().drop.and_then(ItemId::parse).expect("o chão dá item");
        let secs = t.hardness();
        let steps = (secs * 60.0).ceil() as usize + 2;
        for _ in 0..steps {
            let mut cx = Ctx { world: &mut w, player: &mut p, inv: &mut inv, debris: &mut debris, drops: &mut drops, particles: &mut parts, ev: &mut ev };
            let t = pick(cx.world, o, [0.0, -1.0, 0.0]);
            it.update(1.0 / 60.0, t, true, true, 1.0, 0, &mut cx);
        }
        assert_eq!(w.peek_block(h.x, h.y, h.z), AIR, "quebrou em {secs} s");
        assert!(debris.count() >= 15);
        assert!(ev.iter().any(|e| matches!(e, GameEvent::BlockBroken { .. })));
        assert!(ev.iter().any(|e| matches!(e, GameEvent::MineHit { .. })));
        for _ in 0..120 {
            drops.update(1.0 / 60.0, p.center(), &mut inv, &mut ev);
        }
        assert_eq!(inv.count(item), 1);

        // e coloca de volta
        let mut cx = Ctx { world: &mut w, player: &mut p, inv: &mut inv, debris: &mut debris, drops: &mut drops, particles: &mut parts, ev: &mut ev };
        let below = pick(cx.world, o, [0.0, -1.0, 0.0]);
        it.set_build_mode(true, cx.ev);
        it.tap(below, false, &mut cx);
        assert_eq!(w.peek_block(h.x, h.y, h.z), item.data().block.unwrap());
        assert_eq!(inv.count(item), 0);
    }

    #[test]
    fn broca_fraca_avisa_e_nao_minera() {
        let (mut w, mut p) = setup();
        let c = p.center();
        let (x, y, z) = (c[0].floor() as i32 + 2, c[1].floor() as i32, c[2].floor() as i32);
        w.set_block(x, y, z, crate::blocks::BASALT);
        let (mut inv, mut debris, mut drops, mut parts, mut ev) = (Inventory::new(), Debris::new(0.45, 0.0, 1), ItemDrops::new(0.45, 2), Particles::default(), Events::new());
        let mut it = Interaction::default();
        let o = [x as f64 + 0.5, y as f64 + 3.0, z as f64 + 0.5];
        for _ in 0..240 {
            let mut cx = Ctx { world: &mut w, player: &mut p, inv: &mut inv, debris: &mut debris, drops: &mut drops, particles: &mut parts, ev: &mut ev };
            let t = pick(cx.world, o, [0.0, -1.0, 0.0]);
            it.update(1.0 / 60.0, t, true, true, 1.0, 0, &mut cx);
        }
        assert_eq!(w.peek_block(x, y, z), crate::blocks::BASALT);
        assert_eq!(ev.iter().filter(|e| matches!(e, GameEvent::DrillWeak { .. })).count(), 1);
        assert_eq!(it.aim, Some(AimState::Hard));
    }
}
