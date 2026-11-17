//! Spacing nativo (docs/design/PORTE_RUST.md): o jogo em Rust no Android (NativeActivity, Vulkan) e no computador.
//! Este arquivo cuida da janela e do ciclo de vida; o jogo está em `game.rs`, os controles em `controls.rs`, o HUD em `hud.rs`.
pub mod base;
#[cfg(not(target_os = "android"))]
pub mod capture;
pub mod controls;
pub mod desempenho;
pub mod effects;
#[cfg(not(target_os = "android"))]
pub mod fonte;
pub mod fontes;
pub mod game;
pub mod greenhouse;
pub mod hand;
pub mod hud;
pub mod icons;
pub mod items_screen;
pub mod map;
pub mod prefs;
#[cfg(not(target_os = "android"))]
pub mod roteiro;
pub mod sons;
pub mod storage;
pub mod telas;
pub mod vibracao;

use std::sync::Arc;
use std::time::Instant;

use glam::{Vec3, Vec4};
use spacing_core::planet::{planet, PlanetId};
use spacing_core::scaler::ResolutionScaler;
use spacing_render::{Frame, FrameStats, Renderer, Ui};
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

/// onde o app está: no título (e nas configurações dele), carregando um planeta, ou no jogo (com a pausa por cima)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fase {
    Titulo,
    Carregando,
    Jogo,
}

/// some o carregamento por cima do jogo neste tempo (s)
const FADE_S: f32 = 0.35;
/// a tela de carregamento fica pelo menos isto (s), para não piscar; e no máximo isto, se o mundo demorar
const CARREGA_MIN_S: f64 = 1.0;
const CARREGA_MAX_S: f64 = 12.0;

/// um quadro sem mundo (título e começo do carregamento): as telas cobrem tudo; "dentro" não desenha chunks
fn quadro_vazio() -> Frame<'static> {
    Frame {
        eye: Vec3::new(0.0, 10.0, 10.0),
        target: Vec3::ZERO,
        roll: 0.0,
        fov_deg: 50.0,
        time: 0.0,
        dark: 1.0,
        lamp: Vec4::ZERO,
        mist_y: 0.0,
        fog: (1000.0, 2000.0),
        parts: &[],
        props: &[],
        sprites: &[],
        screen: Default::default(),
        storm: 0.0,
        point: None,
        shocks: &[],
        indoor: true,
    }
}

