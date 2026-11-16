//! Meteoros (porte de `src/entities/Meteors.ts`, `src/render/meteorFx.ts` e `src/render/shockwave.ts`; números de
//! `src/data/meteors.ts`): aviso no chão, voo com rastro, impacto com cratera, clarão, bola de fogo, anel de poeira, coluna de
//! fumaça, brasa e a onda de choque que entorta a imagem. Os destroços que quicam (Debris.ts) entram com o M4; aqui os pedaços
//! da cratera voam como partículas. O meteorito que fica no chão é um objeto solto do mundo, como no TS.
use crate::blocks::{registry, AIR, BEDROCK};
use crate::fx::{Particles, PuffSpec, Puffs, Rng, Sprite, SpriteKind};
use crate::terrain::{CS, LANDER};
use crate::world::World;

pub const WARN: f64 = 1.6;
pub const FLIGHT: f64 = 1.7;
const START_DISTANCE: f64 = 38.0;
const TILT: f64 = 1.1;
const SIDE_JITTER: f64 = 0.45;
const VIEW_DEPTH: f64 = 5.5;
const VIEW_SIDE: f64 = 10.0;
pub const PICK_MIN: f64 = 9.5;
pub const PICK_MAX: f64 = 13.0;
const RADIUS_MIN: f64 = 1.6;
const RADIUS_MAX: f64 = 2.4;
const EVERY_MIN: f64 = 90.0;
const EVERY_MAX: f64 = 170.0;
pub const RADIUS_REF: f64 = 2.3;
const ROCK_BASE: f64 = 0.8;
const ROCK_PER_RADIUS: f64 = 0.3;
const SPIN: f64 = 7.0;
const GLOW_SIZE: f64 = 3.6;
const GLOW_COLOR: [f64; 3] = [3.0, 1.1, 0.3];
const WARN_COLOR: [f64; 3] = [2.2, 0.55, 0.25];
const SHELL_LIFE: f64 = 0.55;
const SHELL_RADIUS: f64 = 17.0;
const SHELL_COLOR: [f64; 3] = [2.0, 1.1, 0.55];
/// a luz do clarão (PointLight do meteorFx): pico e queda por segundo; a do meteoro em voo
pub const LIGHT_PEAK: f64 = 60.0;
const LIGHT_DECAY: f64 = 3.2;
const FLIGHT_LIGHT: f64 = 25.0;

/// a câmera e o tempo no impacto (IMPACT_CAMERA)
pub mod camera {
    pub const SHAKE_MAX: f64 = 1.1;
    pub const SHAKE_MIN: f64 = 0.15;
    pub const SHAKE_RANGE: f64 = 30.0;
    pub const PUNCH: f64 = 1.8;
    pub const PUNCH_RANGE: f64 = 26.0;
    pub const HIT_STOP: f64 = 0.07;
    pub const SLOW_MO: (f64, f64) = (0.55, 0.35);
    pub const NEAR_RANGE: f64 = 16.0;
    pub const FLASH_MAX: f64 = 0.8;
    pub const FLASH_RANGE: f64 = 42.0;
    pub const FLASH_DECAY: f64 = 3.2;
}

/// ondas de choque (SHOCK)
const SHOCK_LIFE: f64 = 0.9;
const SHOCK_RADIUS: f64 = 20.0;
const SHOCK_WIDTH: f64 = 2.8;
const SHOCK_STRENGTH: f64 = 0.065;
const SHOCK_RIM: f64 = 0.45;
const SHOCK_CHROMA: f64 = 0.55;
pub const SHOCK_MAX: usize = 4;
const HAZE: (f64, f64, f64) = (1.5, 1.5, 0.012);

#[derive(Clone, Copy, Debug)]
struct Wave {
    pos: [f64; 3],
    age: f64,
    life: f64,
    radius: f64,
    width: f64,
    strength: f64,
    rim: f64,
    chroma: f64,
    haze: bool,
    key: u32,
}

/// Ondas de choque: esferas no mundo que viram anéis na tela (a passada final entorta a imagem com elas).
#[derive(Default)]
pub struct ShockWaves {
    blasts: Vec<Wave>,
    hazes: Vec<Wave>,
}

