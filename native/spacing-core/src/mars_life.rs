//! Marte vivo, a parte que não depende de HUD nem de sobrevivência: clima (porte de `src/systems/Weather.ts`), tempestade de
//! poeira, redemoinhos (`src/render/marsFx.ts`), brasas da lava e erupções do vulcão (`src/app/MarsDirector.ts`). Dano da lava,
//! bateria do redemoinho, avisos e sons entram com o M4 (sobrevivência e HUD).
use crate::blocks::LAVA;
use crate::fx::{Particles, PuffSpec, Puffs, Rng, Sprite, SpriteKind};
use crate::mars::VOLCANO;
use crate::noise::Mulberry32;
use crate::world::World;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WeatherPhase {
    Calm,
    Coming,
    Storm,
    Clearing,
}

impl WeatherPhase {
    fn range(self, first: bool) -> (f64, f64) {
        match self {
            WeatherPhase::Calm if first => (60.0, 90.0),
            WeatherPhase::Calm => (110.0, 220.0),
            WeatherPhase::Coming => (22.0, 22.0),
            WeatherPhase::Storm => (55.0, 95.0),
            WeatherPhase::Clearing => (25.0, 25.0),
        }
    }
    fn target(self) -> f64 {
        match self {
            WeatherPhase::Calm | WeatherPhase::Clearing => 0.0,
            WeatherPhase::Coming => 0.35,
            WeatherPhase::Storm => 1.0,
        }
    }
}

/// Tempestades que chegam, ficam e passam (Weather.ts; mesma semente, mesma sequência).
pub struct Weather {
    pub phase: WeatherPhase,
    pub left: f64,
    /// poeira no ar, 0..1
    pub level: f64,
    pub wind_angle: f64,
    from: f64,
    dur: f64,
    rand: Mulberry32,
}

impl Weather {
    pub fn new(seed: u32) -> Self {
        let mut rand = Mulberry32::new(seed);
        let wind_angle = rand.next_f64() * std::f64::consts::PI * 2.0;
        let (a, b) = WeatherPhase::Calm.range(true);
        let dur = a + (b - a) * rand.next_f64();
        Self { phase: WeatherPhase::Calm, left: dur, level: 0.0, wind_angle, from: 0.0, dur, rand }
    }

    pub fn wind_speed(&self) -> f64 {
        1.0 + self.level * 5.0
    }
    pub fn wind_x(&self) -> f64 {
        self.wind_angle.cos() * self.wind_speed()
    }
    pub fn wind_z(&self) -> f64 {
        self.wind_angle.sin() * self.wind_speed()
    }

    /// Avança o tempo; devolve a fase nova quando muda.
    pub fn update(&mut self, dt: f64) -> Option<WeatherPhase> {
        self.wind_angle += (self.rand.next_f64() - 0.5) * 0.02 * dt * 10.0;
        self.left -= dt;
        let k = (1.0 - self.left / self.dur).min(1.0);
        let ease = k * k * (3.0 - 2.0 * k);
        self.level = self.from + (self.phase.target() - self.from) * ease;
        if self.left > 0.0 {
            return None;
        }
        self.from = self.phase.target();
        let next = match self.phase {
            WeatherPhase::Calm => WeatherPhase::Coming,
            WeatherPhase::Coming => WeatherPhase::Storm,
            WeatherPhase::Storm => WeatherPhase::Clearing,
            WeatherPhase::Clearing => WeatherPhase::Calm,
        };
        self.phase = next;
        let (a, b) = next.range(false);
        self.dur = a + (b - a) * self.rand.next_f64();
        self.left = self.dur;
        if next == WeatherPhase::Coming {
            self.wind_angle = self.rand.next_f64() * std::f64::consts::PI * 2.0;
        }
        Some(next)
    }
}

/// a névoa na tempestade, em múltiplos da distância da câmera (MARS.stormFog)
pub const STORM_FOG: (f64, f64) = (1.05, 1.3);
/// empurrão máximo do vento (blocos/s)
pub const STORM_PUSH: f64 = 0.9;
const ERUPTION_RANGE: f64 = 110.0;
const EMBER: [f64; 3] = [3.2, 1.1, 0.25];
const SMOKE: [f64; 3] = [0.09, 0.06, 0.05];
const STORM_N: usize = 900;
const STORM_BOX: [f64; 3] = [44.0, 14.0, 44.0];
const DEVIL_MAX: usize = 2;
const DEVIL_PER: usize = 140;
const DEVIL_H: f64 = 9.0;

struct Devil {
    x: f64,
    z: f64,
    y: f64,
    vx: f64,
    vz: f64,
    life: f64,
    max: f64,
    touched: bool,
}

