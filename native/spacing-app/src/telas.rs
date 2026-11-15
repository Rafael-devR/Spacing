//! As telas de menu do nativo (docs/design/INTERFACE_NATIVA.md): título, configurações, pausa, controles e carregamento.
//! O desenho segue o canvas aprovado pelo dono: a tela deitada de 844×390 pontos é a referência (tudo escala junto), o céu
//! noturno com estrelas e três morros, o texto em Pixelify Sans alinhado a 28 pontos da borda, linhas sem caixas, e pixel
//! art só nos detalhes (o quadradinho da linha escolhida, a marca do logo, o quadradinho de ligado/desligado).
//! As telas só desenham e devolvem o que o jogador escolheu; quem aplica é o `App` (lib.rs).
use egui::{Align2, Color32, FontId, Id, Pos2, Rect, Sense, Shape, Stroke, Vec2};
use spacing_core::planet::{planet, PlanetId};

use crate::prefs::Prefs;

const fn rgb(r: u8, g: u8, b: u8) -> Color32 {
    Color32::from_rgb(r, g, b)
}

pub const CEU: Color32 = rgb(0x1C, 0x13, 0x33);
const MORRO: [Color32; 3] = [rgb(0x2B, 0x1A, 0x3D), rgb(0x1F, 0x12, 0x30), rgb(0x0E, 0x08, 0x18)];
pub const TINTA: Color32 = rgb(0xF3, 0xE6, 0xD8);
pub const FRACO: Color32 = rgb(0xA8, 0x93, 0xA6);
pub const DESTAQUE: Color32 = rgb(0x7F, 0xE7, 0xFF);
const ESPACO: Color32 = rgb(0x05, 0x07, 0x0E);
const FIO: Color32 = Color32::from_rgba_unmultiplied_const(243, 230, 216, 41);

/// estrelas do céu das telas: x, y (em 844×390), tamanho, brilho
const ESTRELAS: [(f32, f32, f32, f32); 23] = [
    (410.0, 30.0, 2.0, 0.8), (520.0, 64.0, 2.0, 0.5), (640.0, 28.0, 3.0, 0.9), (730.0, 90.0, 2.0, 0.6), (800.0, 40.0, 2.0, 0.7),
    (600.0, 120.0, 2.0, 0.4), (470.0, 150.0, 2.0, 0.6), (690.0, 180.0, 3.0, 0.8), (780.0, 150.0, 2.0, 0.5), (560.0, 210.0, 2.0, 0.5),
    (360.0, 96.0, 2.0, 0.5), (300.0, 20.0, 2.0, 0.6), (240.0, 140.0, 3.0, 0.7), (120.0, 30.0, 2.0, 0.5), (180.0, 70.0, 2.0, 0.4),
    (60.0, 130.0, 2.0, 0.4), (410.0, 205.0, 2.0, 0.4), (830.0, 230.0, 2.0, 0.5), (640.0, 250.0, 2.0, 0.4), (20.0, 70.0, 2.0, 0.4),
    (330.0, 240.0, 2.0, 0.4), (200.0, 200.0, 2.0, 0.3), (500.0, 20.0, 2.0, 0.5),
];

/// estrelas da tela de carregamento (fundo preto, sem morros)
const ESTRELAS_ESPACO: [(f32, f32, f32, f32); 24] = [
    (40.0, 36.0, 2.0, 0.6), (96.0, 150.0, 2.0, 0.4), (150.0, 60.0, 3.0, 0.8), (212.0, 238.0, 2.0, 0.5), (260.0, 110.0, 2.0, 0.6),
    (320.0, 300.0, 2.0, 0.4), (352.0, 42.0, 2.0, 0.7), (410.0, 180.0, 3.0, 0.8), (450.0, 90.0, 2.0, 0.5), (500.0, 258.0, 2.0, 0.4),
    (548.0, 30.0, 2.0, 0.6), (600.0, 140.0, 2.0, 0.5), (652.0, 70.0, 3.0, 0.9), (700.0, 210.0, 2.0, 0.4), (760.0, 120.0, 2.0, 0.6),
    (808.0, 40.0, 2.0, 0.7), (24.0, 260.0, 2.0, 0.4), (70.0, 340.0, 2.0, 0.5), (180.0, 330.0, 2.0, 0.4), (390.0, 350.0, 2.0, 0.5),
    (470.0, 320.0, 2.0, 0.4), (590.0, 340.0, 2.0, 0.5), (690.0, 300.0, 2.0, 0.4), (800.0, 180.0, 2.0, 0.5),
];

