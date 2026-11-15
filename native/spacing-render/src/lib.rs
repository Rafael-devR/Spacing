//! Desenho do Spacing nativo (docs/design/PORTE_RUST.md, M2 e M3). Por quadro: mapa de sombra do sol → cena em HDR com MSAA
//! (blocos com um buffer por chunk, pedras instanciadas, modelos do Blender por partes, céu) → bloom e passada final de cor
//! (post.rs) → interface do egui.
//!
//! O desenho não sabe de janela nem de jogo: recebe um `Frame` (câmera, luz, partes de modelo, pedras) e as malhas do mundo.
pub mod astronaut;
pub mod model;
pub mod post;

use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3, Vec4};
use spacing_core::blocks::hex_to_linear;
use spacing_core::fx::{Sprite, SpriteKind};
use spacing_core::mars_life::STORM_LOOK;
use spacing_core::mesher::Vertex;
use spacing_core::planet::PlanetDef;
use spacing_core::terrain::CS;
use spacing_core::world::{Key, MeshUpdate};
use wgpu::util::DeviceExt;

pub use model::{load_glb, ModelData};
use post::{Post, HDR};
pub use post::{PostSettings, ScreenFx};

const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth24Plus;
const SHADOW_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
/// partes de modelo por quadro (cada uma tem sua fatia do uniforme)
const MAX_PARTS: usize = 256;
/// pedras por quadro
const MAX_PROPS: usize = 4096;
/// sprites por quadro (poeira, fumaça, fogo, halos, pegadas)
const MAX_SPRITES: usize = 4096;
/// direção do sol (src/data/power.ts, SUN_DIRECTION): a câmera da sombra fica aí, relativa ao alvo (lights.ts)
const SUN_OFFSET: Vec3 = Vec3::new(-14.0, 26.0, 9.0);

/// os tipos de pedra, na ordem do arquivo exportado do TS (src/data/props.ts, PROP_TYPES)
pub const PROP_TYPES: [&str; 8] = ["boulder", "ilmenite", "gold", "crystal", "meteorite", "marsBoulder", "blueberries", "solarPanel"];
static PROPS_BIN: &[u8] = include_bytes!("../../assets/props.bin");

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    shadow_vp: [[f32; 4]; 4],
    cam_pos: [f32; 4],
    cam_fwd: [f32; 4],
    sun_dir: [f32; 4],
    sun_col: [f32; 4],
    hemi_sky: [f32; 4],
    hemi_ground: [f32; 4],
    bg_top: [f32; 4],
    bg_bot: [f32; 4],
    mist: [f32; 4],
    fog: [f32; 4],
    lamp: [f32; 4],
    point: [f32; 4],
    point_col: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PartU {
    model: [[f32; 4]; 4],
    tint: [f32; 4],
    emissive: [f32; 4],
}

/// vértice dos blocos na GPU: 28 bytes (cor em meia precisão: a lava passa de 1)
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TerrainVertex {
    pos: [f32; 3],
    normal: [i8; 4],
    color: [half::f16; 4],
    ext: [u8; 4],
}

/// uma pedra: posição, giro em y, escala (x)
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
pub struct PropInstance {
    pub pos: [f32; 3],
    /// giro em y
    pub rot: f32,
    /// x = escala, y = giro em x, z = giro em z (os pedaços que rolam; pedras paradas usam 0)
    pub scale: [f32; 4],
    /// multiplica a cor do vértice (pedaços: a cor do bloco; pedras: 1)
    pub tint: [f32; 4],
}

impl PropInstance {
    /// pedra parada: posição, giro em y e escala
    pub fn still(pos: [f32; 3], rot: f32, scale: f32) -> Self {
        Self { pos, rot, scale: [scale, 0.0, 0.0, 0.0], tint: [1.0; 4] }
    }
}

/// malhas extras depois das pedras: cubo e lasca (os pedaços de Debris.ts) e cubo de item solto
pub const MESH_CUBE: usize = PROP_TYPES.len() * 3;
pub const MESH_SHARD: usize = MESH_CUBE + 1;

/// um sprite na GPU (sprite.wgsl): centro e diâmetro, cor e opacidade, giro, semente e tipo
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SpriteInst {
    center: [f32; 4],
    color: [f32; 4],
    extra: [f32; 4],
}

/// 0 decalque (pegada), 1 mistura normal, 2 soma luz
fn sprite_layer(k: SpriteKind) -> u8 {
    match k {
        SpriteKind::Footprint => 0,
        SpriteKind::Smoke | SpriteKind::Grit => 1,
        SpriteKind::Fire | SpriteKind::Halo | SpriteKind::Ring | SpriteKind::Shell => 2,
    }
}

