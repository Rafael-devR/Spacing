//! Desenho do Spacing nativo (docs/design/PORTE_RUST.md, M2). Um buffer por chunk (posições já no mundo, sem uniforme por
//! chunk), descarte pela câmera, modelos do Blender por partes, fundo do céu e a interface do egui por cima.
//!
//! O desenho não sabe de janela nem de jogo: recebe um `Frame` (câmera, luz, partes de modelo) e as malhas novas do mundo.
pub mod astronaut;
pub mod model;

use std::collections::HashMap;
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3, Vec4};
use spacing_core::blocks::hex_to_linear;
use spacing_core::mesher::Vertex;
use spacing_core::planet::PlanetDef;
use spacing_core::terrain::CS;
use spacing_core::world::{Key, MeshUpdate};
use wgpu::util::DeviceExt;

pub use model::{load_glb, ModelData};

const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth24Plus;
/// partes de modelo por quadro (cada uma tem sua fatia do uniforme)
const MAX_PARTS: usize = 256;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
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
    pub parts: &'a [PartDraw],
}

/// números do quadro (para o medidor na tela)
#[derive(Clone, Copy, Debug, Default)]
pub struct FrameStats {
    pub draws: u32,
    pub triangles: u64,
    pub chunks_drawn: u32,
    pub chunks_total: u32,
}

/// a interface do egui, já tesselada
pub struct Ui<'a> {
    pub primitives: &'a [egui::ClippedPrimitive],
    pub textures: &'a egui::TexturesDelta,
    pub pixels_per_point: f32,
}

struct Lighting {
    sun_dir: Vec3,
    sun: [f32; 3],
    hemi_sky: [f32; 3],
    hemi_ground: [f32; 3],
    bg_top: [f32; 3],
    bg_bot: [f32; 3],
    mist: [f32; 3],
    stars: bool,
    sparkle: bool,
}

pub struct Renderer {
    surface: Option<wgpu::Surface<'static>>,
    /// sem janela: o quadro vai para esta textura
    offscreen: Option<wgpu::Texture>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    msaa: u32,
    present_modes: Vec<wgpu::PresentMode>,
    color_ms: Option<wgpu::TextureView>,
    depth: wgpu::TextureView,
    globals: wgpu::Buffer,
    globals_bg: wgpu::BindGroup,
    parts_buf: wgpu::Buffer,
    parts_bg: wgpu::BindGroup,
    part_stride: u32,
    terrain_pipe: wgpu::RenderPipeline,
    model_pipe: wgpu::RenderPipeline,
    sky_pipe: wgpu::RenderPipeline,
    chunks: HashMap<Key, ChunkGpu>,
    meshes: Vec<MeshGpu>,
    egui: egui_wgpu::Renderer,
    light: Lighting,
    scratch: Vec<TerrainVertex>,
    /// "Vulkan", "Gl"… (a tela diz o que está usando)
    pub backend: String,
    pub adapter_name: String,
}

impl Lighting {
    fn for_planet(planet: &PlanetDef) -> Self {
        let l = &planet.light;
        Lighting {
            sun_dir: Vec3::new(-14.0, 26.0, 9.0).normalize(),
            sun: lin(l.sun, l.sun_power),
            hemi_sky: lin(l.sky, l.hemi),
            hemi_ground: lin(l.ground, l.hemi),
            bg_top: lin(planet.sky.top, 1.0),
            bg_bot: lin(planet.sky.bottom, 1.0),
            mist: lin(planet.sky.mist, 1.0),
            stars: planet.sky.stars,
            sparkle: planet.key == "lua",
        }
    }
}

