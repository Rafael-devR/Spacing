//! Plataforma plana da base (porte de `src/world/basePad.ts`): o gerador nivela o chão sob a base e faz a sacada da porta.
use crate::js;

/// O módulo inicial da base (porte de `HAB_MODULE` em `src/data/base.ts`: só o que o terreno precisa).
pub struct HabModule {
    pub origin: (i32, i32),
    pub size: (i32, i32),
    pub interior_height: i32,
    /// lado da porta (0 norte -z, 1 sul +z, 2 oeste -x, 3 leste +x) e posição ao longo da parede
    pub door_side: u8,
    pub door_at: i32,
}

pub const HAB_MODULE: HabModule = HabModule { origin: (6, -14), size: (11, 9), interior_height: 3, door_side: 1, door_at: 5 };

const MARGIN: f64 = 2.0;
const BLEND: f64 = 8.0;
const APRON: f64 = 6.0;

struct Pad {
    nx: f64,
    nz: f64,
    along_x: bool,
    door_x: f64,
    door_z: f64,
    fx0: f64,
    fx1: f64,
    fz0: f64,
    fz1: f64,
}

fn pad() -> Pad {
    let m = &HAB_MODULE;
    let (ox, oz) = (m.origin.0 as f64, m.origin.1 as f64);
    let (x0, z0) = (ox, oz);
    let (x1, z1) = (ox + m.size.0 as f64 - 1.0, oz + m.size.1 as f64 - 1.0);
    let (nx, nz) = match m.door_side {
        0 => (0.0, -1.0),
        1 => (0.0, 1.0),
        2 => (-1.0, 0.0),
        _ => (1.0, 0.0),
    };
    let along_x = m.door_side <= 1;
    let door_x = if along_x { ox + m.door_at as f64 } else if m.door_side == 2 { x0 } else { x1 };
    let door_z = if !along_x { oz + m.door_at as f64 } else if m.door_side == 0 { z0 } else { z1 };
    Pad {
        nx,
        nz,
        along_x,
        door_x,
        door_z,
        fx0: x0 - MARGIN - if nx < 0.0 { APRON } else { 0.0 },
        fx1: x1 + MARGIN + if nx > 0.0 { APRON } else { 0.0 },
        fz0: z0 - MARGIN - if nz < 0.0 { APRON } else { 0.0 },
        fz1: z1 + MARGIN + if nz > 0.0 { APRON } else { 0.0 },
    }
}

fn smooth(t: f64) -> f64 {
    let k = t.clamp(0.0, 1.0);
    k * k * (3.0 - 2.0 * k)
}

pub fn pad_weight(x: f64, z: f64) -> f64 {
    let p = pad();
    let dx = (p.fx0 - x).max(0.0).max(x - p.fx1);
    let dz = (p.fz0 - z).max(0.0).max(z - p.fz1);
    1.0 - smooth(js::hypot(dx, dz) / BLEND)
}

pub fn is_landing(x: f64, z: f64) -> bool {
    let p = pad();
    let lateral = if p.along_x { (x - p.door_x).abs() } else { (z - p.door_z).abs() };
    let out = (x - p.door_x) * p.nx + (z - p.door_z) * p.nz;
    lateral <= 1.0 && (1.0..=2.0).contains(&out)
}

pub fn in_pad(x: f64, z: f64) -> bool {
    pad_weight(x, z) > 0.0
}

pub fn apply_base_pad(h: f64, x: f64, z: f64, pad_h: f64) -> f64 {
    let w = pad_weight(x, z);
    if w <= 0.0 {
        return h;
    }
    if is_landing(x, z) {
        return pad_h + 1.0;
    }
    if w >= 1.0 {
        return pad_h;
    }
    h + (pad_h - h) * w
}
