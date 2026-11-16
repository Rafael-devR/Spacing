//! Cavernas da Lua (porte de `src/world/caves.ts`): tubos de lava, túneis, salões e entradas (rampas e claraboias).
use std::collections::HashMap;

use crate::js::{self, smoothstep};
use crate::noise::{hash2, Mulberry32, Noise2, Noise3};

pub const SOLID: u8 = 0;
pub const OPEN: u8 = 1;
/// rocha na parede de um tubo de lava: vira basalto vítreo
pub const LINING: u8 = 2;

pub const CLEAR: f64 = 22.0;
pub const CLEAR_TO: f64 = 34.0;
pub const FLOOR: f64 = 3.0;
const TUBE_FREQ: f64 = 0.0055;
const TUBE_HALF: f64 = 4.4;
const TUBE_UP: f64 = 3.7;
const TUBE_DOWN: f64 = 1.6;
const TUBE_YFREQ: f64 = 0.004;
const TUBE_YAMP: f64 = 6.0;
const TUN_FREQ: f64 = 0.021;
const TUN_SQUASH: f64 = 1.9;
const TUN_RADIUS: f64 = 0.105;
const TUN_ROOF: f64 = 6.0;
const HALL_FREQ: f64 = 0.013;
const HALL_SQUASH: f64 = 2.6;
const HALL_LEVEL: f64 = 0.6;
const HALL_ROOF: f64 = 9.0;
const PIT_CELL: f64 = 104.0;
const PIT_CHANCE: f64 = 0.75;
const PIT_RAMP: f64 = 2.7;
const PIT_SLOPE: f64 = 0.5;
const PIT_MAX_RAMP: i32 = 80;
const PIT_FLAT: f64 = 3.0;
const HOME: f64 = 46.0;

pub fn ramp_y(floor: f64, s: f64) -> f64 {
    floor + (s - PIT_FLAT).max(0.0) * PIT_SLOPE
}

const GX: usize = 4;
const GY: usize = 2;
const NX: usize = 16 / GX + 1;

#[derive(Clone, Copy, Debug)]
pub struct Pit {
    pub x: f64,
    pub z: f64,
    pub floor: f64,
    pub dx: f64,
    pub dz: f64,
    pub len: f64,
    pub sky: f64,
    pub top: f64,
}

pub type Surface<'a> = &'a dyn Fn(f64, f64) -> f64;

pub struct Caves {
    seed: u32,
    world_height: f64,
    n_tube: Noise2,
    n_tube_y: Noise2,
    n_mask: Noise2,
    n_ent: Noise2,
    n_a: Noise3,
    n_b: Noise3,
    n_hall: Noise3,
    pits: HashMap<(i32, i32), Option<Pit>>,
    home_pit: Option<Option<Pit>>,
    pub home_x: f64,
    pub home_z: f64,
    home_bias: f64,
    // grade do chunk atual (f32, como o Float32Array do TS)
    ox: f64,
    oz: f64,
    gy: usize,
    g_a: Vec<f32>,
    g_b: Vec<f32>,
    g_h: Vec<f32>,
    chunk_pits: Vec<Pit>,
    // coluna atual
    clear: f64,
    h: f64,
    lx: f64,
    lz: f64,
    tube_w: f64,
    tube_half: f64,
    tube_y: f64,
    tunnel_top: f64,
    spans: Vec<(f64, f64)>,
    // interpolação
    si: usize,
    sx: f64,
    sz: f64,
    sy: f64,
}

impl Caves {
    pub fn new(seed: u32, rand: &mut Mulberry32, world_height: f64) -> Self {
        let n_tube = Noise2::new(rand);
        let n_tube_y = Noise2::new(rand);
        let n_mask = Noise2::new(rand);
        let n_ent = Noise2::new(rand);
        let n_a = Noise3::new(rand);
        let n_b = Noise3::new(rand);
        let n_hall = Noise3::new(rand);
        let a = hash2(11, 23, seed as i64) * std::f64::consts::PI * 2.0;
        let home_x = js::round(a.cos() * HOME);
        let home_z = js::round(a.sin() * HOME);
        let home_bias = n_tube.get(home_x * TUBE_FREQ, home_z * TUBE_FREQ);
        Self {
            seed,
            world_height,
            n_tube,
            n_tube_y,
            n_mask,
            n_ent,
            n_a,
            n_b,
            n_hall,
            pits: HashMap::new(),
            home_pit: None,
            home_x,
            home_z,
            home_bias,
            ox: 0.0,
            oz: 0.0,
            gy: 0,
            g_a: Vec::new(),
            g_b: Vec::new(),
            g_h: Vec::new(),
            chunk_pits: Vec::new(),
            clear: 0.0,
            h: 0.0,
            lx: 0.0,
            lz: 0.0,
            tube_w: -1.0,
            tube_half: 0.0,
            tube_y: 0.0,
            tunnel_top: 0.0,
            spans: Vec::new(),
            si: 0,
            sx: 0.0,
            sz: 0.0,
            sy: 0.0,
        }
    }

