//! O desenho com wgpu: Vulkan (ou OpenGL ES) no Android, WebGL2 no navegador. A mesma conta de `web/three.ts`: um pedaço =
//! uma chamada de desenho com a sua posição numa uniform; câmera e luz numa uniform por quadro; nada é descartado.
use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;
use winit::window::Window;

use crate::bench::{DRAW_CUBES, DRAW_MAX};
use crate::scene::{self, Vertex};

/// malhas diferentes na fase de chamadas de desenho (os pedaços se revezam entre elas, como chunks diferentes no jogo)
const DRAW_MESHES: u32 = 64;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth24Plus;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct CamU {
    view_proj: [[f32; 4]; 4],
    light: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct OverlayV {
    pos: [f32; 2],
    col: [u8; 4],
}

struct Mesh {
    vb: wgpu::Buffer,
    ib: wgpu::Buffer,
    count: u32,
}

impl Mesh {
    fn new(device: &wgpu::Device, cubes: u32, variant: u32) -> Self {
        let (v, i) = scene::cubes(cubes, variant);
        Self {
            vb: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("vb"),
                contents: bytemuck::cast_slice(&v),
                usage: wgpu::BufferUsages::VERTEX,
            }),
            ib: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("ib"),
                contents: bytemuck::cast_slice(&i),
                usage: wgpu::BufferUsages::INDEX,
            }),
            count: i.len() as u32,
        }
    }
}

pub struct Gfx {
    pub window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    depth: wgpu::TextureView,
    scene_pipe: wgpu::RenderPipeline,
    overlay_pipe: wgpu::RenderPipeline,
    cam_buf: wgpu::Buffer,
    cam_bg: wgpu::BindGroup,
    obj_buf: wgpu::Buffer,
    obj_bg: wgpu::BindGroup,
    stride: u32,
    draw_meshes: Vec<Mesh>,
    tris_mesh: Option<(u32, Mesh)>,
    draws: u32,
    cubes: u32,
    overlay_buf: wgpu::Buffer,
    overlay_len: u32,
    /// "Vulkan", "Gl", "WebGL2"… (para a tela dizer o que está medindo)
    pub backend: String,
}

const OVERLAY_MAX_QUADS: u64 = 12_000;

