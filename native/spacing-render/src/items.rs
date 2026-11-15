//! A forma 3D de cada item, equipamento e estação (portes de `src/render/itemModels.ts`, `craftedModels.ts` e `equipModels.ts`):
//! usada nos ícones (desenhados uma vez num atlas, `Renderer::render_icons`) e nos itens soltos no mundo. Tudo vira uma lista de
//! triângulos com cor por vértice (`ModelVertex`), virados para fora, no mesmo jeito das pedras.
//!
//! As formas básicas seguem as do three.js (caixa, cilindro, cone, esfera, icosaedro, toro) para os itens saírem iguais.
use glam::{EulerRot, Mat4, Quat, Vec3};
use spacing_core::blocks::hex_to_linear;
use spacing_core::rules::{rules, EquipId, ItemId, StationId};

use crate::model::{ModelData, ModelVertex};

type Tri = [Vec3; 3];

// ---------- formas básicas (como as do three.js) ----------

fn quad(out: &mut Vec<Tri>, a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
    out.push([a, b, c]);
    out.push([a, c, d]);
}

/// vira cada triângulo para fora do ponto `center` (formas convexas)
fn outward(tris: &mut [Tri], center: Vec3) {
    for t in tris.iter_mut() {
        let n = (t[1] - t[0]).cross(t[2] - t[0]);
        let c = (t[0] + t[1] + t[2]) / 3.0;
        if n.dot(c - center) < 0.0 {
            t.swap(1, 2);
        }
    }
}

fn boxg(w: f32, h: f32, d: f32) -> Vec<Tri> {
    let (x, y, z) = (w / 2.0, h / 2.0, d / 2.0);
    let p = |a: f32, b: f32, c: f32| Vec3::new(a * x, b * y, c * z);
    let mut out = Vec::new();
    quad(&mut out, p(1., -1., -1.), p(1., 1., -1.), p(1., 1., 1.), p(1., -1., 1.));
    quad(&mut out, p(-1., -1., 1.), p(-1., 1., 1.), p(-1., 1., -1.), p(-1., -1., -1.));
    quad(&mut out, p(-1., 1., -1.), p(-1., 1., 1.), p(1., 1., 1.), p(1., 1., -1.));
    quad(&mut out, p(-1., -1., 1.), p(-1., -1., -1.), p(1., -1., -1.), p(1., -1., 1.));
    quad(&mut out, p(-1., -1., 1.), p(1., -1., 1.), p(1., 1., 1.), p(-1., 1., 1.));
    quad(&mut out, p(1., -1., -1.), p(-1., -1., -1.), p(-1., 1., -1.), p(1., 1., -1.));
    outward(&mut out, Vec3::ZERO);
    out
}

/// CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
fn cylinder(rt: f32, rb: f32, h: f32, seg: usize) -> Vec<Tri> {
    let ring = |r: f32, y: f32, i: usize| {
        let a = i as f32 / seg as f32 * std::f32::consts::TAU;
        Vec3::new(r * a.sin(), y, r * a.cos())
    };
    let (top, bot) = (h / 2.0, -h / 2.0);
    let mut out = Vec::new();
    for i in 0..seg {
        let (a, b, c, d) = (ring(rt, top, i), ring(rb, bot, i), ring(rb, bot, i + 1), ring(rt, top, i + 1));
        if rt > 0.0 {
            out.push([a, b, d]);
        }
        out.push([b, c, d]);
        if rt > 0.0 {
            out.push([Vec3::new(0.0, top, 0.0), a, d]);
        }
        out.push([Vec3::new(0.0, bot, 0.0), b, c]);
    }
    outward(&mut out, Vec3::ZERO);
    out
}

fn cone(r: f32, h: f32, seg: usize) -> Vec<Tri> {
    cylinder(0.0, r, h, seg)
}

