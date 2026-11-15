//! Spacing nativo (docs/design/PORTE_RUST.md): o jogo em Rust no Android (NativeActivity, Vulkan) e no computador.
//! Este arquivo cuida da janela e do ciclo de vida; o jogo está em `game.rs`, os controles em `controls.rs`, o HUD em `hud.rs`.
pub mod base;
#[cfg(not(target_os = "android"))]
pub mod capture;
pub mod controls;
pub mod effects;
pub mod game;
pub mod greenhouse;
pub mod hud;
pub mod icons;
pub mod map;
#[cfg(not(target_os = "android"))]
pub mod roteiro;
pub mod storage;

use std::sync::Arc;
use std::time::Instant;

use spacing_core::planet::{planet, PlanetId};
use spacing_core::scaler::ResolutionScaler;
use spacing_render::{FrameStats, Renderer, Ui};
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseScrollDelta, TouchPhase, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowId};

use controls::Controls;
use game::{Game, Models};

/// semente das capturas de teste: a mesma do jogo web aberto com `?semente=12345`, para comparar a mesma cena
pub const DEFAULT_SEED: u32 = 12345;
/// de quanto em quanto tempo o jogo grava sozinho (AUTOSAVE_MS do jogo web)
const AUTOSAVE_SECONDS: f64 = 5.0;

#[derive(Default)]
pub struct Options {
    pub planet: PlanetId,
    /// semente de um jogo novo; None = sorteada (o salvamento guarda a dele)
    pub seed: Option<u32>,
    /// pasta do salvamento; None = não grava
    pub save_dir: Option<std::path::PathBuf>,
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
    vsync: bool,
    bench: Option<effects::EffectBench>,
    /// resolução dinâmica (só fora do teste de efeitos)
    scaler: ResolutionScaler,
    /// escala da cena antes da dinâmica: densidade 2 como a qualidade Alta do jogo web (devicePixelRatio até 2)
    base_scale: f32,
    /// quanto da CPU o quadro anterior gastou (a dinâmica só baixa a resolução quando o atraso é da GPU)
    cpu_ms: f64,
    last: Option<Instant>,
    cursor: (f32, f32),
    /// toques e cliques para o egui (as telas com botões)
    egui_events: Vec<egui::Event>,
    /// por que o desenho não subiu (fica no log; a tela só mostra preto)
    failed: Option<String>,
    store: storage::Store,
    save_t: f64,
    /// a hora (ms) do último salvamento que deu certo
    saved_at: Option<f64>,
}

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_sub(1).clamp(1, 3)
}

impl App {
    fn new(opts: Options) -> Self {
        Self {
            store: storage::Store::new(opts.save_dir.clone()),
            save_t: 0.0,
            saved_at: None,
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
            vsync: false,
            bench: None,
            scaler: ResolutionScaler::default(),
            base_scale: 1.0,
            cpu_ms: 0.0,
            last: None,
            cursor: (0.0, 0.0),
            egui_events: Vec::new(),
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
                let _ = icons::Icons::ensure(&r, &self.egui);
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
            self.base_scale = (2.0 / ppp).min(1.0);
            self.scaler.reset();
            if let Some(r) = &mut self.renderer {
                r.set_scale(self.base_scale);
            }
        }
    }

    /// um dedo ou o mouse para o egui: mover, e apertar (Some(true)) ou soltar (Some(false))
    fn pointer_event(&mut self, x: f32, y: f32, press: Option<bool>) {
        let ppp = self.window.as_ref().map_or(1.0, |w| w.scale_factor() as f32);
        let pos = egui::pos2(x / ppp, y / ppp);
        self.egui_events.push(egui::Event::PointerMoved(pos));
        if let Some(pressed) = press {
            self.egui_events.push(egui::Event::PointerButton { pos, button: egui::PointerButton::Primary, pressed, modifiers: Default::default() });
            if !pressed && cfg!(target_os = "android") {
                self.egui_events.push(egui::Event::PointerGone);
            }
        }
    }

    /// O jogo do planeta: o salvamento (o gerador mudou? o mundo é refeito, o progresso fica) ou um jogo novo.
    fn start_game(&mut self) -> Game {
        let p = self.opts.planet;
        let fresh = self.opts.seed.unwrap_or_else(storage::fresh_seed);
        let mut save = self.store.load(p, fresh);
        let mut renewed = false;
        if let Some(s) = &save {
            if s.world_gen != game::world_gen(p) {
                save = Some(spacing_core::save::renew_world(s, fresh as f64, game::world_gen(p)));
                renewed = true;
            }
        }
        log::info!("{}: {}", planet(p).name, if save.is_some() { "salvamento carregado" } else { "jogo novo" });
        let mut g = Game::load(p, save.as_ref(), fresh, threads());
        if renewed {
            g.toast("O mundo foi gerado de novo. Seus itens e equipamentos continuam com você.");
        }
        g
    }