fn sprite_kind_index(k: SpriteKind) -> f32 {
    match k {
        SpriteKind::Smoke => 0.0,
        SpriteKind::Fire => 1.0,
        SpriteKind::Halo => 2.0,
        SpriteKind::Grit => 3.0,
        SpriteKind::Footprint => 4.0,
        SpriteKind::Ring => 5.0,
        SpriteKind::Shell => 6.0,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PropDraw {
    /// índice em PROP_TYPES × 3 + variação (`prop_mesh`)
    pub mesh: usize,
    pub inst: PropInstance,
}

pub fn prop_mesh(kind: &str, variant: u32) -> Option<usize> {
    PROP_TYPES.iter().position(|t| *t == kind).map(|i| i * 3 + (variant % 3) as usize)
}

fn pack(v: &Vertex, ox: f32, oz: f32) -> TerrainVertex {
    let sn = |x: f32| (x.clamp(-1.0, 1.0) * 127.0).round() as i8;
    let un = |x: f32| (x.clamp(0.0, 1.0) * 255.0).round() as u8;
    TerrainVertex {
        pos: [v.pos[0] + ox, v.pos[1], v.pos[2] + oz],
        normal: [sn(v.normal[0]), sn(v.normal[1]), sn(v.normal[2]), 0],
        color: [half::f16::from_f32(v.color[0]), half::f16::from_f32(v.color[1]), half::f16::from_f32(v.color[2]), half::f16::ONE],
        ext: [un(v.edge[0]), un(v.edge[1]), un(v.sky), 0],
    }
}

struct ChunkGpu {
    buf: wgpu::Buffer,
    count: u32,
    min: Vec3,
    max: Vec3,
}

/// uma malha de modelo na GPU
struct MeshGpu {
    vb: wgpu::Buffer,
    ib: wgpu::Buffer,
    count: u32,
}

/// como pintar uma parte de modelo
#[derive(Clone, Copy, Debug)]
pub enum Material {
    /// Lambert com a cor do vértice (o padrão dos modelos)
    Body,
    /// Lambert com brilho próprio somado (visor, janelas)
    Glow([f32; 3]),
    /// cor lisa no lugar da cor do vértice (ponta da broca)
    Flat([f32; 3]),
    /// sem luz: a cor do vértice vezes `k` (lâmpadas)
    Lit(f32),
    /// transparente (vidro da estufa, holograma): opacidade e cor lisa opcional; desenhado depois dos opacos, sem sombra
    Glass { alpha: f32, color: Option<[f32; 3]> },
}

/// uma parte de modelo para desenhar neste quadro
#[derive(Clone, Copy)]
pub struct PartDraw {
    pub mesh: MeshId,
    pub world: Mat4,
    pub material: Material,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct MeshId(pub usize);

/// O que mostrar neste quadro.
pub struct Frame<'a> {
    pub eye: Vec3,
    pub target: Vec3,
    pub roll: f32,
    pub fov_deg: f32,
    pub time: f32,
    /// 0 céu aberto, 1 escuro de caverna
    pub dark: f32,
    /// lanterna do capacete (posição, força)
    pub lamp: Vec4,
    pub mist_y: f32,
    /// neblina: começo e fim (blocos, na direção da câmera)
    pub fog: (f32, f32),
    pub parts: &'a [PartDraw],
    pub props: &'a [PropDraw],
    pub sprites: &'a [Sprite],
    pub screen: ScreenFx,
    /// poeira da tempestade de Marte (0..1): céu e névoa vão para o marrom, a luz cai (MarsDirector)
    pub storm: f32,
    /// luz pontual (meteoro): posição, intensidade, cor
    pub point: Option<(Vec3, f32, [f32; 3])>,
    /// ondas de choque na tela (centro 0..1 com y para cima, raio, força; espessura, borda, cor separada)
    pub shocks: &'a [([f32; 4], [f32; 4])],
    /// dentro da base (ADR 0006): o mundo de fora (chunks) não é desenhado e a luz é a de dentro
    pub indoor: bool,
}

/// números do quadro (para o medidor na tela)
#[derive(Clone, Copy, Debug, Default)]
pub struct FrameStats {
    pub draws: u32,
    pub triangles: u64,
    pub chunks_drawn: u32,
    pub chunks_total: u32,
    pub shadow_draws: u32,
    pub post_passes: u32,
}

/// a interface do egui, já tesselada
pub struct Ui<'a> {
    pub primitives: &'a [egui::ClippedPrimitive],
    pub textures: &'a egui::TexturesDelta,
    pub pixels_per_point: f32,
}

struct Lighting {
    sun: [f32; 3],
    hemi_sky: [f32; 3],
    hemi_ground: [f32; 3],
    bg_top: [f32; 3],
    bg_bot: [f32; 3],
    mist: [f32; 3],
    stars: bool,
    sparkle: bool,
    storm: [[f32; 3]; 3],
}

impl Lighting {
    /// luz de dentro da base (render/indoors.ts, INSIDE): teto claro e frio, chão quente, sol como luz de teto
    fn indoor() -> Self {
        let bg = lin("#0b0a16", 1.0);
        Lighting {
            sun: lin("#fff1dc", 1.6),
            hemi_sky: lin("#dfe8ff", 1.15),
            hemi_ground: lin("#6e5a4c", 1.15),
            bg_top: bg,
            bg_bot: lin("#1a1730", 1.0),
            mist: bg,
            stars: false,
            sparkle: false,
            storm: [bg, bg, bg],
        }
    }

    fn for_planet(planet: &PlanetDef) -> Self {
        let l = &planet.light;
        Lighting {
            sun: lin(l.sun, l.sun_power),
            hemi_sky: lin(l.sky, l.hemi),
            hemi_ground: lin(l.ground, l.hemi),
            bg_top: lin(planet.sky.top, 1.0),
            bg_bot: lin(planet.sky.bottom, 1.0),
            mist: lin(planet.sky.mist, 1.0),
            stars: planet.sky.stars,
            sparkle: planet.key == "lua",
            storm: [lin(STORM_LOOK.top, 1.0), lin(STORM_LOOK.bottom, 1.0), lin(STORM_LOOK.mist, 1.0)],
        }
    }
}

pub(crate) fn lin(hex: &str, mul: f64) -> [f32; 3] {
    let c = hex_to_linear(hex, mul);
    [c[0] as f32, c[1] as f32, c[2] as f32]
}

pub struct Renderer {
    surface: Option<wgpu::Surface<'static>>,
    /// sem janela: o quadro vai para esta textura
    offscreen: Option<wgpu::Texture>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    msaa: u32,
    /// fração da tela em que a cena 3D é desenhada (a interface fica sempre na resolução cheia)
    scale: f32,
    present_modes: Vec<wgpu::PresentMode>,
    hdr_ms: Option<wgpu::TextureView>,
    hdr: wgpu::TextureView,
    depth: wgpu::TextureView,
    globals: wgpu::Buffer,
    globals_layout: wgpu::BindGroupLayout,
    globals_bg: wgpu::BindGroup,
    shadow_view: wgpu::TextureView,
    shadow_cmp: wgpu::Sampler,
    shadow_size: u32,
    sun_buf: wgpu::Buffer,
    sun_bg: wgpu::BindGroup,
    parts_buf: wgpu::Buffer,
    parts_bg: wgpu::BindGroup,
    part_stride: u32,
    props_inst: wgpu::Buffer,
    sprite_inst: wgpu::Buffer,
    sprite_pipes: [wgpu::RenderPipeline; 3],
    terrain_pipe: wgpu::RenderPipeline,
    model_pipe: wgpu::RenderPipeline,
    glass_pipe: wgpu::RenderPipeline,
    prop_pipe: wgpu::RenderPipeline,
    sky_pipe: wgpu::RenderPipeline,
    shadow_terrain: wgpu::RenderPipeline,
    shadow_model: wgpu::RenderPipeline,
    shadow_prop: wgpu::RenderPipeline,
    chunks: HashMap<Key, ChunkGpu>,
    meshes: Vec<MeshGpu>,
    prop_meshes: Vec<(wgpu::Buffer, u32)>,
    post: Post,
    egui: egui_wgpu::Renderer,
    light: Lighting,
    scratch: Vec<TerrainVertex>,
    /// sombra ligada (desligada, a passada não é desenhada)
    pub shadows: bool,
    /// "Vulkan", "Gl"… (a tela diz o que está usando)
    pub backend: String,
    pub adapter_name: String,
}

fn shadow_texture(device: &wgpu::Device, size: u32) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("sombra"),
            size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: SHADOW_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

fn load_props(device: &wgpu::Device) -> Vec<(wgpu::Buffer, u32)> {
    let mut out = Vec::new();
    let mut at = 0usize;
    let b = PROPS_BIN;
    while at + 4 <= b.len() {
        let n = u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]) as usize;
        at += 4;
        let mut verts: Vec<model::ModelVertex> = Vec::with_capacity(n);
        for i in 0..n {
            let o = at + i * 24;
            let f = |k: usize| f32::from_le_bytes([b[o + k], b[o + k + 1], b[o + k + 2], b[o + k + 3]]);
            verts.push(model::ModelVertex { pos: [f(0), f(4), f(8)], color: [f(12), f(16), f(20), 1.0] });
        }
        at += n * 24;
        let buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("pedra"), contents: bytemuck::cast_slice(&verts), usage: wgpu::BufferUsages::VERTEX });
        out.push((buf, n as u32));
    }
    for verts in [cube_verts(), shard_verts()] {
        let buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("pedaço"), contents: bytemuck::cast_slice(&verts), usage: wgpu::BufferUsages::VERTEX });
        out.push((buf, verts.len() as u32));
    }
    out
}