/// o que um redemoinho fez ao passar pelo jogador
#[derive(Clone, Copy, Debug)]
pub struct DevilHit {
    pub vx: f64,
    pub vz: f64,
}

pub struct MarsLife {
    pub weather: Weather,
    rng: Rng,
    storm: Vec<[f64; 3]>,
    storm_alpha: Vec<f64>,
    storm_origin: [f64; 3],
    devils: Vec<Devil>,
    devil_seed: Vec<(f64, f64)>,
    devil_spawn: f64,
    t: f64,
    lava_cells: Vec<(i32, i32, i32)>,
    scan_in: f64,
    ember_acc: f64,
    eruption_in: f64,
    fountain: f64,
}

impl MarsLife {
    pub fn new() -> Self {
        let mut rng = Rng::new(20261112);
        let storm = (0..STORM_N).map(|_| [rng.f() * STORM_BOX[0], rng.f() * STORM_BOX[1], rng.f() * STORM_BOX[2]]).collect();
        let storm_alpha = (0..STORM_N).map(|_| 0.35 + rng.f() * 0.65).collect();
        let devil_seed = (0..DEVIL_MAX * DEVIL_PER).map(|_| (rng.f() * std::f64::consts::TAU, rng.f().powf(0.8))).collect();
        Self {
            weather: Weather::new(20261112),
            rng,
            storm,
            storm_alpha,
            storm_origin: [0.0; 3],
            devils: Vec::new(),
            devil_seed,
            devil_spawn: 20.0,
            t: 0.0,
            lava_cells: Vec::new(),
            scan_in: 0.0,
            ember_acc: 0.0,
            eruption_in: 25.0,
            fountain: 0.0,
        }
    }

    /// Modo de teste: tempestade já no auge (a do jogo leva minutos para chegar).
    pub fn force_storm(&mut self) {
        let w = &mut self.weather;
        w.phase = WeatherPhase::Storm;
        w.from = 1.0;
        w.level = 1.0;
        w.dur = 60.0;
        w.left = 60.0;
    }

    /// Modo de teste: um redemoinho a alguns blocos, vindo na direção do jogador.
    pub fn force_devil(&mut self, world: &mut World, p: [f64; 3]) {
        let (x, z) = (p[0] - 7.0, p[2] - 3.0);
        let y = world.top_y(x.floor() as i32, z.floor() as i32) as f64 + 1.0;
        self.devils.push(Devil { x, z, y, vx: 1.6, vz: 0.7, life: 4.0, max: 30.0, touched: false });
    }

    /// poeira no ar agora (0..1)
    pub fn dust(&self) -> f64 {
        self.weather.level
    }

    /// névoa (perto, longe) em múltiplos da distância da câmera, a partir dos de tempo bom
    pub fn fog(&self, near: f64, far: f64) -> (f64, f64) {
        let l = self.weather.level;
        (near + (STORM_FOG.0 - near) * l, far + (STORM_FOG.1 - far) * l)
    }

    /// Um quadro. Devolve o empurrão do vento no jogador, se um redemoinho passou e se o chão deve tremer (erupção).
    pub fn update(&mut self, dt: f64, world: &mut World, player: [f64; 3], focus: [f64; 3], puffs: &mut Puffs, parts: &mut Particles) -> (([f64; 3], Option<DevilHit>), f64) {
        self.t += dt;
        self.weather.update(dt);
        let w = &self.weather;
        let l = w.level;
        let (wx, wz) = (w.wind_x(), w.wind_z());
        // tempestade: a caixa de poeira acompanha a câmera e cada grão anda com o vento
        self.storm_origin = [focus[0] - STORM_BOX[0] / 2.0, focus[1] - 3.0, focus[2] - STORM_BOX[2] / 2.0];
        if l > 0.02 {
            let (sx, sz) = (wx * 3.0 * dt, wz * 3.0 * dt);
            for (i, p) in self.storm.iter_mut().enumerate() {
                p[0] = (p[0] + sx).rem_euclid(STORM_BOX[0]);
                p[1] = (p[1] + ((i * 3) as f64 + p[0] * 0.3).sin() * dt * 0.6).rem_euclid(STORM_BOX[1]);
                p[2] = (p[2] + sz).rem_euclid(STORM_BOX[2]);
            }
        }
        let k = l * STORM_PUSH / w.wind_speed().max(1.0);
        let push = [wx * k, 0.0, wz * k];
        let hit = self.devils(dt, world, player, wx, wz, 1.0 - l);
        self.lava(dt, world, player, puffs, parts);
        let shake = self.volcano(dt, world, player, puffs, parts);
        ((push, hit), shake)
    }

