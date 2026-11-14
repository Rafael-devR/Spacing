//! Protótipo de comparação do Spacing (docs/design/NATIVO.md): a mesma cena de cubos desenhada em Rust com wgpu, nativo no
//! Android (Vulkan) e no navegador (WebAssembly + WebGL2), para comparar com a versão em Three.js (`web/three.ts`). Não é o
//! jogo: é uma régua. Mede a tela, sobe a carga até cair de 60 quadros por segundo e mostra o máximo que coube.
pub mod bench;
pub mod font;
pub mod gfx;
pub mod scene;

use std::sync::Arc;

use web_time::Instant;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, TouchPhase, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy};
use winit::window::{Window, WindowId};

use bench::{Kind, Phase, Ramp};
use gfx::Gfx;

/// o que chega pela fila do laço: no navegador a placa de vídeo é pedida de forma assíncrona
pub enum UserEvent {
    Ready(Gfx),
}

struct App {
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    proxy: EventLoopProxy<UserEvent>,
    window: Option<Arc<Window>>,
    gfx: Option<Gfx>,
    ramp: Ramp,
    start: Instant,
    last: Option<Instant>,
    platform: &'static str,
}

/// triângulos para o texto: "2,8 MI" ou "850 MIL"
fn fmt_tris(t: u64) -> String {
    if t == 0 {
        "-".into()
    } else if t >= 1_000_000 {
        format!("{:.1} MI", t as f64 / 1e6).replace('.', ",")
    } else {
        format!("{} MIL", t / 1000)
    }
}

/// "mediana (menor-maior)" de um dos quatro resultados, na unidade certa
fn fmt_stat(r: &Ramp, k: Kind) -> String {
    match r.stats(k) {
        None => "-".into(),
        Some((m, lo, hi)) => {
            let f = |l: u32| if k.is_draws() { l.to_string() } else { fmt_tris(k.amount(l)) };
            if lo == hi { f(m) } else { format!("{} ({}-{})", f(m), f(lo), f(hi)) }
        }
    }
}

impl App {
    fn new(proxy: EventLoopProxy<UserEvent>) -> Self {
        let platform = if cfg!(target_os = "android") {
            "NATIVO ANDROID"
        } else if cfg!(target_arch = "wasm32") {
            "NAVEGADOR (RUST/WASM)"
        } else {
            "COMPUTADOR"
        };
        Self { proxy, window: None, gfx: None, ramp: Ramp::new(), start: Instant::now(), last: None, platform }
    }