/// uma onda na tela: (x, y do centro em 0..1 com y para cima, raio, força) e (espessura, brilho da borda, cor separada, 0)
pub type ShockSlot = ([f32; 4], [f32; 4]);

impl ShockWaves {
    pub fn add(&mut self, p: [f64; 3], size: f64) {
        if self.blasts.len() >= SHOCK_MAX * 2 {
            self.blasts.remove(0);
        }
        self.blasts.push(Wave {
            pos: p,
            age: 0.0,
            life: SHOCK_LIFE,
            radius: SHOCK_RADIUS * size,
            width: SHOCK_WIDTH,
            strength: SHOCK_STRENGTH * size.min(1.4),
            rim: SHOCK_RIM,
            chroma: SHOCK_CHROMA,
            haze: false,
            key: 0,
        });
    }

    /// ar tremendo em volta de algo em voo: chamar todo quadro enquanto ele existe
    pub fn haze(&mut self, key: u32, p: [f64; 3], radius: f64, width: f64, strength: f64) {
        let w = Wave { pos: p, age: 0.0, life: 0.15, radius, width, strength, rim: 0.0, chroma: 0.0, haze: true, key };
        match self.hazes.iter_mut().find(|h| h.key == key) {
            Some(h) => *h = w,
            None => self.hazes.push(w),
        }
    }

    pub fn update(&mut self, dt: f64) {
        for w in self.blasts.iter_mut().chain(self.hazes.iter_mut()) {
            w.age += dt;
        }
        self.blasts.retain(|w| w.age < w.life);
        self.hazes.retain(|w| w.age < w.life);
    }

    pub fn clear(&mut self) {
        self.blasts.clear();
        self.hazes.clear();
    }

    /// As ondas visíveis em coordenadas de tela. `project` leva um ponto do mundo para a tela (x, y em -1..1, z; None atrás
    /// da câmera); `right` é a direita da câmera no mundo.
    pub fn fill(&self, project: &dyn Fn([f64; 3]) -> Option<[f64; 3]>, right: [f64; 3], aspect: f64) -> Vec<ShockSlot> {
        let mut out = Vec::new();
        let write = |w: &Wave| -> Option<ShockSlot> {
            let p = project(w.pos)?;
            let q = project([w.pos[0] + right[0], w.pos[1] + right[1], w.pos[2] + right[2]])?;
            // um bloco do mundo, na tela, em fração da altura
            let k = crate::js::hypot((q[0] - p[0]) * aspect, q[1] - p[1]) * 0.5;
            let (mut r, mut width, mut s, mut rim) = (w.radius, w.width, w.strength, w.rim);
            if !w.haze {
                let u = (w.age / w.life).min(1.0);
                r = w.radius * (1.0 - (1.0 - u).powf(2.2));
                width = w.width * (0.6 + 0.8 * u);
                let fade = (1.0 - u).powf(1.6);
                s = w.strength * fade;
                rim = w.rim * fade;
            }
            Some((
                [(p[0] * 0.5 + 0.5) as f32, (p[1] * 0.5 + 0.5) as f32, (r * k) as f32, s as f32],
                [(width * k) as f32, rim as f32, w.chroma as f32, 0.0],
            ))
        };
        for w in self.blasts.iter().rev() {
            if out.len() >= SHOCK_MAX {
                break;
            }
            if let Some(s) = write(w) {
                out.push(s);
            }
        }
        for w in &self.hazes {
            if out.len() >= SHOCK_MAX {
                break;
            }
            if let Some(s) = write(w) {
                out.push(s);
            }
        }
        out
    }
}

/// um meteoro do aviso ao impacto
pub struct Meteor {
    pub id: u32,
    pub target: [f64; 3],
    start: [f64; 3],
    fwd: [f64; 3],
    /// tempo desde o lançamento; negativo no aviso
    pub t: f64,
    pub radius: f64,
    meteorite: bool,
    /// a cabeça agora
    pub head: [f64; 3],
    last: [f64; 3],
    fire_acc: f64,
    smoke_acc: f64,
    /// qual das três rochas do meteor.glb, giro atual e velocidade do giro
    pub rock: usize,
    pub rot: [f64; 3],
    spin: [f64; 3],
}

