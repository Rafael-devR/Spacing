//! Gerador de Marte (porte de `src/world/marsTerrain.ts`): poeira, dunas, cânion em camadas, gelo, vulcão com lava.
use crate::base_pad::{apply_base_pad, in_pad, is_landing};
use crate::blocks::*;
use crate::js::{self, smoothstep};
use crate::noise::{fbm2, hash2, Mulberry32, Noise2, Noise3};
use crate::terrain::{crater_field, idx, GeneratedChunk, PropSpawn, TerrainGen, CH, CHUNK_LEN, CS, LANDER};

/// o vulcão: centro, raio, altura, caldeira, lago
pub const VOLCANO: (f64, f64, f64, f64, f64, f64) = (-85.0, 75.0, 52.0, 22.0, 10.0, 7.0);
const V_X: f64 = VOLCANO.0;
const V_Z: f64 = VOLCANO.1;
const V_R: f64 = VOLCANO.2;
const V_PEAK: f64 = VOLCANO.3;
const V_CALDERA: f64 = VOLCANO.4;
const V_LAKE: f64 = VOLCANO.5;
const C_Z0: f64 = -62.0;
const C_AMP: f64 = 24.0;
const C_FREQ: f64 = 0.011;
const C_WIDTH: f64 = 13.0;
const C_FLOOR: f64 = 6.0;
const LAVA_RIVERS: [f64; 3] = [0.5, 2.35, 4.3];
const PLAIN: f64 = 16.0;

#[derive(Clone, Copy, Debug)]
pub struct MarsColumn {
    pub h: f64,
    pub mare: f64,
    pub volcano: f64,
    pub lava: bool,
    pub canyon: f64,
    pub strata: bool,
}

pub struct MarsTerrain {
    seed: u32,
    spawn_h: f64,
    n_base: Noise2,
    n_detail: Noise2,
    n_dune: Noise2,
    n_ice: Noise2,
    n_hem: Noise3,
    n_oli: Noise3,
    n_gyp: Noise3,
}

impl MarsTerrain {
    pub fn new(seed: u32) -> Self {
        let mut r = Mulberry32::new(seed);
        let mut t = Self {
            seed,
            spawn_h: 0.0,
            n_base: Noise2::new(&mut r),
            n_detail: Noise2::new(&mut r),
            n_dune: Noise2::new(&mut r),
            n_ice: Noise2::new(&mut r),
            n_hem: Noise3::new(&mut r),
            n_oli: Noise3::new(&mut r),
            n_gyp: Noise3::new(&mut r),
        };
        t.spawn_h = t.raw(0.0, 0.0).h;
        t
    }

    pub fn canyon_z(&self, x: f64) -> f64 {
        C_Z0 + (x * C_FREQ).sin() * C_AMP + self.n_detail.get(x * 0.01, 7.3) * 6.0
    }

    fn river_at(&self, x: f64, z: f64, dv: f64) -> bool {
        if dv <= V_CALDERA + 0.5 || dv > V_R * 0.78 {
            return false;
        }
        let a = (z - V_Z).atan2(x - V_X);
        for (i, r) in LAVA_RIVERS.iter().enumerate() {
            let wobble = self.n_detail.get(dv * 0.07, i as f64 * 13.1) * 0.35;
            let mut da = a - (r + wobble);
            da = da.sin().atan2(da.cos());
            let half = 1.25 - (dv / V_R) * 0.6;
            if da.abs() * dv < half {
                return true;
            }
        }
        false
    }

    fn raw(&self, x: f64, z: f64) -> MarsColumn {
        let mut h = PLAIN + fbm2(&self.n_base, x * 0.007, z * 0.007, 4) * 6.0 + self.n_detail.get(x * 0.04, z * 0.04) * 1.2;
        let dune = smoothstep(0.18, 0.48, fbm2(&self.n_dune, x * 0.005 + 30.0, z * 0.005, 3));
        h -= dune * 2.5;
        h += dune * ((x * 0.42 + z * 0.18 + self.n_detail.get(x * 0.02, z * 0.02) * 4.0).sin() * 0.5 + 0.5) * 1.7;
        h += crater_field(self.seed, x, z, 80.0, 9.0, 26.0, 0.45, 101, 0.4, 0.17);
        h += crater_field(self.seed, x, z, 26.0, 2.0, 6.0, 0.35, 202, 0.4, 0.17);

        let cz = self.canyon_z(x);
        let w = C_WIDTH + self.n_detail.get(x * 0.02, 3.1) * 3.0;
        let d = (z - cz).abs();
        let mut canyon = 0.0;
        if d < w {
            canyon = smoothstep(w, w * 0.35, d);
            let target = h * (1.0 - canyon) + C_FLOOR * canyon;
            h = C_FLOOR + js::round((target - C_FLOOR) / 2.0) * 2.0;
        }
        let strata = d < w + 9.0;

        let dv = js::hypot(x - V_X, z - V_Z);
        let mut volcano = 0.0;
        let mut lava = false;
        if dv < V_R {
            let k = 1.0 - dv / V_R;
            volcano = k;
            let under = h * (1.0 - k) + PLAIN * k;
            h = under + k.powf(1.25) * V_PEAK;
            if dv < V_CALDERA {
                let rim = PLAIN + (1.0 - V_CALDERA / V_R).powf(1.25) * V_PEAK;
                h = rim - 6.0 * (1.0 - (dv / V_CALDERA).powi(2));
                if dv < V_LAKE {
                    lava = true;
                }
            } else if self.river_at(x, z, dv) {
                h -= 1.0;
                lava = true;
            }
        }
        MarsColumn { h, mare: dune, volcano, lava, canyon, strata }
    }