    fn create_gfx(&mut self, event_loop: &ActiveEventLoop) {
        let Some(window) = self.window.clone() else { return };
        let display: Box<dyn wgpu::wgt::WgpuHasDisplayHandle> = Box::new(event_loop.owned_display_handle());
        #[cfg(not(target_arch = "wasm32"))]
        {
            let gfx = pollster::block_on(Gfx::new(window, display));
            self.ready(gfx);
        }
        #[cfg(target_arch = "wasm32")]
        {
            let proxy = self.proxy.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let gfx = Gfx::new(window, display).await;
                let _ = proxy.send_event(UserEvent::Ready(gfx));
            });
        }
    }

    fn ready(&mut self, mut gfx: Gfx) {
        let (d, c) = self.ramp.load();
        gfx.set_load(d, c);
        gfx.window.request_redraw();
        self.gfx = Some(gfx);
        self.last = None;
    }

    fn restart(&mut self) {
        self.ramp = Ramp::new();
        if let Some(g) = &mut self.gfx {
            g.set_load(0, 0);
        }
    }

    fn text(&self) -> Vec<(String, [u8; 4])> {
        let r = &self.ramp;
        let g = self.gfx.as_ref();
        let (w, h) = g.map(|g| g.size()).unwrap_or((0, 0));
        let white = [235, 235, 245, 255];
        let dim = [160, 165, 185, 255];
        let ok = [120, 230, 150, 255];
        let orange = [255, 150, 80, 255];
        let warn = [255, 210, 90, 255];
        let mut out = vec![
            (format!("SPACING - TESTE {}", self.platform), orange),
            (format!("GRAFICOS: {}   TELA: {}X{} ({:.2} MP)", g.map(|g| g.backend.to_uppercase()).unwrap_or_default(), w, h, (w as f64 * h as f64) / 1e6).replace('.', ","), dim),
        ];
        let rounds = if r.phase == Phase::Done { "RESULTADO".to_string() } else { format!("RODADA {}/{}", r.round + 1, bench::ROUNDS) };
        out.push((if r.hz > 0.0 { format!("TAXA DA TELA: {:.0} HZ   {}", r.hz, rounds) } else { "MEDINDO A TELA...".into() }, if r.phase == Phase::Done { ok } else { dim }));
        if r.hz > 0.0 && r.no120 && r.phase != Phase::Done {
            out.push(("MEXA O DEDO NA TELA PARA ELA IR A 120 HZ".into(), warn));
        }
        match r.kind() {
            Some(k) if k.is_draws() => out.push((format!("> CHAMADAS DE DESENHO: {}   ({:.1} MS)", r.level, r.last_ms).replace('.', ","), white)),
            Some(_) => out.push((format!("> TRIANGULOS: {}   ({:.1} MS)", fmt_tris(r.triangles()), r.last_ms).replace('.', ","), white)),
            None => {}
        }
        if r.hz > 0.0 {
            out.push((format!("CHAMADAS 60 FPS: {}", fmt_stat(r, Kind::Draws60)), white));
            out.push((format!("CHAMADAS 120 FPS: {}", fmt_stat(r, Kind::Draws120)), white));
            out.push((format!("TRIANGULOS 60 FPS: {}", fmt_stat(r, Kind::Tris60)), white));
            out.push((format!("TRIANGULOS 120 FPS: {}", fmt_stat(r, Kind::Tris120)), white));
        }
        if r.phase == Phase::Done {
            out.push((if r.no120 { "TELA A 60 HZ: SEM 120 FPS. REPITA MEXENDO O DEDO".into() } else { "TOQUE PARA REPETIR".to_string() }, dim));
        }
        out
    }

    fn frame(&mut self) {
        let now = Instant::now();
        let dt = self.last.map(|l| (now - l).as_secs_f64()).unwrap_or(0.0);
        self.last = Some(now);
        if dt > 0.0 && self.ramp.frame(dt.min(0.5)) {
            let (d, c) = self.ramp.load();
            if let Some(g) = &mut self.gfx {
                g.set_load(d, c);
            }
            log::info!("degrau: {:?} {:?}", self.ramp.phase, self.ramp.load());
        }
        let text = self.text();
        let t = (now - self.start).as_secs_f32();
        if let Some(g) = &mut self.gfx {
            let px = (g.size().1 as f32 / 150.0).max(2.0).floor();
            g.set_text(&text, px);
            g.render(t);
            g.window.request_redraw();
        }
    }
}

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            #[allow(unused_mut)]
            let mut attrs = Window::default_attributes().with_title("Spacing - teste nativo");
            #[cfg(target_arch = "wasm32")]
            {
                use wasm_bindgen::JsCast;
                use winit::platform::web::WindowAttributesExtWebSys;
                let canvas = web_sys::window()
                    .and_then(|w| w.document())
                    .and_then(|d| d.get_element_by_id("tela"))
                    .and_then(|e| e.dyn_into::<web_sys::HtmlCanvasElement>().ok());
                attrs = attrs.with_canvas(canvas);
            }
            self.window = Some(Arc::new(event_loop.create_window(attrs).expect("janela")));
        }
        // no Android a superfície morre quando o app sai da frente; volta aqui
        if self.gfx.is_none() {
            self.create_gfx(event_loop);
        }
    }

    fn suspended(&mut self, _event_loop: &ActiveEventLoop) {
        self.gfx = None;
    }

    fn user_event(&mut self, _event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Ready(g) => self.ready(g),
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(s) => {
                if let Some(g) = &mut self.gfx {
                    g.resize(s.width, s.height);
                }
            }
            WindowEvent::RedrawRequested => self.frame(),
            WindowEvent::Touch(t) if t.phase == TouchPhase::Ended && self.ramp.phase == Phase::Done => self.restart(),
            WindowEvent::MouseInput { state: ElementState::Released, .. } if self.ramp.phase == Phase::Done => self.restart(),
            _ => {}
        }
    }
}

fn run(event_loop: EventLoop<UserEvent>) {
    let app = App::new(event_loop.create_proxy());
    #[cfg(not(target_arch = "wasm32"))]
    {
        let mut app = app;
        event_loop.run_app(&mut app).expect("laço");
    }
    #[cfg(target_arch = "wasm32")]
    {
        use winit::platform::web::EventLoopExtWebSys;
        event_loop.spawn_app(app);
    }
}

/// Entrada no Android (NativeActivity: o app é só esta biblioteca, sem Java).
#[cfg(target_os = "android")]
#[no_mangle]
fn android_main(app: winit::platform::android::activity::AndroidApp) {
    use winit::platform::android::EventLoopBuilderExtAndroid;
    android_logger::init_once(android_logger::Config::default().with_max_level(log::LevelFilter::Info));
    let event_loop = EventLoop::<UserEvent>::with_user_event().with_android_app(app).build().expect("laço");
    run(event_loop);
}

/// Entrada no navegador.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
    let event_loop = EventLoop::<UserEvent>::with_user_event().build().expect("laço");
    run(event_loop);
}

/// No computador (Linux com janela): para conferir o teste sem celular. `cargo run --example desktop`.
#[cfg(not(any(target_os = "android", target_arch = "wasm32")))]
pub fn run_desktop() {
    let event_loop = EventLoop::<UserEvent>::with_user_event().build().expect("laço");
    run(event_loop);
}