impl Meteor {
    fn k(&self) -> f64 {
        self.radius / RADIUS_REF
    }
    pub fn rock_scale(&self) -> f64 {
        ROCK_BASE + ROCK_PER_RADIUS * self.radius
    }
    pub fn flying(&self) -> bool {
        self.t >= 0.0
    }
}

/// o que um impacto fez (para a câmera e o tempo)
#[derive(Clone, Copy, Debug)]
pub struct Impact {
    pub pos: [f64; 3],
    pub distance: f64,
    pub radius: f64,
}

struct Shell {
    pos: [f64; 3],
    age: f64,
    radius: f64,
}

struct Later {
    t: f64,
    pos: [f64; 3],
    radius: f64,
}

pub struct Meteors {
    pub active: Vec<Meteor>,
    next_id: u32,
    timer: f64,
    pub auto_spawn: bool,
    rng: Rng,
    shells: Vec<Shell>,
    later: Vec<Later>,
    pub waves: ShockWaves,
    /// clarão do impacto (1 no começo) e onde
    flash: f64,
    flash_pos: [f64; 3],
    flight_light: (f64, [f64; 3]),
}

impl Meteors {
    pub fn new(seed: u64) -> Self {
        let mut rng = Rng::new(seed ^ 0x6d65_7465);
        let timer = 100.0 + rng.f() * 60.0;
        Self { active: Vec::new(), next_id: 1, timer, auto_spawn: true, rng, shells: Vec::new(), later: Vec::new(), waves: ShockWaves::default(), flash: 0.0, flash_pos: [0.0; 3], flight_light: (0.0, [0.0; 3]) }
    }

    /// Um ponto de queda perto do jogador, longe do módulo, em chunk carregado; de preferência dentro da tela.
    pub fn pick_target(&mut self, world: &mut World, p: [f64; 3], yaw: f64, min_d: f64, max_d: f64) -> Option<[f64; 3]> {
        for tries in 0..40 {
            let a = self.rng.f() * std::f64::consts::TAU;
            let dd = min_d + self.rng.f() * (max_d - min_d);
            if tries < 25 {
                let depth = -yaw.sin() * a.cos() * dd - yaw.cos() * a.sin() * dd;
                let side = yaw.cos() * a.cos() * dd - yaw.sin() * a.sin() * dd;
                if depth.abs() > VIEW_DEPTH || side.abs() > VIEW_SIDE {
                    continue;
                }
            }
            let x = (p[0] + a.cos() * dd).floor() as i32;
            let z = (p[2] + a.sin() * dd).floor() as i32;
            if crate::js::hypot(x as f64 - LANDER.0, z as f64 - LANDER.1) < 9.0 {
                continue;
            }
            let ck = (x.div_euclid(CS as i32), z.div_euclid(CS as i32));
            if !world.chunks.get(&ck).is_some_and(|c| c.meshed) {
                continue;
            }
            let y = world.top_y(x, z) + 1;
            return Some([x as f64 + 0.5, y as f64, z as f64 + 0.5]);
        }
        None
    }

    /// Solta um meteoro (aviso e depois voo). `yaw` da câmera: ele entra de lado, para cruzar a tela.
    pub fn launch(&mut self, target: [f64; 3], radius: f64, meteorite: bool, yaw: f64) -> u32 {
        let r = &mut self.rng;
        let a = -yaw + if r.f() < 0.5 { 0.0 } else { std::f64::consts::PI } + (r.f() * 2.0 - 1.0) * SIDE_JITTER;
        let d = [a.cos() * TILT, -1.0, a.sin() * TILT];
        let l = crate::js::hypot3(d[0], d[1], d[2]);
        let fwd = [d[0] / l, d[1] / l, d[2] / l];
        let start = [target[0] - fwd[0] * START_DISTANCE, target[1] - fwd[1] * START_DISTANCE, target[2] - fwd[2] * START_DISTANCE];
        let id = self.next_id;
        self.next_id += 1;
        let spin = [r.range(0.6, 1.2) * SPIN, r.range(0.6, 1.2) * SPIN, r.range(0.2, 0.6) * SPIN];
        let rock = (r.f() * 3.0) as usize % 3;
        self.active.push(Meteor { id, target, start, fwd, t: -WARN, radius, meteorite, head: start, last: start, fire_acc: 0.0, smoke_acc: 0.0, rock, rot: [0.0; 3], spin });
        id
    }

