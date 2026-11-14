//! Malha de um chunk (porte de `src/world/mesher.ts`): só faces visíveis, oclusão por vértice, variação de cor por bloco,
//! luz do céu por vértice e "pepitas" de minério saindo das faces.
use crate::blocks::{registry, BlockId, Rgb};
use crate::noise::hash3;

/// Um vértice da malha dos blocos (as mesmas grandezas do TS; o renderizador empacota como quiser).
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vertex {
    pub pos: [f32; 3],
    pub normal: [f32; 3],
    pub color: [f32; 3],
    /// coordenada da face (0..1) para o brilho de borda; 0,5 = sem borda
    pub edge: [f32; 2],
    /// luz do céu (0 escuro, 1 céu aberto)
    pub sky: f32,
}

type V3 = [f64; 3];

struct Face {
    dir: [i32; 3],
    c: [[i32; 3]; 4],
    axis: usize,
    u: usize,
    v: usize,
}

const fn face(dir: [i32; 3], c: [[i32; 3]; 4]) -> Face {
    let axis = if dir[0] != 0 {
        0
    } else if dir[1] != 0 {
        1
    } else {
        2
    };
    Face { dir, c, axis, u: if axis == 0 { 1 } else { 0 }, v: if axis == 2 { 1 } else { 2 } }
}

const FACES: [Face; 6] = [
    face([-1, 0, 0], [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]]),
    face([1, 0, 0], [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]]),
    face([0, -1, 0], [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]]),
    face([0, 1, 0], [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]]),
    face([0, 0, -1], [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]]),
    face([0, 0, 1], [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]),
];

const AO: [f64; 4] = [0.48, 0.66, 0.83, 1.0];
/// níveis da luz do céu (igual a SKY_MAX)
pub const SKY_LEVELS: u8 = 12;

fn sky_curve() -> &'static [f32; SKY_LEVELS as usize * 4 + 1] {
    use std::sync::OnceLock;
    static C: OnceLock<[f32; SKY_LEVELS as usize * 4 + 1]> = OnceLock::new();
    C.get_or_init(|| {
        let mut c = [0f32; SKY_LEVELS as usize * 4 + 1];
        for (i, v) in c.iter_mut().enumerate() {
            *v = (i as f64 / (SKY_LEVELS as f64 * 4.0)).powf(1.5) as f32;
        }
        c
    })
}