    fn devils(&mut self, dt: f64, world: &mut World, p: [f64; 3], wx: f64, wz: f64, calm: f64) -> Option<DevilHit> {
        self.devil_spawn -= dt;
        if self.devil_spawn <= 0.0 && self.devils.len() < DEVIL_MAX && calm > 0.6 {
            self.devil_spawn = 25.0 + self.rng.f() * 30.0;
            let wl = crate::js::hypot(wx, wz).max(1e-9);
            let side = (self.rng.f() - 0.5) * 16.0;
            let x = p[0] - (wx / wl) * 26.0 + (-wz / wl) * side;
            let z = p[2] - (wz / wl) * 26.0 + (wx / wl) * side;
            let sp = 2.2 + self.rng.f() * 1.2;
            let y = world.top_y(x.floor() as i32, z.floor() as i32) as f64 + 1.0;
            self.devils.push(Devil { x, z, y, vx: wx / wl * sp, vz: wz / wl * sp, life: 0.0, max: 26.0 + self.rng.f() * 10.0, touched: false });
        }
        let mut hit = None;
        let t = self.t;
        let mut i = self.devils.len();
        while i > 0 {
            i -= 1;
            let d = &mut self.devils[i];
            d.life += dt;
            d.x += (d.vx + (t * 0.7 + i as f64).sin() * 0.8) * dt;
            d.z += (d.vz + (t * 0.6 + i as f64 * 2.0).cos() * 0.8) * dt;
            let g = world.top_y(d.x.floor() as i32, d.z.floor() as i32) as f64 + 1.0;
            d.y += (g - d.y) * (dt * 3.0).min(1.0);
            if d.life > d.max {
                self.devils.remove(i);
                continue;
            }
            if !d.touched && crate::js::hypot(p[0] - d.x, p[2] - d.z) < 1.9 && (p[1] - d.y).abs() < 4.0 {
                d.touched = true;
                hit = Some(DevilHit { vx: d.vx, vz: d.vz });
            }
        }
        hit
    }

    /// brasas e fumaça sobre a lava por perto (uma varredura por segundo)
    fn lava(&mut self, dt: f64, world: &mut World, p: [f64; 3], puffs: &mut Puffs, parts: &mut Particles) {
        self.scan_in -= dt;
        if self.scan_in <= 0.0 {
            self.scan_in = 1.0;
            self.lava_cells.clear();
            let (fx, fz) = (p[0].floor() as i32, p[2].floor() as i32);
            const R: i32 = 18;
            for x in fx - R..=fx + R {
                for z in fz - R..=fz + R {
                    let y = world.top_y(x, z);
                    if world.peek_block(x, y, z) == LAVA {
                        self.lava_cells.push((x, y, z));
                    }
                }
            }
        }
        if self.lava_cells.is_empty() {
            return;
        }
        self.ember_acc += dt * (self.lava_cells.len() as f64 * 0.8).min(40.0);
        while self.ember_acc >= 1.0 {
            self.ember_acc -= 1.0;
            let (x, y, z) = self.lava_cells[(self.rng.f() * self.lava_cells.len() as f64) as usize];
            let (ex, ez) = (x as f64 + self.rng.f(), z as f64 + self.rng.f());
            let r = &mut self.rng;
            if r.f() < 0.75 {
                let vel = [(r.f() - 0.5) * 0.5, 1.2 + r.f() * 1.8, (r.f() - 0.5) * 0.5];
                let (size, life) = (0.06 + r.f() * 0.05, 0.8 + r.f() * 0.8);
                parts.spawn([ex, y as f64 + 1.05, ez], vel, size, EMBER, life, -0.4);
            } else {
                let v = 0.8 + r.f() * 0.6;
                puffs.spawn(false, smoke([ex, y as f64 + 1.1, ez], v, 0.3, 2.2));
            }
        }
    }

    fn volcano(&mut self, dt: f64, world: &mut World, p: [f64; 3], puffs: &mut Puffs, parts: &mut Particles) -> f64 {
        let dist = crate::js::hypot(p[0] - VOLCANO.0, p[2] - VOLCANO.1);
        let mut shake = 0.0;
        self.eruption_in -= dt;
        if self.eruption_in <= 0.0 {
            self.eruption_in = 40.0 + self.rng.f() * 35.0;
            if dist < ERUPTION_RANGE {
                self.fountain = 5.0;
                shake = 0.2 + (1.0 - dist / ERUPTION_RANGE) * 0.6;
            }
        }
        if self.fountain <= 0.0 {
            return shake;
        }
        self.fountain -= dt;
        if dist > ERUPTION_RANGE + 40.0 {
            return shake;
        }
        let top = world.top_y(VOLCANO.0 as i32, VOLCANO.1 as i32) as f64 + 1.0;
        let n = (dt * 70.0).ceil() as i32;
        for _ in 0..n {
            let r = &mut self.rng;
            let a = r.f() * std::f64::consts::TAU;
            let s = r.f() * 3.2;
            let vel = [a.cos() * s, 9.0 + r.f() * 8.0, a.sin() * s];
            let size = 0.2 + r.f() * 0.2;
            parts.spawn([VOLCANO.0 + a.cos() * 1.5, top, VOLCANO.1 + a.sin() * 1.5], vel, size, EMBER, 2.2, 9.0);
        }
        if self.rng.f() < dt * 12.0 {
            puffs.spawn(false, smoke([VOLCANO.0, top + 2.0, VOLCANO.1], 2.5, 1.4, 5.0));
        }
        shake
    }

