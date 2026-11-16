//! Ruído e hashes determinísticos: porte exato de `src/core/noise.ts` (os mundos saem iguais por semente).

/// Gerador `mulberry32` (o mesmo do TS: mesma semente, mesma sequência).
#[derive(Clone)]
pub struct Mulberry32 {
    a: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { a: seed }
    }
    pub fn next_f64(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b79f5);
        let a = self.a;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

#[inline]
fn finish(h: i32) -> f64 {
    let mut h = (h ^ ((h as u32) >> 13) as i32).wrapping_mul(1274126177);
    h ^= ((h as u32) >> 16) as i32;
    (h as u32 as f64) / 4294967296.0
}

/// `hash2(x, z, seed)`: 0..1. A semente pode passar de 32 bits (semente + sal), como no JS (`seed | 0`).
#[inline]
pub fn hash2(x: i32, z: i32, seed: i64) -> f64 {
    let s = seed as i32;
    finish(x.wrapping_mul(374761393).wrapping_add(z.wrapping_mul(668265263)).wrapping_add(s.wrapping_mul(1442695041)))
}

#[inline]
pub fn hash3(x: i32, y: i32, z: i32, seed: i64) -> f64 {
    let s = seed as i32;
    finish(
        x.wrapping_mul(374761393)
            .wrapping_add(y.wrapping_mul(-1028477379))
            .wrapping_add(z.wrapping_mul(668265263))
            .wrapping_add(s.wrapping_mul(1442695041)),
    )
}

const GRAD: [f64; 36] = [
    1., 1., 0., -1., 1., 0., 1., -1., 0., -1., -1., 0., //
    1., 0., 1., -1., 0., 1., 1., 0., -1., -1., 0., -1., //
    0., 1., 1., 0., -1., 1., 0., 1., -1., 0., -1., -1.,
];

struct Perm {
    perm: [u8; 512],
    pg: [u8; 512],
}

fn build_perm(rand: &mut Mulberry32) -> Perm {
    let mut p = [0u8; 256];
    for (i, v) in p.iter_mut().enumerate() {
        *v = i as u8;
    }
    for i in (1..256usize).rev() {
        let r = (rand.next_f64() * (i as f64 + 1.0)).floor() as usize;
        p.swap(i, r);
    }
    let mut perm = [0u8; 512];
    let mut pg = [0u8; 512];
    for i in 0..512 {
        perm[i] = p[i & 255];
        pg[i] = (perm[i] % 12) * 3;
    }
    Perm { perm, pg }
}

/// Simplex 2D (igual a `createNoise2D`)
pub struct Noise2 {
    p: Perm,
}

/// Simplex 3D (igual a `createNoise3D`)
pub struct Noise3 {
    p: Perm,
}

fn f2() -> f64 {
    0.5 * (3f64.sqrt() - 1.0)
}
fn g2() -> f64 {
    (3.0 - 3f64.sqrt()) / 6.0
}
const F3: f64 = 1.0 / 3.0;
const G3: f64 = 1.0 / 6.0;

#[inline]
fn wrap255(i: f64) -> usize {
    ((i as i64) & 255) as usize
}

impl Noise2 {
    pub fn new(rand: &mut Mulberry32) -> Self {
        Self { p: build_perm(rand) }
    }

    pub fn get(&self, x: f64, y: f64) -> f64 {
        let (perm, pg) = (&self.p.perm, &self.p.pg);
        let (f2, g2) = (f2(), g2());
        let (mut n0, mut n1, mut n2) = (0.0, 0.0, 0.0);
        let s = (x + y) * f2;
        let i = (x + s).floor();
        let j = (y + s).floor();
        let t = (i + j) * g2;
        let x0 = x - (i - t);
        let y0 = y - (j - t);
        let (i1, j1) = if x0 > y0 { (1usize, 0usize) } else { (0, 1) };
        let x1 = x0 - i1 as f64 + g2;
        let y1 = y0 - j1 as f64 + g2;
        let x2 = x0 - 1.0 + 2.0 * g2;
        let y2 = y0 - 1.0 + 2.0 * g2;
        let ii = wrap255(i);
        let jj = wrap255(j);
        let mut t0 = 0.5 - x0 * x0 - y0 * y0;
        if t0 >= 0.0 {
            let g = pg[ii + perm[jj] as usize] as usize;
            t0 *= t0;
            n0 = t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
        }
        let mut t1 = 0.5 - x1 * x1 - y1 * y1;
        if t1 >= 0.0 {
            let g = pg[ii + i1 + perm[jj + j1] as usize] as usize;
            t1 *= t1;
            n1 = t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
        }
        let mut t2 = 0.5 - x2 * x2 - y2 * y2;
        if t2 >= 0.0 {
            let g = pg[ii + 1 + perm[jj + 1] as usize] as usize;
            t2 *= t2;
            n2 = t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
        }
        70.0 * (n0 + n1 + n2)
    }
}