struct App {
    opts: Options,
    fase: Fase,
    /// segundos na tela de carregamento (também gira a Lua do ícone durante o fade de saída)
    load_t: f64,
    /// o carregamento some aos poucos por cima do jogo (1 → 0)
    fade: f32,
    menus: telas::Menus,
    /// teclas de navegação das telas de menu deste quadro
    nav: telas::Nav,
    prefs: prefs::Prefs,
    /// a pausa estava aberta no quadro anterior (ao abrir, ela volta à página principal)
    pausado: bool,
    /// a tela cheia que a janela já recebeu (só no computador: no celular o jogo já ocupa a tela toda)
    #[cfg_attr(target_os = "android", allow(dead_code))]
    fs_aplicada: Option<bool>,
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
    /// o teste de desempenho (cenários) em andamento; depois dele vem o custo dos efeitos (`bench`) e o jogo recarrega
    teste: Option<desempenho::Teste>,
    /// o custo dos efeitos que fecha o teste de desempenho está rodando
    teste_efeitos: bool,
    /// o resultado do último teste (fica no painel até tocar no botão de estatísticas)
    relatorio: Vec<String>,
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
    /// a saída de som (a placa); `None` se não abriu: o jogo segue mudo. Fica com o app: o `Sfx` é emprestado a cada jogo
    saida: Option<spacing_audio::Saida>,
    sfx: spacing_audio::Sfx,
    /// a vibração do aparelho (só no Android; em outros sistemas não faz nada)
    vib: vibracao::Vibra,
    vib_aberta: bool,
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
        let egui = egui::Context::default();
        fontes::install(&egui);
        let store = storage::Store::new(opts.save_dir.clone());
        let prefs = prefs::Prefs::ler(store.prefs_path().as_deref());
        Self {
            store,
            saida: None,
            sfx: spacing_audio::Sfx::silent(),
            vib: vibracao::Vibra::silenciosa(),
            vib_aberta: false,
            fase: Fase::Titulo,
            load_t: 0.0,
            fade: 0.0,
            menus: telas::Menus::default(),
            nav: telas::Nav::default(),
            prefs,
            pausado: false,
            fs_aplicada: None,
            save_t: 0.0,
            saved_at: None,
            opts,
            window: None,
            renderer: None,
            models: None,
            game: None,
            controls: Controls::default(),
            egui,
            meter: hud::Meter::default(),
            stats: FrameStats::default(),
            show_stats: true,
            vsync: false,
            bench: None,
            teste: None,
            teste_efeitos: false,
            relatorio: Vec::new(),
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
        }
        self.aplicar_prefs();
    }

    /// a escala da cena: a da qualidade escolhida, ou a da resolução dinâmica (Automática)
    fn escala_cena(&self) -> f32 {
        self.base_scale * self.prefs.qualidade.escala().unwrap_or(self.scaler.scale() as f32)
    }

    /// Aplica as configurações ao que já existe: escala da cena, mira, tremor (no quadro) e tela cheia.
    fn aplicar_prefs(&mut self) {
        self.controls.aim_above = self.prefs.mira_acima;
        self.sfx.set_muted(!self.prefs.som);
        self.vib.ativa(self.prefs.vibracao);
        self.scaler.reset();
        let s = self.escala_cena();
        if let Some(r) = &mut self.renderer {
            r.set_scale(s);
        }
        #[cfg(not(target_os = "android"))]
        if self.fs_aplicada != Some(self.prefs.tela_cheia) {
            if let Some(w) = &self.window {
                w.set_fullscreen(self.prefs.tela_cheia.then_some(winit::window::Fullscreen::Borderless(None)));
                self.fs_aplicada = Some(self.prefs.tela_cheia);
            }
        }
    }

    /// uma tela de menu ocupa a tela toda: os toques e as teclas vão para ela, não para os controles do jogo
    fn ui_cheia(&self) -> bool {
        self.fase != Fase::Jogo || self.game.as_ref().is_some_and(|g| g.screen_open == Some(game::Screen::Menu))
    }

    /// começa a carregar o planeta escolhido (o jogo é montado no quadro seguinte, com a tela já à mostra)
    fn carregar(&mut self) {
        self.game = None;
        self.fase = Fase::Carregando;
        self.load_t = 0.0;
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
        g.set_sfx(self.sfx.clone(), self.vib.clone());
        if renewed {
            g.toast("O mundo foi gerado de novo. Seus itens e equipamentos continuam com você.");
        }
        g
    }

    /// grava o jogo (Game.persist); não grava no meio de uma cena nem morto
    fn persist(&mut self) -> bool {
        // durante o teste de desempenho o mundo é alterado de propósito: nada é gravado
        if self.teste.is_some() || self.teste_efeitos {
            return false;
        }
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

    /// Começa o teste de desempenho (Pausa): grava o progresso, silencia som e vibração e roda os cenários.
    fn teste_comeca(&mut self) {
        let Some(g) = &self.game else { return };
        if g.base.inside() || g.base.busy() || g.death.is_some() {
            if let Some(g) = &mut self.game {
                g.toast("Saia da base e fique vivo para medir o desempenho.");
            }
            return;
        }
        self.persist();
        self.bench = None;
        self.relatorio.clear();
        self.teste_efeitos = false;
        self.teste = Some(desempenho::Teste::novo());
        self.sfx.set_muted(true);
        self.vib.ativa(false);
        self.show_stats = false;
    }

    /// o ambiente de agora (vai no resultado)
    fn teste_ambiente(&self) -> Option<desempenho::Ambiente> {
        let (r, g) = (self.renderer.as_ref()?, self.game.as_ref()?);
        Some(desempenho::Ambiente {
            placa: r.backend.clone(),
            tela: r.size(),
            cena: r.scene_size(),
            msaa: r.msaa(),
            apresentacao: r.present_mode().to_string(),
            planeta: planet(g.planet).name,
        })
    }

    /// O teste acabou ou foi cancelado: som e vibração voltam, o progresso de antes é recarregado (o teste cavou blocos e
    /// soltou meteoros) e o resultado fica no painel.
    fn teste_termina(&mut self, linhas: Vec<String>) {
        self.teste = None;
        self.teste_efeitos = false;
        self.bench = None;
        self.controls.scripted = None;
        self.sfx.set_muted(!self.prefs.som);
        self.vib.ativa(self.prefs.vibracao);
        self.relatorio = linhas;
        self.carregar();
    }

    /// A cada quadro: cancela se a Pausa abriu, e passa dos cenários para o custo dos efeitos e deste para o fim.
    fn teste_verifica(&mut self) {
        if self.teste.is_none() && !self.teste_efeitos {
            return;
        }
        let pausa = self.game.as_ref().is_none_or(|g| g.screen_open.is_some());
        if pausa {
            self.teste_termina(vec!["teste de desempenho cancelado".into()]);
            return;
        }
        if self.teste.as_ref().is_some_and(|t| t.feito) {
            let (Some(amb), Some(t)) = (self.teste_ambiente(), self.teste.take()) else { return };
            let antes = self.store.ultimo_desempenho().map(|v| desempenho::ler_medidas(&v));
            let agora = storage::now_ms();
            self.store.gravar_desempenho(&t.json(&amb, agora), agora);
            self.relatorio = t.linhas(&amb, antes.as_deref());
            // o custo dos efeitos fecha o teste (o astronauta já está parado)
            if let Some(r) = self.renderer.as_mut() {
                self.bench = Some(effects::EffectBench::new(r));
                self.teste_efeitos = true;
            }
            self.controls.scripted = None;
        } else if self.teste_efeitos && self.bench.as_ref().is_some_and(|b| b.done) {
            let mut linhas = std::mem::take(&mut self.relatorio);
            if let Some(b) = &self.bench {
                linhas.extend(b.report());
            }
            self.teste_termina(linhas);
        }
    }

    fn switch_planet(&mut self) {
        self.persist();
        self.opts.planet = match self.opts.planet {
            PlanetId::Lua => PlanetId::Marte,
            PlanetId::Marte => PlanetId::Lua,
        };
        // o desenho fica (a superfície não pode ser recriada no Android): só a luz e o céu mudam; o mundo é refeito
        if let Some(r) = &mut self.renderer {
            r.set_planet(planet(self.opts.planet));
        }
        self.carregar();
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
            // o resultado do teste de desempenho fica até este botão ser tocado
            self.relatorio.clear();
        }
        self.teste_verifica();
        let now = Instant::now();
        let dt = self.last.map(|l| (now - l).as_secs_f64()).unwrap_or(1.0 / 60.0);
        self.last = Some(now);
        self.meter.frame(dt);
        let alvo = self.escala_cena();
        let auto = self.prefs.qualidade == prefs::Qualidade::Auto;
        if let (Some(b), Some(r)) = (self.bench.as_mut(), self.renderer.as_mut()) {
            if b.frame(dt, r) {
                // acabou: a resolução volta à de antes
                r.set_scale(alvo);
            }
        } else if let (Some(r), true, true) = (self.renderer.as_mut(), auto, self.teste.is_none()) {
            // (parada durante o teste de desempenho: a resolução tem de ficar a mesma) gráficos "Automática": alvo de 60 quadros, como o jogo web sem limite escolhido
            if let Some(s) = self.scaler.frame(dt * 1000.0, self.cpu_ms, 1000.0 / 60.0) {
                r.set_scale(self.base_scale * s as f32);
            }
        }
        if self.renderer.is_none() || self.window.is_none() {
            return;
        }
        if self.fase != Fase::Jogo || self.game.is_none() {
            if self.fase == Fase::Jogo {
                self.fase = Fase::Titulo;
            }
            self.frame_menu(dt);
            return;
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
        // pausa aberta: o jogo para (como a pausa do jogo web); ao abrir, ela começa na página principal
        let paused = game.screen_open == Some(game::Screen::Menu);
        if paused && !self.pausado {
            self.menus = telas::Menus::default();
        }
        self.pausado = paused;
        self.sfx.set_paused(paused);
        game.rig.shake_scale = self.prefs.tremor.escala();
        if let Some(t) = self.teste.as_mut().filter(|_| !paused) {
            t.quadro(dt, self.cpu_ms, game, &mut self.controls);
        }
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
                _ if self.teste.is_some() => self.teste.iter().map(|t| t.rotulo()).collect(),
                Some(b) if self.teste_efeitos && !b.done => vec![b.running_label(), "fique parado: o tempo do quadro é medido sem cada efeito".into()],
                _ if !self.relatorio.is_empty() => self.relatorio.clone(),
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
            game,
        };
        let controls = &self.controls;
        let toque = self.controls.touched;
        let (menus, prefs) = (&mut self.menus, &mut self.prefs);
        let nav = std::mem::take(&mut self.nav);
        let (fade, load_t) = (self.fade, self.load_t);
        let mut actions = Vec::new();
        let (mut pausa_acao, mut cfg_acao, mut ctrl_voltar) = (None, None, false);
        let out = self.egui.run_ui(raw, |ui| {
            let ctx = ui.ctx();
            actions = hud::draw(ctx, controls, &info);
            // a pausa e o que ela abre (configurações, controles) cobrem o jogo
            if paused {
                match menus.pagina {
                    telas::Pagina::Principal => pausa_acao = telas::pausa(ctx, menus, &nav, dt),
                    telas::Pagina::Config => cfg_acao = telas::config(ctx, prefs, menus, &nav),
                    telas::Pagina::Controles => ctrl_voltar = telas::controles(ctx, &nav, toque),
                }
            }
            if fade > 0.0 {
                telas::carregando(ctx, load_t, fade);
            }
        });
        let prims = self.egui.tessellate(out.shapes, out.pixels_per_point);
        for a in actions {
            game.ui_action(a);
        }
        let models = self.models.as_ref().unwrap();
        let frame = game.frame(models, aspect);
        if let Some(s) = r.render(&frame, Some(Ui { primitives: &prims, textures: &out.textures_delta, pixels_per_point: out.pixels_per_point })) {
            self.stats = s;
        }
        self.cpu_ms = now.elapsed().as_secs_f64() * 1000.0;
        if self.fade > 0.0 {
            self.fade = (self.fade - dt as f32 / FADE_S).max(0.0);
            self.load_t += dt;
        }
        if let Some(a) = cfg_acao {
            self.config_acao(a);
        }
        if ctrl_voltar {
            self.menus.pagina = telas::Pagina::Principal;
            self.menus.sel = 3;
        }
        if let Some(a) = pausa_acao {
            self.pausa_acao(a);
        }
        window.request_redraw();
    }

    fn pausa_acao(&mut self, a: telas::PausaAcao) {
        use telas::PausaAcao as P;
        match a {
            P::Continuar => {
                if let Some(g) = &mut self.game {
                    g.ui_action(hud::UiAction::Close);
                }
            }
            P::Salvar => {
                // a resposta aparece na própria linha ("salvo"), porque os avisos do HUD ficam atrás da pausa
                self.menus.salvo_ok = self.persist();
                self.menus.salvo = 2.0;
            }
            P::Config => {
                self.menus.pagina = telas::Pagina::Config;
                self.menus.sel_cfg = 0;
            }
            P::Controles => self.menus.pagina = telas::Pagina::Controles,
            P::Teste => {
                if let Some(g) = &mut self.game {
                    g.ui_action(hud::UiAction::Close);
                }
                self.teste_comeca();
            }
            P::Sair => {
                // grava e volta ao título; o mundo sai da memória e do desenho
                self.persist();
                self.game = None;
                self.saved_at = None;
                if let Some(r) = &mut self.renderer {
                    r.clear_chunks();
                }
                self.fase = Fase::Titulo;
                self.menus = telas::Menus::default();
                self.pausado = false;
            }
        }
    }

    fn config_acao(&mut self, a: telas::CfgAcao) {
        match a {
            telas::CfgAcao::Mudou => {
                self.prefs.gravar(self.store.prefs_path().as_deref());
                self.aplicar_prefs();
                // a pausa congela o som; no título o clique confirma a mudança (ligar o som também)
                self.sfx.play(spacing_audio::Sound::Ui, 1.0, None);
            }
            telas::CfgAcao::Voltar => {
                self.menus.pagina = telas::Pagina::Principal;
                // de volta à linha "Configurações" (a última do título, a terceira da pausa)
                self.menus.sel = if self.fase == Fase::Jogo { 2 } else { usize::MAX };
            }
        }
    }

    /// Título (e as configurações dele) e carregamento: sem jogo rodando, só a tela.
    fn frame_menu(&mut self, dt: f64) {
        self.sfx.set_paused(false);
        // carregando: o primeiro quadro já mostra a tela; o jogo é montado no seguinte (Game::load trava enquanto gera o
        // começo do mundo)
        if self.fase == Fase::Carregando && self.game.is_none() && self.load_t > 0.0 {
            if let Some(r) = &mut self.renderer {
                r.clear_chunks();
                r.set_planet(planet(self.opts.planet));
            }
            self.game = Some(self.start_game());
            self.saved_at = None;
            self.save_t = 0.0;
        }
        let (Some(r), Some(window)) = (self.renderer.as_mut(), self.window.clone()) else { return };
        let size = r.size();
        let ppp = window.scale_factor() as f32;
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(size.0 as f32 / ppp, size.1 as f32 / ppp))),
            events: std::mem::take(&mut self.egui_events),
            ..Default::default()
        };
        let nav = std::mem::take(&mut self.nav);
        let info = telas::TituloInfo { planeta: self.opts.planet, salvo: self.store.save_age(self.opts.planet) };
        let carregando = self.fase == Fase::Carregando;
        let load_t = self.load_t;
        let (menus, prefs) = (&mut self.menus, &mut self.prefs);
        let (mut titulo_acao, mut cfg_acao) = (None, None);
        let out = self.egui.run_ui(raw, |ui| {
            let ctx = ui.ctx();
            if carregando {
                telas::carregando(ctx, load_t, 1.0);
            } else if menus.pagina == telas::Pagina::Config {
                cfg_acao = telas::config(ctx, prefs, menus, &nav);
            } else {
                titulo_acao = telas::titulo(ctx, &info, menus, &nav, dt);
            }
        });
        let prims = self.egui.tessellate(out.shapes, out.pixels_per_point);
        let ui = Ui { primitives: &prims, textures: &out.textures_delta, pixels_per_point: out.pixels_per_point };
        let aspect = size.0 as f64 / size.1.max(1) as f64;
        // carregando com o jogo já montado: o mundo anda (parado) e as malhas sobem, escondidos atrás da tela
        let stats = match (&mut self.game, &self.models) {
            (Some(g), Some(m)) => {
                g.update(0.0, &mut Controls::default());
                g.sync(r);
                let f = g.frame(m, aspect);
                r.render(&f, Some(ui))
            }
            _ => r.render(&quadro_vazio(), Some(ui)),
        };
        if let Some(s) = stats {
            self.stats = s;
        }
        if carregando {
            self.load_t += dt;
            let pronto = self.game.as_ref().is_some_and(|g| g.chunks_left == 0);
            if self.game.is_some() && ((pronto && self.load_t >= CARREGA_MIN_S) || self.load_t > CARREGA_MAX_S) {
                self.fase = Fase::Jogo;
                self.fade = 1.0;
                self.menus = telas::Menus::default();
                self.pausado = false;
            }
        }
        if let Some(a) = cfg_acao {
            self.config_acao(a);
        }
        if titulo_acao.is_some() {
            self.sfx.play(spacing_audio::Sound::Ui, 1.0, None);
        }
        match titulo_acao {
            Some(telas::TituloAcao::Continuar) => self.carregar(),
            Some(telas::TituloAcao::NovoJogo) => {
                // o salvamento deste planeta sai; o jogo novo tem semente sorteada
                self.store.clear(self.opts.planet);
                self.carregar();
            }
            Some(telas::TituloAcao::TrocarPlaneta) => {
                self.opts.planet = match self.opts.planet {
                    PlanetId::Lua => PlanetId::Marte,
                    PlanetId::Marte => PlanetId::Lua,
                };
                self.menus.confirmar = 0.0;
            }
            Some(telas::TituloAcao::Config) => {
                self.menus.pagina = telas::Pagina::Config;
                self.menus.sel_cfg = 0;
            }
            None => {}
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
        // a vibração também precisa da atividade (JNI)
        if !self.vib_aberta {
            self.vib_aberta = true;
            self.vib = vibracao::Vibra::abrir();
            self.vib.ativa(self.prefs.vibracao);
            if let Some(g) = &mut self.game {
                g.set_sfx(self.sfx.clone(), self.vib.clone());
            }
        }
        // o som abre uma vez (no Android, depois que a atividade existe) e acompanha o ciclo de vida do app
        match &self.saida {
            Some(s) => s.ativa(true),
            None => {
                self.saida = spacing_audio::Saida::abrir();
                if let Some(s) = &self.saida {
                    self.sfx = s.sfx();
                    self.sfx.set_muted(!self.prefs.som);
                    if let Some(g) = &mut self.game {
                        g.set_sfx(self.sfx.clone(), self.vib.clone());
                    }
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
        // no fundo não toca nada (e a placa descansa)
        if let Some(s) = &self.saida {
            s.ativa(false);
        }
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
                    // com uma tela de menu por cima, o dedo novo é só dela (os que já estavam continuam até soltar)
                    TouchPhase::Started if self.ui_cheia() => {}
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
                    // o Voltar do Android vale como Esc
                    Key::Named(NamedKey::Escape | NamedKey::GoBack | NamedKey::BrowserBack) => "escape".into(),
                    _ => return,
                };
                // tela de menu por cima: a tecla navega nela; soltar sempre chega aos controles (nada fica preso)
                if down && self.ui_cheia() {
                    self.nav.key(&name);
                } else {
                    self.controls.key(&name, down);
                }
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
                (winit::event::MouseButton::Right, ElementState::Pressed) if !self.ui_cheia() => self.controls.tap(self.cursor.0, self.cursor.1, true),
                (winit::event::MouseButton::Left, ElementState::Pressed) => {
                    self.pointer_event(self.cursor.0, self.cursor.1, Some(true));
                    if !self.ui_cheia() {
                        self.controls.finger_down(u64::MAX, self.cursor.0, self.cursor.1, w, false)
                    }
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
    if let Some(dir) = args.iter().position(|a| a == "--fonte").and_then(|i| args.get(i + 1)) {
        fonte::run(dir);
        return;
    }
    if let Some(dir) = args.iter().position(|a| a == "--telas").and_then(|i| args.get(i + 1)) {
        telas::capturas(dir);
        return;
    }
    if let Some(dir) = args.iter().position(|a| a == "--som").and_then(|i| args.get(i + 1)) {
        sons::gravar(dir);
        return;
    }
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