type Bezier = [(f32, f32); 4];

/// os três morros do canvas (curvas cúbicas em 844×390), do mais longe ao mais perto
const MORROS: [&[Bezier]; 3] = [
    &[[(0.0, 272.0), (140.0, 252.0), (280.0, 266.0), (420.0, 258.0)], [(420.0, 258.0), (560.0, 250.0), (700.0, 246.0), (844.0, 262.0)]],
    &[[(0.0, 312.0), (200.0, 296.0), (360.0, 314.0), (540.0, 302.0)], [(540.0, 302.0), (720.0, 290.0), (760.0, 300.0), (844.0, 290.0)]],
    &[[(0.0, 350.0), (220.0, 340.0), (460.0, 354.0), (844.0, 340.0)]],
];

/// teclas de navegação de um quadro (computador; no celular só há toque)
#[derive(Clone, Copy, Debug, Default)]
pub struct Nav {
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
    pub ok: bool,
    pub back: bool,
}

impl Nav {
    /// uma tecla apertada (o mesmo nome que `Controls::key` recebe)
    pub fn key(&mut self, name: &str) {
        match name.to_lowercase().as_str() {
            "arrowup" | "w" => self.up = true,
            "arrowdown" | "s" => self.down = true,
            "arrowleft" | "a" => self.left = true,
            "arrowright" | "d" => self.right = true,
            "enter" | " " => self.ok = true,
            "escape" | "p" => self.back = true,
            _ => {}
        }
    }
}

/// em que página do menu o jogador está (o título e a pausa abrem as mesmas configurações; a pausa abre os controles)
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Pagina {
    #[default]
    Principal,
    Config,
    Controles,
}

/// o estado das telas de menu entre um quadro e outro
#[derive(Clone, Copy, Debug, Default)]
pub struct Menus {
    pub pagina: Pagina,
    /// a linha escolhida na página principal e nas configurações
    pub sel: usize,
    pub sel_cfg: usize,
    /// "Novo jogo" com salvamento pede um segundo toque dentro deste tempo (s)
    pub confirmar: f64,
    /// a pausa mostra "salvo" (ou que não deu) na linha Salvar por este tempo (s)
    pub salvo: f64,
    pub salvo_ok: bool,
}

/// a tela em pontos do egui e a escala da referência de 844×390
#[derive(Clone, Copy)]
struct Tela {
    r: Rect,
    u: f32,
}

impl Tela {
    fn de(ctx: &egui::Context) -> Self {
        let r = ctx.content_rect();
        Self { r, u: (r.width() / 844.0).min(r.height() / 390.0).max(0.1) }
    }
    fn x(&self, x: f32) -> f32 {
        self.r.left() + x * self.u
    }
    fn y(&self, y: f32) -> f32 {
        self.r.top() + y * self.u
    }
    fn d(&self, v: f32) -> f32 {
        v * self.u
    }
}

/// a tela inteira, por cima do HUD e do mundo
fn tela_cheia(ctx: &egui::Context, nome: &'static str, f: impl FnOnce(&mut egui::Ui, &Tela)) {
    let t = Tela::de(ctx);
    egui::Area::new(Id::unique(nome)).order(egui::Order::Foreground).fixed_pos(t.r.min).movable(false).fade_in(false).show(ctx, |ui| {
        ui.set_min_size(t.r.size());
        f(ui, &t);
    });
}

fn bezier(s: &Bezier, t: f32) -> (f32, f32) {
    let m = 1.0 - t;
    let (a, b, c, d) = (m * m * m, 3.0 * m * m * t, 3.0 * m * t * t, t * t * t);
    (a * s[0].0 + b * s[1].0 + c * s[2].0 + d * s[3].0, a * s[0].1 + b * s[1].1 + c * s[2].1 + d * s[3].1)
}