/// SphereGeometry com o pedaço de cima (theta de 0 a `theta_len`)
fn sphere(r: f32, wseg: usize, hseg: usize, theta_len: f32) -> Vec<Tri> {
    let p = |u: usize, v: usize| {
        let phi = u as f32 / wseg as f32 * std::f32::consts::TAU;
        let th = v as f32 / hseg as f32 * theta_len;
        Vec3::new(-r * phi.cos() * th.sin(), r * th.cos(), r * phi.sin() * th.sin())
    };
    let mut out = Vec::new();
    for v in 0..hseg {
        for u in 0..wseg {
            let (a, b, c, d) = (p(u, v), p(u, v + 1), p(u + 1, v + 1), p(u + 1, v));
            if v > 0 {
                out.push([a, b, d]);
            }
            out.push([b, c, d]);
        }
    }
    outward(&mut out, Vec3::ZERO);
    out
}

fn icosahedron(r: f32) -> Vec<Tri> {
    let t = (1.0 + 5f32.sqrt()) / 2.0;
    let raw = [[-1.0, t, 0.0], [1.0, t, 0.0], [-1.0, -t, 0.0], [1.0, -t, 0.0], [0.0, -1.0, t], [0.0, 1.0, t], [0.0, -1.0, -t], [0.0, 1.0, -t], [t, 0.0, -1.0], [t, 0.0, 1.0], [-t, 0.0, -1.0], [-t, 0.0, 1.0]];
    let pts: Vec<Vec3> = raw.iter().map(|p| Vec3::from_array(*p).normalize() * r).collect();
    let faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    let mut out: Vec<Tri> = faces.iter().map(|f| [pts[f[0]], pts[f[1]], pts[f[2]]]).collect();
    outward(&mut out, Vec3::ZERO);
    out
}

/// TorusGeometry(radius, tube, radialSegments, tubularSegments), no plano xy
fn torus(rr: f32, tube: f32, rseg: usize, tseg: usize) -> Vec<Tri> {
    let p = |j: usize, i: usize| {
        let u = i as f32 / tseg as f32 * std::f32::consts::TAU;
        let v = j as f32 / rseg as f32 * std::f32::consts::TAU;
        Vec3::new((rr + tube * v.cos()) * u.cos(), (rr + tube * v.cos()) * u.sin(), tube * v.sin())
    };
    let mut out = Vec::new();
    for j in 0..rseg {
        for i in 0..tseg {
            let (a, b, c, d) = (p(j, i), p(j + 1, i), p(j + 1, i + 1), p(j, i + 1));
            for mut t in [[a, b, d], [b, c, d]] {
                // para fora do centro do tubo
                let mid = (t[0] + t[1] + t[2]) / 3.0;
                let ang = mid.y.atan2(mid.x);
                let core = Vec3::new(rr * ang.cos(), rr * ang.sin(), 0.0);
                if (t[1] - t[0]).cross(t[2] - t[0]).dot(mid - core) < 0.0 {
                    t.swap(1, 2);
                }
                out.push(t);
            }
        }
    }
    out
}

fn transform(tris: &mut [Tri], m: Mat4) {
    let flip = m.determinant() < 0.0;
    for t in tris.iter_mut() {
        for p in t.iter_mut() {
            *p = m.transform_point3(*p);
        }
        if flip {
            t.swap(1, 2);
        }
    }
}

// ---------- cor ----------

fn lin(hex: &str) -> Vec3 {
    let c = hex_to_linear(hex, 1.0);
    Vec3::new(c[0] as f32, c[1] as f32, c[2] as f32)
}