/// cubo de lado 1 centrado, branco (a cor vem da instância)
fn cube_verts() -> Vec<model::ModelVertex> {
    let c = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]];
    let faces = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]];
    let mut v = Vec::new();
    for f in faces {
        for i in [0, 1, 2, 0, 2, 3] {
            v.push(model::ModelVertex { pos: c[f[i]], color: [1.0; 4] });
        }
    }
    v
}

/// lasca: icosaedro de raio 0,55 com os vértices puxados por um sorteio fixo e achatado em y (shardGeometry do Debris.ts)
fn shard_verts() -> Vec<model::ModelVertex> {
    let t = (1.0 + 5f32.sqrt()) / 2.0;
    let raw = [[-1.0, t, 0.0], [1.0, t, 0.0], [-1.0, -t, 0.0], [1.0, -t, 0.0], [0.0, -1.0, t], [0.0, 1.0, t], [0.0, -1.0, -t], [0.0, 1.0, -t], [t, 0.0, -1.0], [t, 0.0, 1.0], [-t, 0.0, -1.0], [-t, 0.0, 1.0]];
    let tris = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    let mut s: u64 = 7;
    let pts: Vec<[f32; 3]> = raw
        .iter()
        .map(|p: &[f32; 3]| {
            s = (s * 16807) % 2147483647;
            let j = 0.75 + (s as f32 / 2147483647.0) * 0.5;
            let l = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
            let k = 0.55 / l * j;
            [p[0] * k, p[1] * k * 0.8, p[2] * k]
        })
        .collect();
    tris.iter().flat_map(|t| t.iter().map(|&i| model::ModelVertex { pos: pts[i], color: [1.0; 4] })).collect()
}

impl Renderer {
    /// `window`: a janela (qualquer uma que o wgpu aceite, como a do winit). `display`: o dono da tela (o laço do winit).
    pub async fn new(
        window: wgpu::SurfaceTarget<'static>,
        display: Box<dyn wgpu::wgt::WgpuHasDisplayHandle>,
        width: u32,
        height: u32,
        planet: &PlanetDef,
    ) -> Result<Self, String> {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = wgpu::Backends::VULKAN | wgpu::Backends::GL | wgpu::Backends::DX12 | wgpu::Backends::METAL;
        let instance = wgpu::Instance::new(desc.with_display_handle(display));
        let surface = instance.create_surface(window).map_err(|e| format!("superfície: {e}"))?;
        Self::build(instance, Some(surface), width, height, planet).await
    }

    /// Sem janela: desenha numa textura e deixa ler os pixels (`read_pixels`). Para capturas de teste no computador.
    pub async fn new_headless(width: u32, height: u32, planet: &PlanetDef) -> Result<Self, String> {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = wgpu::Backends::VULKAN | wgpu::Backends::GL | wgpu::Backends::DX12 | wgpu::Backends::METAL;
        Self::build(wgpu::Instance::new(desc), None, width, height, planet).await
    }