fn lin(hex: &str, mul: f64) -> [f32; 3] {
    let c = hex_to_linear(hex, mul);
    [c[0] as f32, c[1] as f32, c[2] as f32]
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
        let flags = adapter.get_texture_format_features(format).flags;
        let msaa = if flags.sample_count_supported(4) && adapter.get_texture_format_features(DEPTH).flags.sample_count_supported(4) { 4 } else { 1 };
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

        let globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let part_stride = (std::mem::size_of::<PartU>() as u32).next_multiple_of(limits.min_uniform_buffer_offset_alignment.max(16));
        let parts_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("parts"),
            size: part_stride as u64 * MAX_PARTS as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let globals_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("globals"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                count: None,
            }],
        });
        let part_size = wgpu::BufferSize::new(std::mem::size_of::<PartU>() as u64);
        let parts_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("parts"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: true, min_binding_size: part_size },
                count: None,
            }],
        });
        let globals_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("globals"),
            layout: &globals_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: globals.as_entire_binding() }],
        });
        let parts_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("parts"),
            layout: &parts_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &parts_buf, offset: 0, size: part_size }),
            }],
        });

        let common = include_str!("shaders/common.wgsl");
        let module = |name: &str, src: &str| {
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(name),
                source: wgpu::ShaderSource::Wgsl(format!("{common}\n{src}").into()),
            })
        };
        let terrain_sh = module("terrain", include_str!("shaders/terrain.wgsl"));
        let model_sh = module("model", include_str!("shaders/model.wgsl"));
        let sky_sh = module("sky", include_str!("shaders/sky.wgsl"));
        let depth_state = |write: bool, cmp: wgpu::CompareFunction| wgpu::DepthStencilState {
            format: DEPTH,
            depth_write_enabled: Some(write),
            depth_compare: Some(cmp),
            stencil: Default::default(),
            bias: Default::default(),
        };
        let ms = wgpu::MultisampleState { count: msaa, ..Default::default() };
        let one_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("globals"),
            bind_group_layouts: &[Some(&globals_layout)],
            ..Default::default()
        });
        let two_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("globals+part"),
            bind_group_layouts: &[Some(&globals_layout), Some(&parts_layout)],
            ..Default::default()
        });
        let target = [Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })];
        let terrain_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("terrain"),
            layout: Some(&one_layout),
            vertex: wgpu::VertexState {
                module: &terrain_sh,
                entry_point: Some("vs"),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<TerrainVertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Snorm8x4, 2 => Float16x4, 3 => Unorm8x4],
                })],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState { module: &terrain_sh, entry_point: Some("fs"), targets: &target, compilation_options: Default::default() }),
            primitive: wgpu::PrimitiveState { cull_mode: Some(wgpu::Face::Back), front_face: wgpu::FrontFace::Ccw, ..Default::default() },
            depth_stencil: Some(depth_state(true, wgpu::CompareFunction::Less)),
            multisample: ms,
            multiview_mask: None,
            cache: None,
        });
        let model_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("model"),
            layout: Some(&two_layout),
            vertex: wgpu::VertexState {
                module: &model_sh,
                entry_point: Some("vs"),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<model::ModelVertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x4],
                })],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState { module: &model_sh, entry_point: Some("fs"), targets: &target, compilation_options: Default::default() }),
            // modelos do Blender às vezes vêm com faces viradas: sem descarte de costas
            primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
            depth_stencil: Some(depth_state(true, wgpu::CompareFunction::Less)),
            multisample: ms,
            multiview_mask: None,
            cache: None,
        });
        let sky_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("sky"),
            layout: Some(&one_layout),
            vertex: wgpu::VertexState { module: &sky_sh, entry_point: Some("vs"), buffers: &[], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState { module: &sky_sh, entry_point: Some("fs"), targets: &target, compilation_options: Default::default() }),
            primitive: Default::default(),
            depth_stencil: Some(depth_state(false, wgpu::CompareFunction::LessEqual)),
            multisample: ms,
            multiview_mask: None,
            cache: None,
        });
        let egui = egui_wgpu::Renderer::new(&device, format, egui_wgpu::RendererOptions::default());

        let light = Lighting::for_planet(planet);
        let (color_ms, depth) = Self::targets(&device, &config, msaa);
        Ok(Self {
            surface,
            offscreen,
            device,
            queue,
            config,
            msaa,
            present_modes,
            color_ms,
            depth,
            globals,
            globals_bg,
            parts_buf,
            parts_bg,
            part_stride,
            terrain_pipe,
            model_pipe,
            sky_pipe,
            chunks: HashMap::new(),
            meshes: Vec::new(),
            egui,
            light,
            scratch: Vec::new(),
            backend: format!("{:?}", info.backend),
            adapter_name: info.name,
        })
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

    fn targets(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration, msaa: u32) -> (Option<wgpu::TextureView>, wgpu::TextureView) {
        let size = wgpu::Extent3d { width: config.width, height: config.height, depth_or_array_layers: 1 };
        let tex = |format, label| {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size,
                    mip_level_count: 1,
                    sample_count: msaa,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        let color = if msaa > 1 { Some(tex(config.format, "cor msaa")) } else { None };
        (color, tex(DEPTH, "profundidade"))
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
        let (c, d) = Self::targets(&self.device, &self.config, self.msaa);
        self.color_ms = c;
        self.depth = d;
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
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("chunk"),
            contents: bytemuck::cast_slice(&self.scratch),
            usage: wgpu::BufferUsages::VERTEX,
        });
        self.chunks.insert(key, ChunkGpu { buf, count: m.verts.len() as u32, min: lo, max: hi });
    }

    /// Troca de planeta sem recriar a superfície (o Android não aceita criar duas na mesma janela): novas cores de luz e de céu,
    /// e as malhas do mundo antigo saem.
    pub fn set_planet(&mut self, planet: &PlanetDef) {
        self.light = Lighting::for_planet(planet);
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
                let vb = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("modelo"),
                    contents: bytemuck::cast_slice(&mesh.verts),
                    usage: wgpu::BufferUsages::VERTEX,
                });
                let ib = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("modelo"),
                    contents: bytemuck::cast_slice(&mesh.indices),
                    usage: wgpu::BufferUsages::INDEX,
                });
                self.meshes.push(MeshGpu { vb, ib, count: mesh.indices.len() as u32 });
                MeshId(self.meshes.len() - 1)
            })
            .collect()
    }

    fn view_proj(&self, f: &Frame) -> Mat4 {
        let (w, h) = self.size();
        let aspect = w as f32 / h as f32;
        let proj = Mat4::perspective_rh(f.fov_deg.to_radians(), aspect, 1.0, 400.0);
        let fwd = (f.target - f.eye).normalize();
        let right = fwd.cross(Vec3::Y).normalize();
        let up = right.cross(fwd);
        let up = (up * f.roll.cos() + right * f.roll.sin()).normalize();
        proj * Mat4::look_at_rh(f.eye, f.target, up)
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
            (Some(f), _) => f.texture.create_view(&Default::default()),
            (None, Some(t)) => t.create_view(&Default::default()),
            (None, None) => return None,
        };
        let vp = self.view_proj(f);
        let (w, h) = self.size();
        let lt = &self.light;
        let fwd = (f.target - f.eye).normalize();
        let g = Globals {
            view_proj: vp.to_cols_array_2d(),
            cam_pos: [f.eye.x, f.eye.y, f.eye.z, f.time],
            cam_fwd: [fwd.x, fwd.y, fwd.z, 1.08],
            sun_dir: [lt.sun_dir.x, lt.sun_dir.y, lt.sun_dir.z, f.dark],
            sun_col: [lt.sun[0], lt.sun[1], lt.sun[2], lt.sparkle as u8 as f32],
            hemi_sky: [lt.hemi_sky[0], lt.hemi_sky[1], lt.hemi_sky[2], 0.0],
            hemi_ground: [lt.hemi_ground[0], lt.hemi_ground[1], lt.hemi_ground[2], 0.0],
            bg_top: [lt.bg_top[0], lt.bg_top[1], lt.bg_top[2], 0.0],
            bg_bot: [lt.bg_bot[0], lt.bg_bot[1], lt.bg_bot[2], lt.stars as u8 as f32],
            mist: [lt.mist[0], lt.mist[1], lt.mist[2], f.mist_y],
            fog: [40.0, 80.0, w as f32, h as f32],
            lamp: f.lamp.to_array(),
        };
        self.queue.write_buffer(&self.globals, 0, bytemuck::bytes_of(&g));

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
                };
                let u = PartU { model: p.world.to_cols_array_2d(), tint, emissive };
                let at = i * self.part_stride as usize;
                data[at..at + std::mem::size_of::<PartU>()].copy_from_slice(bytemuck::bytes_of(&u));
            }
            self.queue.write_buffer(&self.parts_buf, 0, &data);
        }

        let planes = frustum(vp);
        let mut stats = FrameStats { chunks_total: self.chunks.len() as u32, ..Default::default() };
        let mut enc = self.device.create_command_encoder(&Default::default());
        {
            let (target, resolve) = match &self.color_ms {
                Some(ms) => (ms, Some(&view)),
                None => (&view, None),
            };
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("cena"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    depth_slice: None,
                    resolve_target: resolve,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
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
            for c in self.chunks.values() {
                if !aabb_visible(&planes, c.min, c.max) {
                    continue;
                }
                pass.set_vertex_buffer(0, c.buf.slice(..));
                pass.draw(0..c.count, 0..1);
                stats.draws += 1;
                stats.chunks_drawn += 1;
                stats.triangles += c.count as u64 / 3;
            }
            if !parts.is_empty() {
                pass.set_pipeline(&self.model_pipe);
                for (i, p) in parts.iter().enumerate() {
                    let Some(m) = self.meshes.get(p.mesh.0) else { continue };
                    pass.set_bind_group(1, &self.parts_bg, &[i as u32 * self.part_stride]);
                    pass.set_vertex_buffer(0, m.vb.slice(..));
                    pass.set_index_buffer(m.ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..m.count, 0, 0..1);
                    stats.draws += 1;
                    stats.triangles += m.count as u64 / 3;
                }
            }
            // o céu por último, só onde nada foi desenhado (profundidade 1)
            pass.set_pipeline(&self.sky_pipe);
            pass.draw(0..3, 0..1);
        }

        if let Some(ui) = ui {
            for (id, deltas) in &ui.textures.set {
                for delta in deltas.iter() {
                    self.egui.update_texture(&self.device, &self.queue, *id, delta);
                }
            }
            let sd = egui_wgpu::ScreenDescriptor { size_in_pixels: [w, h], pixels_per_point: ui.pixels_per_point };
            let extra = self.egui.update_buffers(&self.device, &self.queue, &mut enc, ui.primitives, &sd);
            {
                let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("interface"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                    })],
                    ..Default::default()
                });
                let mut pass = pass.forget_lifetime();
                self.egui.render(&mut pass, ui.primitives, &sd);
            }
            for id in &ui.textures.free {
                self.egui.free_texture(id);
            }
            self.queue.submit(extra.into_iter().chain(std::iter::once(enc.finish())));
        } else {
            self.queue.submit(std::iter::once(enc.finish()));
        }
        if let Some(f) = frame {
            self.queue.present(f);
        }
        Some(stats)
    }
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
    }
}
