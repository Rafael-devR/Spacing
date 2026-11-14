//! Spacing nativo (docs/design/PORTE_RUST.md): o jogo em Rust no Android (NativeActivity, Vulkan) e no computador.
//! Este arquivo cuida da janela e do ciclo de vida; o jogo está em `game.rs`, os controles em `controls.rs`, o HUD em `hud.rs`.
#[cfg(not(target_os = "android"))]
pub mod capture;
pub mod controls;
pub mod game;
pub mod hud;

use std::sync::Arc;
use std::time::Instant;

use spacing_core::planet::{planet, PlanetId};
use spacing_render::{FrameStats, Renderer, Ui};
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseScrollDelta, TouchPhase, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowId};

use controls::Controls;
use game::{Game, Models};

/// semente fixa do M2: a mesma do jogo web aberto com `?semente=12345`, para comparar a mesma cena
pub const DEFAULT_SEED: u32 = 12345;

pub struct Options {
    pub planet: PlanetId,
    pub seed: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self { planet: PlanetId::Lua, seed: DEFAULT_SEED }
    }
}

struct App {
    opts: Options,
    window: Option<Arc<Window>>,
    renderer: Option<Renderer>,
    models: Option<Models>,
    game: Option<Game>,
    controls: Controls,
    egui: egui::Context,
    meter: hud::Meter,
    stats: FrameStats,
    show_stats: bool,
    last: Option<Instant>,
    cursor: (f32, f32),
    /// por que o desenho não subiu (fica no log; a tela só mostra preto)
    failed: Option<String>,
}

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_sub(1).clamp(1, 3)
}

impl App {
    fn new(opts: Options) -> Self {
        Self {
            opts,
            window: None,
            renderer: None,
            models: None,
            game: None,
            controls: Controls::default(),
            egui: egui::Context::default(),
            meter: hud::Meter::default(),
            stats: FrameStats::default(),
            show_stats: true,
            last: None,
            cursor: (0.0, 0.0),
            failed: None,
        }
    }

    fn create_renderer(&mut self, event_loop: &ActiveEventLoop) {
        let Some(window) = self.window.clone() else { return };
        let size = window.inner_size();
        let display: Box<dyn wgpu::wgt::WgpuHasDisplayHandle> = Box::new(event_loop.owned_display_handle());
        let p = planet(self.opts.planet);
        match pollster::block_on(Renderer::new(window.clone().into(), display, size.width, size.height, p)) {
            Ok(mut r) => {
                self.models = Some(Models::load(&mut r));
                if let Some(g) = &mut self.game {
                    // superfície nova (o app voltou do fundo): refaz todas as malhas
                    g.world.remesh_all();
                }
                self.renderer = Some(r);
                self.layout();
                self.last = None;
                window.request_redraw();
            }
            Err(e) => {
                log::error!("não deu para iniciar o desenho: {e}");
                self.failed = Some(e);
            }
        }
    }

    fn layout(&mut self) {
        if let Some(w) = &self.window {
            let s = w.inner_size();
            let ppp = w.scale_factor() as f32;
            self.egui.set_pixels_per_point(ppp);
            self.controls.layout(s.width as f32, s.height as f32, ppp);
        }
    }

    fn switch_planet(&mut self) {
        self.opts.planet = match self.opts.planet {
            PlanetId::Lua => PlanetId::Marte,
            PlanetId::Marte => PlanetId::Lua,
        };
        // a luz e o céu mudam com o planeta: refaz o desenho e o mundo
        self.game = None;
        self.renderer = None;
        self.models = None;
    }