    async fn build(instance: wgpu::Instance, surface: Option<wgpu::Surface<'static>>, width: u32, height: u32, planet: &PlanetDef) -> Result<Self, String> {
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: surface.as_ref(),
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            })
            .await
            .map_err(|e| format!("sem placa de vídeo compatível: {e}"))?;
        let info = adapter.get_info();
        log::info!("adaptador: {} ({:?})", info.name, info.backend);
        let limits = wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits());
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor { label: Some("spacing"), required_limits: limits.clone(), ..Default::default() })
            .await
            .map_err(|e| format!("dispositivo: {e}"))?;
        let (format, alpha, present_modes) = match &surface {
            Some(s) => {
                let caps = s.get_capabilities(&adapter);
                (caps.formats.iter().copied().find(|f| f.is_srgb()).unwrap_or(caps.formats[0]), caps.alpha_modes[0], caps.present_modes)
            }
            None => (wgpu::TextureFormat::Rgba8UnormSrgb, wgpu::CompositeAlphaMode::Opaque, Vec::new()),
        };
        // MSAA 4x quando o aparelho deixa (o 2x derrubou o app no celular do dono logo ao abrir: caminho que nunca rodou
        // aqui, onde o simulador não tem MSAA); o custo é compensado pela escala da cena
        let ms_ok = |f| adapter.get_texture_format_features(f).flags.sample_count_supported(4);
        let msaa = if ms_ok(HDR) && ms_ok(DEPTH) { 4 } else { 1 };
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: width.max(1),
            height: height.max(1),
            // sem limite de FPS por padrão (o app pode voltar ao vsync): o que a placa suportar de mais solto
            present_mode: Self::pick_mode(&present_modes, false),
            desired_maximum_frame_latency: 2,
            alpha_mode: alpha,
            view_formats: vec![],
            color_space: Default::default(),
        };
        if let Some(s) = &surface {
            s.configure(&device, &config);
        }
        let offscreen = if surface.is_none() { Some(Self::offscreen_tex(&device, &config)) } else { None };

        let uniform = |label, size: u64| {
            device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false })
        };
        let globals = uniform("globals", std::mem::size_of::<Globals>() as u64);
        let sun_buf = uniform("sol", 64);
        let part_stride = (std::mem::size_of::<PartU>() as u32).next_multiple_of(limits.min_uniform_buffer_offset_alignment.max(16));
        let parts_buf = uniform("parts", part_stride as u64 * MAX_PARTS as u64);
        let props_inst = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("pedras"),
            size: (MAX_PROPS * std::mem::size_of::<PropInstance>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sprite_inst = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sprites"),
            size: (MAX_SPRITES * std::mem::size_of::<SpriteInst>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let buf_entry = |binding, vis, dynamic: Option<u64>| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: vis,
            ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: dynamic.is_some(), min_binding_size: dynamic.and_then(wgpu::BufferSize::new) },
            count: None,
        };
        let vf = wgpu::ShaderStages::VERTEX_FRAGMENT;
        let globals_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("globals"),
            entries: &[
                buf_entry(0, vf, None),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Depth, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison), count: None },
            ],
        });
        let sun_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("sol"), entries: &[buf_entry(0, wgpu::ShaderStages::VERTEX, None)] });
        let part_size = std::mem::size_of::<PartU>() as u64;
        let parts_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("parts"), entries: &[buf_entry(0, vf, Some(part_size))] });
        let shadow_cmp = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("sombra"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            compare: Some(wgpu::CompareFunction::LessEqual),
            ..Default::default()
        });
        let shadow_size = 2048;
        let shadow_view = shadow_texture(&device, shadow_size);
        let globals_bg = Self::globals_group(&device, &globals_layout, &globals, &shadow_view, &shadow_cmp);
        let sun_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sol"),
            layout: &sun_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: sun_buf.as_entire_binding() }],
        });
        let parts_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("parts"),
            layout: &parts_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &parts_buf, offset: 0, size: wgpu::BufferSize::new(part_size) }),
            }],
        });

        let common = include_str!("shaders/common.wgsl");
        let module = |name: &str, src: &str| {
            device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(name), source: wgpu::ShaderSource::Wgsl(format!("{common}\n{src}").into()) })
        };
        let terrain_sh = module("terrain", include_str!("shaders/terrain.wgsl"));
        let model_sh = module("model", include_str!("shaders/model.wgsl"));
        let prop_sh = module("prop", include_str!("shaders/prop.wgsl"));
        let sky_sh = module("sky", include_str!("shaders/sky.wgsl"));
        let sprite_sh = module("sprite", include_str!("shaders/sprite.wgsl"));
        let shadow_sh = device.create_shader_module(wgpu::include_wgsl!("shaders/shadow.wgsl"));

        let layout = |label, groups: &[Option<&wgpu::BindGroupLayout>]| {
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some(label), bind_group_layouts: groups, ..Default::default() })
        };
        let scene1 = layout("cena", &[Some(&globals_layout)]);
        let scene2 = layout("cena+parte", &[Some(&globals_layout), Some(&parts_layout)]);
        let sun1 = layout("sol", &[Some(&sun_layout)]);
        let sun2 = layout("sol+parte", &[Some(&sun_layout), Some(&parts_layout)]);

        let terrain_vb = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<TerrainVertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Snorm8x4, 2 => Float16x4, 3 => Unorm8x4],
        };
        let model_vb = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<model::ModelVertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x4],
        };
        let inst_vb = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<PropInstance>() as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &wgpu::vertex_attr_array![2 => Float32x4, 3 => Float32x4, 4 => Float32x4],
        };
        let depth_state = |format, write: bool, cmp: wgpu::CompareFunction| wgpu::DepthStencilState {
            format,
            depth_write_enabled: Some(write),
            depth_compare: Some(cmp),
            stencil: Default::default(),
            bias: Default::default(),
        };
        let ms = wgpu::MultisampleState { count: msaa, ..Default::default() };
        let hdr_target = [Some(wgpu::ColorTargetState { format: HDR, blend: None, write_mask: wgpu::ColorWrites::ALL })];
        let less = wgpu::CompareFunction::Less;
        let scene_pipe = |label, layout: &wgpu::PipelineLayout, sh: &wgpu::ShaderModule, buffers: &[Option<wgpu::VertexBufferLayout>], cull: Option<wgpu::Face>, cmp: wgpu::CompareFunction| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(layout),
                vertex: wgpu::VertexState { module: sh, entry_point: Some("vs"), buffers, compilation_options: Default::default() },
                fragment: Some(wgpu::FragmentState { module: sh, entry_point: Some("fs"), targets: &hdr_target, compilation_options: Default::default() }),
                primitive: wgpu::PrimitiveState { cull_mode: cull, ..Default::default() },
                depth_stencil: Some(depth_state(DEPTH, cmp == less, cmp)),
                multisample: ms,
                multiview_mask: None,
                cache: None,
            })
        };
        let terrain_pipe = scene_pipe("terrain", &scene1, &terrain_sh, &[Some(terrain_vb.clone())], Some(wgpu::Face::Back), less);
        // modelos do Blender às vezes vêm com faces viradas: sem descarte de costas
        let model_pipe = scene_pipe("model", &scene2, &model_sh, &[Some(model_vb.clone())], None, less);
        let prop_pipe = scene_pipe("prop", &scene1, &prop_sh, &[Some(model_vb.clone()), Some(inst_vb.clone())], None, less);
        let sky_pipe = scene_pipe("sky", &scene1, &sky_sh, &[], None, wgpu::CompareFunction::LessEqual);
        let glass_target = [Some(wgpu::ColorTargetState { format: HDR, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })];
        let glass_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("vidro"),
            layout: Some(&scene2),
            vertex: wgpu::VertexState { module: &model_sh, entry_point: Some("vs"), buffers: &[Some(model_vb.clone())], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState { module: &model_sh, entry_point: Some("fs"), targets: &glass_target, compilation_options: Default::default() }),
            primitive: Default::default(),
            depth_stencil: Some(depth_state(DEPTH, false, less)),
            multisample: ms,
            multiview_mask: None,
            cache: None,
        });
        let sprite_vb = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<SpriteInst>() as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4],
        };
        let alpha = wgpu::BlendState::ALPHA_BLENDING;
        let add = wgpu::BlendState {
            color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
            alpha: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::Zero, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
        };
        let sprite_pipe = |label, entry, blend, bias: i32| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&scene1),
                vertex: wgpu::VertexState { module: &sprite_sh, entry_point: Some("vs"), buffers: &[Some(sprite_vb.clone())], compilation_options: Default::default() },
                fragment: Some(wgpu::FragmentState {
                    module: &sprite_sh,
                    entry_point: Some(entry),
                    targets: &[Some(wgpu::ColorTargetState { format: HDR, blend: Some(blend), write_mask: wgpu::ColorWrites::ALL })],
                    compilation_options: Default::default(),
                }),
                primitive: Default::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: DEPTH,
                    depth_write_enabled: Some(false),
                    depth_compare: Some(wgpu::CompareFunction::LessEqual),
                    stencil: Default::default(),
                    // as pegadas ficam rente ao chão: puxadas para a câmera (o polygonOffset do Footprints.ts)
                    bias: wgpu::DepthBiasState { constant: bias, slope_scale: bias as f32 * 0.5, clamp: 0.0 },
                }),
                multisample: ms,
                multiview_mask: None,
                cache: None,
            })
        };
        let sprite_pipes = [sprite_pipe("pegadas", "fs_alpha", alpha, -4), sprite_pipe("fumaça", "fs_alpha", alpha, 0), sprite_pipe("brilho", "fs_add", add, 0)];
        let shadow_pipe = |label, layout: &wgpu::PipelineLayout, entry, buffers: &[Option<wgpu::VertexBufferLayout>], cull| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(layout),
                vertex: wgpu::VertexState { module: &shadow_sh, entry_point: Some(entry), buffers, compilation_options: Default::default() },
                fragment: None,
                // como o Three.js: as costas vão para o mapa de sombra (menos "acne" nas faces de frente)
                primitive: wgpu::PrimitiveState { cull_mode: cull, ..Default::default() },
                depth_stencil: Some(depth_state(SHADOW_FORMAT, true, less)),
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        let shadow_terrain = shadow_pipe("sombra blocos", &sun1, "terrain", &[Some(terrain_vb)], Some(wgpu::Face::Front));
        let shadow_model = shadow_pipe("sombra modelos", &sun2, "model", &[Some(model_vb.clone())], None);
        let shadow_prop = shadow_pipe("sombra pedras", &sun1, "prop", &[Some(model_vb), Some(inst_vb)], None);

        let egui = egui_wgpu::Renderer::new(&device, format, egui_wgpu::RendererOptions::default());
        let post = Post::new(&device, format);
        let prop_meshes = load_props(&device);
        let (hdr_ms, hdr, depth) = Self::targets(&device, (config.width, config.height), msaa);
        let mut r = Self {
            surface,
            offscreen,
            device,
            queue,
            config,
            msaa,
            scale: 1.0,
            present_modes,
            hdr_ms,
            hdr,
            depth,
            globals,
            globals_layout,
            globals_bg,
            shadow_view,
            shadow_cmp,
            shadow_size,
            sun_buf,
            sun_bg,
            parts_buf,
            parts_bg,
            part_stride,
            props_inst,
            sprite_inst,
            sprite_pipes,
            terrain_pipe,
            model_pipe,
            glass_pipe,
            prop_pipe,
            sky_pipe,
            shadow_terrain,
            shadow_model,
            shadow_prop,
            chunks: HashMap::new(),
            meshes: Vec::new(),
            prop_meshes,
            post,
            egui,
            light: Lighting::for_planet(planet),
            scratch: Vec::new(),
            shadows: true,
            backend: format!("{:?}", info.backend),
            adapter_name: info.name,
        };
        let (sw, sh) = r.scene_size();
        r.post.resize(&r.device, &r.queue, &r.hdr, sw, sh);
        Ok(r)
    }

    fn globals_group(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, globals: &wgpu::Buffer, shadow: &wgpu::TextureView, cmp: &wgpu::Sampler) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("globals"),
            layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: globals.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(shadow) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(cmp) },
            ],
        })
    }

    /// Tamanho do mapa de sombra (1024, 2048, 4096; 0 desliga), como as opções do jogo web.
    pub fn set_shadow_size(&mut self, size: u32) {
        self.shadows = size > 0;
        if size == 0 || size == self.shadow_size {
            return;
        }
        self.shadow_size = size;
        self.shadow_view = shadow_texture(&self.device, size);
        self.globals_bg = Self::globals_group(&self.device, &self.globals_layout, &self.globals, &self.shadow_view, &self.shadow_cmp);
    }

    pub fn shadow_size(&self) -> u32 {
        if self.shadows {
            self.shadow_size
        } else {
            0
        }
    }

    pub fn post_settings(&mut self) -> &mut PostSettings {
        &mut self.post.settings
    }

    fn offscreen_tex(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("quadro"),
            size: wgpu::Extent3d { width: config.width, height: config.height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: config.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        })
    }

    /// Pixels RGBA do último quadro (só sem janela).
    pub fn read_pixels(&self) -> Option<Vec<u8>> {
        let tex = self.offscreen.as_ref()?;
        let (w, h) = self.size();
        let row = (w * 4).next_multiple_of(256);
        let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("leitura"),
            size: (row * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = self.device.create_command_encoder(&Default::default());
        enc.copy_texture_to_buffer(
            tex.as_image_copy(),
            wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(h) } },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.queue.submit(std::iter::once(enc.finish()));
        let slice = buf.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        self.device.poll(wgpu::PollType::wait_indefinitely()).ok()?;
        let data = slice.get_mapped_range().ok()?;
        let mut out = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            let a = (y * row) as usize;
            out.extend_from_slice(&data[a..a + (w * 4) as usize]);
        }
        Some(out)
    }

    /// cor HDR com MSAA (se houver), cor HDR resolvida (o pós lê) e profundidade
    fn targets(device: &wgpu::Device, (w, h): (u32, u32), msaa: u32) -> (Option<wgpu::TextureView>, wgpu::TextureView, wgpu::TextureView) {
        let size = wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 };
        let tex = |format, label, samples, usage| {
            device
                .create_texture(&wgpu::TextureDescriptor { label: Some(label), size, mip_level_count: 1, sample_count: samples, dimension: wgpu::TextureDimension::D2, format, usage, view_formats: &[] })
                .create_view(&Default::default())
        };
        let ra = wgpu::TextureUsages::RENDER_ATTACHMENT;
        let ms = if msaa > 1 { Some(tex(HDR, "cena msaa", msaa, ra)) } else { None };
        let hdr = tex(HDR, "cena", 1, ra | wgpu::TextureUsages::TEXTURE_BINDING);
        (ms, hdr, tex(DEPTH, "profundidade", msaa, ra))
    }

    /// Imediato (sem espera), senão Mailbox (sem espera, mas sem rasgar), senão Fifo (vsync, sempre existe).
    fn pick_mode(modes: &[wgpu::PresentMode], vsync: bool) -> wgpu::PresentMode {
        use wgpu::PresentMode::*;
        if !vsync {
            for m in [Immediate, Mailbox] {
                if modes.contains(&m) {
                    return m;
                }
            }
        }
        Fifo
    }

    /// Liga ou desliga o vsync (desligado = FPS sem limite, se a placa deixar).
    pub fn set_vsync(&mut self, on: bool) {
        self.config.present_mode = Self::pick_mode(&self.present_modes, on);
        if let Some(s) = &self.surface {
            s.configure(&self.device, &self.config);
        }
    }

    pub fn present_mode(&self) -> &'static str {
        match self.config.present_mode {
            wgpu::PresentMode::Fifo | wgpu::PresentMode::FifoRelaxed => "vsync",
            wgpu::PresentMode::Mailbox => "sem limite (mailbox)",
            wgpu::PresentMode::Immediate => "sem limite",
            _ => "?",
        }
    }

    pub fn size(&self) -> (u32, u32) {
        (self.config.width, self.config.height)
    }

    pub fn msaa(&self) -> u32 {
        self.msaa
    }

    /// tamanho em que a cena 3D é desenhada (a tela vezes a escala)
    pub fn scene_size(&self) -> (u32, u32) {
        let (w, h) = self.size();
        (((w as f32 * self.scale).round() as u32).max(1), ((h as f32 * self.scale).round() as u32).max(1))
    }

    pub fn scale(&self) -> f32 {
        self.scale
    }

    /// Escala da cena 3D (0,3 a 1; a passada final estica para a tela). É a "resolução" das configurações do jogo web
    /// e o que a resolução dinâmica mexe.
    pub fn set_scale(&mut self, s: f32) {
        let s = s.clamp(0.3, 1.0);
        if (s - self.scale).abs() < 1e-3 {
            return;
        }
        self.scale = s;
        self.rebuild_targets();
    }

    fn rebuild_targets(&mut self) {
        let size = self.scene_size();
        let (m, c, d) = Self::targets(&self.device, size, self.msaa);
        self.hdr_ms = m;
        self.hdr = c;
        self.depth = d;
        self.post.resize(&self.device, &self.queue, &self.hdr, size.0, size.1);
    }

    pub fn resize(&mut self, w: u32, h: u32) {
        if w == 0 || h == 0 || (w, h) == self.size() {
            return;
        }
        self.config.width = w;
        self.config.height = h;
        if let Some(s) = &self.surface {
            s.configure(&self.device, &self.config);
        } else {
            self.offscreen = Some(Self::offscreen_tex(&self.device, &self.config));
        }
        self.rebuild_targets();
    }

    /// Sobe (ou troca) a malha de um chunk.
    pub fn upload_chunk(&mut self, m: &MeshUpdate) {
        let key = (m.cx, m.cz);
        if m.verts.is_empty() {
            self.chunks.remove(&key);
            return;
        }
        let (ox, oz) = ((m.cx * CS as i32) as f32, (m.cz * CS as i32) as f32);
        self.scratch.clear();
        let mut lo = Vec3::splat(f32::MAX);
        let mut hi = Vec3::splat(f32::MIN);
        for v in &m.verts {
            let p = pack(v, ox, oz);
            let q = Vec3::from(p.pos);
            lo = lo.min(q);
            hi = hi.max(q);
            self.scratch.push(p);
        }
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("chunk"), contents: bytemuck::cast_slice(&self.scratch), usage: wgpu::BufferUsages::VERTEX });
        self.chunks.insert(key, ChunkGpu { buf, count: m.verts.len() as u32, min: lo, max: hi });
    }

    /// Troca de planeta sem recriar a superfície (o Android não aceita criar duas na mesma janela): novas cores de luz e de céu,
    /// e as malhas do mundo antigo saem.
    pub fn set_planet(&mut self, planet: &PlanetDef) {
        self.light = Lighting::for_planet(planet);
        self.chunks.clear();
    }

    /// tira todas as malhas do mundo (jogo novo no mesmo planeta)
    pub fn clear_chunks(&mut self) {
        self.chunks.clear();
    }

    pub fn remove_chunk(&mut self, k: Key) {
        self.chunks.remove(&k);
    }

    /// Sobe as malhas de um modelo; devolve o id de cada uma (na ordem de `ModelData::meshes`).
    pub fn upload_model(&mut self, m: &ModelData) -> Vec<MeshId> {
        m.meshes
            .iter()
            .map(|mesh| {
                let vb = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("modelo"), contents: bytemuck::cast_slice(&mesh.verts), usage: wgpu::BufferUsages::VERTEX });
                let ib = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("modelo"), contents: bytemuck::cast_slice(&mesh.indices), usage: wgpu::BufferUsages::INDEX });
                self.meshes.push(MeshGpu { vb, ib, count: mesh.indices.len() as u32 });
                MeshId(self.meshes.len() - 1)
            })
            .collect()
    }

    /// Leva um ponto do mundo à tela (x, y em -1..1, y para cima; z de profundidade). None atrás da câmera.
    pub fn project(&self, f: &Frame, p: Vec3) -> Option<Vec3> {
        let c = self.view_proj(f) * p.extend(1.0);
        if c.w <= 0.0 {
            return None;
        }
        Some(c.truncate() / c.w)
    }

    pub fn view_proj(&self, f: &Frame) -> Mat4 {
        let (w, h) = self.size();
        camera_matrix(f.eye, f.target, f.roll, f.fov_deg, w as f32 / h as f32)
    }

    /// Câmera do sol (lights.ts): ortográfica, segue o alvo em passos de um texel (a sombra não treme ao andar).
    fn sun_view_proj(&self, f: &Frame) -> Mat4 {
        let extent = (f.eye.distance(f.target) * 0.8).max(14.0);
        let texel = extent * 2.0 / self.shadow_size as f32;
        let t = Vec3::new((f.target.x / texel).round() * texel, f.target.y, (f.target.z / texel).round() * texel);
        let view = Mat4::look_at_rh(t + SUN_OFFSET, t, Vec3::Y);
        Mat4::orthographic_rh(-extent, extent, -extent, extent, 1.0, 90.0) * view
    }

    /// Junta as pedras por malha (uma chamada por tipo e variação) e sobe as instâncias. Devolve (malha, primeira, quantas).
    fn upload_props(&self, props: &[PropDraw]) -> Vec<(usize, u32, u32)> {
        let mut sorted: Vec<&PropDraw> = props.iter().filter(|p| p.mesh < self.prop_meshes.len()).take(MAX_PROPS).collect();
        sorted.sort_by_key(|p| p.mesh);
        let inst: Vec<PropInstance> = sorted.iter().map(|p| p.inst).collect();
        if !inst.is_empty() {
            self.queue.write_buffer(&self.props_inst, 0, bytemuck::cast_slice(&inst));
        }
        let mut groups: Vec<(usize, u32, u32)> = Vec::new();
        for (i, p) in sorted.iter().enumerate() {
            match groups.last_mut() {
                Some(g) if g.0 == p.mesh => g.2 += 1,
                _ => groups.push((p.mesh, i as u32, 1)),
            }
        }
        groups
    }

    /// Ordena os sprites por camada (pegadas, fumaça, brilho) e sobe. Devolve (camada, primeiro, quantos).
    fn upload_sprites(&self, sprites: &[Sprite]) -> Vec<(u8, u32, u32)> {
        let mut v: Vec<(u8, SpriteInst)> = sprites
            .iter()
            .take(MAX_SPRITES)
            .map(|s| {
                (
                    sprite_layer(s.kind),
                    SpriteInst {
                        center: [s.pos[0], s.pos[1], s.pos[2], s.size],
                        color: s.color,
                        extra: [s.rot, s.seed, sprite_kind_index(s.kind), 0.0],
                    },
                )
            })
            .collect();
        v.sort_by_key(|x| x.0);
        let inst: Vec<SpriteInst> = v.iter().map(|x| x.1).collect();
        if !inst.is_empty() {
            self.queue.write_buffer(&self.sprite_inst, 0, bytemuck::cast_slice(&inst));
        }
        let mut groups: Vec<(u8, u32, u32)> = Vec::new();
        for (i, (l, _)) in v.iter().enumerate() {
            match groups.last_mut() {
                Some(g) if g.0 == *l => g.2 += 1,
                _ => groups.push((*l, i as u32, 1)),
            }
        }
        groups
    }

    /// Desenha um quadro. Devolve os números dele, ou None se a tela não estava pronta.
    pub fn render(&mut self, f: &Frame, ui: Option<Ui>) -> Option<FrameStats> {
        let frame = match &self.surface {
            Some(surface) => match surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => Some(t),
                wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                    surface.configure(&self.device, &self.config);
                    return None;
                }
                _ => return None,
            },
            None => None,
        };
        let view = match (&frame, &self.offscreen) {
            (Some(fr), _) => fr.texture.create_view(&Default::default()),
            (None, Some(t)) => t.create_view(&Default::default()),
            (None, None) => return None,
        };
        let vp = self.view_proj(f);
        let svp = self.sun_view_proj(f);
        let (w, h) = self.size();
        let (sw, sh) = self.scene_size();
        let indoor_light = Lighting::indoor();
        let lt = if f.indoor { &indoor_light } else { &self.light };
        let st = if f.indoor { 0.0 } else { f.storm.clamp(0.0, 1.0) };
        let mixc = |a: [f32; 3], b: [f32; 3]| [a[0] + (b[0] - a[0]) * st, a[1] + (b[1] - a[1]) * st, a[2] + (b[2] - a[2]) * st];
        let (bg_top, bg_bot, mist) = (mixc(lt.bg_top, lt.storm[0]), mixc(lt.bg_bot, lt.storm[1]), mixc(lt.mist, lt.storm[2]));
        let hk = 1.0 - STORM_LOOK.hemi_drop as f32 * st;
        let sk = 1.0 - STORM_LOOK.sun_drop as f32 * st;
        let fwd = (f.target - f.eye).normalize();
        let sd = SUN_OFFSET.normalize();
        let shadow_on = if self.shadows { 1.0 } else { 0.0 };
        let g = Globals {
            view_proj: vp.to_cols_array_2d(),
            shadow_vp: svp.to_cols_array_2d(),
            cam_pos: [f.eye.x, f.eye.y, f.eye.z, f.time],
            cam_fwd: [fwd.x, fwd.y, fwd.z, self.shadow_size as f32],
            sun_dir: [sd.x, sd.y, sd.z, f.dark],
            sun_col: [lt.sun[0] * sk, lt.sun[1] * sk, lt.sun[2] * sk, lt.sparkle as u8 as f32],
            hemi_sky: [lt.hemi_sky[0] * hk, lt.hemi_sky[1] * hk, lt.hemi_sky[2] * hk, shadow_on],
            // viés da sombra: -0,0004 do Three.js (em profundidade 0..1) e 0,03 bloco na normal
            hemi_ground: [lt.hemi_ground[0] * hk, lt.hemi_ground[1] * hk, lt.hemi_ground[2] * hk, -0.0004],
            bg_top: [bg_top[0], bg_top[1], bg_top[2], 0.03],
            bg_bot: [bg_bot[0], bg_bot[1], bg_bot[2], lt.stars as u8 as f32],
            mist: [mist[0], mist[1], mist[2], f.mist_y],
            fog: [f.fog.0, f.fog.1, sw as f32, sh as f32],
            lamp: f.lamp.to_array(),
            point: f.point.map(|p| [p.0.x, p.0.y, p.0.z, p.1]).unwrap_or([0.0; 4]),
            point_col: f.point.map(|p| [p.2[0], p.2[1], p.2[2], 0.0]).unwrap_or([0.0; 4]),
        };
        self.queue.write_buffer(&self.globals, 0, bytemuck::bytes_of(&g));
        self.queue.write_buffer(&self.sun_buf, 0, bytemuck::bytes_of(&svp.to_cols_array_2d()));

        // partes de modelo: uma fatia do uniforme cada
        let parts = &f.parts[..f.parts.len().min(MAX_PARTS)];
        if !parts.is_empty() {
            let mut data = vec![0u8; self.part_stride as usize * parts.len()];
            for (i, p) in parts.iter().enumerate() {
                let (tint, emissive) = match p.material {
                    Material::Body => ([1.0, 1.0, 1.0, 0.0], [0.0; 4]),
                    Material::Glow(e) => ([1.0, 1.0, 1.0, 0.0], [e[0], e[1], e[2], 0.0]),
                    Material::Flat(c) => ([c[0], c[1], c[2], 1.0], [0.0; 4]),
                    Material::Lit(k) => ([k, k, k, 0.0], [0.0, 0.0, 0.0, 1.0]),
                    Material::Glass { alpha, color: None } => ([1.0, 1.0, 1.0, 2.0], [0.0, 0.0, 0.0, alpha]),
                    Material::Glass { alpha, color: Some(c) } => ([c[0], c[1], c[2], 3.0], [0.0, 0.0, 0.0, alpha]),
                };
                let u = PartU { model: p.world.to_cols_array_2d(), tint, emissive };
                let at = i * self.part_stride as usize;
                data[at..at + std::mem::size_of::<PartU>()].copy_from_slice(bytemuck::bytes_of(&u));
            }
            self.queue.write_buffer(&self.parts_buf, 0, &data);
        }
        let prop_groups = self.upload_props(f.props);
        let sprite_groups = self.upload_sprites(f.sprites);

        let mut stats = FrameStats { chunks_total: self.chunks.len() as u32, ..Default::default() };
        let mut enc = self.device.create_command_encoder(&Default::default());

        // 1. sombra do sol
        if self.shadows {
            let planes = frustum(svp);
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("sombra"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.shadow_view,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.set_bind_group(0, &self.sun_bg, &[]);
            pass.set_pipeline(&self.shadow_terrain);
            for c in self.chunks.values().filter(|_| !f.indoor) {
                if aabb_visible(&planes, c.min, c.max) {
                    pass.set_vertex_buffer(0, c.buf.slice(..));
                    pass.draw(0..c.count, 0..1);
                    stats.shadow_draws += 1;
                }
            }
            if !prop_groups.is_empty() {
                pass.set_pipeline(&self.shadow_prop);
                pass.set_vertex_buffer(1, self.props_inst.slice(..));
                for &(m, first, n) in &prop_groups {
                    let (vb, count) = &self.prop_meshes[m];
                    pass.set_vertex_buffer(0, vb.slice(..));
                    pass.draw(0..*count, first..first + n);
                    stats.shadow_draws += 1;
                }
            }
            if !parts.is_empty() {
                pass.set_pipeline(&self.shadow_model);
                for (i, p) in parts.iter().enumerate() {
                    if matches!(p.material, Material::Lit(_) | Material::Glass { .. }) {
                        continue;
                    }
                    let Some(m) = self.meshes.get(p.mesh.0) else { continue };
                    pass.set_bind_group(1, &self.parts_bg, &[i as u32 * self.part_stride]);
                    pass.set_vertex_buffer(0, m.vb.slice(..));
                    pass.set_index_buffer(m.ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..m.count, 0, 0..1);
                    stats.shadow_draws += 1;
                }
            }
        }

        // 2. a cena, em HDR
        {
            let planes = frustum(vp);
            let (target, resolve) = match &self.hdr_ms {
                Some(ms) => (ms, Some(&self.hdr)),
                None => (&self.hdr, None),
            };
            let store = if resolve.is_some() { wgpu::StoreOp::Discard } else { wgpu::StoreOp::Store };
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("cena"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    depth_slice: None,
                    resolve_target: resolve,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.set_bind_group(0, &self.globals_bg, &[]);
            pass.set_pipeline(&self.terrain_pipe);
            for c in self.chunks.values().filter(|_| !f.indoor) {
                if !aabb_visible(&planes, c.min, c.max) {
                    continue;
                }
                pass.set_vertex_buffer(0, c.buf.slice(..));
                pass.draw(0..c.count, 0..1);
                stats.draws += 1;
                stats.chunks_drawn += 1;
                stats.triangles += c.count as u64 / 3;
            }
            if !prop_groups.is_empty() {
                pass.set_pipeline(&self.prop_pipe);
                pass.set_vertex_buffer(1, self.props_inst.slice(..));
                for &(m, first, n) in &prop_groups {
                    let (vb, count) = &self.prop_meshes[m];
                    pass.set_vertex_buffer(0, vb.slice(..));
                    pass.draw(0..*count, first..first + n);
                    stats.draws += 1;
                    stats.triangles += (*count as u64 / 3) * n as u64;
                }
            }
            if !parts.is_empty() {
                pass.set_pipeline(&self.model_pipe);
                for (i, p) in parts.iter().enumerate() {
                    if matches!(p.material, Material::Glass { .. }) {
                        continue;
                    }
                    let Some(m) = self.meshes.get(p.mesh.0) else { continue };
                    pass.set_bind_group(1, &self.parts_bg, &[i as u32 * self.part_stride]);
                    pass.set_vertex_buffer(0, m.vb.slice(..));
                    pass.set_index_buffer(m.ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..m.count, 0, 0..1);
                    stats.draws += 1;
                    stats.triangles += m.count as u64 / 3;
                }
            }
            // o céu depois dos opacos, só onde nada foi desenhado (profundidade 1)
            pass.set_pipeline(&self.sky_pipe);
            pass.draw(0..3, 0..1);
            // vidro e hologramas: por cima do céu e dos opacos, sem escrever profundidade
            if parts.iter().any(|p| matches!(p.material, Material::Glass { .. })) {
                pass.set_pipeline(&self.glass_pipe);
                for (i, p) in parts.iter().enumerate() {
                    if !matches!(p.material, Material::Glass { .. }) {
                        continue;
                    }
                    let Some(m) = self.meshes.get(p.mesh.0) else { continue };
                    pass.set_bind_group(1, &self.parts_bg, &[i as u32 * self.part_stride]);
                    pass.set_vertex_buffer(0, m.vb.slice(..));
                    pass.set_index_buffer(m.ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..m.count, 0, 0..1);
                    stats.draws += 1;
                }
            }
            // transparentes depois do céu (não escrevem profundidade)
            if !sprite_groups.is_empty() {
                pass.set_vertex_buffer(0, self.sprite_inst.slice(..));
                for &(layer, first, n) in &sprite_groups {
                    pass.set_pipeline(&self.sprite_pipes[layer as usize]);
                    pass.draw(0..6, first..first + n);
                    stats.draws += 1;
                }
            }
        }

        // 3. interface: texturas e buffers antes das passadas (o egui grava cópias no codificador)
        let mut extra = Vec::new();
        let sd = egui_wgpu::ScreenDescriptor { size_in_pixels: [w, h], pixels_per_point: ui.as_ref().map_or(1.0, |u| u.pixels_per_point) };
        if let Some(ui) = &ui {
            for (id, deltas) in &ui.textures.set {
                for delta in deltas.iter() {
                    self.egui.update_texture(&self.device, &self.queue, *id, delta);
                }
            }
            extra = self.egui.update_buffers(&self.device, &self.queue, &mut enc, ui.primitives, &sd);
        }

        // 4. bloom e passada final; a interface vai na mesma passada (num celular, cada passada a mais na tela inteira
        // custa uma leitura e uma escrita da imagem toda)
        stats.post_passes = self.post.run(&mut enc, &self.queue, (w, h), f.time, f.screen, f.shocks);
        {
            let mut pass = self.post.final_pass(&mut enc, &view);
            if let Some(ui) = &ui {
                self.egui.render(&mut pass, ui.primitives, &sd);
            }
        }
        if let Some(ui) = &ui {
            for id in &ui.textures.free {
                self.egui.free_texture(id);
            }
        }
        self.queue.submit(extra.into_iter().chain(std::iter::once(enc.finish())));
        if let Some(fr) = frame {
            self.queue.present(fr);
        }
        // sem tela, nada apresenta o quadro nem segura o ritmo: espera a placa terminar (senão os quadros se acumulam na memória)
        if self.surface.is_none() {
            let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
        }
        Some(stats)
    }
}

