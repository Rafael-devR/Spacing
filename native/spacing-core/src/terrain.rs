//! Gerador da Lua (porte de `src/world/terrain.ts`): relevo com montanhas, mares, crateras, camadas, minérios, cavernas e
//! objetos soltos. Mesma semente, mesmo mundo que o jogo em TypeScript (testes em `tests/golden.rs`).
use crate::base_pad::{apply_base_pad, in_pad, is_landing};
use crate::blocks::*;
use crate::caves::{Caves, LINING, OPEN};
use crate::js::{self, smoothstep};
use crate::noise::{fbm2, hash2, Mulberry32, Noise2, Noise3};

/// largura do chunk (x, z)
pub const CS: usize = 16;
/// altura do mundo
pub const CH: usize = 96;
pub const CHUNK_LEN: usize = CS * CS * CH;
/// versão do gerador de cada planeta (igual ao `WORLD_GEN` do TS)
pub const WORLD_GEN_LUA: u32 = 3;
pub const WORLD_GEN_MARTE: u32 = 2;
/// Lua: nível médio do terreno
pub const SEA: f64 = 44.0;
pub const ICE_LEVEL: f64 = SEA - 7.0;
/// módulo de pouso: centro e raio
pub const LANDER: (f64, f64, f64) = (-3.0, -2.0, 1.7);
/// onde o astronauta começa e renasce
pub const SPAWN: (f64, f64) = (1.0, 0.8);

#[inline]
pub fn idx(x: usize, y: usize, z: usize) -> usize {
    x + z * CS + y * CS * CS
}

/// tipo de objeto solto (os mesmos nomes do TS)
pub type PropType = &'static str;

/// todos os tipos de objeto solto (src/data/props.ts, PROP_TYPES)
pub const PROP_TYPES: [&str; 8] = ["boulder", "ilmenite", "gold", "crystal", "meteorite", "marsBoulder", "blueberries", "solarPanel"];

/// o nome guardado no salvamento, como `PropType`
pub fn prop_type(name: &str) -> Option<PropType> {
    PROP_TYPES.iter().copied().find(|t| *t == name)
}

#[derive(Clone, Debug, PartialEq)]
pub struct PropSpawn {
    pub wx: i32,
    pub wz: i32,
    pub y: i32,
    pub kind: PropType,
    pub variant: u32,
    pub rot: f64,
    pub scale: f64,
    /// chave no salvamento; objetos naturais usam "wx,wz"
    pub key: Option<String>,
}

pub struct GeneratedChunk {
    pub data: Vec<u8>,
    pub props: Vec<PropSpawn>,
    pub max_y: usize,
}

/// O que o mundo precisa de um gerador (a Lua e Marte têm o seu). Cada thread tem o seu gerador (como os workers do TS).
pub trait TerrainGen: Send {
    fn seed(&self) -> u32;
    /// altura (não arredondada) do planalto do pouso
    fn spawn_h(&self) -> f64;
    /// (altura inteira do topo, "mar")
    fn column(&self, x: f64, z: f64) -> (f64, f64);
    fn generate(&mut self, cx: i32, cz: i32) -> GeneratedChunk;
}

fn crater(d: f64, r: f64, depth: f64, rim: f64) -> f64 {
    if d > 1.8 {
        return 0.0;
    }
    (if d < 1.0 { -r * depth * (1.0 - d * d) } else { 0.0 }) + (-((d - 1.0) / 0.24).powi(2)).exp() * r * rim
}

/// Relevo de crateras numa grade: cada célula pode ter uma cratera.
#[allow(clippy::too_many_arguments)]
pub fn crater_field(seed: u32, x: f64, z: f64, cell: f64, min_r: f64, max_r: f64, prob: f64, salt: i64, depth: f64, rim: f64) -> f64 {
    let s = seed as i64 + salt;
    let cx = (x / cell).floor() as i32;
    let cz = (z / cell).floor() as i32;
    let mut h = 0.0;
    for dx in -1..=1 {
        for dz in -1..=1 {
            let (gx, gz) = (cx + dx, cz + dz);
            if hash2(gx, gz, s) > prob {
                continue;
            }
            let px = (gx as f64 + 0.15 + 0.7 * hash2(gx, gz, s + 1)) * cell;
            let pz = (gz as f64 + 0.15 + 0.7 * hash2(gx, gz, s + 2)) * cell;
            let r = min_r + (max_r - min_r) * hash2(gx, gz, s + 3).powi(2);
            h += crater(js::hypot(x - px, z - pz) / r, r, depth, rim);
        }
    }
    h
}

/// a cratera com gelo garantida perto do pouso
pub const HOME_CRATER: (f64, f64, f64) = (66.0, 22.0, 0.52); // distância, raio, profundidade

