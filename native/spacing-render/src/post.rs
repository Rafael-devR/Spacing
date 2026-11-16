//! Pós-processamento (porte de `src/render/post.ts`): a cena em HDR passa pelo bloom (cadeia de meia, um quarto... da
//! resolução) e por uma passada final com tons, correção de cor, aberração, vinheta e ruído.
use bytemuck::{Pod, Zeroable};

pub const HDR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// faixas do bloom (cada uma com metade do tamanho da anterior, a primeira já na metade da tela)
const MIPS: usize = 5;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Default)]
pub struct PostU {
    pub res: [f32; 4],
    pub fx: [f32; 4],
    pub screen: [f32; 4],
    pub bloom: [f32; 4],
    /// x = quantas ondas de choque
    pub shock_n: [f32; 4],
    pub shock_a: [[f32; 4]; 4],
    pub shock_b: [[f32; 4]; 4],
}

/// Efeitos ligados (as mesmas chaves das configurações gráficas do jogo web)
#[derive(Clone, Copy, Debug)]
pub struct PostSettings {
    pub bloom: bool,
    pub chromatic: bool,
    pub vignette: bool,
    pub noise: bool,
}

impl Default for PostSettings {
    fn default() -> Self {
        Self { bloom: true, chromatic: true, vignette: true, noise: true }
    }
}

/// efeitos de tela da sobrevivência e dos impactos (0 a 1)
#[derive(Clone, Copy, Debug, Default)]
pub struct ScreenFx {
    pub desat: f32,
    pub hurt: f32,
    pub dark: f32,
    pub flash: f32,
}

struct Step {
    bind: wgpu::BindGroup,
    buf: wgpu::Buffer,
}

pub struct Post {
    chain_layout: wgpu::BindGroupLayout,
    grade_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    bright: wgpu::RenderPipeline,
    down: wgpu::RenderPipeline,
    up: wgpu::RenderPipeline,
    grade: wgpu::RenderPipeline,
    mips: Vec<(wgpu::TextureView, u32, u32)>,
    /// passadas da cadeia: 1 clara, MIPS-1 descidas, MIPS-1 subidas
    steps: Vec<Step>,
    grade_step: Option<Step>,
    pub settings: PostSettings,
}

fn uniform(device: &wgpu::Device) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("pós"),
        size: std::mem::size_of::<PostU>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