/// A matriz da câmera do jogo (lente de `fov_deg` graus, perto 1 e longe 400, como no Game.ts).
pub fn camera_matrix(eye: Vec3, target: Vec3, roll: f32, fov_deg: f32, aspect: f32) -> Mat4 {
    let proj = Mat4::perspective_rh(fov_deg.to_radians(), aspect, 1.0, 400.0);
    let fwd = (target - eye).normalize();
    let right = fwd.cross(Vec3::Y).normalize();
    let up = right.cross(fwd);
    let up = (up * roll.cos() + right * roll.sin()).normalize();
    proj * Mat4::look_at_rh(eye, target, up)
}

/// os 6 planos da câmera (Gribb e Hartmann), para descartar chunks fora da tela
fn frustum(m: Mat4) -> [Vec4; 6] {
    let r = |i: usize| m.row(i);
    let p = [r(3) + r(0), r(3) - r(0), r(3) + r(1), r(3) - r(1), r(2), r(3) - r(2)];
    p.map(|v| v / v.truncate().length())
}

fn aabb_visible(planes: &[Vec4; 6], min: Vec3, max: Vec3) -> bool {
    for p in planes {
        let v = Vec3::new(if p.x > 0.0 { max.x } else { min.x }, if p.y > 0.0 { max.y } else { min.y }, if p.z > 0.0 { max.z } else { min.z });
        if p.truncate().dot(v) + p.w < 0.0 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descarte_pela_camera() {
        let vp = Mat4::perspective_rh(0.5, 1.0, 1.0, 400.0) * Mat4::look_at_rh(Vec3::new(0.0, 0.0, 10.0), Vec3::ZERO, Vec3::Y);
        let pl = frustum(vp);
        assert!(aabb_visible(&pl, Vec3::splat(-1.0), Vec3::splat(1.0)));
        assert!(!aabb_visible(&pl, Vec3::new(-1.0, -1.0, 20.0), Vec3::new(1.0, 1.0, 22.0)), "atrás da câmera");
        assert!(!aabb_visible(&pl, Vec3::new(100.0, -1.0, -1.0), Vec3::new(102.0, 1.0, 1.0)), "ao lado");
    }
    #[test]
    fn vertice_compacto() {
        assert_eq!(std::mem::size_of::<TerrainVertex>(), 28);
        assert_eq!(std::mem::size_of::<PropInstance>(), 48);
    }
    #[test]
    fn pedras_exportadas_do_ts() {
        // 8 tipos × 3 variações, todas com triângulos inteiros
        let b = PROPS_BIN;
        let mut at = 0;
        let mut n = 0;
        while at + 4 <= b.len() {
            let v = u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]) as usize;
            assert!(v > 0 && v.is_multiple_of(3));
            at += 4 + v * 24;
            n += 1;
        }
        assert_eq!(at, b.len());
        assert_eq!(n, PROP_TYPES.len() * 3);
        assert_eq!(prop_mesh("crystal", 4), Some(10));
    }
}