    /// Um meteoro sorteado agora (o modo de teste do jogo tem o mesmo botão).
    pub fn launch_random(&mut self, world: &mut World, p: [f64; 3], yaw: f64) -> Option<u32> {
        let t = self.pick_target(world, p, yaw, PICK_MIN, PICK_MAX)?;
        let radius = RADIUS_MIN + self.rng.f() * (RADIUS_MAX - RADIUS_MIN);
        let meteorite = self.rng.f() < 0.6;
        Some(self.launch(t, radius, meteorite, yaw))
    }

    /// Um quadro. Devolve os impactos deste quadro.
    #[allow(clippy::too_many_arguments)]
    pub fn update(&mut self, dt: f64, world: &mut World, player: [f64; 3], yaw: f64, puffs: &mut Puffs, parts: &mut Particles) -> Vec<Impact> {
        if self.auto_spawn {
            self.timer -= dt;
        }
        if self.timer <= 0.0 {
            self.timer = EVERY_MIN + self.rng.f() * (EVERY_MAX - EVERY_MIN);
            self.launch_random(world, player, yaw);
        }
        let mut impacts = Vec::new();
        self.flight_light = (0.0, [0.0; 3]);
        let mut i = self.active.len();
        while i > 0 {
            i -= 1;
            self.active[i].t += dt;
            if self.active[i].t < 0.0 {
                continue;
            }
            let m = &mut self.active[i];
            let k = (m.t / FLIGHT).min(1.0);
            let e = k * k * (0.4 + 0.6 * k);
            let pos = [m.start[0] + (m.target[0] - m.start[0]) * e, m.start[1] + (m.target[1] - m.start[1]) * e, m.start[2] + (m.target[2] - m.start[2]) * e];
            m.head = pos;
            for j in 0..3 {
                m.rot[j] += m.spin[j] * dt;
            }
            Self::trail(m, pos, &mut self.rng, puffs);
            if FLIGHT_LIGHT * k > self.flight_light.0 {
                self.flight_light = (FLIGHT_LIGHT * k, pos);
            }
            let r = &mut parts.rng;
            let vel = [(r.f() - 0.5) * 2.0, r.f() * 2.0, (r.f() - 0.5) * 2.0];
            let g = 0.9 + r.f() * 0.4;
            parts.spawn(pos, vel, 0.14, [2.5, g, 0.25], 0.35, 0.0);
            let k_hz = m.k();
            self.waves.haze(m.id, pos, HAZE.0 * k_hz, HAZE.1 * k_hz, HAZE.2 * (m.t / 0.4).min(1.0));
            if k >= 1.0 {
                let m = self.active.remove(i);
                impacts.push(self.impact(&m, world, player, puffs, parts));
            }
        }
        // bolhas, a fila da coluna de fumaça, a luz do clarão, as ondas
        for s in self.shells.iter_mut() {
            s.age += dt;
        }
        self.shells.retain(|s| s.age < SHELL_LIFE);
        let mut due = Vec::new();
        self.later.retain_mut(|l| {
            l.t -= dt;
            if l.t <= 0.0 {
                due.push((l.pos, l.radius));
                false
            } else {
                true
            }
        });
        for (pos, radius) in due {
            self.column_puff(pos, radius, puffs);
        }
        self.flash = (self.flash - dt * LIGHT_DECAY).max(0.0);
        self.waves.update(dt);
        impacts
    }