    pub fn mars_column(&self, x: f64, z: f64) -> MarsColumn {
        let mut c = self.raw(x, z);
        let mut h = c.h;
        let d = js::hypot(x, z);
        if d < 9.0 {
            h = self.spawn_h + (h - self.spawn_h) * smoothstep(5.0, 9.0, d);
        }
        h = apply_base_pad(h, x, z, self.spawn_h.floor());
        c.h = h.floor().clamp(3.0, CH as f64 - 6.0);
        c
    }
}

impl TerrainGen for MarsTerrain {
    fn seed(&self) -> u32 {
        self.seed
    }
    fn spawn_h(&self) -> f64 {
        self.spawn_h
    }
    fn column(&self, x: f64, z: f64) -> (f64, f64) {
        let c = self.mars_column(x, z);
        (c.h, c.mare)
    }

    fn generate(&mut self, cx: i32, cz: i32) -> GeneratedChunk {
        let mut data = vec![0u8; CHUNK_LEN];
        let mut props = Vec::new();
        let mut max_y = 0usize;
        let s = self.seed as i64;
        for lz in 0..CS {
            for lx in 0..CS {
                let (wx, wz) = (cx * CS as i32 + lx as i32, cz * CS as i32 + lz as i32);
                let (fx, fz) = (wx as f64, wz as f64);
                let c = self.mars_column(fx, fz);
                let h = c.h as usize;
                max_y = max_y.max(h);
                let volc = c.volcano > 0.12;
                let dune = c.mare > 0.55 && !volc;
                let ice_here = !volc && self.n_ice.get(fx * 0.02, fz * 0.02) > 0.35;
                let layered = |y: usize| if (y >> 1) & 1 == 1 { SEDIMENT } else { MARS_ROCK };
                for y in 0..=h {
                    let depth = h - y;
                    let mut id: BlockId = if y == 0 {
                        BEDROCK
                    } else if depth == 0 && is_landing(fx, fz) {
                        HULL
                    } else if depth == 0 {
                        if c.lava {
                            LAVA
                        } else if volc {
                            if c.volcano < 0.35 && hash2(wx, wz, s + 5) < 0.3 {
                                MARS_DUST
                            } else {
                                VOLCANIC
                            }
                        } else if c.canyon > 0.75 || dune {
                            DARK_SAND
                        } else if c.canyon > 0.05 {
                            layered(y)
                        } else {
                            MARS_DUST
                        }
                    } else if depth <= 2 {
                        if volc {
                            VOLCANIC
                        } else if dune {
                            DARK_SAND
                        } else if ice_here && depth == 2 {
                            ICE
                        } else if c.strata {
                            layered(y)
                        } else {
                            MARS_DUST
                        }
                    } else if y < 5 || volc {
                        VOLCANIC
                    } else if c.strata {
                        layered(y)
                    } else {
                        MARS_ROCK
                    };
                    if y > 1 && id != LAVA && id != ICE && id != DARK_SAND {
                        let yf = y as f64;
                        if (id == MARS_ROCK || id == SEDIMENT || id == MARS_DUST)
                            && self.n_hem.get(fx * 0.11, yf * 0.14, fz * 0.11) > if depth == 0 { 0.68 } else { 0.6 }
                        {
                            id = HEMATITE;
                        } else if id == VOLCANIC
                            && depth > 0
                            && self.n_oli.get(fx * 0.15, yf * 0.2, fz * 0.15) > if volc { 0.6 } else { 0.72 }
                        {
                            id = OLIVINE;
                        } else if id == SEDIMENT && self.n_gyp.get(fx * 0.3, yf * 0.06, fz * 0.3) > 0.5 {
                            id = GYPSUM;
                        }
                    }
                    data[idx(lx, y, lz)] = id;
                }
                let r = hash2(wx, wz, s + 77);
                if r < 0.014 && !c.lava && c.volcano < 0.8 && js::hypot(fx - LANDER.0, fz - LANDER.1) > 4.0 && !in_pad(fx, fz) {
                    let t = hash2(wx, wz, s + 78);
                    let kind = if volc || t < 0.62 { "marsBoulder" } else { "blueberries" };
                    props.push(PropSpawn {
                        wx,
                        wz,
                        y: h as i32 + 1,
                        kind,
                        variant: (hash2(wx, wz, s + 79) * 3.0).floor() as u32,
                        rot: hash2(wx, wz, s + 80) * std::f64::consts::PI * 2.0,
                        scale: 0.8 + hash2(wx, wz, s + 81) * 0.45,
                        key: None,
                    });
                }
            }
        }
        GeneratedChunk { data, props, max_y }
    }
}