    fn frame(&mut self, event_loop: &ActiveEventLoop) {
        if self.controls.actions.switch_planet {
            self.controls.actions.switch_planet = false;
            self.switch_planet();
            self.create_renderer(event_loop);
        }
        if self.controls.actions.toggle_stats {
            self.controls.actions.toggle_stats = false;
            self.show_stats = !self.show_stats;
        }
        let now = Instant::now();
        let dt = self.last.map(|l| (now - l).as_secs_f64()).unwrap_or(1.0 / 60.0);
        self.last = Some(now);
        self.meter.frame(dt);
        let (Some(r), Some(window)) = (self.renderer.as_mut(), self.window.clone()) else { return };
        if self.game.is_none() {
            self.game = Some(Game::new(self.opts.planet, self.opts.seed, threads()));
        }
        let game = self.game.as_mut().unwrap();
        game.update(dt, &mut self.controls);
        game.sync(r);
        let size = r.size();
        let aspect = size.0 as f64 / size.1.max(1) as f64;

        // interface
        let ppp = window.scale_factor() as f32;
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(size.0 as f32 / ppp, size.1 as f32 / ppp))),
            ..Default::default()
        };
        let info = hud::HudInfo {
            meter: &self.meter,
            stats: self.stats,
            backend: &r.backend,
            size,
            msaa: r.msaa(),
            planet: planet(game.planet).name,
            seed: game.seed,
            pos: game.player.pos,
            chunks: game.world.chunk_count(),
            show_stats: self.show_stats,
        };
        let controls = &self.controls;
        let out = self.egui.run_ui(raw, |ui| hud::draw(ui.ctx(), controls, &info));
        let prims = self.egui.tessellate(out.shapes, out.pixels_per_point);
        let models = self.models.as_ref().unwrap();
        let frame = game.frame(models, aspect);
        if let Some(s) = r.render(&frame, Some(Ui { primitives: &prims, textures: &out.textures_delta, pixels_per_point: out.pixels_per_point })) {
            self.stats = s;
        }
        window.request_redraw();
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            let attrs = Window::default_attributes().with_title("Spacing (nativo)").with_inner_size(winit::dpi::LogicalSize::new(1280.0, 720.0));
            match event_loop.create_window(attrs) {
                Ok(w) => self.window = Some(Arc::new(w)),
                Err(e) => {
                    log::error!("janela: {e}");
                    event_loop.exit();
                    return;
                }
            }
        }
        if self.renderer.is_none() {
            self.create_renderer(event_loop);
        }
    }

    fn suspended(&mut self, _event_loop: &ActiveEventLoop) {
        // o Android derruba a superfície quando o app vai para o fundo; o jogo continua na memória
        self.renderer = None;
        self.models = None;
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let w = self.renderer.as_ref().map(|r| r.size().0 as f32).unwrap_or(1.0);
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(s) => {
                if let Some(r) = &mut self.renderer {
                    r.resize(s.width, s.height);
                }
                self.layout();
            }
            WindowEvent::ScaleFactorChanged { .. } => self.layout(),
            WindowEvent::RedrawRequested => self.frame(event_loop),
            WindowEvent::Touch(t) => {
                let (x, y) = (t.location.x as f32, t.location.y as f32);
                match t.phase {
                    TouchPhase::Started => self.controls.touch_start(t.id, x, y, w),
                    TouchPhase::Moved => self.controls.touch_move(t.id, x, y),
                    TouchPhase::Ended | TouchPhase::Cancelled => self.controls.touch_end(t.id),
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let down = event.state == ElementState::Pressed;
                let name = match &event.logical_key {
                    Key::Character(c) => c.to_string(),
                    Key::Named(NamedKey::Space) => " ".into(),
                    Key::Named(NamedKey::ArrowUp) => "arrowup".into(),
                    Key::Named(NamedKey::ArrowDown) => "arrowdown".into(),
                    Key::Named(NamedKey::ArrowLeft) => "arrowleft".into(),
                    Key::Named(NamedKey::ArrowRight) => "arrowright".into(),
                    Key::Named(NamedKey::Tab) => "tab".into(),
                    Key::Named(NamedKey::F3) => "f3".into(),
                    Key::Named(NamedKey::Escape) if down => {
                        event_loop.exit();
                        return;
                    }
                    _ => return,
                };
                self.controls.key(&name, down);
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let lines = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y as f64,
                    MouseScrollDelta::PixelDelta(p) => p.y / 40.0,
                };
                self.controls.wheel(lines);
            }
            // o mouse vale como um dedo (para testar os botões no computador)
            WindowEvent::CursorMoved { position, .. } => {
                self.cursor = (position.x as f32, position.y as f32);
                self.controls.touch_move(u64::MAX, self.cursor.0, self.cursor.1);
            }
            WindowEvent::MouseInput { state, .. } => {
                if state == ElementState::Pressed {
                    self.controls.touch_start(u64::MAX, self.cursor.0, self.cursor.1, w);
                    self.controls.touched = true;
                } else {
                    self.controls.touch_end(u64::MAX);
                }
            }
            _ => {}
        }
    }
}

pub fn run(event_loop: EventLoop<()>, opts: Options) {
    let mut app = App::new(opts);
    if let Err(e) = event_loop.run_app(&mut app) {
        log::error!("laço: {e}");
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
fn android_main(app: winit::platform::android::activity::AndroidApp) {
    use winit::platform::android::EventLoopBuilderExtAndroid;
    android_logger::init_once(android_logger::Config::default().with_max_level(log::LevelFilter::Info).with_tag("spacing"));
    // um panic vira linha no logcat (`adb logcat -s spacing`) em vez de o app fechar sem dizer nada
    std::panic::set_hook(Box::new(|info| log::error!("PANIC: {info}")));
    log::info!("Spacing nativo iniciando");
    let event_loop = EventLoop::builder().with_android_app(app).build().expect("laço");
    run(event_loop, Options::default());
}

/// Computador: `spacing [lua|marte] [semente]`.
#[cfg(not(target_os = "android"))]
pub fn run_desktop() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    let mut opts = Options::default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let capture = args.iter().position(|a| a == "--captura").and_then(|i| args.get(i + 1).cloned());
    for a in &args {
        if let Some(p) = PlanetId::parse(a) {
            opts.planet = p;
        } else if let Ok(s) = a.parse() {
            opts.seed = s;
        }
    }
    if let Some(dir) = capture {
        capture::run(&dir, opts);
        return;
    }
    let event_loop = EventLoop::new().expect("laço");
    run(event_loop, opts);
}