    /// poeira da tempestade e dos redemoinhos, para desenhar
    pub fn draw(&self, out: &mut Vec<Sprite>) {
        let l = self.weather.level;
        if l > 0.02 {
            let op = (l * 1.2).min(1.0) * 0.8;
            let c = crate::blocks::hex_to_linear("#c88a5f", 1.0);
            let o = self.storm_origin;
            for (p, a) in self.storm.iter().zip(&self.storm_alpha) {
                out.push(Sprite {
                    kind: SpriteKind::Grit,
                    pos: [(o[0] + p[0]) as f32, (o[1] + p[1]) as f32, (o[2] + p[2]) as f32],
                    // uSize 0,16 do marsFx.ts em pontos da tela vira ~0,09 bloco com a lente de 30°
                    size: 0.09,
                    color: [c[0] as f32, c[1] as f32, c[2] as f32, (a * op) as f32],
                    rot: 0.0,
                    seed: 0.0,
                });
            }
        }
        let c = crate::blocks::hex_to_linear("#e8c09a", 1.0);
        for (k, d) in self.devils.iter().enumerate() {
            let fade = (d.life / 3.0).min((d.max - d.life) / 3.0).min(1.0);
            for j in 0..DEVIL_PER {
                let (sa, h) = self.devil_seed[k * DEVIL_PER + j];
                let r = 0.35 + h * 1.9;
                let a = sa + self.t * (5.0 - h * 2.5);
                let alpha = fade * (1.0 - h * 0.75) * (0.5 + 0.5 * (a * 3.0 + j as f64).sin()) * 0.95;
                if alpha < 0.01 {
                    continue;
                }
                out.push(Sprite {
                    kind: SpriteKind::Grit,
                    pos: [(d.x + a.cos() * r) as f32, (d.y + h * DEVIL_H) as f32, (d.z + a.sin() * r) as f32],
                    size: 0.3,
                    color: [c[0] as f32, c[1] as f32, c[2] as f32, alpha as f32],
                    rot: 0.0,
                    seed: 0.0,
                });
            }
        }
    }
}

impl Default for MarsLife {
    fn default() -> Self {
        Self::new()
    }
}

/// fumaça subindo (as "partículas que crescem" do particles.ts viram baforadas)
fn smoke(pos: [f64; 3], vy: f64, size: f64, life: f64) -> PuffSpec {
    PuffSpec { pos, vel: [0.0, vy, 0.0], size, grow_to: 2.6, life, from: SMOKE, alpha: 0.85, gravity: -0.2, ..Default::default() }
}

/// cores do céu e da luz na tempestade (MarsDirector): o céu escurece para o marrom e a luz cai
pub struct StormLook {
    pub top: &'static str,
    pub bottom: &'static str,
    pub mist: &'static str,
    /// quanto a luz do hemisfério e do sol caem com a poeira toda no ar
    pub hemi_drop: f64,
    pub sun_drop: f64,
}

pub const STORM_LOOK: StormLook = StormLook { top: "#5e3a2a", bottom: "#9a6040", mist: "#a8714e", hemi_drop: 0.25, sun_drop: 0.55 };

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_tempestade_chega_e_passa() {
        let mut w = Weather::new(20261112);
        let mut seen = Vec::new();
        for _ in 0..(60 * 600) {
            if let Some(p) = w.update(1.0 / 60.0) {
                seen.push(p);
            }
        }
        assert!(seen.starts_with(&[WeatherPhase::Coming, WeatherPhase::Storm, WeatherPhase::Clearing, WeatherPhase::Calm]));
    }
    #[test]
    fn nivel_sobe_na_tempestade() {
        let mut w = Weather::new(1);
        let mut max: f64 = 0.0;
        for _ in 0..(60 * 300) {
            w.update(1.0 / 60.0);
            max = max.max(w.level);
        }
        assert!(max > 0.95);
    }
}