    fn trail(m: &mut Meteor, pos: [f64; 3], rng: &mut Rng, puffs: &mut Puffs) {
        let k = m.k();
        let dist = crate::js::hypot3(pos[0] - m.last[0], pos[1] - m.last[1], pos[2] - m.last[2]);
        m.fire_acc += dist;
        m.smoke_acc += dist;
        let lerp = |u: f64| [pos[0] + (m.last[0] - pos[0]) * u, pos[1] + (m.last[1] - pos[1]) * u, pos[2] + (m.last[2] - pos[2]) * u];
        while m.fire_acc >= 0.7 * k {
            m.fire_acc -= 0.7 * k;
            let u = if dist > 0.0 { (m.fire_acc / dist).min(1.0) } else { 0.0 };
            let p = lerp(u);
            let p = [p[0] + rng.range(-0.12, 0.12), p[1] + rng.range(-0.12, 0.12), p[2] + rng.range(-0.12, 0.12)];
            let vel = [rng.range(-0.6, 0.6), rng.range(-0.3, 0.9), rng.range(-0.6, 0.6)];
            puffs.spawn(false, PuffSpec { pos: p, vel, size: 1.9 * k * rng.range(0.8, 1.15), grow_to: 0.5, life: 0.65 * rng.range(0.8, 1.2), from: [3.0, 1.0, 0.2], to: Some([0.22, 0.1, 0.08]), alpha: 0.9, ..Default::default() });
            puffs.spawn(true, PuffSpec { pos: p, vel, size: 1.1 * k * rng.range(0.8, 1.15), grow_to: 0.3, life: 0.32 * rng.range(0.8, 1.2), from: [3.6, 2.4, 1.1], to: Some([1.4, 0.3, 0.05]), alpha: 0.9, ..Default::default() });
        }
        while m.smoke_acc >= 1.5 * k {
            m.smoke_acc -= 1.5 * k;
            let u = if dist > 0.0 { (m.smoke_acc / dist).min(1.0) } else { 0.0 };
            let vel = [rng.range(-0.5, 0.5), rng.range(-0.2, 0.5), rng.range(-0.5, 0.5)];
            puffs.spawn(
                false,
                PuffSpec { pos: lerp(u), vel, size: 1.2 * k * rng.range(0.8, 1.2), grow_to: 3.4, life: 3.4 * rng.range(0.8, 1.2), from: [0.4, 0.34, 0.38], to: Some([0.16, 0.15, 0.19]), alpha: 0.5, drag: 0.5, ..Default::default() },
            );
        }
        m.last = pos;
    }

    fn impact(&mut self, m: &Meteor, world: &mut World, player: [f64; 3], puffs: &mut Puffs, parts: &mut Particles) -> Impact {
        let t = m.target;
        let r = m.radius;
        let c = [t[0], t[1] - 0.2, t[2]];
        // cratera
        let ri = r.ceil() as i32;
        let mut list = Vec::new();
        let mut pieces = Vec::new();
        for y in (c[1] - ri as f64).floor() as i32..=(c[1] + ri as f64).floor() as i32 {
            for z in (c[2] - ri as f64).floor() as i32..=(c[2] + ri as f64).floor() as i32 {
                for x in (c[0] - ri as f64).floor() as i32..=(c[0] + ri as f64).floor() as i32 {
                    let d = crate::js::hypot3(x as f64 + 0.5 - c[0], (y as f64 + 0.5 - c[1]) * 1.4, z as f64 + 0.5 - c[2]);
                    if d > r {
                        continue;
                    }
                    let id = world.get_block(x, y, z);
                    if id == AIR || id == BEDROCK {
                        continue;
                    }
                    list.push((x, y, z, AIR));
                    pieces.push((x, y, z, id));
                }
            }
        }
        world.set_blocks(&list);
        // objetos no raio viram pedaços
        for (_, pos) in world.remove_props_near(t, r + 1.2) {
            for _ in 0..8 {
                let a = self.rng.f() * std::f64::consts::TAU;
                parts.spawn([pos[0], pos[1] + 0.4, pos[2]], [a.cos() * 3.0, 2.6, a.sin() * 3.0], 0.12, [0.29, 0.26, 0.23], 1.2, 9.0);
            }
        }
        self.eject(c, &pieces, m, parts);
        self.visuals(t, r, puffs, parts);
        if m.meteorite {
            let rot = self.rng.f() * std::f64::consts::TAU;
            let scale = 0.95 + self.rng.f() * 0.2;
            world.add_extra_prop(t[0].floor() as i32, t[2].floor() as i32, "meteorite", rot, scale);
        }
        Impact { pos: t, distance: crate::js::hypot3(player[0] - t[0], player[1] - t[1], player[2] - t[2]), radius: r }
    }