impl Noise3 {
    pub fn new(rand: &mut Mulberry32) -> Self {
        Self { p: build_perm(rand) }
    }

    pub fn get(&self, x: f64, y: f64, z: f64) -> f64 {
        let (perm, pg) = (&self.p.perm, &self.p.pg);
        let (mut n0, mut n1, mut n2, mut n3) = (0.0, 0.0, 0.0, 0.0);
        let s = (x + y + z) * F3;
        let i = (x + s).floor();
        let j = (y + s).floor();
        let k = (z + s).floor();
        let t = (i + j + k) * G3;
        let x0 = x - (i - t);
        let y0 = y - (j - t);
        let z0 = z - (k - t);
        let (i1, j1, k1, i2, j2, k2): (usize, usize, usize, usize, usize, usize) = if x0 >= y0 {
            if y0 >= z0 {
                (1, 0, 0, 1, 1, 0)
            } else if x0 >= z0 {
                (1, 0, 0, 1, 0, 1)
            } else {
                (0, 0, 1, 1, 0, 1)
            }
        } else if y0 < z0 {
            (0, 0, 1, 0, 1, 1)
        } else if x0 < z0 {
            (0, 1, 0, 0, 1, 1)
        } else {
            (0, 1, 0, 1, 1, 0)
        };
        let x1 = x0 - i1 as f64 + G3;
        let y1 = y0 - j1 as f64 + G3;
        let z1 = z0 - k1 as f64 + G3;
        let x2 = x0 - i2 as f64 + 2.0 * G3;
        let y2 = y0 - j2 as f64 + 2.0 * G3;
        let z2 = z0 - k2 as f64 + 2.0 * G3;
        let x3 = x0 - 1.0 + 3.0 * G3;
        let y3 = y0 - 1.0 + 3.0 * G3;
        let z3 = z0 - 1.0 + 3.0 * G3;
        let ii = wrap255(i);
        let jj = wrap255(j);
        let kk = wrap255(k);
        let p = |a: usize| perm[a] as usize;
        let mut t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
        if t0 > 0.0 {
            let g = pg[ii + p(jj + p(kk))] as usize;
            t0 *= t0;
            n0 = t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0);
        }
        let mut t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
        if t1 > 0.0 {
            let g = pg[ii + i1 + p(jj + j1 + p(kk + k1))] as usize;
            t1 *= t1;
            n1 = t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1);
        }
        let mut t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
        if t2 > 0.0 {
            let g = pg[ii + i2 + p(jj + j2 + p(kk + k2))] as usize;
            t2 *= t2;
            n2 = t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2);
        }
        let mut t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
        if t3 > 0.0 {
            let g = pg[ii + 1 + p(jj + 1 + p(kk + 1))] as usize;
            t3 *= t3;
            n3 = t3 * t3 * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3);
        }
        32.0 * (n0 + n1 + n2 + n3)
    }
}

/// `fbm2(noise, x, y, octaves)` com lacunaridade 2 e ganho 0,5 (os únicos usados pelo jogo)
pub fn fbm2(noise: &Noise2, x: f64, y: f64, octaves: u32) -> f64 {
    let (mut amp, mut freq, mut sum, mut norm) = (1.0, 1.0, 0.0, 0.0);
    for _ in 0..octaves {
        sum += noise.get(x * freq, y * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / norm
}