/// Blocos com 1 de margem em x e z: índice (x+1) + (z+1)*(w+2) + y*(w+2)*(d+2). `ox`, `oz`: origem do chunk no mundo.
#[allow(clippy::too_many_arguments)]
pub fn mesh_padded(
    pad: &[u8],
    w: usize,
    d: usize,
    h: usize,
    max_y: usize,
    ox: i32,
    oz: i32,
    below_solid: bool,
    light: Option<&[u8]>,
    out: &mut Vec<Vertex>,
) {
    out.clear();
    let pw = (w + 2) as i32;
    let pl = ((w + 2) * (d + 2)) as i32;
    let hi = h as i32;
    let at = |x: i32, y: i32, z: i32| -> u8 {
        if y < 0 {
            return below_solid as u8;
        }
        if y >= hi {
            return 0;
        }
        pad[(x + 1 + (z + 1) * pw + y * pl) as usize]
    };
    let light_at = |x: i32, y: i32, z: i32| -> f64 {
        match light {
            None => SKY_LEVELS as f64,
            Some(_) if y >= hi => SKY_LEVELS as f64,
            Some(_) if y < 0 => 0.0,
            Some(l) => l[(x + 1 + (z + 1) * pw + y * pl) as usize] as f64,
        }
    };
    let reg = registry();
    let curve = sky_curve();
    let mut sk = [1f32; 4];
    let top = max_y.min(h - 1) as i32;
    for y in 0..=top {
        for z in 0..d as i32 {
            for x in 0..w as i32 {
                let id = at(x, y, z);
                if id == 0 {
                    continue;
                }
                let def = &reg[id as usize];
                let (wx, wz) = (ox + x, oz + z);
                let vary = 0.93 + 0.12 * hash3(wx, y, wz, 9);
                for (fi, f) in FACES.iter().enumerate() {
                    let [nx, ny, nz] = f.dir;
                    if at(x + nx, y + ny, z + nz) != 0 {
                        continue;
                    }
                    let base = if ny == 1 {
                        def.top
                    } else if ny == -1 {
                        def.bot
                    } else {
                        def.side
                    };
                    let mut ao = [0usize; 4];
                    for k in 0..4 {
                        let c = f.c[k];
                        let du = if c[f.u] != 0 { 1 } else { -1 };
                        let dv = if c[f.v] != 0 { 1 } else { -1 };
                        let p = [x + nx, y + ny, z + nz];
                        let mut q = p;
                        let mut ls = light_at(p[0], p[1], p[2]);
                        let mut ln = 1.0;
                        q[f.u] += du;
                        let s1 = (at(q[0], q[1], q[2]) != 0) as usize;
                        if s1 == 0 {
                            ls += light_at(q[0], q[1], q[2]);
                            ln += 1.0;
                        }
                        q[f.u] -= du;
                        q[f.v] += dv;
                        let s2 = (at(q[0], q[1], q[2]) != 0) as usize;
                        if s2 == 0 {
                            ls += light_at(q[0], q[1], q[2]);
                            ln += 1.0;
                        }
                        q[f.u] += du;
                        let cr = (at(q[0], q[1], q[2]) != 0) as usize;
                        if cr == 0 && !(s1 == 1 && s2 == 1) {
                            ls += light_at(q[0], q[1], q[2]);
                            ln += 1.0;
                        }
                        ao[k] = if s1 == 1 && s2 == 1 { 0 } else { 3 - (s1 + s2 + cr) };
                        sk[k] = curve[crate::js::round((ls / ln) * 4.0) as usize];
                    }
                    let order: [usize; 6] = if ao[1] + ao[2] < ao[0] + ao[3] { [0, 1, 3, 0, 3, 2] } else { [0, 1, 2, 2, 1, 3] };
                    let fv = vary * (0.97 + 0.06 * hash3(wx, y, wz, 20 + fi as i64));
                    let n = [nx as f32, ny as f32, nz as f32];
                    for &k in &order {
                        let c = f.c[k];
                        let b = AO[ao[k]] * fv;
                        out.push(Vertex {
                            pos: [(x + c[0]) as f32, (y + c[1]) as f32, (z + c[2]) as f32],
                            normal: n,
                            color: [(base[0] * b) as f32, (base[1] * b) as f32, (base[2] * b) as f32],
                            edge: [c[f.u] as f32, c[f.v] as f32],
                            sky: sk[k],
                        });
                    }
                    if let Some(ore) = def.ore {
                        if ny != -1 {
                            let s = ((sk[0] as f64 + sk[1] as f64 + sk[2] as f64 + sk[3] as f64) / 4.0) as f32;
                            add_nuggets(out, ore, f, x, y, z, wx, wz, fi, s);
                        }
                    }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn add_nuggets(out: &mut Vec<Vertex>, ore: Rgb, f: &Face, x: i32, y: i32, z: i32, wx: i32, wz: i32, fi: usize, sky: f32) {
    let n = [f.dir[0] as f64, f.dir[1] as f64, f.dir[2] as f64];
    let fi64 = fi as i64;
    let count = 1 + (hash3(wx, y, wz, 40 + fi64) > 0.35) as i32 + (hash3(wx, y, wz, 50 + fi64) > 0.8) as i32;
    for k in 0..count {
        let r = |s: i64| hash3(wx.wrapping_mul(3) + k, y.wrapping_mul(7) + fi as i32, wz.wrapping_mul(5), s);
        let hu = 0.22 + 0.56 * r(11);
        let hv = 0.22 + 0.56 * r(12);
        let size = 0.1 + 0.09 * r(13);
        let ang = r(14) * std::f64::consts::PI;
        let mut p: V3 = [x as f64, y as f64, z as f64];
        if n[f.axis] > 0.0 {
            p[f.axis] += 1.0;
        }
        p[f.u] += hu;
        p[f.v] += hv;
        let mut base = [[0f64; 3]; 4];
        for (i, b) in base.iter_mut().enumerate() {
            let a = ang + (i as f64 * std::f64::consts::PI) / 2.0;
            *b = p;
            b[f.u] += a.cos() * size;
            b[f.v] += a.sin() * size;
            b[f.axis] -= n[f.axis] * 0.04;
        }
        let mut apex = p;
        apex[f.axis] += n[f.axis] * size * 1.15;
        apex[f.u] += (r(15) - 0.5) * size * 0.6;
        apex[f.v] += (r(16) - 0.5) * size * 0.6;
        let center = [p[0] + n[0] * size * 0.3, p[1] + n[1] * size * 0.3, p[2] + n[2] * size * 0.3];
        let shade = 0.88 + 0.24 * r(17);
        for i in 0..4 {
            let (mut a, mut b) = (base[i], base[(i + 1) % 4]);
            let mut nn = tri_normal(a, b, apex);
            let cx = (a[0] + b[0] + apex[0]) / 3.0 - center[0];
            let cy = (a[1] + b[1] + apex[1]) / 3.0 - center[1];
            let cz = (a[2] + b[2] + apex[2]) / 3.0 - center[2];
            if nn[0] * cx + nn[1] * cy + nn[2] * cz < 0.0 {
                std::mem::swap(&mut a, &mut b);
                nn = [-nn[0], -nn[1], -nn[2]];
            }
            let facet = shade * (0.92 + 0.16 * r(30 + i as i64));
            for v in [a, b, apex] {
                out.push(Vertex {
                    pos: [v[0] as f32, v[1] as f32, v[2] as f32],
                    normal: [nn[0] as f32, nn[1] as f32, nn[2] as f32],
                    color: [(ore[0] * facet) as f32, (ore[1] * facet) as f32, (ore[2] * facet) as f32],
                    edge: [0.5, 0.5],
                    sky,
                });
            }
        }
    }
}

fn tri_normal(a: V3, b: V3, c: V3) -> V3 {
    let (ux, uy, uz) = (b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let (vx, vy, vz) = (c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    let (x, y, z) = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    let l = crate::js::hypot3(x, y, z);
    let l = if l != 0.0 { l } else { 1.0 };
    [x / l, y / l, z / l]
}

/// Malha de um único bloco (ícones e itens soltos)
pub fn mesh_single(id: BlockId) -> Vec<Vertex> {
    let mut pad = [0u8; 9];
    pad[4] = id;
    let mut out = Vec::new();
    mesh_padded(&pad, 1, 1, 1, 0, 0, 0, false, None, &mut out);
    out
}
