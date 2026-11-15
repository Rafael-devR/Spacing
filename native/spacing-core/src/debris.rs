//! Pedaços de bloco e lascas que quicam (porte de `src/entities/Debris.ts`, docs/design/FISICA.md): saem do que foi
//! quebrado, batem nos blocos e uns nos outros, param e "dormem", e o astronauta chuta os que estão no caminho. Na Lua
//! a gravidade dos pedaços é fraca (flutuam); em Marte caem de verdade e o ar freia. Brasas esfriam até a cor da rocha
//! e podem quebrar em lascas na primeira pancada forte (meteoros).
use std::collections::HashMap;

use crate::blocks::{Rgb, AIR};
use crate::fx::Rng;
use crate::world::World;

/// cor de brasa (linear, acima de 1: o bloom pega)
const HOT: Rgb = [2.8, 1.0, 0.28];
/// pancada mais forte que isto (blocos/s) quebra um pedaço que tem lascas
const BREAK_SPEED: f64 = 2.2;
/// pedaços de cada forma, no máximo (o mais velho dá lugar ao novo)
const PER_KIND: usize = 150;
const LIFE: f64 = 50.0;
const HALF_PI: f64 = std::f64::consts::FRAC_PI_2;

/// 0 = cubo, 1 = lasca
pub type Kind = u8;

#[derive(Clone, Debug)]
pub struct Piece {
    pub kind: Kind,
    pub size: f64,
    r: f64,
    pub pos: [f64; 3],
    vel: [f64; 3],
    prev: [f64; 3],
    /// giro (x, y, z) e velocidade do giro
    pub rot: [f64; 3],
    spin: [f64; 3],
    pub life: f64,
    sleep: bool,
    still: f64,
    check: f64,
    ground: bool,
    base: Rgb,
    heat: f64,
    heat0: f64,
    trail: f64,
    trail_t: f64,
    splinters: u32,
}

impl Piece {
    /// a cor agora: da brasa (quente) até a da rocha (frio)
    pub fn color(&self) -> Rgb {
        let h = if self.heat0 > 0.0 { self.heat.max(0.0) / self.heat0 } else { 0.0 };
        let k = h.powf(1.6);
        let b = self.base;
        [b[0] + (HOT[0] - b[0]) * k, b[1] + (HOT[1] - b[1]) * k, b[2] + (HOT[2] - b[2]) * k]
    }

