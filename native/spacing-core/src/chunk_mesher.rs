//! Luz do céu e malha de um chunk, função pura dos blocos dele e dos 8 vizinhos (porte de `src/world/chunkMesher.ts`).
use crate::mesher::{mesh_padded, Vertex, SKY_LEVELS};
use crate::terrain::{idx, CH, CS};

/// nível de quem vê o céu direto; cada bloco por dentro da rocha tira 1
pub const SKY_MAX: u8 = SKY_LEVELS;

const PW: usize = CS + 2;
const PL: usize = PW * PW;
const LM: usize = SKY_MAX as usize;
const LW: usize = CS + 2 * LM;
const LL: usize = LW * LW;

/// o que o mesher precisa de cada chunk
pub struct ChunkSource<'a> {
    pub data: &'a [u8],
    pub max_y: usize,
}

/// Memória de trabalho reaproveitada (uma por thread).
pub struct ChunkMesher {
    pad: Vec<u8>,
    pad_light: Vec<u8>,
    reg: Vec<u8>,
    reg_light: Vec<u8>,
    reg_top: Vec<i16>,
    queue: Vec<u32>,
}

impl Default for ChunkMesher {
    fn default() -> Self {
        Self::new()
    }
}

impl ChunkMesher {
    pub fn new() -> Self {
        Self {
            pad: vec![0; PL * CH],
            pad_light: vec![0; PL * CH],
            reg: vec![0; LL * CH],
            reg_light: vec![0; LL * CH],
            reg_top: vec![0; LL],
            queue: Vec::new(),
        }
    }

    /// Malha do chunk do meio de `nb` (9 chunks em ordem de z e depois x; o do meio é o 4). `light` recebe a luz do céu
    /// de cada bloco do chunk (CS × CS × CH).
    pub fn build(&mut self, nb: &[ChunkSource; 9], ox: i32, oz: i32, light: &mut [u8], out: &mut Vec<Vertex>) {
        let top = nb.iter().map(|n| n.max_y).max().unwrap_or(0);
        let max_y = nb[4].max_y;
        let hh = CH.min(top + 2);
        let h = CH.min(max_y + 2);
        self.sky_light(nb, hh);
        for y in 0..h {
            for z in -1..=CS as i32 {
                let r = (LM as i32 + z) as usize;
                let o = (z + 1) as usize * PW + y * PL + 1;
                for x in -1..=CS as i32 {
                    let i = (LM as i32 + x) as usize + r * LW + y * LL;
                    let po = (o as i32 + x) as usize;
                    self.pad[po] = self.reg[i];
                    self.pad_light[po] = self.reg_light[i];
                }
            }
        }
        for y in 0..hh {
            for z in 0..CS {
                let i = LM + (LM + z) * LW + y * LL;
                let d = idx(0, y, z);
                light[d..d + CS].copy_from_slice(&self.reg_light[i..i + CS]);
            }
        }
        light[hh * CS * CS..].fill(SKY_MAX);
        self.pad[h * PL..].fill(0);
        self.pad_light[h * PL..].fill(SKY_MAX);
        mesh_padded(&self.pad, CS, CS, CH, max_y, ox, oz, true, Some(&self.pad_light), out);
    }

    fn sky_light(&mut self, nb: &[ChunkSource; 9], hh: usize) {
        for z in 0..LW {
            let wz = z as i32 - LM as i32;
            let dz: i32 = if wz < 0 { 0 } else if wz >= CS as i32 { 2 } else { 1 };
            let lz = (wz - (dz - 1) * CS as i32) as usize;
            for x in 0..LW {
                let wx = x as i32 - LM as i32;
                let dx: i32 = if wx < 0 { 0 } else if wx >= CS as i32 { 2 } else { 1 };
                let lx = (wx - (dx - 1) * CS as i32) as usize;
                let n = &nb[(dx + dz * 3) as usize];
                let data = n.data;
                let col = lx + lz * CS;
                let o = x + z * LW;
                let mut t = n.max_y.min(hh - 1) as i32;
                while t > 0 && data[col + t as usize * CS * CS] == 0 {
                    t -= 1;
                }
                self.reg_top[o] = t as i16;
                for y in 0..hh {
                    self.reg[o + y * LL] = data[col + y * CS * CS];
                    self.reg_light[o + y * LL] = if y as i32 > t { SKY_MAX } else { 0 };
                }
            }
        }
        self.queue.clear();
        for z in 0..LW {
            for x in 0..LW {
                let o = x + z * LW;
                let t = self.reg_top[o];
                let mut m = t;
                if x > 0 {
                    m = m.max(self.reg_top[o - 1]);
                }
                if x < LW - 1 {
                    m = m.max(self.reg_top[o + 1]);
                }
                if z > 0 {
                    m = m.max(self.reg_top[o - LW]);
                }
                if z < LW - 1 {
                    m = m.max(self.reg_top[o + LW]);
                }
                for y in (t + 1)..=m {
                    self.queue.push((o + y as usize * LL) as u32);
                }
            }
        }
        let mut q = 0;
        while q < self.queue.len() {
            let i = self.queue[q] as usize;
            q += 1;
            let v = self.reg_light[i] as i32 - 1;
            if v <= 0 {
                continue;
            }
            let v = v as u8;
            let y = i / LL;
            let r = i - y * LL;
            let z = r / LW;
            let x = r - z * LW;
            if x > 0 {
                self.spread(i - 1, v);
            }
            if x < LW - 1 {
                self.spread(i + 1, v);
            }
            if z > 0 {
                self.spread(i - LW, v);
            }
            if z < LW - 1 {
                self.spread(i + LW, v);
            }
            if y > 0 {
                self.spread(i - LL, v);
            }
            if y < hh - 1 {
                self.spread(i + LL, v);
            }
        }
    }

    #[inline]
    fn spread(&mut self, i: usize, v: u8) {
        if self.reg[i] != 0 || self.reg_light[i] >= v {
            return;
        }
        self.reg_light[i] = v;
        self.queue.push(i as u32);
    }
}
