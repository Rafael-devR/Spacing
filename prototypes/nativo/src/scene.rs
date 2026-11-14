//! A cena do teste: pedaços de cubos (como os chunks do jogo), postos numa grade no chão, e a câmera girando em volta de
//! todos (nada fica fora da tela: o teste mede desenhar, não descartar). `web/three.ts` faz a mesma conta.
use bytemuck::{Pod, Zeroable};

/// vértice: posição e normal (a normal em 4 bytes, como no jogo)
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Vertex {
    pub pos: [f32; 3],
    pub normal: [i8; 4],
}

/// tamanho de um pedaço (unidades) e distância entre pedaços
pub const CHUNK: f32 = 8.0;
pub const SPACING: f32 = 10.0;

const FACES: [([i8; 3], [[f32; 3]; 4]); 6] = [
    ([1, 0, 0], [[1., 0., 0.], [1., 1., 0.], [1., 1., 1.], [1., 0., 1.]]),
    ([-1, 0, 0], [[0., 0., 0.], [0., 0., 1.], [0., 1., 1.], [0., 1., 0.]]),
    ([0, 1, 0], [[0., 1., 0.], [0., 1., 1.], [1., 1., 1.], [1., 1., 0.]]),
    ([0, -1, 0], [[0., 0., 0.], [1., 0., 0.], [1., 0., 1.], [0., 0., 1.]]),
    ([0, 0, 1], [[0., 0., 1.], [1., 0., 1.], [1., 1., 1.], [0., 1., 1.]]),
    ([0, 0, -1], [[0., 0., 0.], [0., 1., 0.], [1., 1., 0.], [1., 0., 0.]]),
];

/// `n` cubos num bloco de lado ⌈∛n⌉, cabendo em CHUNK unidades (centro no meio); `variant` desloca um pouco cada malha,
/// para as malhas da fase de chamadas de desenho não serem idênticas
pub fn cubes(n: u32, variant: u32) -> (Vec<Vertex>, Vec<u32>) {
    let side = (n as f64).cbrt().ceil().max(1.0) as u32;
    let cell = CHUNK / side as f32;
    let size = cell * 0.8;
    let shift = (variant % 7) as f32 * 0.01;
    let mut v = Vec::with_capacity(n as usize * 24);
    let mut idx = Vec::with_capacity(n as usize * 36);
    for i in 0..n {
        let (x, y, z) = (i % side, (i / side) % side, i / (side * side));
        let o = [
            x as f32 * cell - CHUNK / 2.0 + shift,
            y as f32 * cell - CHUNK / 2.0,
            z as f32 * cell - CHUNK / 2.0,
        ];
        for (nrm, corners) in FACES {
            let base = v.len() as u32;
            for c in corners {
                v.push(Vertex {
                    pos: [o[0] + c[0] * size, o[1] + c[1] * size, o[2] + c[2] * size],
                    normal: [nrm[0] * 127, nrm[1] * 127, nrm[2] * 127, 0],
                });
            }
            idx.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
        }
    }
    (v, idx)
}

/// onde fica o pedaço `i` de `n` (grade quadrada no chão, centro na origem)
pub fn chunk_pos(i: u32, n: u32) -> [f32; 3] {
    let side = (n as f64).sqrt().ceil().max(1.0) as u32;
    let half = (side as f32 - 1.0) * SPACING / 2.0;
    [(i % side) as f32 * SPACING - half, 0.0, (i / side) as f32 * SPACING - half]
}

/// distância da câmera para caber a grade de `n` pedaços inteira na tela
pub fn camera_distance(n: u32) -> f32 {
    let side = (n as f64).sqrt().ceil().max(1.0) as f32;
    side * SPACING * 1.15 + 18.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cubos_tem_24_vertices_e_12_triangulos() {
        let (v, i) = cubes(10, 0);
        assert_eq!(v.len(), 240);
        assert_eq!(i.len(), 360);
    }

    #[test]
    fn grade_centrada() {
        assert_eq!(chunk_pos(0, 1), [0.0, 0.0, 0.0]);
        let a = chunk_pos(0, 4);
        let b = chunk_pos(3, 4);
        assert_eq!(a[0], -b[0]);
        assert_eq!(a[2], -b[2]);
    }
}

/// matriz 4×4 em colunas (como o wgpu e o WebGL esperam)
pub type Mat4 = [[f32; 4]; 4];

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn norm(a: [f32; 3]) -> [f32; 3] {
    let l = dot(a, a).sqrt();
    [a[0] / l, a[1] / l, a[2] / l]
}

/// projeção em perspectiva (mão direita, profundidade de 0 a 1)
pub fn perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> Mat4 {
    let f = 1.0 / (fov_y / 2.0).tan();
    let nf = 1.0 / (near - far);
    [[f / aspect, 0.0, 0.0, 0.0], [0.0, f, 0.0, 0.0], [0.0, 0.0, far * nf, -1.0], [0.0, 0.0, near * far * nf, 0.0]]
}

/// câmera em `eye` olhando para `center`
pub fn look_at(eye: [f32; 3], center: [f32; 3], up: [f32; 3]) -> Mat4 {
    let f = norm(sub(center, eye));
    let s = norm(cross(f, up));
    let u = cross(s, f);
    [[s[0], u[0], -f[0], 0.0], [s[1], u[1], -f[1], 0.0], [s[2], u[2], -f[2], 0.0], [-dot(s, eye), -dot(u, eye), dot(f, eye), 1.0]]
}

pub fn mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut r = [[0.0; 4]; 4];
    for c in 0..4 {
        for row in 0..4 {
            r[c][row] = (0..4).map(|k| a[k][row] * b[c][k]).sum();
        }
    }
    r
}

/// câmera do quadro: gira em volta da grade de `n` pedaços (mesma conta de web/three.ts)
pub fn view_proj(t: f32, n: u32, aspect: f32) -> Mat4 {
    let dist = camera_distance(n);
    let eye = [(t * 0.2).cos() * dist, dist * 0.75, (t * 0.2).sin() * dist];
    mul(&perspective(50f32.to_radians(), aspect, 0.5, dist * 4.0), &look_at(eye, [0.0, 0.0, 0.0], [0.0, 1.0, 0.0]))
}

#[cfg(test)]
mod camera_tests {
    use super::*;

    #[test]
    fn o_centro_cai_no_meio_da_tela_e_dentro_da_profundidade() {
        let m = view_proj(1.0, 64, 2.0);
        // ponto (0,0,0): clip = coluna 3
        let (x, y, z, w) = (m[3][0], m[3][1], m[3][2], m[3][3]);
        assert!((x / w).abs() < 1e-4 && (y / w).abs() < 1e-4, "{x} {y} {w}");
        assert!(z / w > 0.0 && z / w < 1.0);
    }
}