    /// pedaços da cratera voando para fora, mais para onde o meteoro ia (no M4 viram destroços que quicam)
    fn eject(&mut self, c: [f64; 3], pieces: &[(i32, i32, i32, u8)], m: &Meteor, parts: &mut Particles) {
        if pieces.is_empty() {
            return;
        }
        let k = m.radius / RADIUS_REF;
        let reg = registry();
        for i in 0..56 {
            let (x, y, z, id) = pieces[(i * 7) % pieces.len()];
            let big = i < 14;
            let r = &mut self.rng;
            let p = [x as f64 + 0.5 + r.range(-0.3, 0.3), y as f64 + 0.5, z as f64 + 0.5 + r.range(-0.3, 0.3)];
            let (mut vx, mut vz) = (p[0] - c[0], p[2] - c[2]);
            let l = crate::js::hypot(vx, vz);
            if l < 1e-2 {
                vx = r.f() - 0.5;
                vz = r.f() - 0.5;
            }
            let l = crate::js::hypot(vx, vz).max(1e-6);
            let (out, up, size) = if big { ((2.5, 6.0), (3.0, 8.0), (0.34, 0.56)) } else { ((3.0, 9.0), (2.0, 7.0), (0.1, 0.2)) };
            let sp = r.range(out.0, out.1) * (0.8 + 0.2 * k);
            let vel = [vx / l * sp + m.fwd[0] * r.range(0.0, 2.5), r.range(up.0, up.1), vz / l * sp + m.fwd[2] * r.range(0.0, 2.5)];
            let def = &reg[id as usize];
            let col = match def.ore {
                Some(o) if r.f() < 0.5 => o,
                _ if r.f() < 0.3 => def.top,
                _ => def.side,
            };
            // saem em brasa e esfriam rápido: a cor vai do laranja à do bloco (aqui só a do bloco, um pouco quente)
            let hot = [col[0] + 0.4, col[1] + 0.12, col[2]];
            let size = r.range(size.0, size.1);
            parts.spawn(p, vel, size, hot, r.range(1.2, 1.9), 9.0);
        }
    }

    fn visuals(&mut self, t: [f64; 3], radius: f64, puffs: &mut Puffs, parts: &mut Particles) {
        let k = radius / RADIUS_REF;
        let r = &mut self.rng;
        // 1. clarão
        puffs.spawn(true, PuffSpec { pos: [t[0], t[1] + 0.8, t[2]], vel: [0.0, 0.4, 0.0], size: 9.0 * k, grow_to: 0.7, life: 0.16, from: [4.2, 3.0, 1.8], alpha: 1.0, ..Default::default() });
        // 2. bola de fogo
        for i in 0..8 {
            let a = r.f() * std::f64::consts::TAU;
            let rr = r.f() * radius * 0.45;
            let body = PuffSpec {
                pos: [t[0] + a.cos() * rr, t[1] + 0.5 + r.f() * 1.2, t[2] + a.sin() * rr],
                vel: [a.cos() * r.range(1.0, 4.0), r.range(1.5, 5.0), a.sin() * r.range(1.0, 4.0)],
                size: r.range(3.2, 5.5) * k,
                grow_to: 2.1,
                life: r.range(0.55, 0.95),
                from: [3.2, 1.1, 0.25],
                to: Some([0.2, 0.1, 0.08]),
                alpha: 0.95,
                drag: 2.2,
                gravity: -0.5,
                spin: None,
            };
            puffs.spawn(false, body);
            if i % 2 == 0 {
                puffs.spawn(true, PuffSpec { size: body.size * 0.55, life: body.life * 0.6, from: [3.6, 2.5, 1.2], to: Some([1.2, 0.3, 0.05]), alpha: 0.85, ..body });
            }
        }
        // 3. anel de poeira
        for i in 0..26 {
            let a = ((i as f64 + r.f() * 0.8) / 26.0) * std::f64::consts::TAU;
            let sp = r.range(7.0, 11.0);
            puffs.spawn(
                false,
                PuffSpec {
                    pos: [t[0] + a.cos() * radius * 0.5, t[1] + 0.3, t[2] + a.sin() * radius * 0.5],
                    vel: [a.cos() * sp, r.range(0.2, 1.2), a.sin() * sp],
                    size: r.range(1.1, 2.0) * k,
                    grow_to: 2.4,
                    life: r.range(1.5, 2.6),
                    from: [0.44, 0.39, 0.4],
                    alpha: 0.6,
                    drag: 1.8,
                    gravity: -0.15,
                    ..Default::default()
                },
            );
        }
        // 4. bolha da onda de choque
        self.shells.push(Shell { pos: [t[0], t[1] + 0.5, t[2]], age: 0.0, radius: SHELL_RADIUS * k });
        // 5. brasa do fundo e coluna de fumaça em sequência
        for _ in 0..3 {
            let r = &mut self.rng;
            puffs.spawn(
                true,
                PuffSpec {
                    pos: [t[0] + r.range(-0.6, 0.6), t[1] - radius * 0.35 + 0.4, t[2] + r.range(-0.6, 0.6)],
                    vel: [0.0, r.range(0.05, 0.2), 0.0],
                    size: 1.5 * k * r.range(0.8, 1.2),
                    grow_to: 1.15,
                    life: 5.0 * r.range(0.8, 1.1),
                    from: [1.8, 0.55, 0.12],
                    to: Some([0.25, 0.04, 0.01]),
                    alpha: 0.5,
                    ..Default::default()
                },
            );
        }
        for i in 0..11 {
            self.later.push(Later { t: i as f64 / 11.0 * 1.4, pos: t, radius });
        }
        // 6. faíscas
        for _ in 0..22 {
            let r = &mut parts.rng;
            let a = r.f() * std::f64::consts::TAU;
            let sp = (0.4 + r.f()) * 6.0;
            let shade = 0.8 + r.f() * 0.35;
            let vel = [a.cos() * sp * 0.6, 0.4 + r.f() * 6.0 * 0.35, a.sin() * sp * 0.6];
            let (size, life) = (0.09 + r.f() * 0.12, 1.2 + r.f() * 1.2);
            parts.spawn([t[0], t[1] + 0.3, t[2]], vel, size, [2.6 * shade, 1.0 * shade, 0.3 * shade], life, 0.45);
        }
        // 7. luz do clarão
        self.flash = 1.0;
        self.flash_pos = [t[0], t[1] + 1.5, t[2]];
    }