impl Gfx {
    pub async fn new(window: Arc<Window>, display: Box<dyn wgpu::wgt::WgpuHasDisplayHandle>) -> Gfx {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = if cfg!(target_arch = "wasm32") { wgpu::Backends::GL } else { wgpu::Backends::VULKAN | wgpu::Backends::GL };
        let instance = wgpu::Instance::new(desc.with_display_handle(display));
        let size = window.inner_size();
        let surface = instance.create_surface(window.clone()).expect("superfície");
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            })
            .await
            .expect("sem placa de vídeo compatível");
        let info = adapter.get_info();
        let backend = format!("{:?}", info.backend);
        log::info!("adaptador: {} ({:?})", info.name, info.backend);
        let limits = wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits());
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor { label: Some("bench"), required_limits: limits.clone(), ..Default::default() })
            .await
            .expect("dispositivo");
        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().copied().find(|f| f.is_srgb()).unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            // sincronizado com a tela, como o navegador
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            color_space: Default::default(),
        };
        surface.configure(&device, &config);
        let depth = Self::depth_view(&device, &config);

        let stride = limits.min_uniform_buffer_offset_alignment.max(16);
        let cam_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("cam"),
            size: std::mem::size_of::<CamU>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let obj_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("obj"),
            size: stride as u64 * DRAW_MAX as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let cam_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("cam"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                count: None,
            }],
        });
        let obj_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("obj"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true,
                    min_binding_size: wgpu::BufferSize::new(16),
                },
                count: None,
            }],
        });
        let cam_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("cam"),
            layout: &cam_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: cam_buf.as_entire_binding() }],
        });
        let obj_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("obj"),
            layout: &obj_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &obj_buf, offset: 0, size: wgpu::BufferSize::new(16) }),
            }],
        });

        let scene_shader = device.create_shader_module(wgpu::include_wgsl!("scene.wgsl"));
        let overlay_shader = device.create_shader_module(wgpu::include_wgsl!("overlay.wgsl"));
        let depth_state = |write: bool, cmp: wgpu::CompareFunction| wgpu::DepthStencilState {
            format: DEPTH,
            depth_write_enabled: Some(write),
            depth_compare: Some(cmp),
            stencil: Default::default(),
            bias: Default::default(),
        };
        let scene_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene"),
            bind_group_layouts: &[Some(&cam_layout), Some(&obj_layout)],
            ..Default::default()
        });
        let scene_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("scene"),
            layout: Some(&scene_layout),
            vertex: wgpu::VertexState {
                module: &scene_shader,
                entry_point: Some("vs"),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Snorm8x4],
                })],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &scene_shader,
                entry_point: Some("fs"),
                targets: &[Some(format.into())],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState { cull_mode: Some(wgpu::Face::Back), ..Default::default() },
            depth_stencil: Some(depth_state(true, wgpu::CompareFunction::Less)),
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let overlay_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("overlay"), ..Default::default() });
        let overlay_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("overlay"),
            layout: Some(&overlay_layout),
            vertex: wgpu::VertexState {
                module: &overlay_shader,
                entry_point: Some("vs"),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<OverlayV>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Unorm8x4],
                })],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &overlay_shader,
                entry_point: Some("fs"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: Some(depth_state(false, wgpu::CompareFunction::Always)),
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let overlay_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("overlay"),
            size: OVERLAY_MAX_QUADS * 6 * std::mem::size_of::<OverlayV>() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let draw_meshes = (0..DRAW_MESHES).map(|v| Mesh::new(&device, DRAW_CUBES, v)).collect();
        Gfx {
            window,
            surface,
            device,
            queue,
            config,
            depth,
            scene_pipe,
            overlay_pipe,
            cam_buf,
            cam_bg,
            obj_buf,
            obj_bg,
            stride,
            draw_meshes,
            tris_mesh: None,
            draws: 0,
            cubes: 0,
            overlay_buf,
            overlay_len: 0,
            backend,
        }
    }

    fn depth_view(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) -> wgpu::TextureView {
        device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("depth"),
                size: wgpu::Extent3d { width: config.width, height: config.height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: DEPTH,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
            .create_view(&Default::default())
    }

    pub fn size(&self) -> (u32, u32) {
        (self.config.width, self.config.height)
    }

    pub fn resize(&mut self, w: u32, h: u32) {
        if w == 0 || h == 0 {
            return;
        }
        self.config.width = w;
        self.config.height = h;
        self.surface.configure(&self.device, &self.config);
        self.depth = Self::depth_view(&self.device, &self.config);
    }

    /// troca a carga: `draws` chamadas de desenho de `cubes` cubos cada
    pub fn set_load(&mut self, draws: u32, cubes: u32) {
        self.draws = draws.min(DRAW_MAX);
        self.cubes = cubes;
        if draws == 0 {
            return;
        }
        // posições dos pedaços (uma uniform por pedaço, no passo de alinhamento do aparelho)
        let mut data = vec![0u8; (self.stride * self.draws) as usize];
        for i in 0..self.draws {
            let p = scene::chunk_pos(i, self.draws);
            let at = (i * self.stride) as usize;
            data[at..at + 16].copy_from_slice(bytemuck::cast_slice(&[p[0], p[1], p[2], 1.0f32]));
        }
        self.queue.write_buffer(&self.obj_buf, 0, &data);
        if cubes != DRAW_CUBES && self.tris_mesh.as_ref().map(|m| m.0) != Some(cubes) {
            self.tris_mesh = None; // solta a malha anterior antes de criar a maior
            self.tris_mesh = Some((cubes, Mesh::new(&self.device, cubes, 0)));
        }
    }

    /// escreve as linhas de texto (pontos em pixels, cores RGBA)
    pub fn set_text(&mut self, lines: &[(String, [u8; 4])], px: f32) {
        let (w, h) = (self.config.width as f32, self.config.height as f32);
        let mut quads: Vec<[f32; 3]> = Vec::new();
        let mut verts: Vec<OverlayV> = Vec::new();
        // fundo escuro atrás do texto
        let rows = lines.len() as f32;
        let longest = lines.iter().map(|l| l.0.len()).max().unwrap_or(0) as f32;
        let bg = [12.0 * px, 12.0 * px, (longest * 6.0 + 4.0) * px, (rows * 10.0 + 2.0) * px];
        let to_ndc = |x: f32, y: f32| [x / w * 2.0 - 1.0, 1.0 - y / h * 2.0];
        let quad = |verts: &mut Vec<OverlayV>, x: f32, y: f32, qw: f32, qh: f32, col: [u8; 4]| {
            let (a, b, c, d) = (to_ndc(x, y), to_ndc(x + qw, y), to_ndc(x + qw, y + qh), to_ndc(x, y + qh));
            for p in [a, b, c, a, c, d] {
                verts.push(OverlayV { pos: p, col });
            }
        };
        quad(&mut verts, bg[0], bg[1], bg[2], bg[3], [0, 0, 0, 170]);
        for (row, (text, col)) in lines.iter().enumerate() {
            quads.clear();
            crate::font::layout(text, 14.0 * px, 13.0 * px + row as f32 * 10.0 * px, px, &mut quads);
            for q in &quads {
                quad(&mut verts, q[0], q[1], q[2], q[2], *col);
            }
        }
        let max = (OVERLAY_MAX_QUADS * 6) as usize;
        verts.truncate(max);
        self.overlay_len = verts.len() as u32;
        self.queue.write_buffer(&self.overlay_buf, 0, bytemuck::cast_slice(&verts));
    }

    /// desenha um quadro; `t` = segundos desde o começo (a câmera gira)
    pub fn render(&mut self, t: f32) {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                return;
            }
            _ => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let aspect = self.config.width as f32 / self.config.height as f32;
        let vp = scene::view_proj(t, self.draws.max(1), aspect);
        // luz do sol: (-0,5; 0,8; 0,3) normalizado
        let l = [-0.5f32, 0.8, 0.3];
        let k = 1.0 / (l[0] * l[0] + l[1] * l[1] + l[2] * l[2]).sqrt();
        self.queue.write_buffer(&self.cam_buf, 0, bytemuck::bytes_of(&CamU { view_proj: vp, light: [l[0] * k, l[1] * k, l[2] * k, 0.0] }));
        let mut enc = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("frame"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.02, g: 0.02, b: 0.05, a: 1.0 }), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            if self.draws > 0 {
                pass.set_pipeline(&self.scene_pipe);
                pass.set_bind_group(0, &self.cam_bg, &[]);
                let tris = if self.cubes != DRAW_CUBES { self.tris_mesh.as_ref().map(|m| &m.1) } else { None };
                for i in 0..self.draws {
                    let mesh = tris.unwrap_or(&self.draw_meshes[(i % DRAW_MESHES) as usize]);
                    pass.set_bind_group(1, &self.obj_bg, &[i * self.stride]);
                    pass.set_vertex_buffer(0, mesh.vb.slice(..));
                    pass.set_index_buffer(mesh.ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..mesh.count, 0, 0..1);
                }
            }
            if self.overlay_len > 0 {
                pass.set_pipeline(&self.overlay_pipe);
                pass.set_vertex_buffer(0, self.overlay_buf.slice(..));
                pass.draw(0..self.overlay_len, 0..1);
            }
        }
        self.queue.submit([enc.finish()]);
        self.window.pre_present_notify();
        self.queue.present(frame);
    }
}