    fn tube_field(&self, x: f64, z: f64) -> f64 {
        let dx = x - self.home_x;
        let dz = z - self.home_z;
        self.n_tube.get(x * TUBE_FREQ, z * TUBE_FREQ) - self.home_bias * (-(dx * dx + dz * dz) / 4900.0).exp()
    }

    fn tube_mask(&self, x: f64, z: f64) -> f64 {
        let near = 1.0 - smoothstep(90.0, 130.0, js::hypot(x, z));
        near.max(smoothstep(-0.35, -0.15, self.n_mask.get(x * 0.0021, z * 0.0021)))
    }

    pub fn tube_level(&self, x: f64, z: f64, base: f64) -> f64 {
        base + self.n_tube_y.get(x * TUBE_YFREQ, z * TUBE_YFREQ) * TUBE_YAMP
    }

    fn tube_base(&self) -> f64 {
        js::round(self.world_height * 0.29)
    }

    fn clear_at(&self, x: f64, z: f64) -> f64 {
        smoothstep(CLEAR, CLEAR_TO, js::hypot(x, z))
    }

    fn snap(&self, mut x: f64, mut z: f64) -> Option<(f64, f64, f64, f64)> {
        for _ in 0..8 {
            let n = self.tube_field(x, z);
            let gx = self.tube_field(x + 1.0, z) - n;
            let gz = self.tube_field(x, z + 1.0) - n;
            let g2 = gx * gx + gz * gz;
            if g2 < 1e-9 {
                return None;
            }
            if n.abs() < 0.0015 {
                let g = g2.sqrt();
                return Some((x, z, gx / g, gz / g));
            }
            let g = g2.sqrt();
            let step = (n / g).clamp(-24.0, 24.0);
            x -= (gx / g) * step;
            z -= (gz / g) * step;
        }
        None
    }

    fn build_pit(&self, px: f64, pz: f64, salt: i64, home: bool, surface: Surface) -> Option<Pit> {
        let (sx, sz, sgx, sgz) = self.snap(px, pz)?;
        let x = js::round(sx);
        let z = js::round(sz);
        if js::hypot(x, z) < CLEAR_TO + 6.0 {
            return None;
        }
        if self.tube_mask(x, z) < 0.99 {
            return None;
        }
        let floor = (self.tube_level(x, z, self.tube_base()) - TUBE_DOWN - 0.5).ceil() - 1.0;
        if surface(x, z) - floor < 7.0 {
            return None;
        }
        let seed = self.seed as i64;
        let (xi, zi) = (x as i32, z as i32);
        let first: f64 = if home {
            if sgx * -x + sgz * -z > 0.0 {
                1.0
            } else {
                -1.0
            }
        } else if hash2(xi, zi, seed + salt) < 0.5 {
            1.0
        } else {
            -1.0
        };
        for sign in [first, -first] {
            let (dx, dz) = (sgx * sign, sgz * sign);
            for t in 4..=PIT_MAX_RAMP {
                let tf = t as f64;
                let (ex, ez) = (x + dx * tf, z + dz * tf);
                let y = ramp_y(floor, tf);
                if y < surface(js::round(ex), js::round(ez)) + 1.0 {
                    continue;
                }
                if js::hypot(ex, ez) < CLEAR + 4.0 {
                    break;
                }
                let sky = if !home && hash2(xi, zi, seed + salt + 1) < 0.6 {
                    2.3 + hash2(xi, zi, seed + salt + 2) * 1.6
                } else if home {
                    2.6
                } else {
                    0.0
                };
                return Some(Pit { x, z, floor, dx, dz, len: tf + 2.0, sky, top: surface(x, z) });
            }
        }
        None
    }

