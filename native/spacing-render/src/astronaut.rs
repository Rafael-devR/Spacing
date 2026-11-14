//! O astronauta do Blender com esqueleto (porte de `src/render/astronaut.ts`, ADR 0017). O `.glb` traz um nó por junta, todos
//! soltos na raiz com o pivô no lugar da junta; aqui eles viram uma hierarquia e a pose de `spacing_core::anim` gira cada um.
use glam::{EulerRot, Mat4, Quat, Vec3};
use spacing_core::anim::{Pose, JOINTS};

use crate::model::ModelData;
use crate::{lin, Material, MeshId, PartDraw};

/// nome do nó no arquivo, na ordem de `spacing_core::anim::JOINTS`
const NODE: [&str; 16] = [
    "pelvis", "torso", "head", "pack", "arm_l", "fore_l", "hand_l", "arm_r", "fore_r", "hand_r", "leg_l", "shin_l", "foot_l", "leg_r", "shin_r", "foot_r",
];
/// pai de cada junta (índice em JOINTS); o quadril pendura na raiz
const PARENT: [Option<usize>; 16] = [None, Some(0), Some(1), Some(1), Some(1), Some(4), Some(5), Some(1), Some(7), Some(8), Some(0), Some(10), Some(11), Some(0), Some(13), Some(14)];

struct Piece {
    mesh: MeshId,
    /// posição da peça relativa à junta (ou ao ponto onde ela pendura)
    local: Mat4,
    material: Material,
}

pub struct Astronaut {
    /// posição de cada junta relativa à junta mãe, em repouso
    rest: [Vec3; 16],
    pieces: [Vec<Piece>; 16],
    /// broca: peças, e onde ela fica no cinto e na luva (relativo ao quadril e à mão direita)
    drill: Vec<Piece>,
    holster: Mat4,
    grip: Mat4,
    pub hip_rest_y: f32,
}

fn material_for(name: &str) -> Material {
    if name.starts_with("fx_bit") {
        Material::Flat(lin("#ffb03a", 1.0))
    } else if name.starts_with("glow_visor") {
        Material::Glow(lin("#070b1e", 1.0))
    } else if name.starts_with("lit") || name.starts_with("fx") {
        Material::Lit(1.7)
    } else if name.starts_with("glow") {
        Material::Glow(lin("#1b2a6a", 1.0))
    } else {
        Material::Body
    }
}

impl Astronaut {
    /// `meshes`: os ids que `Renderer::upload_model` devolveu para este modelo
    pub fn new(m: &ModelData, meshes: &[MeshId]) -> Option<Self> {
        let world = m.world_matrices();
        let idx: Vec<usize> = NODE.iter().map(|n| m.find(n)).collect::<Option<Vec<_>>>()?;
        let pos = |i: usize| world[i].w_axis.truncate();
        let mut rest = [Vec3::ZERO; 16];
        for j in 0..16 {
            rest[j] = match PARENT[j] {
                Some(p) => pos(idx[j]) - pos(idx[p]),
                None => pos(idx[j]),
            };
        }
        let mut pieces: [Vec<Piece>; 16] = Default::default();
        for j in 0..16 {
            for &c in &m.nodes[idx[j]].children {
                let n = &m.nodes[c];
                if let Some(mi) = n.mesh {
                    pieces[j].push(Piece { mesh: meshes[mi], local: n.local(), material: material_for(&n.name) });
                }
            }
        }
        let mut drill = Vec::new();
        if let Some(d) = m.find("drill") {
            for &c in &m.nodes[d].children {
                let n = &m.nodes[c];
                if let Some(mi) = n.mesh {
                    drill.push(Piece { mesh: meshes[mi], local: n.local(), material: material_for(&n.name) });
                }
            }
        }
        let local_of = |name: &str| m.find(name).map(|i| m.nodes[i].local()).unwrap_or(Mat4::IDENTITY);
        let hip_rest_y = rest[0].y;
        Some(Self { rest, pieces, drill, holster: local_of("holster"), grip: local_of("grip_r"), hip_rest_y })
    }

    /// As peças para desenhar: `pos` dos pés, `facing` (rad, em y), pose da animação; `mining` põe a broca na mão.
    pub fn draw(&self, pos: Vec3, facing: f32, pose: &Pose, mining: bool, visible: bool, out: &mut Vec<PartDraw>) {
        if !visible {
            return;
        }
        let s = pose.stretch as f32;
        let w = 1.0 + (1.0 - s) * 0.6;
        let root = Mat4::from_translation(pos) * Mat4::from_rotation_y(facing) * Mat4::from_scale(Vec3::new(w, s, w));
        let mut jw = [Mat4::IDENTITY; 16];
        for j in 0..16 {
            let a = pose.j[j];
            let rot = Mat4::from_quat(Quat::from_euler(EulerRot::XYZ, a.x as f32, a.y as f32, a.z as f32));
            let mut t = self.rest[j];
            if j == 0 {
                t.y = self.hip_rest_y + pose.hip_y as f32;
            }
            let parent = PARENT[j].map(|p| jw[p]).unwrap_or(root);
            jw[j] = parent * Mat4::from_translation(t) * rot;
            for p in &self.pieces[j] {
                out.push(PartDraw { mesh: p.mesh, world: jw[j] * p.local, material: p.material });
            }
        }
        let place = if mining {
            jw[9] * self.grip * Mat4::from_translation(Vec3::new(0.0, 0.03, 0.02)) * Mat4::from_rotation_x(std::f32::consts::FRAC_PI_2 - 0.25)
        } else {
            jw[0]
                * self.holster
                * Mat4::from_translation(Vec3::new(-0.02, 0.0, 0.0))
                * Mat4::from_quat(Quat::from_euler(EulerRot::XYZ, std::f32::consts::FRAC_PI_2 + 0.15, 0.0, 0.1))
                * Mat4::from_scale(Vec3::splat(0.85))
        };
        for p in &self.drill {
            out.push(PartDraw { mesh: p.mesh, world: place * p.local, material: p.material });
        }
        let _ = JOINTS;
    }
}

/// Um modelo parado (módulo de pouso): todas as peças na pose do arquivo, na posição dada.
pub struct StaticModel {
    pieces: Vec<Piece>,
}

impl StaticModel {
    pub fn new(m: &ModelData, meshes: &[MeshId]) -> Self {
        let world = m.world_matrices();
        let pieces = m
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(i, n)| n.mesh.map(|mi| Piece { mesh: meshes[mi], local: world[i], material: material_for(&n.name) }))
            .collect();
        Self { pieces }
    }

    pub fn draw(&self, at: Mat4, out: &mut Vec<PartDraw>) {
        for p in &self.pieces {
            out.push(PartDraw { mesh: p.mesh, world: at * p.local, material: p.material });
        }
    }
}