/// Color.offsetHSL do three.js (no espaço linear, como ele faz)
fn offset_hsl(c: Vec3, dh: f32, ds: f32, dl: f32) -> Vec3 {
    let (r, g, b) = (c.x, c.y, c.z);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let l = (max + min) / 2.0;
    let (mut h, mut s) = (0.0, 0.0);
    if max != min {
        let d = max - min;
        s = if l <= 0.5 { d / (max + min) } else { d / (2.0 - max - min) };
        h = if max == r {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        h /= 6.0;
    }
    let h = (h + dh).rem_euclid(1.0);
    let s = (s + ds).clamp(0.0, 1.0);
    let l = (l + dl).clamp(0.0, 1.0);
    if s == 0.0 {
        return Vec3::splat(l);
    }
    let q = if l <= 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let hue = |mut t: f32| {
        t = t.rem_euclid(1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * 6.0 * (2.0 / 3.0 - t)
        } else {
            p
        }
    };
    Vec3::new(hue(h + 1.0 / 3.0), hue(h), hue(h - 1.0 / 3.0))
}

/// Uma parte: os triângulos, deslocados, numa cor com leve variação por face (o `part` do craftedModels.ts).
fn part(out: &mut Vec<ModelVertex>, mut tris: Vec<Tri>, color: Vec3, at: (f32, f32, f32), vary: f32) {
    transform(&mut tris, Mat4::from_translation(Vec3::new(at.0, at.1, at.2)));
    for (k, t) in tris.iter().enumerate() {
        let i = k * 3;
        let f = 1.0 - vary / 2.0 + ((i * 7919) % 97) as f32 / 97.0 * vary;
        let c = color * f;
        for p in t {
            out.push(ModelVertex { pos: p.to_array(), color: [c.x, c.y, c.z, 1.0] });
        }
    }
}

// ---------- itens fabricados ----------

fn crafted(model: &str, color: &str) -> Vec<ModelVertex> {
    let c = lin(color);
    let mut o = Vec::new();
    let p = |o: &mut Vec<ModelVertex>, t: Vec<Tri>, col: Vec3, x: f32, y: f32, z: f32, v: f32| part(o, t, col, (x, y, z), v);
    match model {
        "ingot" => {
            let mut g = cylinder(0.5, 0.62, 0.32, 4);
            transform(&mut g, Mat4::from_scale(Vec3::new(1.25, 1.0, 0.62)) * Mat4::from_rotation_y(std::f32::consts::FRAC_PI_4));
            p(&mut o, g, c, 0.0, 0.16, 0.0, 0.08);
            p(&mut o, boxg(0.62, 0.02, 0.24), offset_hsl(c, 0.0, 0.0, 0.12), 0.0, 0.33, 0.0, 0.08);
        }
        "brick" => {
            let dark = offset_hsl(c, 0.0, 0.0, -0.12);
            p(&mut o, boxg(0.9, 0.36, 0.48), c, 0.0, 0.18, 0.0, 0.18);
            p(&mut o, boxg(0.2, 0.04, 0.2), dark, -0.22, 0.37, 0.0, 0.08);
            p(&mut o, boxg(0.2, 0.04, 0.2), dark, 0.22, 0.37, 0.0, 0.08);
        }
        "pane" => {
            p(&mut o, boxg(0.78, 0.7, 0.06), c, 0.0, 0.45, 0.0, 0.02);
            p(&mut o, boxg(0.86, 0.1, 0.22), lin("#7d8494"), 0.0, 0.05, 0.0, 0.08);
            p(&mut o, boxg(0.3, 0.06, 0.07), lin("#ffffff"), -0.15, 0.62, 0.02, 0.0);
        }
        "spool" => {
            let lay = |mut t: Vec<Tri>| {
                transform(&mut t, Mat4::from_rotation_z(std::f32::consts::FRAC_PI_2));
                t
            };
            let flange = lin("#c3c7d2");
            p(&mut o, lay(cylinder(0.42, 0.42, 0.06, 10)), flange, -0.28, 0.42, 0.0, 0.08);
            p(&mut o, lay(cylinder(0.42, 0.42, 0.06, 10)), flange, 0.28, 0.42, 0.0, 0.08);
            p(&mut o, lay(cylinder(0.3, 0.3, 0.5, 10)), c, 0.0, 0.42, 0.0, 0.2);
        }
        "tank" => {
            p(&mut o, cylinder(0.26, 0.26, 0.8, 8), lin("#e9ebf0"), 0.0, 0.4, 0.0, 0.08);
            p(&mut o, sphere(0.26, 8, 4, std::f32::consts::FRAC_PI_2), c, 0.0, 0.8, 0.0, 0.08);
            p(&mut o, cylinder(0.27, 0.27, 0.16, 8), c, 0.0, 0.45, 0.0, 0.08);
            p(&mut o, cylinder(0.07, 0.07, 0.14, 6), lin("#5b6070"), 0.0, 1.1, 0.0, 0.08);
        }
        "powder" => {
            p(&mut o, cylinder(0.5, 0.44, 0.1, 8), lin("#7d8494"), 0.0, 0.05, 0.0, 0.08);
            p(&mut o, cone(0.38, 0.36, 7), c, 0.0, 0.28, 0.0, 0.1);
        }
        "wafer" => {
            p(&mut o, cylinder(0.5, 0.5, 0.06, 12), c, 0.0, 0.03, 0.0, 0.02);
            p(&mut o, boxg(0.5, 0.02, 0.5), offset_hsl(c, 0.02, 0.1, 0.16), 0.0, 0.07, 0.0, 0.08);
        }
        "chip" => {
            p(&mut o, boxg(0.9, 0.06, 0.62), c, 0.0, 0.03, 0.0, 0.08);
            p(&mut o, boxg(0.34, 0.08, 0.34), lin("#1c1d24"), 0.08, 0.1, 0.0, 0.08);
            for i in 0..4 {
                p(&mut o, boxg(0.08, 0.03, 0.12), lin("#ffc23a"), -0.38 + i as f32 * 0.1, 0.07, 0.27, 0.0);
            }
            p(&mut o, boxg(0.12, 0.05, 0.12), lin("#9fb4dc"), -0.26, 0.08, -0.12, 0.08);
        }
        "plan" => {
            let line = lin("#d7f0f5");
            p(&mut o, boxg(0.9, 0.05, 0.66), c, 0.0, 0.025, 0.0, 0.04);
            p(&mut o, boxg(0.62, 0.02, 0.04), line, 0.0, 0.06, -0.14, 0.0);
            p(&mut o, boxg(0.62, 0.02, 0.04), line, 0.0, 0.06, 0.02, 0.0);
            p(&mut o, boxg(0.4, 0.02, 0.04), line, -0.11, 0.06, 0.18, 0.0);
            p(&mut o, boxg(0.1, 0.03, 0.1), lin("#4fd1e8"), 0.3, 0.07, 0.2, 0.0);
        }
        "tuber" => {
            let mut a = icosahedron(0.34);
            transform(&mut a, Mat4::from_rotation_z(0.3) * Mat4::from_scale(Vec3::new(1.3, 0.85, 0.95)));
            let mut b = icosahedron(0.26);
            transform(&mut b, Mat4::from_rotation_y(1.1) * Mat4::from_scale(Vec3::new(1.2, 0.8, 0.9)));
            let eye = lin("#6d4b2a");
            p(&mut o, a, c, -0.12, 0.3, 0.0, 0.16);
            p(&mut o, b, offset_hsl(c, 0.0, 0.0, -0.05), 0.26, 0.22, 0.12, 0.16);
            p(&mut o, boxg(0.05, 0.05, 0.05), eye, -0.2, 0.52, 0.12, 0.0);
            p(&mut o, boxg(0.05, 0.05, 0.05), eye, 0.05, 0.42, 0.25, 0.0);
        }
        "sack" => {
            p(&mut o, cylinder(0.34, 0.4, 0.7, 7), lin("#d9cdb5"), 0.0, 0.35, 0.0, 0.1);
            p(&mut o, cylinder(0.3, 0.34, 0.12, 7), c, 0.0, 0.76, 0.0, 0.12);
            p(&mut o, boxg(0.5, 0.14, 0.05), lin("#5aa04a"), 0.0, 0.38, 0.34, 0.0);
        }
        "planter" => {
            p(&mut o, boxg(0.9, 0.36, 0.6), c, 0.0, 0.18, 0.0, 0.06);
            p(&mut o, boxg(0.94, 0.05, 0.64), lin("#4b4f60"), 0.0, 0.38, 0.0, 0.04);
            p(&mut o, boxg(0.78, 0.04, 0.48), lin("#5a3d28"), 0.0, 0.39, 0.0, 0.1);
            p(&mut o, boxg(0.06, 0.16, 0.06), lin("#6fbf5a"), -0.2, 0.47, 0.0, 0.0);
            p(&mut o, boxg(0.06, 0.12, 0.06), lin("#6fbf5a"), 0.18, 0.45, 0.06, 0.0);
        }
        _ => p(&mut o, boxg(0.5, 0.5, 0.5), c, 0.0, 0.25, 0.0, 0.08),
    }
    o
}

/// centra em x e z e apoia em y = 0 → o craftedGeometry centra pela caixa inteira
fn centered(mut v: Vec<ModelVertex>) -> Vec<ModelVertex> {
    if v.is_empty() {
        return v;
    }
    let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
    for p in &v {
        let q = Vec3::from_array(p.pos);
        lo = lo.min(q);
        hi = hi.max(q);
    }
    let c = (lo + hi) / 2.0;
    for p in &mut v {
        p.pos = (Vec3::from_array(p.pos) - c).to_array();
    }
    v
}

/// A forma de um item, centrada na origem: bloco, pedra (a mesma do mundo) ou peça fabricada.
pub fn item_shape(item: ItemId, props: &dyn Fn(&str) -> Option<Vec<ModelVertex>>) -> Vec<ModelVertex> {
    let d = item.data();
    if let Some(b) = d.block.or(d.icon_block) {
        return spacing_core::mesher::mesh_single(b)
            .into_iter()
            .map(|v| ModelVertex { pos: [v.pos[0] - 0.5, v.pos[1] - 0.5, v.pos[2] - 0.5], color: [v.color[0], v.color[1], v.color[2], 1.0] })
            .collect();
    }
    if let Some(m) = &d.model {
        return centered(crafted(m, d.color.as_deref().unwrap_or("#c3c7d2")));
    }
    centered(props(d.icon_prop.as_deref().unwrap_or("boulder")).unwrap_or_else(|| crafted("", "#c3c7d2")))
}

/// cor "sem luz" nos ícones: a tela do tablet brilha (alfa 0 = não acender nem apagar)
fn unlit(v: &mut [ModelVertex]) {
    for p in v {
        p.color[3] = 0.0;
    }
}

/// Os equipamentos: o tablet do Mapa e as brocas de mão (createEquipModel).
pub fn equip_shape(id: EquipId) -> Vec<ModelVertex> {
    let mut o = Vec::new();
    if id.key() == "map" {
        // tablet: moldura escura, aro laranja, tela com um mapa simples (curvas e marcadores) em blocos finos
        let (aspect, bezel) = (1.5f32, 0.09f32);
        let (w, h) = (aspect + bezel * 2.0, 1.0 + bezel * 2.4);
        let mut t = Vec::new();
        part(&mut t, boxg(w, h, 0.07), lin("#1d2340"), (0.0, 0.0, 0.0), 0.0);
        part(&mut t, boxg(w + 0.035, h + 0.035, 0.035), lin("#ff7a2f"), (0.0, 0.0, -0.012), 0.0);
        let mut screen = Vec::new();
        let sy = -bezel * 0.2;
        part(&mut screen, boxg(aspect, 1.0, 0.004), lin("#0b3150"), (0.0, sy, 0.036), 0.0);
        for k in 0..5 {
            let r = 0.12 + k as f32 * 0.1;
            part(&mut screen, boxg(r * 1.6, 0.025, 0.004), lin("#7fe7ff"), (-0.15, sy + 0.02 + r * 0.55, 0.039), 0.0);
            part(&mut screen, boxg(r * 1.6, 0.025, 0.004), lin("#7fe7ff"), (-0.15, sy + 0.02 - r * 0.55, 0.039), 0.0);
        }
        part(&mut screen, boxg(0.16, 0.12, 0.004), lin("#f4f0e8"), (0.42, sy - 0.2, 0.04), 0.0);
        part(&mut screen, boxg(0.12, 0.16, 0.004), lin("#ff7a2f"), (0.4, sy + 0.25, 0.04), 0.0);
        unlit(&mut screen);
        t.extend(screen);
        part(&mut t, boxg(0.035, 0.16, 0.05), lin("#4b4f60"), (w / 2.0 + 0.02, h * 0.22, 0.0), 0.0);
        let m = Mat4::from_quat(Quat::from_euler(EulerRot::XYZ, -0.28, std::f32::consts::FRAC_PI_4, 0.0)) * Mat4::from_scale(Vec3::splat(0.62));
        for v in &mut t {
            v.pos = m.transform_point3(Vec3::from_array(v.pos)).to_array();
        }
        o.extend(t);
    }
    if let Some(drill) = id.data().drill.as_deref() {
        let d = rules().drills.iter().find(|x| x.id == drill).expect("broca");
        let mut b = Vec::new();
        part(&mut b, boxg(0.2, 0.22, 0.5), lin("#283157"), (0.0, 0.0, -0.1), 0.0);
        part(&mut b, boxg(0.22, 0.05, 0.3), lin("#ff7a2f"), (0.0, 0.13, -0.08), 0.0);
        part(&mut b, boxg(0.1, 0.3, 0.12), lin("#4b4f60"), (0.0, -0.24, -0.2), 0.0);
        let along_z = |mut t: Vec<Tri>| {
            transform(&mut t, Mat4::from_rotation_x(std::f32::consts::FRAC_PI_2));
            t
        };
        part(&mut b, along_z(cylinder(0.075, 0.09, 0.18, 8)), lin("#8c90a0"), (0.0, 0.0, 0.24), 0.0);
        let mut bit = lin(&d.bit);
        if let Some(g) = &d.glow {
            bit += lin(g);
        }
        part(&mut b, along_z(cone(0.09, 0.5, if d.tier >= 2 { 5 } else { 6 })), bit, (0.0, 0.0, 0.58), 0.0);
        for k in 0..d.tier {
            part(&mut b, torus(0.085 - k as f32 * 0.02, 0.012, 5, 10), lin("#ff7a2f"), (0.0, 0.0, 0.4 + k as f32 * 0.1), 0.0);
        }
        let m = Mat4::from_rotation_y(-0.6);
        for v in &mut b {
            v.pos = m.transform_point3(Vec3::from_array(v.pos)).to_array();
        }
        o.extend(b);
    }
    o
}

/// Um modelo do Blender inteiro numa lista de triângulos, na pose do arquivo (ícone das estações).
pub fn model_shape(m: &ModelData) -> Vec<ModelVertex> {
    let world = m.world_matrices();
    let mut o = Vec::new();
    for (i, n) in m.nodes.iter().enumerate() {
        let Some(mi) = n.mesh else { continue };
        let mesh = &m.meshes[mi];
        let w = world[i];
        for &k in &mesh.indices {
            let v = mesh.verts[k as usize];
            o.push(ModelVertex { pos: w.transform_point3(Vec3::from_array(v.pos)).to_array(), color: v.color });
        }
    }
    o
}

/// os ícones na ordem do atlas: itens, equipamentos, estações
pub fn icon_count() -> usize {
    ItemId::all().count() + EquipId::all().count() + StationId::all().count()
}

pub fn icon_of_item(i: ItemId) -> usize {
    i.0 as usize
}

pub fn icon_of_equip(e: EquipId) -> usize {
    ItemId::all().count() + e.0 as usize
}

pub fn icon_of_station(s: StationId) -> usize {
    ItemId::all().count() + EquipId::all().count() + s.0 as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    fn closed_outward(v: &[ModelVertex]) -> bool {
        // soma das normais (com área) de uma forma fechada é zero; virada para fora, o volume é positivo
        let mut vol = 0.0;
        for t in v.chunks(3) {
            let (a, b, c) = (Vec3::from_array(t[0].pos), Vec3::from_array(t[1].pos), Vec3::from_array(t[2].pos));
            vol += a.dot(b.cross(c)) / 6.0;
        }
        vol > 0.0
    }

    #[test]
    fn todos_os_itens_tem_forma_virada_para_fora() {
        let none = |_: &str| None;
        for i in ItemId::all() {
            let v = item_shape(i, &none);
            assert!(!v.is_empty() && v.len().is_multiple_of(3), "{i:?}");
            if i.data().model.is_some() {
                assert!(closed_outward(&v), "{i:?} virado para dentro");
            }
        }
        for e in EquipId::all() {
            assert!(!equip_shape(e).is_empty(), "{e:?}");
        }
        assert!(closed_outward(&boxg(1.0, 2.0, 3.0).iter().flat_map(|t| t.iter().map(|p| ModelVertex { pos: p.to_array(), color: [1.0; 4] })).collect::<Vec<_>>()));
        assert!(closed_outward(&cylinder(0.3, 0.5, 1.0, 7).iter().flat_map(|t| t.iter().map(|p| ModelVertex { pos: p.to_array(), color: [1.0; 4] })).collect::<Vec<_>>()));
    }
}