    fn pit(&mut self, gx: i32, gz: i32, surface: Surface) -> Option<Pit> {
        if let Some(p) = self.pits.get(&(gx, gz)) {
            return *p;
        }
        let s = self.seed as i64 + 900;
        let mut p = None;
        if hash2(gx, gz, s) < PIT_CHANCE {
            p = self.build_pit(
                (gx as f64 + 0.2 + 0.6 * hash2(gx, gz, s + 1)) * PIT_CELL,
                (gz as f64 + 0.2 + 0.6 * hash2(gx, gz, s + 2)) * PIT_CELL,
                910,
                false,
                surface,
            );
        }
        self.pits.insert((gx, gz), p);
        p
    }

    pub fn home_pit(&mut self, surface: Surface) -> Option<Pit> {
        if self.home_pit.is_none() {
            self.home_pit = Some(self.build_pit(self.home_x, self.home_z, 920, true, surface));
        }
        self.home_pit.unwrap()
    }

    pub fn pits_near(&mut self, x0: f64, z0: f64, x1: f64, z1: f64, surface: Surface) -> Vec<Pit> {
        let reach = PIT_MAX_RAMP as f64 + 12.0;
        let touches = |p: &Pit| {
            let ex = p.x + p.dx * p.len;
            let ez = p.z + p.dz * p.len;
            let m = 12.0;
            p.x.max(ex) + m >= x0 && p.x.min(ex) - m <= x1 && p.z.max(ez) + m >= z0 && p.z.min(ez) - m <= z1
        };
        let mut out = Vec::new();
        let gz0 = ((z0 - reach) / PIT_CELL).floor() as i32;
        let gz1 = ((z1 + reach) / PIT_CELL).floor() as i32;
        let gx0 = ((x0 - reach) / PIT_CELL).floor() as i32;
        let gx1 = ((x1 + reach) / PIT_CELL).floor() as i32;
        for gz in gz0..=gz1 {
            for gx in gx0..=gx1 {
                if let Some(p) = self.pit(gx, gz, surface) {
                    if touches(&p) {
                        out.push(p);
                    }
                }
            }
        }
        if let Some(h) = self.home_pit(surface) {
            if touches(&h) {
                out.push(h);
            }
        }
        out
    }

    pub fn begin_chunk(&mut self, ox: f64, oz: f64, size: usize, top: f64, surface: Surface) {
        self.ox = ox;
        self.oz = oz;
        let nx = size / GX + 1;
        let ny = (top / GY as f64).ceil() as usize + 2;
        self.gy = ny;
        let n = nx * nx * ny;
        if self.g_a.len() < n {
            self.g_a = vec![0.0; n];
            self.g_b = vec![0.0; n];
            self.g_h = vec![0.0; n];
        }
        let mut i = 0;
        for iy in 0..ny {
            let y = (iy * GY) as f64;
            for iz in 0..nx {
                let z = oz + (iz * GX) as f64;
                for ix in 0..nx {
                    let x = ox + (ix * GX) as f64;
                    self.g_a[i] = self.n_a.get(x * TUN_FREQ, y * TUN_FREQ * TUN_SQUASH, z * TUN_FREQ) as f32;
                    self.g_b[i] = self.n_b.get(x * TUN_FREQ + 40.0, y * TUN_FREQ * TUN_SQUASH, z * TUN_FREQ - 17.0) as f32;
                    self.g_h[i] = self.n_hall.get(x * HALL_FREQ, y * HALL_FREQ * HALL_SQUASH, z * HALL_FREQ) as f32;
                    i += 1;
                }
            }
        }
        let s = size as f64;
        self.chunk_pits = self.pits_near(ox, oz, ox + s - 1.0, oz + s - 1.0, surface);
    }