#[derive(Clone, Copy, Debug)]
pub struct Column {
    pub h: f64,
    pub mare: f64,
    pub high: f64,
}

/// A parte do gerador da Lua que não muda (ruídos); as cavernas consultam a altura por aqui.
pub struct Relief {
    pub seed: u32,
    pub spawn_h: f64,
    pub home_crater: (f64, f64),
    n_base: Noise2,
    n_detail: Noise2,
    n_mare: Noise2,
    n_high: Noise2,
    n_ridge: Noise2,
    n_ore: Noise3,
}

impl Relief {
    pub fn raw_height(&self, x: f64, z: f64) -> Column {
        let mut h = SEA + fbm2(&self.n_base, x * 0.006, z * 0.006, 4) * 8.0 + self.n_detail.get(x * 0.035, z * 0.035) * 1.4;
        let mare = smoothstep(0.12, 0.42, fbm2(&self.n_mare, x * 0.0045 + 50.0, z * 0.0045, 3));
        h -= mare * 4.0;
        let high = smoothstep(0.08, 0.5, fbm2(&self.n_high, x * 0.0028 - 20.0, z * 0.0028, 3)) * (1.0 - mare);
        if high > 0.0 {
            let ridge = 1.0 - self.n_ridge.get(x * 0.011, z * 0.011).abs();
            h += high * (7.0 + ridge * ridge * 21.0 + self.n_detail.get(x * 0.02 + 5.0, z * 0.02) * 3.0);
        }
        h += crater_field(self.seed, x, z, 210.0, 34.0, 62.0, 0.42, 303, 0.2, 0.1);
        h += crater_field(self.seed, x, z, 64.0, 8.0, 28.0, 0.55, 101, 0.4, 0.17);
        h += crater_field(self.seed, x, z, 22.0, 2.2, 7.0, 0.5, 202, 0.4, 0.17);
        Column { h, mare, high }
    }

    pub fn column(&self, x: f64, z: f64) -> Column {
        let raw = self.raw_height(x, z);
        let mut h = raw.h;
        let d = js::hypot(x, z);
        if d < 48.0 {
            let plain = self.spawn_h + self.n_detail.get(x * 0.035, z * 0.035) * 1.2;
            h = plain + (h - plain) * smoothstep(14.0, 48.0, d);
            if d < 9.0 {
                h = self.spawn_h + (h - self.spawn_h) * smoothstep(5.0, 9.0, d);
            }
        }
        let k = 1.0 - smoothstep(14.0, 48.0, d);
        let (ccx, ccz) = self.home_crater;
        let dc = js::hypot(x - ccx, z - ccz) / HOME_CRATER.1;
        if dc < 1.9 {
            let kc = 1.0 - smoothstep(1.1, 1.9, dc);
            h += (self.spawn_h - h) * kc;
            h += crater(dc, HOME_CRATER.1, HOME_CRATER.2, 0.12);
        }
        h = apply_base_pad(h, x, z, self.spawn_h.floor());
        Column { h: h.floor().clamp(4.0, CH as f64 - 6.0), mare: raw.mare * (1.0 - k), high: raw.high * (1.0 - k) }
    }

    fn strata(&self, y: f64, h: f64, mare: bool, high: f64, wob: f64) -> BlockId {
        let depth = h - y;
        if h <= ICE_LEVEL && depth <= 1.0 {
            return ICE;
        }
        let peak = high > 0.5 && h >= SEA + 13.0;
        if depth <= 2.0 {
            if mare {
                return BASALT;
            }
            if peak && (depth > 0.0 || h >= SEA + 18.0) {
                return ANORTHOSITE;
            }
            return REGOLITH;
        }
        if y < 21.0 + wob * 3.0 {
            return NORITE;
        }
        if mare && depth <= 9.0 {
            return BASALT;
        }
        if depth <= 6.0 + wob * 2.0 {
            return BRECCIA;
        }
        if high > 0.35 && y > SEA - 6.0 + wob * 3.0 {
            return ANORTHOSITE;
        }
        ROCK
    }

    fn ore(&self, id: BlockId, wx: f64, y: f64, wz: f64, depth: f64) -> BlockId {
        if id == ICE {
            return id;
        }
        let n = self.n_ore.get(wx * 0.12, y * 0.15, wz * 0.12);
        let dark = id == BASALT || id == GLASSY_BASALT || id == NORITE;
        if n > 0.0 {
            if dark {
                return if n > 0.68 { ILMENITE_ORE } else { id };
            }
            return if n > (if depth == 0.0 { 0.7 } else { 0.6 }) { IRON } else { id };
        }
        if id == GLASSY_BASALT || depth == 0.0 {
            return id;
        }
        if id == NORITE && n < -0.86 {
            return GOLD_ORE;
        }
        if n < (if y < SEA - 14.0 { -0.74 } else { -0.79 }) {
            CRYSTAL
        } else {
            id
        }
    }
}