    /// tamanho desenhado (some no fim da vida)
    pub fn draw_size(&self) -> f64 {
        let fade = if self.life < 0.0 { (1.0 + self.life * 2.0).max(0.0) } else { 1.0 };
        self.size * fade
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SpawnOpts {
    /// segundos incandescente, esfriando
    pub heat: f64,
    /// segundos soltando fumaça no voo
    pub trail: f64,
    /// pedaços em que quebra ao bater forte
    pub splinters: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct BurstOpts {
    pub power: f64,
    pub spread: f64,
    pub min_size: f64,
    pub max_size: f64,
    pub up: f64,
}

impl Default for BurstOpts {
    fn default() -> Self {
        Self { power: 1.8, spread: 0.32, min_size: 0.12, max_size: 0.3, up: 1.1 }
    }
}

/// som que um pedaço pede (o jogo toca)
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DebrisSound {
    /// bateu no chão
    Clink { speed: f64, pos: [f64; 3] },
    /// o astronauta chutou
    Kick { speed: f64, pos: [f64; 3] },
}

/// fumaça de um pedaço quente em voo: posição, velocidade, tamanho e quanto ainda está quente (0 a 1)
#[derive(Clone, Copy, Debug)]
pub struct Trail {
    pub pos: [f64; 3],
    pub vel: [f64; 3],
    pub size: f64,
    pub heat: f64,
}

/// quebra pendente: posição, velocidade, tamanho, cor, calor e quantas lascas
type Split = ([f64; 3], [f64; 3], f64, Rgb, f64, u32);

pub struct Debris {
    pub items: Vec<Piece>,
    gravity: f64,
    drag: f64,
    rng: Rng,
    grid: HashMap<i64, Vec<usize>>,
    sound_cooldown: f64,
    /// sons deste passo
    pub sounds: Vec<DebrisSound>,
    /// fumaça deste passo
    pub trails: Vec<Trail>,
    /// quebras deste passo (posição e tamanho): poeira e som
    pub breaks: Vec<([f64; 3], f64)>,
}

impl Debris {
    /// `gravity` e `drag` vêm do planeta (debris_gravity, debris_drag)
    pub fn new(gravity: f64, drag: f64, seed: u64) -> Self {
        Self { items: Vec::new(), gravity, drag, rng: Rng::new(seed), grid: HashMap::new(), sound_cooldown: 0.0, sounds: Vec::new(), trails: Vec::new(), breaks: Vec::new() }
    }

    pub fn count(&self) -> usize {
        self.items.len()
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn spawn(&mut self, pos: [f64; 3], vel: [f64; 3], size: f64, rgb: Rgb, kind: Kind, o: SpawnOpts) {
        if self.items.iter().filter(|it| it.kind == kind).count() >= PER_KIND {
            if let Some(k) = self.items.iter().position(|it| it.kind == kind) {
                self.items.remove(k);
            }
        }
        let r = size * if kind == 0 { 0.5 } else { 0.42 };
        let g = &mut self.rng;
        let rot = [g.f() * 6.0, g.f() * 6.0, g.f() * 6.0];
        let spin = [(g.f() - 0.5) * 14.0, (g.f() - 0.5) * 14.0, (g.f() - 0.5) * 14.0];
        let life = LIFE * (0.8 + g.f() * 0.4);
        self.items.push(Piece {
            kind,
            size,
            r,
            pos,
            vel,
            prev: pos,
            rot,
            spin,
            life,
            sleep: false,
            still: 0.0,
            check: 0.0,
            ground: false,
            base: rgb,
            heat: o.heat,
            heat0: o.heat,
            trail: o.trail,
            trail_t: 0.0,
            splinters: o.splinters,
        });
    }

    /// explode um volume em pedaços
    pub fn burst(&mut self, center: [f64; 3], count: usize, palette: &[Rgb], o: BurstOpts) {
        if palette.is_empty() {
            return;
        }
        for k in 0..count {
            let col = palette[k % palette.len()];
            let g = &mut self.rng;
            let shade = 0.82 + g.f() * 0.3;
            let p = [
                center[0] + (g.f() - 0.5) * o.spread * 2.0,
                center[1] + (g.f() - 0.5) * o.spread * 2.0,
                center[2] + (g.f() - 0.5) * o.spread * 2.0,
            ];
            let mut v = [(p[0] - center[0]) * o.power * 2.2, (p[1] - center[1]) * o.power * 2.2, (p[2] - center[2]) * o.power * 2.2];
            v[0] += (g.f() - 0.5) * o.power;
            v[2] += (g.f() - 0.5) * o.power;
            v[1] += o.up * (0.6 + g.f() * 0.8);
            let size = o.min_size + g.f() * (o.max_size - o.min_size);
            let kind = if k % palette.len() > 0 || g.f() < 0.45 { 1 } else { 0 };
            self.spawn(p, v, size, [col[0] * shade, col[1] * shade, col[2] * shade], kind, SpawnOpts::default());
        }
    }

    pub fn rand(&mut self) -> f64 {
        self.rng.f()
    }

    fn solid(w: &World, x: f64, y: f64, z: f64, r: f64) -> bool {
        let (x0, x1) = ((x - r).floor() as i32, (x + r).floor() as i32);
        let (y0, y1) = ((y - r).floor() as i32, (y + r).floor() as i32);
        let (z0, z1) = ((z - r).floor() as i32, (z + r).floor() as i32);
        for yy in y0..=y1 {
            for zz in z0..=z1 {
                for xx in x0..=x1 {
                    if yy < 0 || w.peek_block(xx, yy, zz) != AIR {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// anda num eixo em passos de 0,2; devolve true se bateu
    fn move_axis(w: &World, it: &mut Piece, axis: usize, amount: f64) -> bool {
        let r = it.r;
        let steps = ((amount.abs() / 0.2).ceil() as usize).max(1);
        let d = amount / steps as f64;
        for _ in 0..steps {
            it.pos[axis] += d;
            if !Self::solid(w, it.pos[0], it.pos[1], it.pos[2], r) {
                continue;
            }
            it.pos[axis] = if d > 0.0 { (it.pos[axis] + r).floor() - r - 0.001 } else { (it.pos[axis] - r).floor() + 1.0 + r + 0.001 };
            return true;
        }
        false
    }

    fn cell_key(x: f64, y: f64, z: f64) -> i64 {
        let f = |v: f64, k: i64| ((v * 2.0).floor() as i64).wrapping_mul(k);
        f(x, 73856093) ^ f(y, 19349663) ^ f(z, 83492791)
    }

    fn build_grid(&mut self) {
        self.grid.clear();
        for (i, it) in self.items.iter().enumerate() {
            self.grid.entry(Self::cell_key(it.pos[0], it.pos[1], it.pos[2])).or_default().push(i);
        }
    }

    fn neighbors(&self, i: usize) -> Vec<usize> {
        let p = self.items[i].pos;
        let mut out = Vec::new();
        for dx in [-0.5, 0.0, 0.5] {
            for dy in [-0.5, 0.0, 0.5] {
                for dz in [-0.5, 0.0, 0.5] {
                    if let Some(a) = self.grid.get(&Self::cell_key(p[0] + dx, p[1] + dy, p[2] + dz)) {
                        out.extend(a.iter().copied().filter(|&o| o != i));
                    }
                }
            }
        }
        out
    }

    fn supported(&self, w: &World, i: usize) -> bool {
        let it = &self.items[i];
        if Self::solid(w, it.pos[0], it.pos[1] - 0.06, it.pos[2], it.r) {
            return true;
        }
        self.neighbors(i).into_iter().any(|o| {
            let o = &self.items[o];
            let dy = it.pos[1] - o.pos[1];
            dy > 0.02 && (it.pos[0] - o.pos[0]).hypot(it.pos[2] - o.pos[2]) < (it.r + o.r) * 0.9 && dy < it.r + o.r + 0.06
        })
    }

    fn wake(it: &mut Piece) {
        it.sleep = false;
        it.still = 0.0;
    }

    /// acorda tudo perto de um bloco alterado
    pub fn disturb(&mut self, x: i32, y: i32, z: i32) {
        for it in &mut self.items {
            if (it.pos[0] - x as f64 - 0.5).abs() < 1.6 && (it.pos[1] - y as f64 - 0.5).abs() < 1.8 && (it.pos[2] - z as f64 - 0.5).abs() < 1.6 {
                Self::wake(it);
            }
        }
    }

    /// Um passo. `pp`, `pv`: posição e velocidade do astronauta (chuta o que estiver no caminho).
    pub fn update(&mut self, dt: f64, w: &World, pp: [f64; 3], pv: [f64; 3]) {
        self.sounds.clear();
        self.trails.clear();
        self.breaks.clear();
        self.sound_cooldown -= dt;
        self.build_grid();
        let p_speed = pv[0].hypot(pv[2]);
        let mut pending: Vec<DebrisSound> = Vec::new();
        let mut splits: Vec<Split> = Vec::new();
        let mut dead = Vec::new();
        let (gravity, drag) = (self.gravity, self.drag);
        for n in (0..self.items.len()).rev() {
            let neigh = self.neighbors(n);
            let supported = self.items[n].sleep && self.items[n].check - dt <= 0.0 && self.supported(w, n);
            let (r1, r2, r3, r4, r5, r6) = (self.rng.f(), self.rng.f(), self.rng.f(), self.rng.f(), self.rng.f(), self.rng.f());
            let it = &mut self.items[n];
            it.life -= dt;
            if it.life < -0.5 {
                dead.push(n);
                continue;
            }
            if it.heat > 0.0 {
                it.heat = (it.heat - dt).max(0.0);
            }
            let (dx, dz) = (it.pos[0] - pp[0], it.pos[2] - pp[2]);
            let dh = dx.hypot(dz);
            if dh > 80.0 && it.life > 0.0 {
                it.life = 0.0;
            }
            // chutado pelo astronauta
            if dh < 0.34 + it.r && it.pos[1] > pp[1] - 0.35 && it.pos[1] < pp[1] + 1.5 {
                let (nx, nz) = if dh > 1e-3 { (dx / dh, dz / dh) } else { (r1 - 0.5, r2 - 0.5) };
                let push = 1.4 + p_speed * 1.15;
                it.vel = [nx * push + pv[0] * 0.45, 1.1 + p_speed * 0.35 + r3 * 0.9, nz * push + pv[2] * 0.45];
                // pisou em cima
                if pv[1] < -3.0 && it.pos[1] < pp[1] + 0.2 {
                    it.vel[1] += -pv[1] * 0.25;
                }
                it.spin[0] = (r4 - 0.5) * 16.0;
                it.spin[2] = (r5 - 0.5) * 16.0;
                let (ox, oz) = (it.pos[0], it.pos[2]);
                it.pos[0] = pp[0] + nx * (0.35 + it.r);
                it.pos[2] = pp[2] + nz * (0.35 + it.r);
                if Self::solid(w, it.pos[0], it.pos[1], it.pos[2], it.r) {
                    it.pos[0] = ox;
                    it.pos[2] = oz;
                }
                if it.sleep || it.still > 0.0 {
                    pending.push(DebrisSound::Kick { speed: push, pos: it.pos });
                }
                Self::wake(it);
            }
            if it.sleep {
                it.check -= dt;
                if it.check <= 0.0 {
                    it.check = 0.25 + r6 * 0.1;
                    if !supported {
                        Self::wake(it);
                    }
                }
                continue;
            }
            if Self::solid(w, it.pos[0], it.pos[1], it.pos[2], it.r) {
                it.pos[1] = (it.pos[1] - it.r).floor() + 1.0 + it.r + 0.002;
            }
            it.prev = it.pos;
            it.vel[1] -= gravity * dt;
            if drag > 0.0 {
                let k = (-drag * dt).exp();
                it.vel[0] *= k;
                it.vel[2] *= k;
            }
            it.vel[1] = it.vel[1].max(-25.0);
            if Self::move_axis(w, it, 0, it.vel[0] * dt) {
                it.vel[0] *= -0.5;
                it.spin[2] *= 0.5;
            }
            if Self::move_axis(w, it, 2, it.vel[2] * dt) {
                it.vel[2] *= -0.5;
                it.spin[0] *= 0.5;
            }
            it.ground = false;
            let vy = it.vel[1];
            if Self::move_axis(w, it, 1, vy * dt) {
                if vy < 0.0 {
                    it.ground = true;
                    if vy < -0.7 {
                        it.vel[1] = -vy * 0.45;
                        it.spin[0] = it.spin[0] * 0.6 + it.vel[2] * 4.0;
                        it.spin[2] = it.spin[2] * 0.6 - it.vel[0] * 4.0;
                        if vy < -2.5 {
                            pending.push(DebrisSound::Clink { speed: -vy, pos: it.pos });
                        }
                        if it.splinters > 0 && -vy > BREAK_SPEED {
                            splits.push((it.pos, it.vel, it.size, it.base, it.heat, it.splinters));
                            it.splinters = 0;
                            it.size *= 0.72;
                            it.r *= 0.8;
                        }
                    } else {
                        it.vel[1] = 0.0;
                    }
                } else {
                    it.vel[1] = 0.0;
                }
            } else if vy <= 0.0 && Self::solid(w, it.pos[0], it.pos[1] - 0.01, it.pos[2], it.r) {
                // apoiado com folga de 0,001: no TS o pedaço alterna "no chão"/"caindo" a cada passo e nunca dorme
                it.ground = true;
                it.vel[1] = 0.0;
            }
            // empurra os vizinhos
            for o in neigh {
                if o == n || o >= self.items.len() {
                    continue;
                }
                let (a, b) = if n < o {
                    let (l, r) = self.items.split_at_mut(o);
                    (&mut l[n], &mut r[0])
                } else {
                    let (l, r) = self.items.split_at_mut(n);
                    (&mut r[0], &mut l[o])
                };
                let d = [a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]];
                let sum = (a.r + b.r) * 0.92;
                let d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
                if d2 >= sum * sum || d2 < 1e-8 {
                    continue;
                }
                let dl = d2.sqrt();
                let nrm = [d[0] / dl, d[1] / dl, d[2] / dl];
                let overlap = sum - dl;
                let share = if b.sleep { 1.0 } else { 0.5 };
                for (k, nk) in nrm.iter().enumerate() {
                    a.pos[k] += nk * overlap * share;
                    if !b.sleep {
                        b.pos[k] -= nk * overlap * 0.5;
                    }
                }
                let rv = (0..3).map(|k| (a.vel[k] - b.vel[k]) * nrm[k]).sum::<f64>();
                if rv < 0.0 {
                    let j = -rv * 0.6;
                    for (v, nk) in a.vel.iter_mut().zip(nrm) {
                        *v += nk * j;
                    }
                    if b.sleep {
                        if -rv > 3.0 {
                            Self::wake(b);
                            b.vel[0] -= nrm[0] * j;
                            b.vel[2] -= nrm[2] * j;
                            b.vel[1] += 0.8;
                        }
                    } else {
                        for (v, nk) in b.vel.iter_mut().zip(nrm) {
                            *v -= nk * j;
                        }
                    }
                }
                if nrm[1] > 0.55 {
                    a.ground = true;
                    if a.vel[1] < 0.0 {
                        a.vel[1] = 0.0;
                    }
                }
            }
            let it = &mut self.items[n];
            if Self::solid(w, it.pos[0], it.pos[1], it.pos[2], it.r) {
                it.pos = it.prev;
            }
            if it.ground {
                let f = (-5.5 * dt).exp();
                it.vel[0] *= f;
                it.vel[2] *= f;
                let af = (-4.0 * dt).exp();
                it.spin.iter_mut().for_each(|s| *s *= af);
            }
            for k in 0..3 {
                it.rot[k] += it.spin[k] * dt;
            }
            if it.trail > 0.0 && !it.ground {
                it.trail -= dt;
                it.trail_t -= dt;
                if it.trail_t <= 0.0 {
                    it.trail_t = 0.05;
                    self.trails.push(Trail { pos: it.pos, vel: it.vel, size: it.size, heat: if it.heat0 > 0.0 { it.heat / it.heat0 } else { 0.0 } });
                }
            }
            let speed = (it.vel[0] * it.vel[0] + it.vel[1] * it.vel[1] + it.vel[2] * it.vel[2]).sqrt();
            if it.ground && speed < 0.35 {
                it.still += dt;
                // assenta numa face
                let k = 1.0 - (-10.0 * dt).exp();
                it.rot[0] += ((it.rot[0] / HALF_PI).round() * HALF_PI - it.rot[0]) * k;
                it.rot[2] += ((it.rot[2] / HALF_PI).round() * HALF_PI - it.rot[2]) * k;
                if it.still > 0.4 {
                    it.sleep = true;
                    it.vel = [0.0; 3];
                    it.check = 0.3;
                }
            } else {
                it.still = 0.0;
            }
        }
        dead.sort_unstable();
        for i in dead.into_iter().rev() {
            self.items.remove(i);
        }
        // quebras: lascas novas
        for (pos, vel, size, base, heat, n) in splits {
            for _ in 0..n {
                let g = &mut self.rng;
                let a = g.f() * std::f64::consts::TAU;
                let sp = 1.2 + g.f() * 2.4;
                let p = [pos[0] + a.cos() * 0.15, pos[1] + 0.2, pos[2] + a.sin() * 0.15];
                let v = [a.cos() * sp + vel[0] * 0.3, 1.4 + g.f() * 2.4, a.sin() * sp + vel[2] * 0.3];
                let s = size * (0.3 + g.f() * 0.2);
                self.spawn(p, v, s, base, 1, SpawnOpts { heat, ..Default::default() });
            }
            self.breaks.push((pos, size));
        }
        if !pending.is_empty() && self.sound_cooldown <= 0.0 {
            self.sounds = pending;
            self.sound_cooldown = 0.07;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planet::PlanetId;

    #[test]
    fn pedacos_caem_param_e_dormem() {
        let mut w = World::new(PlanetId::Marte, 12345);
        w.update(0.5, 0.5, crate::world::SYNC_BUDGET);
        let top = w.top_y(0, 0) as f64 + 1.0;
        let mut d = Debris::new(3.5, 0.6, 1);
        d.burst([0.5, top + 0.6, 0.5], 15, &[[0.3, 0.2, 0.1]], BurstOpts::default());
        assert_eq!(d.count(), 15);
        for _ in 0..600 {
            d.update(1.0 / 60.0, &w, [40.0, top, 40.0], [0.0; 3]);
        }
        // todos no chão (acima do bloco do topo, sem atravessar) e a maioria dormindo
        for it in &d.items {
            assert!(it.pos[1] > top - 1.0 && it.pos[1] < top + 2.0, "pedaço em {:?}", it.pos);
        }
        assert!(d.items.iter().filter(|it| it.sleep).count() > 10);
        // o astronauta passa e chuta
        let p = d.items[0].pos;
        d.update(1.0 / 60.0, &w, [p[0], p[1] - 0.2, p[2]], [3.0, 0.0, 0.0]);
        assert!(!d.items[0].sleep);
    }
}