    /// grava o jogo (Game.persist); não grava no meio de uma cena nem morto
    fn persist(&mut self) -> bool {
        let Some(g) = &self.game else { return false };
        if !g.can_save() {
            return false;
        }
        let ok = self.store.write(g.planet, &g.to_save());
        if ok {
            self.saved_at = Some(storage::now_ms());
        }
        ok
    }

    fn switch_planet(&mut self) {
        self.persist();
        self.opts.planet = match self.opts.planet {
            PlanetId::Lua => PlanetId::Marte,
            PlanetId::Marte => PlanetId::Lua,
        };
        // o desenho fica (a superfície não pode ser recriada no Android): só a luz e o céu mudam; o mundo é refeito
        self.game = None;
        if let Some(r) = &mut self.renderer {
            r.set_planet(planet(self.opts.planet));
        }
    }

    fn frame(&mut self, _event_loop: &ActiveEventLoop) {
        if self.controls.actions.switch_planet {
            self.controls.actions.switch_planet = false;
            self.switch_planet();
        }
        if self.controls.actions.toggle_vsync {
            self.controls.actions.toggle_vsync = false;
            self.vsync = !self.vsync;
            if let Some(r) = &mut self.renderer {
                r.set_vsync(self.vsync);
            }
        }
        if self.controls.actions.bench {
            self.controls.actions.bench = false;
            // de novo apaga o resultado; parado, começa a medir
            self.bench = match (&self.bench, self.renderer.as_mut()) {
                (Some(b), _) if b.done => None,
                (None, Some(r)) => Some(effects::EffectBench::new(r)),
                _ => None,
            };
            self.show_stats = true;
        }
        if self.controls.actions.toggle_stats {
            self.controls.actions.toggle_stats = false;
            self.show_stats = !self.show_stats;
        }
        let now = Instant::now();
        let dt = self.last.map(|l| (now - l).as_secs_f64()).unwrap_or(1.0 / 60.0);
        self.last = Some(now);
        self.meter.frame(dt);
        if let (Some(b), Some(r)) = (self.bench.as_mut(), self.renderer.as_mut()) {
            if b.frame(dt, r) {
                // acabou: a resolução volta à de antes
                r.set_scale(self.base_scale * self.scaler.scale() as f32);
            }
        } else if let Some(r) = self.renderer.as_mut() {
            // alvo de 60 quadros, como o jogo web sem limite escolhido
            if let Some(s) = self.scaler.frame(dt * 1000.0, self.cpu_ms, 1000.0 / 60.0) {
                r.set_scale(self.base_scale * s as f32);
            }
        }
        if self.renderer.is_none() || self.window.is_none() {
            return;
        }
        if self.game.is_none() {
            self.game = Some(self.start_game());
        }
        self.save_t += dt;
        if self.save_t >= AUTOSAVE_SECONDS {
            self.save_t = 0.0;
            self.persist();
        }
        let (Some(r), Some(window)) = (self.renderer.as_mut(), self.window.clone()) else { return };
        let game = self.game.as_mut().unwrap();
        self.controls.use_visible = game.base.use_label.is_some();
        self.controls.modal = game.screen_open.is_some();
        // menu aberto: o jogo para (como a pausa do jogo web)
        let paused = game.screen_open == Some(game::Screen::Menu);
        game.update(if paused { 0.0 } else { dt }, &mut self.controls);
        game.sync(r);
        let size = r.size();
        let aspect = size.0 as f64 / size.1.max(1) as f64;

        // interface
        let ppp = window.scale_factor() as f32;
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(size.0 as f32 / ppp, size.1 as f32 / ppp))),
            events: std::mem::take(&mut self.egui_events),
            ..Default::default()
        };
        let info = hud::HudInfo {
            meter: &self.meter,
            stats: self.stats,
            backend: &r.backend,
            size,
            scene: r.scene_size(),
            msaa: r.msaa(),
            present: r.present_mode(),
            planet: planet(game.planet).name,
            seed: game.seed,
            pos: game.player.pos,
            chunks: game.world.chunk_count(),
            show_stats: self.show_stats,
            bench: match &self.bench {
                Some(b) if b.done => {
                    let mut r = b.report();
                    if self.vsync {
                        r.push("(vsync ligado: o tempo é o da tela; desligue com V e repita)".into());
                    }
                    r
                }
                Some(b) => vec![b.running_label(), "fique parado: o tempo do quadro é medido sem cada efeito".into()],
                None => Vec::new(),
            },
            saved_ago: self.saved_at.map(|t| ((storage::now_ms() - t) / 1000.0).max(0.0)),
            save_path: self.store.path(game.planet).map(|p| p.display().to_string()),
            game,
        };
        let controls = &self.controls;
        let mut actions = Vec::new();
        let out = self.egui.run_ui(raw, |ui| actions = hud::draw(ui.ctx(), controls, &info));
        let prims = self.egui.tessellate(out.shapes, out.pixels_per_point);
        let mut app_actions = Vec::new();
        for a in actions {
            match a {
                hud::UiAction::Save | hud::UiAction::NewGame => app_actions.push(a),
                a => game.ui_action(a),
            }
        }
        let models = self.models.as_ref().unwrap();
        let frame = game.frame(models, aspect);
        if let Some(s) = r.render(&frame, Some(Ui { primitives: &prims, textures: &out.textures_delta, pixels_per_point: out.pixels_per_point })) {
            self.stats = s;
        }
        self.cpu_ms = now.elapsed().as_secs_f64() * 1000.0;
        for a in app_actions {
            match a {
                hud::UiAction::Save => {
                    let ok = self.persist();
                    if let Some(g) = &mut self.game {
                        g.toast(if ok { "Jogo salvo" } else { "Não deu para salvar agora" });
                    }
                }
                hud::UiAction::NewGame => {
                    // o salvamento deste planeta sai; o jogo novo tem semente sorteada
                    self.store.clear(self.opts.planet);
                    self.saved_at = None;
                    self.game = Some(self.start_game());
                    if let Some(r) = &mut self.renderer {
                        r.clear_chunks();
                    }
                }
                _ => {}
            }
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
        // o Android derruba a superfície quando o app vai para o fundo (e pode matar o app lá): grava antes
        self.persist();
        // o jogo continua na memória
        self.renderer = None;
        self.models = None;
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let w = self.renderer.as_ref().map(|r| r.size().0 as f32).unwrap_or(1.0);
        match event {
            WindowEvent::CloseRequested => {
                self.persist();
                event_loop.exit();
            }
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
                self.pointer_event(x, y, match t.phase {
                    TouchPhase::Started => Some(true),
                    TouchPhase::Ended | TouchPhase::Cancelled => Some(false),
                    TouchPhase::Moved => None,
                });
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
                    Key::Named(NamedKey::Enter) => "enter".into(),
                    Key::Named(NamedKey::Escape) => "escape".into(),
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
                self.pointer_event(self.cursor.0, self.cursor.1, None);
                if !cfg!(target_os = "android") {
                    self.controls.hover = Some(self.cursor);
                }
            }
            // botão esquerdo: aperta os botões da tela ou mira e minera segurando; direito: constrói no ponto
            WindowEvent::MouseInput { state, button, .. } => match (button, state) {
                (winit::event::MouseButton::Right, ElementState::Pressed) => self.controls.tap(self.cursor.0, self.cursor.1, true),
                (winit::event::MouseButton::Left, ElementState::Pressed) => {
                    self.pointer_event(self.cursor.0, self.cursor.1, Some(true));
                    self.controls.finger_down(u64::MAX, self.cursor.0, self.cursor.1, w, false)
                }
                (winit::event::MouseButton::Left, ElementState::Released) => {
                    self.pointer_event(self.cursor.0, self.cursor.1, Some(false));
                    self.controls.touch_end(u64::MAX)
                }
                _ => {}
            },
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
    // o salvamento fica na pasta interna do app
    let save_dir = app.internal_data_path();
    log::info!("salvamento em {save_dir:?}");
    let event_loop = EventLoop::builder().with_android_app(app).build().expect("laço");
    run(event_loop, Options { save_dir, ..Options::default() });
}

/// Computador: `spacing [lua|marte] [semente]`. Com semente, um jogo novo começa com ela (o salvamento guarda a dele).
#[cfg(not(target_os = "android"))]
pub fn run_desktop() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    let mut opts = Options::default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let capture = args.iter().position(|a| a == "--captura").and_then(|i| args.get(i + 1).cloned());
    if let Some(dir) = args.iter().position(|a| a == "--roteiro").and_then(|i| args.get(i + 1)) {
        roteiro::run(dir);
        return;
    }
    for a in &args {
        if let Some(p) = PlanetId::parse(a) {
            opts.planet = p;
        } else if let Ok(s) = a.parse() {
            opts.seed = Some(s);
        }
    }
    if let Some(dir) = capture {
        capture::run(&dir, opts);
        return;
    }
    opts.save_dir = Some(storage::Store::desktop_dir());
    let event_loop = EventLoop::new().expect("laço");
    run(event_loop, opts);
}