/// o céu (estrelas), e os morros quando `morros`; esticado para a tela toda
fn fundo(p: &egui::Painter, r: Rect, fundo: Color32, estrelas: &[(f32, f32, f32, f32)], morros: bool, alfa: f32) {
    let (sx, sy) = (r.width() / 844.0, r.height() / 390.0);
    let u = sx.min(sy);
    p.rect_filled(r, 0.0, fundo.gamma_multiply(alfa));
    for &(x, y, s, a) in estrelas {
        let q = Rect::from_min_size(Pos2::new(r.left() + x * sx, r.top() + y * sy), Vec2::splat((s * u).max(1.0)));
        p.rect_filled(q, 0.0, TINTA.gamma_multiply(a * alfa));
    }
    if !morros {
        return;
    }
    for (segs, cor) in MORROS.iter().zip(MORRO) {
        let mut pts = Vec::new();
        for s in segs.iter() {
            for k in 0..=32 {
                let (x, y) = bezier(s, k as f32 / 32.0);
                pts.push(Pos2::new(r.left() + x * sx, r.top() + y * sy));
            }
        }
        let mut mesh = egui::Mesh::default();
        let cor = cor.gamma_multiply(alfa);
        for w in pts.windows(2) {
            let i = mesh.vertices.len() as u32;
            mesh.colored_vertex(w[0], cor);
            mesh.colored_vertex(w[1], cor);
            mesh.colored_vertex(Pos2::new(w[1].x, r.bottom()), cor);
            mesh.colored_vertex(Pos2::new(w[0].x, r.bottom()), cor);
            mesh.add_triangle(i, i + 1, i + 2);
            mesh.add_triangle(i, i + 2, i + 3);
        }
        p.add(Shape::mesh(mesh));
    }
}

/// texto; `negrito` desenha de novo um pouco ao lado (a Pixelify do jogo é uma só, sem o peso negrito)
fn texto(p: &egui::Painter, pos: Pos2, align: Align2, s: &str, size: f32, cor: Color32, negrito: bool) -> Rect {
    let f = FontId::proportional(size);
    if negrito {
        p.text(pos + Vec2::new(size * 0.06, 0.0), align, s, f.clone(), cor);
    }
    p.text(pos, align, s, f, cor)
}

/// triângulo de escolha (‹ ou ›) com a ponta para `direita`; `x` é a borda esquerda
fn triangulo(p: &egui::Painter, x: f32, cy: f32, u: f32, direita: bool) {
    let (w, h) = (7.0 * u, 5.0 * u);
    let pts = if direita {
        vec![Pos2::new(x, cy - h), Pos2::new(x + w, cy), Pos2::new(x, cy + h)]
    } else {
        vec![Pos2::new(x + w, cy - h), Pos2::new(x, cy), Pos2::new(x + w, cy + h)]
    };
    p.add(Shape::convex_polygon(pts, FRACO, Stroke::NONE));
}