impl Post {
    pub fn new(device: &wgpu::Device, out_format: wgpu::TextureFormat) -> Self {
        let tex_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
            count: None,
        };
        let base = [
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                count: None,
            },
            tex_entry(1),
            wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
        ];
        let chain_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("bloom"), entries: &base });
        let mut all = base.to_vec();
        all.push(tex_entry(3));
        let grade_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("final"), entries: &all });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("pós"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let sh = device.create_shader_module(wgpu::include_wgsl!("shaders/post.wgsl"));
        let pipe = |layout: &wgpu::BindGroupLayout, entry: &str, format: wgpu::TextureFormat, additive: bool| {
            let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some(entry), bind_group_layouts: &[Some(layout)], ..Default::default() });
            let blend = additive.then_some(wgpu::BlendState {
                color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
                alpha: wgpu::BlendComponent::OVER,
            });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&pl),
                vertex: wgpu::VertexState { module: &sh, entry_point: Some("vs"), buffers: &[], compilation_options: Default::default() },
                fragment: Some(wgpu::FragmentState {
                    module: &sh,
                    entry_point: Some(entry),
                    targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                    compilation_options: Default::default(),
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        Self {
            bright: pipe(&chain_layout, "bright", HDR, false),
            down: pipe(&chain_layout, "down", HDR, false),
            up: pipe(&chain_layout, "up", HDR, true),
            grade: pipe(&grade_layout, "grade", out_format, false),
            chain_layout,
            grade_layout,
            sampler,
            mips: Vec::new(),
            steps: Vec::new(),
            grade_step: None,
            settings: PostSettings::default(),
        }
    }

    /// Refaz as texturas do bloom e os grupos de ligação para o tamanho da tela; `hdr` é a cena resolvida.
    pub fn resize(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, hdr: &wgpu::TextureView, w: u32, h: u32) {
        self.mips.clear();
        let (mut mw, mut mh) = ((w / 2).max(1), (h / 2).max(1));
        for _ in 0..MIPS {
            let t = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("bloom"),
                size: wgpu::Extent3d { width: mw, height: mh, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: HDR,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            self.mips.push((t.create_view(&Default::default()), mw, mh));
            mw = (mw / 2).max(1);
            mh = (mh / 2).max(1);
        }
        let step = |src: &wgpu::TextureView, sw: u32, sh: u32| {
            let buf = uniform(device);
            // força 0,42 e limite 1,0: os números do BloomOnlyPass do jogo web
            let u = PostU { bloom: [0.42, 1.0, 1.0 / sw as f32, 1.0 / sh as f32], ..Default::default() };
            queue.write_buffer(&buf, 0, bytemuck::bytes_of(&u));
            let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("bloom"),
                layout: &self.chain_layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(src) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                ],
            });
            Step { bind, buf }
        };
        let mut steps = vec![step(hdr, w, h)];
        for i in 0..MIPS - 1 {
            let (v, sw, sh) = &self.mips[i];
            steps.push(step(v, *sw, *sh));
        }
        for i in (0..MIPS - 1).rev() {
            let (v, sw, sh) = &self.mips[i + 1];
            steps.push(step(v, *sw, *sh));
        }
        self.steps = steps;
        let buf = uniform(device);
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("final"),
            layout: &self.grade_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(hdr) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&self.mips[0].0) },
            ],
        });
        self.grade_step = Some(Step { bind, buf });
    }

    fn pass(enc: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, load: wgpu::LoadOp<wgpu::Color>, pipe: &wgpu::RenderPipeline, bind: &wgpu::BindGroup) {
        let mut p = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("pós"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load, store: wgpu::StoreOp::Store },
            })],
            ..Default::default()
        });
        p.set_pipeline(pipe);
        p.set_bind_group(0, bind, &[]);
        p.draw(0..3, 0..1);
    }

    /// Grava o bloom e prepara a passada final (que `final_pass` abre). Devolve quantas passadas de tela serão feitas.
    pub fn run(&self, enc: &mut wgpu::CommandEncoder, queue: &wgpu::Queue, (w, h): (u32, u32), time: f32, screen: ScreenFx, shocks: &[([f32; 4], [f32; 4])]) -> u32 {
        let s = self.settings;
        let Some(g) = &self.grade_step else { return 0 };
        let flag = |b: bool| if b { 1.0 } else { 0.0 };
        let u = PostU {
            res: [w as f32, h as f32, time, 1.08],
            fx: [flag(s.bloom), flag(s.chromatic), flag(s.vignette), flag(s.noise)],
            screen: [screen.desat, screen.hurt, screen.dark, screen.flash],
            bloom: [0.42, 1.0, 0.0, 0.0],
            ..Default::default()
        };
        let mut u = u;
        let n = shocks.len().min(4);
        u.shock_n[0] = n as f32;
        for (i, (a, b)) in shocks.iter().take(4).enumerate() {
            u.shock_a[i] = *a;
            u.shock_b[i] = *b;
        }
        queue.write_buffer(&g.buf, 0, bytemuck::bytes_of(&u));
        let mut passes = 1;
        if s.bloom && self.steps.len() == 2 * MIPS - 1 {
            let clear = wgpu::LoadOp::Clear(wgpu::Color::BLACK);
            Self::pass(enc, &self.mips[0].0, clear, &self.bright, &self.steps[0].bind);
            for i in 0..MIPS - 1 {
                Self::pass(enc, &self.mips[i + 1].0, clear, &self.down, &self.steps[1 + i].bind);
            }
            for (k, i) in (0..MIPS - 1).rev().enumerate() {
                Self::pass(enc, &self.mips[i].0, wgpu::LoadOp::Load, &self.up, &self.steps[MIPS + k].bind);
            }
            passes += 2 * MIPS as u32 - 1;
        }
        passes
    }

    /// Abre a passada final em `out` (a tela), já com a imagem desenhada; quem chama pode desenhar por cima (a
    /// interface) antes de soltá-la.
    pub fn final_pass(&self, enc: &mut wgpu::CommandEncoder, out: &wgpu::TextureView) -> wgpu::RenderPass<'static> {
        let mut p = enc
            .begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("final"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: out,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                ..Default::default()
            })
            .forget_lifetime();
        if let Some(g) = &self.grade_step {
            p.set_pipeline(&self.grade);
            p.set_bind_group(0, &g.bind, &[]);
            p.draw(0..3, 0..1);
        }
        p
    }

    /// para os testes saberem que os buffers existem
    pub fn ready(&self) -> bool {
        self.grade_step.is_some() && self.steps.iter().all(|s| s.buf.size() > 0)
    }
}
