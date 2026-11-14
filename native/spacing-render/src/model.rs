//! Modelos do Blender (`.glb`, ADR 0013): lê malhas e nós. A hierarquia fica como no arquivo; quem anima (o astronauta) monta
//! o esqueleto com os nomes dos nós.
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Quat, Vec3};

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct ModelVertex {
    pub pos: [f32; 3],
    pub color: [f32; 4],
}

/// uma malha na CPU (antes de subir para a GPU)
pub struct MeshData {
    pub verts: Vec<ModelVertex>,
    pub indices: Vec<u32>,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub name: String,
    pub translation: Vec3,
    pub rotation: Quat,
    pub scale: Vec3,
    /// índice em `ModelData::meshes`
    pub mesh: Option<usize>,
    pub children: Vec<usize>,
    pub parent: Option<usize>,
}

impl Node {
    pub fn local(&self) -> Mat4 {
        Mat4::from_scale_rotation_translation(self.scale, self.rotation, self.translation)
    }
}

pub struct ModelData {
    pub meshes: Vec<MeshData>,
    pub nodes: Vec<Node>,
    /// nós sem pai
    pub roots: Vec<usize>,
}

impl ModelData {
    pub fn find(&self, name: &str) -> Option<usize> {
        self.nodes.iter().position(|n| n.name == name)
    }

    /// matriz de mundo de cada nó na pose do arquivo
    pub fn world_matrices(&self) -> Vec<Mat4> {
        let mut out = vec![Mat4::IDENTITY; self.nodes.len()];
        fn walk(m: &ModelData, i: usize, parent: Mat4, out: &mut [Mat4]) {
            let w = parent * m.nodes[i].local();
            out[i] = w;
            for &c in &m.nodes[i].children {
                walk(m, c, w, out);
            }
        }
        for &r in &self.roots {
            walk(self, r, Mat4::IDENTITY, &mut out);
        }
        out
    }
}

/// Lê um `.glb` (posição e COLOR_0; o jogo não usa texturas nos modelos). Uma malha com várias partes vira uma só.
pub fn load_glb(bytes: &[u8]) -> Result<ModelData, String> {
    let (doc, buffers, _images) = gltf::import_slice(bytes).map_err(|e| e.to_string())?;
    let mut meshes = Vec::new();
    for mesh in doc.meshes() {
        let mut verts = Vec::new();
        let mut indices = Vec::new();
        for prim in mesh.primitives() {
            let r = prim.reader(|b| Some(&buffers[b.index()]));
            let base = verts.len() as u32;
            let pos: Vec<[f32; 3]> = r.read_positions().ok_or("malha sem posição")?.collect();
            let col: Vec<[f32; 4]> = match r.read_colors(0) {
                Some(c) => c.into_rgba_f32().collect(),
                None => vec![[1.0; 4]; pos.len()],
            };
            for (p, c) in pos.iter().zip(col.iter()) {
                verts.push(ModelVertex { pos: *p, color: *c });
            }
            match r.read_indices() {
                Some(i) => indices.extend(i.into_u32().map(|i| i + base)),
                None => indices.extend(base..base + pos.len() as u32),
            }
        }
        meshes.push(MeshData { verts, indices });
    }
    let mut nodes: Vec<Node> = doc
        .nodes()
        .map(|n| {
            let (t, r, s) = n.transform().decomposed();
            Node {
                name: n.name().unwrap_or("").to_string(),
                translation: Vec3::from(t),
                rotation: Quat::from_array(r),
                scale: Vec3::from(s),
                mesh: n.mesh().map(|m| m.index()),
                children: n.children().map(|c| c.index()).collect(),
                parent: None,
            }
        })
        .collect();
    for i in 0..nodes.len() {
        for c in nodes[i].children.clone() {
            nodes[c].parent = Some(i);
        }
    }
    let roots = (0..nodes.len()).filter(|&i| nodes[i].parent.is_none()).collect();
    Ok(ModelData { meshes, nodes, roots })
}