/// o que aparece à direita de uma linha
enum Valor<'a> {
    Nada,
    /// informação pequena e apagada ("Lua · 2 min")
    Meta(&'a str),
    /// um pedido de confirmação, em destaque
    Aviso(&'a str),
    /// uma escolha entre opções: ‹ valor ›
    Escolha(&'a str),
    /// ligado ou desligado, com o quadradinho
    Chave(bool),
}

/// Uma linha de menu: marcador, nome e valor à direita (o canvas: 22 pontos do marcador ao texto). Devolve a resposta do toque.
#[allow(clippy::too_many_arguments)]
fn linha(ui: &mut egui::Ui, t: &Tela, id: Id, x: f32, y: f32, w: f32, h: f32, fonte: f32, rotulo: &str, valor: Valor, sel: bool) -> egui::Response {
    let u = t.u;
    let rect = Rect::from_min_size(Pos2::new(t.x(x), t.y(y)), Vec2::new(t.d(w), t.d(h)));
    let resp = ui.interact(rect, id, Sense::click());
    let p = ui.painter();
    let cy = rect.center().y;
    if sel {
        p.rect_filled(Rect::from_center_size(Pos2::new(rect.left() + 4.0 * u, cy), Vec2::splat(8.0 * u)), 0.0, DESTAQUE);
    }
    texto(p, Pos2::new(rect.left() + 22.0 * u, cy), Align2::LEFT_CENTER, rotulo, fonte * u, if sel { TINTA } else { FRACO }, sel);
    let dir = rect.right();
    match valor {
        Valor::Nada => {}
        Valor::Meta(s) => {
            texto(p, Pos2::new(dir, cy), Align2::RIGHT_CENTER, s, 14.0 * u, FRACO, false);
        }
        Valor::Aviso(s) => {
            texto(p, Pos2::new(dir, cy), Align2::RIGHT_CENTER, s, 14.0 * u, DESTAQUE, false);
        }
        Valor::Escolha(s) => {
            let xr = dir - 7.0 * u;
            triangulo(p, xr, cy, u, true);
            let r = texto(p, Pos2::new(xr - 9.0 * u, cy), Align2::RIGHT_CENTER, s, 16.0 * u, TINTA, false);
            triangulo(p, r.left() - 9.0 * u - 7.0 * u, cy, u, false);
        }
        Valor::Chave(on) => {
            let r = texto(p, Pos2::new(dir, cy), Align2::RIGHT_CENTER, if on { "Ligado" } else { "Desligado" }, 16.0 * u, TINTA, false);
            let q = Rect::from_center_size(Pos2::new(r.left() - 9.0 * u - 4.0 * u, cy), Vec2::splat(8.0 * u));
            if on {
                p.rect_filled(q, 0.0, DESTAQUE);
            } else {
                p.rect_stroke(q, 0.0, Stroke::new(2.0 * u, FRACO), egui::StrokeKind::Inside);
            }
        }
    }
    resp
}

/// o fio fino que separa um grupo de linhas
fn fio(p: &egui::Painter, t: &Tela, x: f32, y: f32, w: f32) {
    let y = t.y(y);
    p.line_segment([Pos2::new(t.x(x), y), Pos2::new(t.x(x + w), y)], Stroke::new(1.0, FIO));
}

fn titulo_da_tela(p: &egui::Painter, t: &Tela, s: &str) {
    texto(p, Pos2::new(t.x(28.0), t.y(26.0)), Align2::LEFT_TOP, s, t.d(36.0), TINTA, true);
}

/// cima/baixo andam pela lista (dando a volta)
fn navegar(sel: &mut usize, n: usize, nav: &Nav) {
    if n == 0 {
        return;
    }
    *sel = (*sel).min(n - 1);
    if nav.up {
        *sel = (*sel + n - 1) % n;
    }
    if nav.down {
        *sel = (*sel + 1) % n;
    }
}

/// há quanto tempo foi o salvamento, curto ("agora", "2 min", "3 h", "5 d")
pub fn idade(segundos: f64) -> String {
    let s = segundos.max(0.0);
    if s < 60.0 {
        "agora".into()
    } else if s < 3600.0 {
        format!("{:.0} min", (s / 60.0).floor())
    } else if s < 86400.0 {
        format!("{:.0} h", (s / 3600.0).floor())
    } else {
        format!("{:.0} d", (s / 86400.0).floor())
    }
}

// ---------------------------------------------------------------------------------------------------------------- título

pub struct TituloInfo {
    pub planeta: PlanetId,
    /// há quantos segundos o salvamento deste planeta foi gravado (None = não há salvamento)
    pub salvo: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TituloAcao {
    Continuar,
    NovoJogo,
    TrocarPlaneta,
    Config,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LinhaTitulo {
    Continuar,
    Novo,
    Planeta,
    Config,
}

pub fn titulo(ctx: &egui::Context, info: &TituloInfo, m: &mut Menus, nav: &Nav, dt: f64) -> Option<TituloAcao> {
    m.confirmar = (m.confirmar - dt).max(0.0);
    let mut linhas = Vec::new();
    if info.salvo.is_some() {
        linhas.push(LinhaTitulo::Continuar);
    }
    linhas.extend([LinhaTitulo::Novo, LinhaTitulo::Planeta, LinhaTitulo::Config]);
    navegar(&mut m.sel, linhas.len(), nav);
    let nome = planet(info.planeta).name;
    let meta = info.salvo.map(|s| format!("{nome} · {}", idade(s))).unwrap_or_default();
    let mut acao = None;
    tela_cheia(ctx, "tela-titulo", |ui, t| {
        let p = ui.painter().clone();
        fundo(&p, t.r, CEU, &ESTRELAS, true, 1.0);
        // logo: o nome e a marca em pixel
        // o logo já é grosso: sem o negrito desenhado duas vezes (que deixa listras nas letras grandes)
        let size = t.d(64.0);
        let r = texto(&p, Pos2::new(t.x(28.0), t.y(40.0)), Align2::LEFT_TOP, "SPACING", size, TINTA, false);
        // a marca fica na altura do topo das letras (o retângulo do texto começa acima delas)
        p.rect_filled(Rect::from_min_size(Pos2::new(r.right() + t.d(8.0), r.top() + size * 0.3), Vec2::splat(t.d(10.0))), 0.0, DESTAQUE);
        let versao = format!("v{}", env!("CARGO_PKG_VERSION").rsplit_once('.').map_or(env!("CARGO_PKG_VERSION"), |(a, _)| a));
        texto(&p, Pos2::new(t.r.right() - t.d(28.0), t.r.bottom() - t.d(20.0)), Align2::RIGHT_BOTTOM, &versao, t.d(13.0), FRACO, false);
        for (i, l) in linhas.iter().enumerate() {
            let sel = m.sel == i;
            let (rotulo, valor) = match l {
                LinhaTitulo::Continuar => ("Continuar missão", Valor::Meta(&meta)),
                LinhaTitulo::Novo if m.confirmar > 0.0 => ("Novo jogo", Valor::Aviso("toque de novo")),
                LinhaTitulo::Novo => ("Novo jogo", Valor::Nada),
                LinhaTitulo::Planeta => ("Planeta", Valor::Escolha(nome)),
                LinhaTitulo::Config => ("Configurações", Valor::Nada),
            };
            let resp = linha(ui, t, Id::unique(("titulo", i)), 28.0, 186.0 + 36.0 * i as f32, 280.0, 36.0, 20.0, rotulo, valor, sel);
            if resp.hovered() {
                m.sel = i;
            }
            let lado = sel && *l == LinhaTitulo::Planeta && (nav.left || nav.right);
            if !(resp.clicked() || (sel && nav.ok) || lado) {
                continue;
            }
            acao = match l {
                LinhaTitulo::Continuar => Some(TituloAcao::Continuar),
                // com salvamento, o jogo novo apaga o progresso deste planeta: pede um segundo toque
                LinhaTitulo::Novo if info.salvo.is_some() && m.confirmar <= 0.0 => {
                    m.confirmar = 4.0;
                    None
                }
                LinhaTitulo::Novo => Some(TituloAcao::NovoJogo),
                LinhaTitulo::Planeta => Some(TituloAcao::TrocarPlaneta),
                LinhaTitulo::Config => Some(TituloAcao::Config),
            };
        }
    });
    acao
}

// --------------------------------------------------------------------------------------------------------- configurações

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CfgAcao {
    /// uma preferência mudou: gravar e aplicar
    Mudou,
    Voltar,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LinhaCfg {
    Graficos,
    Som,
    Vibracao,
    Tremor,
    Mira,
    TelaCheia,
    Voltar,
}

pub fn config(ctx: &egui::Context, prefs: &mut Prefs, m: &mut Menus, nav: &Nav) -> Option<CfgAcao> {
    let mut linhas = vec![LinhaCfg::Graficos, LinhaCfg::Som, LinhaCfg::Vibracao, LinhaCfg::Tremor, LinhaCfg::Mira];
    // no celular o jogo já ocupa a tela toda
    if !cfg!(target_os = "android") {
        linhas.push(LinhaCfg::TelaCheia);
    }
    linhas.push(LinhaCfg::Voltar);
    navegar(&mut m.sel_cfg, linhas.len(), nav);
    if nav.back {
        return Some(CfgAcao::Voltar);
    }
    let mut acao = None;
    tela_cheia(ctx, "tela-config", |ui, t| {
        let p = ui.painter().clone();
        fundo(&p, t.r, CEU, &ESTRELAS, true, 1.0);
        titulo_da_tela(&p, t, "Configurações");
        let mut y = 84.0;
        for (i, l) in linhas.iter().enumerate() {
            if *l == LinhaCfg::Voltar {
                fio(&p, t, 28.0, y + 10.0, 380.0);
                y += 17.0;
            }
            let sel = m.sel_cfg == i;
            let mira = if prefs.mira_acima { "Acima do dedo" } else { "No dedo" };
            let (rotulo, valor) = match l {
                LinhaCfg::Graficos => ("Gráficos", Valor::Escolha(prefs.qualidade.nome())),
                LinhaCfg::Som => ("Som", Valor::Chave(prefs.som)),
                LinhaCfg::Vibracao => ("Vibração", Valor::Chave(prefs.vibracao)),
                LinhaCfg::Tremor => ("Tremor de tela", Valor::Escolha(prefs.tremor.nome())),
                LinhaCfg::Mira => ("Mira ao segurar", Valor::Escolha(mira)),
                LinhaCfg::TelaCheia => ("Tela cheia", Valor::Chave(prefs.tela_cheia)),
                LinhaCfg::Voltar => ("Voltar", Valor::Nada),
            };
            let resp = linha(ui, t, Id::unique(("config", i)), 28.0, y, 380.0, 34.0, 19.0, rotulo, valor, sel);
            y += 34.0;
            if resp.hovered() {
                m.sel_cfg = i;
            }
            // tocar avança a escolha; no teclado, esquerda e direita andam para os dois lados
            let passo = if resp.clicked() || (sel && nav.ok) || (sel && nav.right) {
                1
            } else if sel && nav.left {
                -1
            } else {
                continue;
            };
            match l {
                LinhaCfg::Graficos => prefs.qualidade = prefs.qualidade.passo(passo),
                LinhaCfg::Som => prefs.som = !prefs.som,
                LinhaCfg::Vibracao => prefs.vibracao = !prefs.vibracao,
                LinhaCfg::Tremor => prefs.tremor = prefs.tremor.passo(passo),
                LinhaCfg::Mira => prefs.mira_acima = !prefs.mira_acima,
                LinhaCfg::TelaCheia => prefs.tela_cheia = !prefs.tela_cheia,
                LinhaCfg::Voltar => {
                    if passo == 1 && !nav.right {
                        acao = Some(CfgAcao::Voltar);
                    }
                    continue;
                }
            }
            acao = Some(CfgAcao::Mudou);
        }
    });
    acao
}

// ------------------------------------------------------------------------------------------------------------------ pausa

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PausaAcao {
    Continuar,
    Salvar,
    Config,
    Controles,
    Teste,
    Sair,
}

pub fn pausa(ctx: &egui::Context, m: &mut Menus, nav: &Nav, dt: f64) -> Option<PausaAcao> {
    m.salvo = (m.salvo - dt).max(0.0);
    const LINHAS: [(&str, PausaAcao); 6] = [
        ("Continuar", PausaAcao::Continuar),
        ("Salvar", PausaAcao::Salvar),
        ("Configurações", PausaAcao::Config),
        ("Controles", PausaAcao::Controles),
        ("Teste de desempenho", PausaAcao::Teste),
        ("Sair para o título", PausaAcao::Sair),
    ];
    navegar(&mut m.sel, LINHAS.len(), nav);
    if nav.back {
        return Some(PausaAcao::Continuar);
    }
    let mut acao = None;
    tela_cheia(ctx, "tela-pausa", |ui, t| {
        let p = ui.painter().clone();
        fundo(&p, t.r, CEU, &ESTRELAS, true, 1.0);
        titulo_da_tela(&p, t, "Pausado");
        let mut y = 84.0;
        for (i, (rotulo, a)) in LINHAS.iter().enumerate() {
            // sair fica separado das ações do dia a dia
            if *a == PausaAcao::Sair {
                fio(&p, t, 28.0, y + 10.0, 320.0);
                y += 17.0;
            }
            let sel = m.sel == i;
            let valor = match a {
                PausaAcao::Salvar if m.salvo > 0.0 => Valor::Aviso(if m.salvo_ok { "salvo" } else { "não deu agora" }),
                _ => Valor::Nada,
            };
            let resp = linha(ui, t, Id::unique(("pausa", i)), 28.0, y, 320.0, 34.0, 19.0, rotulo, valor, sel);
            y += 34.0;
            if resp.hovered() {
                m.sel = i;
            }
            if resp.clicked() || (sel && nav.ok) {
                acao = Some(*a);
            }
        }
    });
    acao
}

// --------------------------------------------------------------------------------------------------------------- controles

/// uma coluna da tela de controles: ação e como fazer
type Lista<'a> = &'a [(&'a str, &'a str)];

/// a lista de controles; `toque` = celular (senão, teclado e mouse). Devolve true para voltar.
pub fn controles(ctx: &egui::Context, nav: &Nav, toque: bool) -> bool {
    let (esq, dir): (Lista, Lista) = if toque {
        (
            &[("Andar", "joystick à esquerda"), ("Pular", "botão embaixo à direita"), ("Girar câmera", "botões < e >"), ("Zoom", "+ e − (segurar)"), ("Menu", "botão ||")],
            &[("Minerar", "segurar à direita"), ("Construir", "CONSTR. e toque rápido"), ("Escolher item", "barra de baixo"), ("Mapa", "botão MAPA")],
        )
    } else {
        (
            &[("Andar", "WASD ou setas"), ("Pular", "espaço"), ("Girar câmera", "Q e E"), ("Zoom", "roda do mouse"), ("Menu", "Esc ou P")],
            &[("Minerar", "segurar o botão esquerdo"), ("Construir", "C ou botão direito"), ("Escolher item", "1 a 8"), ("Mapa", "N")],
        )
    };
    let mut voltar = nav.back || nav.ok;
    tela_cheia(ctx, "tela-controles", |ui, t| {
        let p = ui.painter().clone();
        fundo(&p, t.r, CEU, &ESTRELAS, true, 1.0);
        titulo_da_tela(&p, t, "Controles");
        for (x, coluna) in [(28.0, esq), (436.0, dir)] {
            for (i, (acao, como)) in coluna.iter().enumerate() {
                let cy = t.y(84.0 + 34.0 * i as f32 + 17.0);
                texto(&p, Pos2::new(t.x(x + 22.0), cy), Align2::LEFT_CENTER, acao, t.d(18.0), TINTA, false);
                texto(&p, Pos2::new(t.x(x + 380.0), cy), Align2::RIGHT_CENTER, como, t.d(14.0), FRACO, false);
            }
        }
        let resp = linha(ui, t, Id::unique("controles-voltar"), 28.0, 276.0, 380.0, 34.0, 19.0, "Voltar", Valor::Nada, true);
        voltar |= resp.clicked();
    });
    voltar
}

// ------------------------------------------------------------------------------------------------------------ carregamento

/// período de uma volta da Lua no ícone (s)
const VOLTA_S: f64 = 3.2;

/// Fundo preto estrelado e só o ícone no canto inferior direito: a Terra com a Lua em órbita. Sem texto e sem barra.
/// O ícone é provisório (círculos) até o dono desenhar o dele: `terra.png` e `lua.png` (INTERFACE_NATIVA.md, "5. Carregamento").
/// `alfa` < 1 no fade de saída.
pub fn carregando(ctx: &egui::Context, t_s: f64, alfa: f32) {
    let t = Tela::de(ctx);
    let p = ctx.layer_painter(egui::LayerId::new(egui::Order::Foreground, Id::unique("tela-carregando")));
    fundo(&p, t.r, ESPACO, &ESTRELAS_ESPACO, false, alfa);
    // caixa de 96×96 a 28 pontos das bordas
    let c = Pos2::new(t.r.right() - t.d(28.0 + 48.0), t.r.bottom() - t.d(28.0 + 48.0));
    let terra = rgb(0x2F, 0x6D, 0xB5).gamma_multiply(alfa);
    let verde = rgb(0x4E, 0x9A, 0x5B).gamma_multiply(alfa);
    p.circle_filled(c, t.d(22.0), terra);
    p.add(Shape::ellipse_filled(c + Vec2::new(t.d(-6.0), t.d(-7.0)), Vec2::new(t.d(8.0), t.d(5.0)), verde));
    p.add(Shape::ellipse_filled(c + Vec2::new(t.d(9.0), t.d(7.0)), Vec2::new(t.d(7.0), t.d(5.0)), verde));
    let a = (t_s / VOLTA_S * std::f64::consts::TAU) as f32;
    let lua = c + Vec2::new(a.cos(), a.sin()) * t.d(43.0);
    p.circle_filled(lua, t.d(7.0), rgb(0xC9, 0xC3, 0xCF).gamma_multiply(alfa));
}

/// `spacing --telas <pasta>`: uma captura de cada tela, no tamanho de um celular deitado (844×390 pontos, densidade 2),
/// para conferir o desenho sem abrir o jogo (titulo.png, titulo-sem-salvo.png, config.png, pausa.png, controles.png,
/// carregando.png).
#[cfg(not(target_os = "android"))]
pub fn capturas(dir: &str) {
    use crate::game::{Game, Models};
    use spacing_render::Renderer;
    let _ = std::fs::create_dir_all(dir);
    let (w, h) = (1688u32, 780u32);
    let mut r = match pollster::block_on(Renderer::new_headless(w, h, planet(PlanetId::Lua))) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("sem desenho: {e}");
            std::process::exit(1);
        }
    };
    let models = Models::load(&mut r);
    let egui = egui::Context::default();
    crate::fontes::install(&egui);
    let mut game = Game::new(PlanetId::Lua, crate::DEFAULT_SEED, 2);
    for _ in 0..30 {
        game.update(1.0 / 60.0, &mut crate::controls::Controls::default());
        game.sync(&mut r);
    }
    let nav = Nav::default();
    let prefs = Prefs::default();
    type Desenho<'a> = Box<dyn Fn(&egui::Context, &Game) + 'a>;
    let shots: [(&str, Desenho); 6] = [
        ("titulo", Box::new(|ctx, _| {
            let mut m = Menus::default();
            titulo(ctx, &TituloInfo { planeta: PlanetId::Lua, salvo: Some(150.0) }, &mut m, &nav, 0.0);
        })),
        ("titulo-sem-salvo", Box::new(|ctx, _| {
            let mut m = Menus::default();
            titulo(ctx, &TituloInfo { planeta: PlanetId::Marte, salvo: None }, &mut m, &nav, 0.0);
        })),
        ("config", Box::new(|ctx, _| {
            let (mut m, mut p) = (Menus::default(), prefs);
            config(ctx, &mut p, &mut m, &nav);
        })),
        ("pausa", Box::new(|ctx, _| {
            let mut m = Menus { salvo: 1.0, salvo_ok: true, sel: 1, ..Default::default() };
            pausa(ctx, &mut m, &nav, 0.0);
        })),
        ("controles", Box::new(|ctx, _| {
            controles(ctx, &nav, true);
        })),
        ("carregando", Box::new(|ctx, _| carregando(ctx, 0.8, 1.0))),
    ];
    for (nome, draw) in shots.iter() {
        let path = format!("{dir}/{nome}.png");
        crate::capture::shoot_with(&mut r, &models, &egui, &mut game, &path, None, draw.as_ref());
        println!("{path}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idade_curta() {
        assert_eq!(idade(5.0), "agora");
        assert_eq!(idade(150.0), "2 min");
        assert_eq!(idade(3.0 * 3600.0 + 10.0), "3 h");
        assert_eq!(idade(2.0 * 86400.0), "2 d");
    }

    #[test]
    fn navegar_da_a_volta() {
        let mut s = 0;
        navegar(&mut s, 4, &Nav { up: true, ..Default::default() });
        assert_eq!(s, 3);
        navegar(&mut s, 4, &Nav { down: true, ..Default::default() });
        assert_eq!(s, 0);
        // a lista encolheu: a escolha fica dentro dela
        let mut s = 9;
        navegar(&mut s, 3, &Nav::default());
        assert_eq!(s, 2);
    }
}