    fn column_puff(&mut self, t: [f64; 3], radius: f64, puffs: &mut Puffs) {
        let k = radius / RADIUS_REF;
        let r = &mut self.rng;
        let a = r.f() * std::f64::consts::TAU;
        let rr = r.f() * radius * 0.4;
        puffs.spawn(
            false,
            PuffSpec {
                pos: [t[0] + a.cos() * rr, t[1] + 0.4, t[2] + a.sin() * rr],
                vel: [r.range(-0.5, 0.5), r.range(2.2, 4.0), r.range(-0.5, 0.5)],
                size: r.range(1.8, 2.8) * k,
                grow_to: 2.6,
                life: r.range(3.6, 5.6),
                from: [0.12, 0.105, 0.115],
                to: Some([0.34, 0.32, 0.34]),
                alpha: 0.7,
                drag: 0.35,
                ..Default::default()
            },
        );
    }

    /// A luz laranja do momento (posição, intensidade, cor): o clarão do impacto ou o meteoro em voo mais perto do chão.
    pub fn light(&self) -> Option<([f64; 3], f64, [f64; 3])> {
        let hot = self.flash * LIGHT_PEAK;
        if hot > self.flight_light.0 {
            let f2 = self.flash * self.flash;
            Some((self.flash_pos, hot, [1.0, 0.7 + 0.3 * f2, 0.4 + 0.5 * f2]))
        } else if self.flight_light.0 > 0.0 {
            Some((self.flight_light.1, self.flight_light.0, [1.0, 0.6, 0.29]))
        } else {
            None
        }
    }