    pub fn begin_column(&mut self, wx: f64, wz: f64, h: f64) -> bool {
        self.h = h;
        self.lx = wx - self.ox;
        self.lz = wz - self.oz;
        self.clear = self.clear_at(wx, wz);
        self.tube_w = -1.0;
        self.spans.clear();
        if self.clear <= 0.0 {
            return false;
        }
        let ent = self.n_ent.get(wx * 0.011, wz * 0.011);
        self.tunnel_top = h - TUN_ROOF * (1.0 - smoothstep(0.28, 0.5, ent));

        let n = self.tube_field(wx, wz);
        if n.abs() < 0.16 {
            let gx = self.tube_field(wx + 1.0, wz) - n;
            let gz = self.tube_field(wx, wz + 1.0) - n;
            let hg = js::hypot(gx, gz);
            let w = n.abs() / if hg != 0.0 { hg } else { 1e-6 };
            let half = TUBE_HALF * (0.82 + 0.3 * self.n_ent.get(wx * 0.03 + 9.0, wz * 0.03)) * self.tube_mask(wx, wz) * self.clear;
            if half > 1.2 && w < half + 1.6 {
                self.tube_w = w;
                self.tube_half = half;
                self.tube_y = self.tube_level(wx, wz, self.tube_base());
            }
        }

        for i in 0..self.chunk_pits.len() {
            let p = self.chunk_pits[i];
            let rx = wx + 0.5 - (p.x + 0.5);
            let rz = wz + 0.5 - (p.z + 0.5);
            let s = rx * p.dx + rz * p.dz;
            let w = (rx * p.dz - rz * p.dx).abs();
            if s > -2.5 && s < p.len && w < PIT_RAMP {
                let fy = ramp_y(p.floor, s);
                self.spans.push((fy.floor() + 1.0, fy + 4.2 - w * w * 0.28));
            }
            if p.sky > 0.0 {
                let d = js::hypot(rx, rz);
                if d < p.sky + 5.0 {
                    let lo = if d < p.sky { p.floor + 1.0 } else { p.top - 4.0 + (d - p.sky) / 1.2 };
                    self.spans.push((lo, self.world_height));
                }
            }
        }
        true
    }

    fn locate(&mut self, y: f64) {
        let fx = self.lx / GX as f64;
        let fz = self.lz / GX as f64;
        let fy = y / GY as f64;
        let ix = ((NX - 2) as f64).min(fx.floor());
        let iz = ((NX - 2) as f64).min(fz.floor());
        let iy = ((self.gy - 2) as f64).min(fy.floor());
        self.sx = fx - ix;
        self.sz = fz - iz;
        self.sy = fy - iy;
        self.si = ix as usize + iz as usize * NX + iy as usize * NX * NX;
    }

    fn sample(&self, g: &[f32]) -> f64 {
        let i = self.si;
        let (dz, dy, tx) = (NX, NX * NX, self.sx);
        let v = |k: usize| g[k] as f64;
        let a = v(i) + (v(i + 1) - v(i)) * tx;
        let b = v(i + dz) + (v(i + dz + 1) - v(i + dz)) * tx;
        let c = v(i + dy) + (v(i + dy + 1) - v(i + dy)) * tx;
        let d = v(i + dy + dz) + (v(i + dy + dz + 1) - v(i + dy + dz)) * tx;
        let lo = a + (b - a) * self.sz;
        let hi = c + (d - c) * self.sz;
        lo + (hi - lo) * self.sy
    }

    /// O bloco (coluna atual, altura y) é rocha, vazio ou parede de tubo?
    pub fn at(&mut self, y: f64) -> u8 {
        if y < FLOOR {
            return SOLID;
        }
        for &(lo, hi) in &self.spans {
            if y >= lo && y <= hi {
                return OPEN;
            }
        }
        let mut lining = false;
        if self.tube_w >= 0.0 {
            let dy = y + 0.5 - self.tube_y;
            if dy >= -TUBE_DOWN {
                let u = self.tube_w / self.tube_half;
                let v = dy / TUBE_UP;
                if u * u + v * v < 1.0 {
                    return OPEN;
                }
            }
            let u = self.tube_w / (self.tube_half + 1.6);
            let v = dy / if dy > 0.0 { TUBE_UP + 1.6 } else { TUBE_DOWN + 1.6 };
            lining = u * u + v * v < 1.0;
        }
        let depth = self.h - y;
        self.locate(y);
        if y <= self.tunnel_top {
            let a = self.sample(&self.g_a);
            let b = self.sample(&self.g_b);
            let r = TUN_RADIUS * (0.8 + 0.35 * smoothstep(4.0, 26.0, depth)) * self.clear;
            if a * a + b * b < r * r {
                return OPEN;
            }
        }
        if depth >= HALL_ROOF {
            let fade = smoothstep(FLOOR, FLOOR + 5.0, y) * smoothstep(HALL_ROOF, HALL_ROOF + 5.0, depth) * self.clear;
            if self.sample(&self.g_h) * fade > HALL_LEVEL {
                return OPEN;
            }
        }
        if lining {
            LINING
        } else {
            SOLID
        }
    }
}