/// O gerador da Lua.
pub struct Terrain {
    pub relief: Relief,
    pub caves: Caves,
}

impl Terrain {
    pub fn new(seed: u32) -> Self {
        let mut r = Mulberry32::new(seed);
        let n_base = Noise2::new(&mut r);
        let n_detail = Noise2::new(&mut r);
        let n_mare = Noise2::new(&mut r);
        let n_high = Noise2::new(&mut r);
        let n_ridge = Noise2::new(&mut r);
        let n_ore = Noise3::new(&mut r);
        let caves = Caves::new(seed, &mut r, CH as f64);
        let hl = js::hypot(caves.home_x, caves.home_z);
        let home_crater = (-js::round((caves.home_x / hl) * HOME_CRATER.0), -js::round((caves.home_z / hl) * HOME_CRATER.0));
        // -0 do JS vira 0 aqui; dá no mesmo nas contas
        let relief = Relief { seed, spawn_h: SEA + 1.5, home_crater, n_base, n_detail, n_mare, n_high, n_ridge, n_ore };
        Self { relief, caves }
    }

    pub fn column_full(&self, x: f64, z: f64) -> Column {
        self.relief.column(x, z)
    }
}

impl TerrainGen for Terrain {
    fn seed(&self) -> u32 {
        self.relief.seed
    }
    fn spawn_h(&self) -> f64 {
        self.relief.spawn_h
    }
    fn column(&self, x: f64, z: f64) -> (f64, f64) {
        let c = self.relief.column(x, z);
        (c.h, c.mare)
    }

    fn generate(&mut self, cx: i32, cz: i32) -> GeneratedChunk {
        let mut data = vec![0u8; CHUNK_LEN];
        let mut props = Vec::new();
        let mut max_y = 0.0f64;
        let s = self.relief.seed as i64;
        let (ox, oz) = (cx * CS as i32, cz * CS as i32);
        let mut cols = Vec::with_capacity(CS * CS);
        for lz in 0..CS {
            for lx in 0..CS {
                let c = self.relief.column((ox + lx as i32) as f64, (oz + lz as i32) as f64);
                if c.h > max_y {
                    max_y = c.h;
                }
                cols.push(c);
            }
        }
        let relief = &self.relief;
        let surface = |x: f64, z: f64| relief.column(x, z).h;
        self.caves.begin_chunk(ox as f64, oz as f64, CS, max_y, &surface);
        for lz in 0..CS {
            for lx in 0..CS {
                let (wx, wz) = (ox + lx as i32, oz + lz as i32);
                let (fx, fz) = (wx as f64, wz as f64);
                let Column { h, mare, high } = cols[lx + lz * CS];
                let is_mare = mare > 0.5;
                let carve = self.caves.begin_column(fx, fz, h);
                let wob = relief.n_detail.get(fx * 0.05 + 3.0, fz * 0.05 - 8.0);
                data[idx(lx, 0, lz)] = BEDROCK;
                let hi = h as usize;
                for y in 1..=hi {
                    let cave = if carve { self.caves.at(y as f64) } else { 0 };
                    if cave == OPEN {
                        continue;
                    }
                    let yf = y as f64;
                    let mut id = relief.strata(yf, h, is_mare, high, wob);
                    if cave == LINING && id != ICE {
                        id = GLASSY_BASALT;
                    }
                    if y == hi && is_landing(fx, fz) {
                        id = HULL;
                    }
                    data[idx(lx, y, lz)] = if y > 1 { relief.ore(id, fx, yf, fz, h - yf) } else { id };
                }
                let r = hash2(wx, wz, s + 77);
                if r < 0.013
                    && js::hypot(fx - LANDER.0, fz - LANDER.1) > 4.0
                    && !in_pad(fx, fz)
                    && data[idx(lx, hi, lz)] != AIR
                {
                    let t = hash2(wx, wz, s + 78);
                    let kind = if t < 0.42 {
                        "boulder"
                    } else if t < 0.68 {
                        "ilmenite"
                    } else if t < 0.86 {
                        "crystal"
                    } else {
                        "gold"
                    };
                    props.push(PropSpawn {
                        wx,
                        wz,
                        y: hi as i32 + 1,
                        kind,
                        variant: (hash2(wx, wz, s + 79) * 3.0).floor() as u32,
                        rot: hash2(wx, wz, s + 80) * std::f64::consts::PI * 2.0,
                        scale: 0.8 + hash2(wx, wz, s + 81) * 0.45,
                        key: None,
                    });
                }
            }
        }
        GeneratedChunk { data, props, max_y: max_y as usize }
    }
}
