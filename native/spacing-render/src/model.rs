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
    /// laços feitos no Blender (as máquinas da base)
    pub clips: Vec<Clip>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Translation,
    Rotation,
    Scale,
}

/// uma curva de animação: um nó, uma propriedade, tempos e valores (rotação em quatérnio xyzw; o resto em xyz)
#[derive(Clone, Debug)]
pub struct Track {
    pub node: usize,
    pub channel: Channel,
    pub times: Vec<f32>,
    pub values: Vec<[f32; 4]>,
    /// STEP: sem interpolar
    pub step: bool,
}

#[derive(Clone, Debug)]
pub struct Clip {
    pub name: String,
    pub duration: f32,
    pub tracks: Vec<Track>,
}

impl Track {
    /// valor no tempo `t` (linear; quatérnio com slerp)
    pub fn sample(&self, t: f32) -> [f32; 4] {
        let n = self.times.len();
        if n == 0 {
            return [0.0; 4];
        }
        if t <= self.times[0] {
            return self.values[0];
        }
        if t >= self.times[n - 1] {
            return self.values[n - 1];
        }
        let i = self.times.partition_point(|&x| x <= t).max(1) - 1;
        let (t0, t1) = (self.times[i], self.times[i + 1]);
        let k = if self.step { 0.0 } else { ((t - t0) / (t1 - t0).max(1e-6)).clamp(0.0, 1.0) };
        let (a, b) = (self.values[i], self.values[i + 1]);
        if self.channel == Channel::Rotation {
            Quat::from_array(a).slerp(Quat::from_array(b), k).to_array()
        } else {
            [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, 0.0]
        }
    }
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
    let mut clips = Vec::new();
    for anim in doc.animations() {
        let mut tracks = Vec::new();
        let mut duration = 0.0f32;
        for ch in anim.channels() {
            let r = ch.reader(|b| Some(&buffers[b.index()]));
            let Some(times) = r.read_inputs().map(|i| i.collect::<Vec<f32>>()) else { continue };
            use gltf::animation::util::ReadOutputs;
            let (channel, values): (Channel, Vec<[f32; 4]>) = match r.read_outputs() {
                Some(ReadOutputs::Translations(v)) => (Channel::Translation, v.map(|p| [p[0], p[1], p[2], 0.0]).collect()),
                Some(ReadOutputs::Scales(v)) => (Channel::Scale, v.map(|p| [p[0], p[1], p[2], 0.0]).collect()),
                Some(ReadOutputs::Rotations(v)) => (Channel::Rotation, v.into_f32().collect()),
                _ => continue,
            };
            // CUBICSPLINE guarda tangentes junto: fica só o valor do meio de cada trinca
            let values = if ch.sampler().interpolation() == gltf::animation::Interpolation::CubicSpline {
                values.chunks(3).map(|c| c[1]).collect()
            } else {
                values
            };
            duration = duration.max(times.last().copied().unwrap_or(0.0));
            tracks.push(Track { node: ch.target().node().index(), channel, times, values, step: ch.sampler().interpolation() == gltf::animation::Interpolation::Step });
        }
        clips.push(Clip { name: anim.name().unwrap_or("").to_string(), duration, tracks });
    }
    Ok(ModelData { meshes, nodes, roots, clips })
}
