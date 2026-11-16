//! Efeitos sem colisão, só a conta (o desenho fica no renderizador): baforadas de fogo e fumaça (porte de `src/render/puffs.ts`),
//! pedrinhas e lascas (`particles.ts`), pegadas (`Footprints.ts`), a poeira dos pés (`dustFx.ts`) e luzes de sinal (`lamps.ts`).
use crate::blocks::{block_data, hex_to_linear, BlockId, Rgb, ANORTHOSITE, BASALT, BRECCIA, DARK_SAND, ICE, MARS_DUST, MARS_ROCK, REGOLITH, ROCK, SEDIMENT, VOLCANIC};

/// Gerador rápido para efeitos (não precisa ser igual ao TS: lá é Math.random).
#[derive(Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1)
    }
    pub fn f(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn range(&mut self, a: f64, b: f64) -> f64 {
        a + self.f() * (b - a)
    }
}

/// Como desenhar um sprite.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpriteKind {
    /// nuvem macia, mistura normal (poeira, fumaça)
    Smoke,
    /// nuvem macia que soma luz (fogo, clarão)
    Fire,
    /// halo radial que soma luz (lâmpadas)
    Halo,
    /// pedrinha: disco firme, mistura normal
    Grit,
    /// pegada no chão (deitada, mistura normal)
    Footprint,
    /// mira do aviso de meteoro: deitada no chão, soma luz, gira
    Ring,
    /// bolha da onda de choque: só a borda da esfera brilha (soma luz)
    Shell,
}

/// um sprite pronto para desenhar
#[derive(Clone, Copy, Debug)]
pub struct Sprite {
    pub kind: SpriteKind,
    pub pos: [f32; 3],
    /// diâmetro (blocos)
    pub size: f32,
    /// cor linear e opacidade
    pub color: [f32; 4],
    /// giro (rad) e semente do ruído
    pub rot: f32,
    pub seed: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct PuffSpec {
    pub pos: [f64; 3],
    pub vel: [f64; 3],
    pub size: f64,
    pub grow_to: f64,
    pub life: f64,
    pub from: Rgb,
    pub to: Option<Rgb>,
    pub alpha: f64,
    pub drag: f64,
    pub gravity: f64,
    pub spin: Option<f64>,
}

impl Default for PuffSpec {
    fn default() -> Self {
        Self { pos: [0.0; 3], vel: [0.0; 3], size: 0.3, grow_to: 1.0, life: 1.0, from: [1.0; 3], to: None, alpha: 1.0, drag: 0.0, gravity: 0.0, spin: None }
    }
}

#[derive(Clone, Copy, Debug)]
struct Puff {
    s: PuffSpec,
    life: f64,
    pos: [f64; 3],
    vel: [f64; 3],
    rot: f64,
    spin: f64,
    seed: f64,
}

/// Baforadas (as duas camadas do puffs.ts), com limite de quantas vivas.
pub struct Puffs {
    fire: Vec<Puff>,
    smoke: Vec<Puff>,
    fire_max: usize,
    smoke_max: usize,
    rng: Rng,
}

impl Default for Puffs {
    fn default() -> Self {
        Self { fire: Vec::new(), smoke: Vec::new(), fire_max: 640, smoke_max: 480, rng: Rng::new(7) }
    }
}

impl Puffs {
    pub fn spawn(&mut self, fire: bool, s: PuffSpec) -> bool {
        let (list, max) = if fire { (&mut self.fire, self.fire_max) } else { (&mut self.smoke, self.smoke_max) };
        if list.len() >= max {
            return false;
        }
        let spin = s.spin.unwrap_or_else(|| (self.rng.f() - 0.5) * 0.8);
        let life = s.life.max(0.01);
        list.push(Puff { s: PuffSpec { life, ..s }, life, pos: s.pos, vel: s.vel, rot: self.rng.f() * std::f64::consts::TAU, spin, seed: self.rng.f() * 40.0 });
        true
    }

    pub fn active(&self) -> usize {
        self.fire.len() + self.smoke.len()
    }

    pub fn clear(&mut self) {
        self.fire.clear();
        self.smoke.clear();
    }

    pub fn update(&mut self, dt: f64) {
        for list in [&mut self.fire, &mut self.smoke] {
            list.retain_mut(|p| {
                p.life -= dt;
                if p.life <= 0.0 {
                    return false;
                }
                let k = (-p.s.drag * dt).exp();
                for v in p.vel.iter_mut() {
                    *v *= k;
                }
                p.vel[1] -= p.s.gravity * dt;
                for i in 0..3 {
                    p.pos[i] += p.vel[i] * dt;
                }
                p.rot += p.spin * dt;
                true
            });
        }
    }