    /// aviso no chão, brilho da cabeça, linha do rastro e bolhas de choque
    pub fn draw(&self, time: f64, out: &mut Vec<Sprite>) {
        let c3 = |c: [f64; 3], a: f64| [c[0] as f32, c[1] as f32, c[2] as f32, a as f32];
        for m in &self.active {
            let warn_k = ((m.t + WARN) / WARN).min(1.0);
            let flight_k = (m.t / FLIGHT).max(0.0);
            let size = (1.35 + (1.0 - 1.35) * flight_k) * m.radius * 2.0;
            let alpha = warn_k * (0.5 + 0.4 * (time * 14.0).sin());
            out.push(Sprite { kind: SpriteKind::Ring, pos: [m.target[0] as f32, (m.target[1] + 0.06) as f32, m.target[2] as f32], size: size as f32, color: c3(WARN_COLOR, alpha), rot: (time * 0.8) as f32, seed: 0.0 });
            if !m.flying() {
                continue;
            }
            let k = (m.t / FLIGHT).min(1.0);
            let mk = m.k();
            let glow = GLOW_SIZE * (0.7 + 0.3 * mk) * (0.9 + 0.1 * (k * 90.0).sin()) * (0.6 + 0.6 * k);
            let h = m.head;
            out.push(Sprite { kind: SpriteKind::Halo, pos: [h[0] as f32, h[1] as f32, h[2] as f32], size: glow as f32, color: c3(GLOW_COLOR, 1.0), rot: 0.0, seed: 0.0 });
            // a linha de brilho do rastro: halos cada vez menores e mais fracos para trás
            let len = 5.0 + 7.0 * k;
            let w = 0.26 * (0.8 + 0.4 * mk) * 2.0;
            for j in 1..10 {
                let u = j as f64 / 10.0;
                let p = [h[0] - m.fwd[0] * len * u, h[1] - m.fwd[1] * len * u, h[2] - m.fwd[2] * len * u];
                out.push(Sprite { kind: SpriteKind::Halo, pos: [p[0] as f32, p[1] as f32, p[2] as f32], size: (w * (1.0 - u * 0.9) * 2.5) as f32, color: c3([2.4, 1.3, 0.5], 0.85 * (1.0 - u)), rot: 0.0, seed: 0.0 });
            }
        }
        for s in &self.shells {
            let u = (s.age / SHELL_LIFE).min(1.0);
            let r = (s.radius * (1.0 - (1.0 - u).powf(2.2))).max(0.01);
            out.push(Sprite { kind: SpriteKind::Shell, pos: [s.pos[0] as f32, s.pos[1] as f32, s.pos[2] as f32], size: (r * 2.0) as f32, color: c3(SHELL_COLOR, 0.55 * (1.0 - u).powf(1.5)), rot: 0.0, seed: 0.0 });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planet::PlanetId;
    use crate::world::SYNC_BUDGET;

    #[test]
    fn meteoro_cai_faz_cratera_e_deixa_onda() {
        let mut w = World::new(PlanetId::Lua, 12345);
        w.radius = 2;
        w.update(0.5, 0.5, SYNC_BUDGET);
        let mut m = Meteors::new(1);
        m.auto_spawn = false;
        let (mut puffs, mut parts) = (Puffs::default(), Particles::default());
        let top = w.top_y(20, 5);
        let target = [20.5, top as f64 + 1.0, 5.5];
        m.launch(target, 2.3, true, 0.7);
        let mut hits = Vec::new();
        for _ in 0..240 {
            hits.extend(m.update(1.0 / 60.0, &mut w, [1.0, 46.0, 1.0], 0.7, &mut puffs, &mut parts));
        }
        assert_eq!(hits.len(), 1);
        assert!(w.top_y(20, 5) < top, "a cratera afundou o chão");
        assert!(puffs.active() > 10);
        let proj = |p: [f64; 3]| Some([p[0] / 50.0, p[2] / 50.0, 0.5]);
        // a onda de choque já passou (0,9 s), mas a cratera ficou e o meteorito está no mundo
        assert!(m.waves.fill(&proj, [1.0, 0.0, 0.0], 1.6).is_empty());
        let has_rock = w.chunks.values().any(|c| c.props.iter().any(|p| p.kind == "meteorite"));
        assert!(has_rock);
    }

    #[test]
    fn onda_cresce_e_some() {
        let mut s = ShockWaves::default();
        s.add([0.0, 0.0, 0.0], 1.0);
        let proj = |p: [f64; 3]| Some([p[0] / 50.0, p[2] / 50.0, 0.5]);
        s.update(0.3);
        let a = s.fill(&proj, [1.0, 0.0, 0.0], 1.0);
        assert_eq!(a.len(), 1);
        assert!(a[0].0[2] > 0.0 && a[0].0[3] > 0.0);
        s.update(1.0);
        assert!(s.fill(&proj, [1.0, 0.0, 0.0], 1.0).is_empty());
    }
}