    pub fn draw(&self, out: &mut Vec<Sprite>) {
        for (list, kind) in [(&self.smoke, SpriteKind::Smoke), (&self.fire, SpriteKind::Fire)] {
            for p in list {
                let u = 1.0 - p.life / p.s.life;
                let grow = 1.0 - (1.0 - u) * (1.0 - u);
                let fade = (u / 0.1).min(1.0) * (1.0 - u).powf(1.4);
                let m = u.powf(0.7);
                let to = p.s.to.unwrap_or(p.s.from);
                let c = |i: usize| (p.s.from[i] + (to[i] - p.s.from[i]) * m) as f32;
                out.push(Sprite {
                    kind,
                    pos: [p.pos[0] as f32, p.pos[1] as f32, p.pos[2] as f32],
                    size: (p.s.size * (1.0 + (p.s.grow_to - 1.0) * grow)) as f32,
                    color: [c(0), c(1), c(2), (p.s.alpha * fade) as f32],
                    rot: p.rot as f32,
                    seed: p.seed as f32,
                });
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Particle {
    life: f64,
    max: f64,
    pos: [f64; 3],
    vel: [f64; 3],
    size: f64,
    gravity: f64,
    color: Rgb,
}

/// Pedrinhas e lascas (particles.ts): caem na gravidade dada, com freio.
pub struct Particles {
    p: Vec<Particle>,
    max: usize,
    pub rng: Rng,
}

impl Default for Particles {
    fn default() -> Self {
        Self { p: Vec::new(), max: 320, rng: Rng::new(11) }
    }
}

impl Particles {
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(&mut self, pos: [f64; 3], vel: [f64; 3], size: f64, color: Rgb, life: f64, gravity: f64) {
        if self.p.len() < self.max {
            self.p.push(Particle { life, max: life, pos, vel, size, gravity, color });
        }
    }

    pub fn active(&self) -> usize {
        self.p.len()
    }

    pub fn update(&mut self, dt: f64) {
        self.p.retain_mut(|p| {
            p.life -= dt;
            if p.life <= 0.0 {
                return false;
            }
            p.vel[1] -= p.gravity * dt;
            p.vel[0] *= 1.0 - dt * 1.2;
            p.vel[2] *= 1.0 - dt * 1.2;
            for i in 0..3 {
                p.pos[i] += p.vel[i] * dt;
            }
            true
        });
    }

    pub fn draw(&self, out: &mut Vec<Sprite>) {
        for p in &self.p {
            let t = p.life / p.max;
            let sc = p.size * (t * 2.5).min(1.0);
            out.push(Sprite {
                kind: SpriteKind::Grit,
                pos: [p.pos[0] as f32, p.pos[1] as f32, p.pos[2] as f32],
                size: (sc * 1.3) as f32,
                color: [p.color[0] as f32, p.color[1] as f32, p.color[2] as f32, 1.0],
                rot: 0.0,
                seed: 0.0,
            });
        }
    }
}

/// Pegadas (Footprints.ts): até 160 no chão, apagam no fim da vida (últimos 10 s).
/// uma pegada: posição, ângulo, vida que falta, bloco embaixo
type Mark = ([f64; 3], f64, f64, (i32, i32, i32));

pub struct Footprints {
    marks: Vec<Mark>,
    life: f64,
    color: [f32; 3],
    next: usize,
}

const FOOTPRINT_MAX: usize = 160;
/// chãos que guardam pegada (Game.ts)
pub fn takes_footprint(b: BlockId) -> bool {
    matches!(b, REGOLITH | BASALT | ICE | MARS_DUST | DARK_SAND)
}

impl Footprints {
    pub fn new(life: f64, color: [f64; 3]) -> Self {
        Self { marks: Vec::new(), life, color: [color[0] as f32, color[1] as f32, color[2] as f32], next: 0 }
    }

    pub fn place(&mut self, x: f64, y: f64, z: f64, angle: f64) {
        let cell = (x.floor() as i32, crate::js::round(y) as i32 - 1, z.floor() as i32);
        let m = ([x, y + 0.012, z], angle, self.life, cell);
        if self.marks.len() < FOOTPRINT_MAX {
            self.marks.push(m);
        } else {
            self.marks[self.next] = m;
            self.next = (self.next + 1) % FOOTPRINT_MAX;
        }
    }

    /// apaga as pegadas sobre um bloco alterado
    pub fn clear_at(&mut self, x: i32, y: i32, z: i32) {
        for m in self.marks.iter_mut() {
            if m.3 == (x, y, z) {
                m.2 = 0.0;
            }
        }
    }

    /// `wind` acelera o apagamento (tempestade em Marte)
    pub fn update(&mut self, dt: f64, wind: f64) {
        for m in self.marks.iter_mut() {
            m.2 -= dt * (1.0 + wind);
        }
    }

    pub fn draw(&self, out: &mut Vec<Sprite>) {
        for (p, a, life, _) in &self.marks {
            let fade = (life / 10.0).clamp(0.0, 1.0) as f32;
            if fade <= 0.0 {
                continue;
            }
            out.push(Sprite {
                kind: SpriteKind::Footprint,
                pos: [p[0] as f32, p[1] as f32, p[2] as f32],
                size: 0.32,
                color: [self.color[0], self.color[1], self.color[2], fade],
                rot: *a as f32,
                seed: 0.0,
            });
        }
    }
}

/// a poeira de um chão (dustFx.ts)
#[derive(Clone, Copy, Debug)]
pub struct Dust {
    pub amount: f64,
    pub cloud: Rgb,
    pub grit: Rgb,
}

pub fn dust_of(b: BlockId) -> Option<Dust> {
    let amount = match b {
        REGOLITH | MARS_DUST => 1.0,
        DARK_SAND => 0.9,
        SEDIMENT => 0.6,
        BRECCIA => 0.55,
        ROCK | ANORTHOSITE => 0.4,
        MARS_ROCK => 0.45,
        BASALT => 0.3,
        VOLCANIC => 0.35,
        _ => return None,
    };
    let d = block_data(b)?;
    Some(Dust { amount, cloud: hex_to_linear(d.color, 0.95), grit: hex_to_linear(d.bottom.unwrap_or(d.color), 0.8) })
}

/// Poeira dos pés (DustFx do TS): passo, pouso e pulo.
pub struct DustFx {
    pub gravity: f64,
}

impl DustFx {
    #[allow(clippy::too_many_arguments)]
    pub fn step(&self, puffs: &mut Puffs, parts: &mut Particles, p: [f64; 3], vx: f64, vz: f64, d: Dust, run: f64) {
        let sp = crate::js::hypot(vx, vz);
        let sp = if sp > 0.0 { sp } else { 1.0 };
        let (bx, bz) = (-vx / sp, -vz / sp);
        let n = crate::js::round((1.0 + run * 2.0) * (0.6 + d.amount * 0.6)) as i32;
        let r = &mut parts.rng;
        for _ in 0..n {
            let kick = r.range(0.5, 1.1) * (0.7 + run * 0.9);
            let side = r.range(-0.45, 0.45);
            puffs.spawn(
                false,
                PuffSpec {
                    pos: [p[0] + bx * 0.12 + r.range(-0.08, 0.08), p[1] + r.range(0.04, 0.12), p[2] + bz * 0.12 + r.range(-0.08, 0.08)],
                    vel: [(bx - bz * side) * kick, r.range(0.25, 0.55) * (0.8 + run * 0.6), (bz + bx * side) * kick],
                    size: r.range(0.18, 0.3) * (0.85 + run * 0.4),
                    grow_to: r.range(2.2, 3.2),
                    life: r.range(0.9, 1.5) + run * 0.5,
                    from: d.cloud,
                    alpha: (0.42 + run * 0.2) * d.amount,
                    drag: 2.4,
                    gravity: 0.12,
                    ..Default::default()
                },
            );
        }
        let g = crate::js::round((if run > 0.4 { 3.0 } else { 1.0 }) * d.amount + r.f() * 0.8) as i32;
        for _ in 0..g {
            let r = &mut parts.rng;
            let kick = r.range(0.8, 1.6) * (0.6 + run);
            let side = r.range(-0.6, 0.6);
            let pos = [p[0] + r.range(-0.05, 0.05), p[1] + 0.05, p[2] + r.range(-0.05, 0.05)];
            let vel = [(bx - bz * side) * kick, r.range(0.8, 1.8) * (0.7 + run * 0.5), (bz + bx * side) * kick];
            let (size, life) = (r.range(0.035, 0.06), r.range(0.6, 1.0));
            parts.spawn(pos, vel, size, d.grit, life, self.gravity * 0.7);
        }
    }

    pub fn land(&self, puffs: &mut Puffs, parts: &mut Particles, p: [f64; 3], d: Dust, impact: f64) {
        let n = crate::js::round(6.0 + impact * 8.0) as i32;
        for i in 0..n {
            let r = &mut parts.rng;
            let a = (i as f64 / n as f64) * std::f64::consts::PI * 2.0 + r.range(-0.2, 0.2);
            let v = r.range(1.0, 1.8) * (0.7 + impact);
            puffs.spawn(
                false,
                PuffSpec {
                    pos: [p[0] + a.cos() * 0.2, p[1] + 0.06, p[2] + a.sin() * 0.2],
                    vel: [a.cos() * v, r.range(0.1, 0.35), a.sin() * v],
                    size: r.range(0.22, 0.34),
                    grow_to: r.range(2.4, 3.4),
                    life: r.range(1.1, 1.8),
                    from: d.cloud,
                    alpha: (0.35 + impact * 0.2) * d.amount,
                    drag: 2.2,
                    gravity: 0.1,
                    ..Default::default()
                },
            );
        }
        let k = (3.0 + impact * 5.0) as i32;
        for _ in 0..k {
            let r = &mut parts.rng;
            let a = r.f() * std::f64::consts::PI * 2.0;
            let v = r.range(0.8, 2.0);
            let vel = [a.cos() * v, r.range(1.0, 2.4), a.sin() * v];
            let (size, life) = (r.range(0.035, 0.065), r.range(0.7, 1.1));
            parts.spawn([p[0], p[1] + 0.05, p[2]], vel, size, d.grit, life, self.gravity * 0.7);
        }
    }

    pub fn jump(&self, puffs: &mut Puffs, rng: &mut Rng, p: [f64; 3], d: Dust) {
        for _ in 0..5 {
            let a = rng.f() * std::f64::consts::PI * 2.0;
            let v = rng.range(0.5, 1.0);
            puffs.spawn(
                false,
                PuffSpec {
                    pos: [p[0], p[1] + 0.05, p[2]],
                    vel: [a.cos() * v, rng.range(0.05, 0.25), a.sin() * v],
                    size: rng.range(0.2, 0.3),
                    grow_to: rng.range(2.0, 2.8),
                    life: rng.range(0.8, 1.2),
                    from: d.cloud,
                    alpha: 0.3 * d.amount,
                    drag: 2.5,
                    gravity: 0.1,
                    ..Default::default()
                },
            );
        }
    }
}

/// Luz de sinal (lamps.ts): núcleo muito claro (o bloom faz o brilho) e dois halos aditivos.
pub fn signal_lamp(pos: [f32; 3], color: [f32; 3], size: f32, halo: f32, level: f32, out: &mut Vec<Sprite>) {
    if level <= 0.02 {
        return;
    }
    let k = 0.15 + 0.85 * level.min(1.0);
    let max = color[0].max(color[1]).max(color[2]).max(1.0);
    let soft = [color[0] / max, color[1] / max, color[2] / max];
    out.push(Sprite { kind: SpriteKind::Halo, pos, size: size * 2.2, color: [color[0] * k * 3.0, color[1] * k * 3.0, color[2] * k * 3.0, 1.0], rot: 0.0, seed: 1.0 });
    out.push(Sprite { kind: SpriteKind::Halo, pos, size: halo * 0.4 * (0.8 + 0.2 * level), color: [soft[0], soft[1], soft[2], level.min(1.0)], rot: 0.0, seed: 0.0 });
    out.push(Sprite { kind: SpriteKind::Halo, pos, size: halo * (0.7 + 0.3 * level), color: [soft[0], soft[1], soft[2], 0.45 * level], rot: 0.0, seed: 0.0 });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn baforada_cresce_e_some() {
        let mut p = Puffs::default();
        p.spawn(false, PuffSpec { size: 0.2, grow_to: 3.0, life: 1.0, ..Default::default() });
        let mut s = Vec::new();
        p.update(0.5);
        p.draw(&mut s);
        assert!(s[0].size > 0.2 && s[0].color[3] > 0.0);
        p.update(0.6);
        assert_eq!(p.active(), 0);
    }
    #[test]
    fn pegada_apaga_no_bloco_mexido() {
        let mut f = Footprints::new(45.0, [0.1, 0.1, 0.1]);
        f.place(3.2, 46.0, 4.7, 0.0);
        let mut s = Vec::new();
        f.draw(&mut s);
        assert_eq!(s.len(), 1);
        f.clear_at(3, 45, 4);
        s.clear();
        f.draw(&mut s);
        assert!(s.is_empty());
    }
    #[test]
    fn regolito_solta_poeira_e_gelo_nao() {
        assert!(dust_of(REGOLITH).is_some());
        assert!(dust_of(ICE).is_none());
    }
}
