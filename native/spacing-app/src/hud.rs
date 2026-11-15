//! HUD mínimo do M2, desenhado com o egui: botões de toque, joystick, e o medidor (FPS, tempo do quadro, chamadas de
//! desenho, triângulos, chunks) para comparar com o jogo web na mesma semente.
use egui::{Align2, Color32, FontId, Pos2, Rect, Stroke, Vec2};
use glam::Vec3;
use spacing_core::interaction::{AimState, Target};
use spacing_core::planet::planet;
use spacing_render::FrameStats;

use crate::controls::{Button, Controls};
use crate::game::{Game, Screen};
use spacing_core::rules::data::Output;
use spacing_core::rules::{rules, RecipeId, StationId};

/// o que o jogador apertou numa tela (o jogo aplica depois do quadro da interface)
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum UiAction {
    Start(RecipeId, u32),
    Take(StationId, Option<usize>),
    Pause(StationId, usize),
    Cancel(StationId, usize),
    Close,
    /// tela de itens: mover parte de uma pilha, mandar rápido (barra ↔ mochila), organizar a mochila
    Move { from: usize, to: usize, n: u32 },
    QuickMove(usize),
    Sort,
    /// menu: gravar agora, e começar de novo (apaga o salvamento deste planeta)
    Save,
    NewGame,
}

/// nome curto do que a receita entrega
pub fn output_name(o: Output) -> String {
    match o {
        Output::Item { item, .. } => item.data().name.clone(),
        Output::Equip { equip } => equip.data().name.clone(),
        Output::Station { station } => station.data().name.clone(),
    }
}

/// O console: energia da base (porte simplificado do PowerPanel.ts).
fn power_screen(ui: &mut egui::Ui, g: &Game) {
    let p = &g.power;
    let accent = Color32::from_rgb(127, 231, 255);
    ui.heading(egui::RichText::new("Energia da base").color(accent).strong());
    ui.label(egui::RichText::new("Nada vem do nada: a eletricidade vem do sol e fica na bateria.").weak());
    ui.separator();
    ui.label(format!("Sol chegando: {:.0}%", p.sun * 100.0));
    ui.label(format!("Gerando: {:.2} kW (telhado {:.2} kW)", p.generation, p.roof_kw()));
    ui.label(format!("Pedido: {:.2} kW", p.demand));
    ui.add(egui::ProgressBar::new((p.battery / p.capacity()) as f32).text(format!("Bateria {:.0} de {:.0} kJ", p.battery, p.capacity())));
    if p.satisfaction < 1.0 {
        ui.label(egui::RichText::new(format!("Energia faltando: as máquinas andam a {:.0}%", p.satisfaction * 100.0)).color(Color32::from_rgb(255, 180, 90)));
    }
    ui.separator();
    for l in &p.last_loads {
        let name = match l.id.as_str() {
            "life" => "Suporte de vida".to_string(),
            "suit" => "Recarga do traje".to_string(),
            id => StationId::parse(id).map_or(id.to_string(), |s| s.data().name.clone()),
        };
        ui.label(format!("{name}: {:.2} kW", l.kw));
    }
    ui.separator();
    if p.panels.is_empty() {
        ui.label(egui::RichText::new("Sem painéis no chão. Painéis solares são fabricados na bancada.").weak());
    }
    for q in &p.panels {
        let st = if !q.linked {
            "longe demais do cabo".to_string()
        } else {
            format!("{:.2} kW ({:.0}% de luz)", q.kw, q.light * 100.0)
        };
        ui.label(format!("Painel em {}, {}: {st}", q.x, q.z));
    }
    let _ = rules();
}

/// o menu (pausa): continuar, salvar, novo jogo com confirmação
fn menu_screen(ui: &mut egui::Ui, info: &HudInfo, actions: &mut Vec<UiAction>) {
    let accent = Color32::from_rgb(127, 231, 255);
    let g = info.game;
    ui.heading(egui::RichText::new("Pausa").color(accent).strong());
    ui.label(egui::RichText::new(format!("{} · semente {}", planet(g.planet).name, g.seed)).weak());
    ui.separator();
    let v = g.missions.view(&g.inv);
    ui.label(format!("Missão {} de {}: {}", (v.index + 1).min(v.total.max(1)), v.total, v.step.title));
    ui.label(egui::RichText::new(&v.step.text).weak());
    ui.label(format!("Mapa descoberto: {} ladrilhos", g.exploration.revealed));
    ui.separator();
    match info.saved_ago {
        Some(s) if s < 90.0 => ui.label(format!("Salvo há {s:.0} s (grava sozinho a cada 5 s e ao sair)")),
        Some(s) => ui.label(format!("Salvo há {:.0} min", s / 60.0)),
        None => ui.label("Ainda não salvo nesta sessão (grava sozinho a cada 5 s e ao sair)"),
    };
    if let Some(p) = &info.save_path {
        ui.label(egui::RichText::new(p).weak().small());
    }
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        if ui.button("Continuar").clicked() {
            actions.push(UiAction::Close);
        }
        if ui.button("Salvar agora").clicked() {
            actions.push(UiAction::Save);
        }
    });
    ui.add_space(14.0);
    // novo jogo pede um segundo toque
    let id = egui::Id::unique("confirmar-novo-jogo");
    let armed = ui.ctx().data(|d| d.get_temp::<bool>(id)).unwrap_or(false);
    if !armed {
        if ui.button("Novo jogo…").clicked() {
            ui.ctx().data_mut(|d| d.insert_temp(id, true));
        }
    } else {
        ui.label(egui::RichText::new(format!("Apagar o progresso de {} e começar um mundo novo?", planet(g.planet).name)).color(Color32::from_rgb(255, 180, 90)));
        ui.horizontal(|ui| {
            if ui.button("Sim, começar de novo").clicked() {
                ui.ctx().data_mut(|d| d.insert_temp(id, false));
                actions.push(UiAction::NewGame);
                actions.push(UiAction::Close);
            }
            if ui.button("Não").clicked() {
                ui.ctx().data_mut(|d| d.insert_temp(id, false));
            }
        });
    }
}

/// média de FPS e pior quadro a cada meio segundo
#[derive(Default)]
pub struct Meter {
    acc: f64,
    frames: u32,
    worst: f64,
    pub fps: f64,
    pub ms: f64,
    pub worst_ms: f64,
}

impl Meter {
    pub fn frame(&mut self, dt: f64) {
        self.acc += dt;
        self.frames += 1;
        self.worst = self.worst.max(dt);
        if self.acc >= 0.5 {
            self.fps = self.frames as f64 / self.acc;
            self.ms = self.acc * 1000.0 / self.frames as f64;
            self.worst_ms = self.worst * 1000.0;
            self.acc = 0.0;
            self.frames = 0;
            self.worst = 0.0;
        }
    }
}

pub struct HudInfo<'a> {
    pub meter: &'a Meter,
    pub stats: FrameStats,
    pub backend: &'a str,
    pub size: (u32, u32),
    /// onde a cena 3D é desenhada (a resolução dinâmica mexe)
    pub scene: (u32, u32),
    pub msaa: u32,
    pub present: &'a str,
    pub planet: &'a str,
    pub seed: u32,
    pub pos: [f64; 3],
    pub chunks: usize,
    pub show_stats: bool,
    /// teste de efeitos: o que está medindo agora, ou o resultado
    pub bench: Vec<String>,
    /// segundos desde o último salvamento, e onde ele fica
    pub saved_ago: Option<f64>,
    pub save_path: Option<String>,
    pub game: &'a Game,
}

/// Medidores do traje, barra de itens, mira, contorno do alvo, avisos e o cartão de morte (Hud.ts, SurvivalDirector).
fn draw_play(painter: &egui::Painter, c: &Controls, g: &Game, ppp: f32, ink: Color32, glass: Color32) {
    let pt = |x: f32, y: f32| Pos2::new(x / ppp, y / ppp);
    // contorno do alvo e do bloco a colocar: a caixa projetada na tela
    let project = |p: Vec3| {
        let q = g.view_proj * p.extend(1.0);
        (q.w > 0.0).then(|| Pos2::new((q.x / q.w * 0.5 + 0.5) * g.screen.0 / ppp, (0.5 - q.y / q.w * 0.5) * g.screen.1 / ppp))
    };
    let cube = |ctr: [f64; 3], size: f32, color: Color32| {
        let h = size * 0.5;
        let c = Vec3::new(ctr[0] as f32, ctr[1] as f32, ctr[2] as f32);
        let corner = |i: usize| c + Vec3::new(if i & 1 == 0 { -h } else { h }, if i & 2 == 0 { -h } else { h }, if i & 4 == 0 { -h } else { h });
        for (a, b) in [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)] {
            if let (Some(p), Some(q)) = (project(corner(a)), project(corner(b))) {
                painter.line_segment([p, q], Stroke::new(1.6, color));
            }
        }
    };
    let it = &g.interaction;
    if let Some(t) = &it.target {
        let reach = spacing_core::interaction::in_reach(&g.player, t);
        let weak = it.aim == Some(AimState::Hard);
        let col = if !reach || (weak && !it.build_mode) {
            Color32::from_rgb(255, 143, 122)
        } else if it.build_mode {
            Color32::from_rgb(127, 231, 255)
        } else {
            Color32::WHITE
        };
        cube(t.center(), t.size() as f32, col);
        if let (Target::Block(h), true, true) = (t, reach, it.build_mode) {
            if g.inv.selected_block_item().is_some() {
                let p = [(h.x + h.normal[0]) as f64 + 0.5, (h.y + h.normal[1]) as f64 + 0.5, (h.z + h.normal[2]) as f64 + 0.5];
                cube(p, 1.0, Color32::from_rgba_unmultiplied(127, 231, 255, 150));
            }
        }
    }
    // mira acima do dedo, com o anel de progresso
    if let Some((p, holding)) = g.pointer {
        if p.touch && holding && !it.build_mode {
            let col = match it.aim {
                Some(AimState::Ok) => Color32::WHITE,
                Some(AimState::Far) => Color32::from_rgb(255, 214, 120),
                Some(AimState::Hard) => Color32::from_rgb(255, 120, 100),
                _ => Color32::from_white_alpha(140),
            };
            painter.line_segment([pt(p.fx, p.fy), pt(p.x, p.y)], Stroke::new(1.0, Color32::from_white_alpha(60)));
            painter.circle_stroke(pt(p.x, p.y), 9.0, Stroke::new(2.0, col));
            painter.circle_filled(pt(p.x, p.y), 1.8, col);
        }
        if let Some(f) = it.progress {
            let ctr = pt(p.x, p.y);
            let n = 32;
            let pts: Vec<Pos2> = (0..=((n as f64 * f) as usize)).map(|i| {
                let a = -std::f32::consts::FRAC_PI_2 + i as f32 / n as f32 * std::f32::consts::TAU;
                ctr + Vec2::new(a.cos(), a.sin()) * 16.0
            }).collect();
            painter.circle_stroke(ctr, 16.0, Stroke::new(3.0, Color32::from_black_alpha(90)));
            painter.add(egui::Shape::line(pts, Stroke::new(3.0, Color32::from_rgb(255, 196, 90))));
        }
    }

    // medidores do traje (embaixo dos botões do canto)
    let s = &g.survival;
    let meters = [("O₂", s.o2, 30.0, 15.0), ("Bateria", s.battery, 20.0, 10.0), ("Traje", s.integrity, 35.0, 15.0), ("Energia", s.energy, 30.0, 10.0)];
    let (mx, mut my) = (14.0, 90.0);
    painter.rect_filled(Rect::from_min_size(Pos2::new(mx - 6.0, my - 10.0), Vec2::new(186.0, 17.0 * 4.0 + if s.in_pressure { 18.0 } else { 3.0 })), 6.0, glass);
    for (name, v, warn, crit) in meters {
        let col = if v <= crit {
            Color32::from_rgb(255, 106, 85)
        } else if v <= warn {
            Color32::from_rgb(255, 182, 72)
        } else {
            Color32::from_rgb(127, 231, 255)
        };
        painter.text(Pos2::new(mx, my), Align2::LEFT_CENTER, name, FontId::proportional(12.0), ink);
        let bar = Rect::from_min_size(Pos2::new(mx + 54.0, my - 4.0), Vec2::new(90.0, 8.0));
        painter.rect_filled(bar, 3.0, glass);
        painter.rect_filled(Rect::from_min_size(bar.min, Vec2::new(90.0 * (v / 100.0).clamp(0.0, 1.0) as f32, 8.0)), 3.0, col);
        painter.text(Pos2::new(mx + 150.0, my), Align2::LEFT_CENTER, format!("{v:.0}"), FontId::monospace(11.0), ink);
        my += 17.0;
    }
    if s.in_pressure {
        painter.text(Pos2::new(mx, my), Align2::LEFT_CENTER, "recarregando no módulo", FontId::proportional(11.0), Color32::from_rgb(127, 231, 255));
    }

    // barra de itens
    for b in c.buttons.iter() {
        let Button::Slot(i) = b.b else { continue };
        let r = Rect::from_center_size(pt(b.x, b.y), Vec2::splat(b.r * 2.0 / ppp));
        let sel = g.inv.selected() == i as usize;
        painter.rect_filled(r, 6.0, glass);
        painter.rect_stroke(r, 6.0, Stroke::new(if sel { 2.5 } else { 1.0 }, if sel { Color32::from_rgb(255, 196, 90) } else { ink }), egui::StrokeKind::Inside);
        if let Some(st) = g.inv.slot(i as usize) {
            let sw = Rect::from_center_size(r.center() - Vec2::new(0.0, 1.0), Vec2::splat(r.width() * 0.86));
            crate::icons::paint_item(painter, sw, st.item, Color32::WHITE);
            painter.text(r.right_bottom() - Vec2::new(4.0, 2.0), Align2::RIGHT_BOTTOM, st.n.to_string(), FontId::monospace(11.0), ink);
        }
    }
    if let (Some(item), Some(b)) = (g.inv.selected_item(), c.buttons.iter().find(|b| b.b == Button::Slot(g.inv.selected() as u8))) {
        let at = pt(c.screen.0 * 0.5, b.y - b.r - 6.0 * ppp);
        painter.text(at + Vec2::new(1.0, 1.0), Align2::CENTER_BOTTOM, &item.data().name, FontId::proportional(13.0), Color32::from_black_alpha(200));
        painter.text(at, Align2::CENTER_BOTTOM, &item.data().name, FontId::proportional(13.0), ink);
    }

    // botão de ação
    if let (Some(label), Some(b)) = (&g.base.use_label, c.buttons.iter().find(|b| b.b == Button::Use)) {
        if c.use_visible && !c.modal {
            let r = Rect::from_center_size(pt(b.x, b.y), Vec2::new(b.r * 8.0 / ppp, b.r * 2.0 / ppp));
            let fill = if c.pressed(Button::Use) { Color32::from_rgba_unmultiplied(255, 170, 90, 200) } else { Color32::from_rgba_unmultiplied(20, 30, 60, 200) };
            painter.rect_filled(r, b.r / ppp, fill);
            painter.rect_stroke(r, b.r / ppp, Stroke::new(1.5, Color32::from_rgb(127, 231, 255)), egui::StrokeKind::Inside);
            painter.text(r.center(), Align2::CENTER_CENTER, label, FontId::proportional(15.0), ink);
        }
    }
    // câmara de pressurização e descanso
    let (sw, sh) = (c.screen.0 / ppp, c.screen.1 / ppp);
    if let Some((title, sub, f)) = g.base.airlock {
        let ctr = Pos2::new(sw * 0.5, sh * 0.42);
        painter.rect_filled(Rect::from_center_size(ctr, Vec2::new(300.0, 96.0)), 10.0, Color32::from_rgba_unmultiplied(10, 12, 28, 220));
        painter.text(ctr - Vec2::new(0.0, 26.0), Align2::CENTER_CENTER, title, FontId::proportional(18.0), ink);
        painter.text(ctr - Vec2::new(0.0, 2.0), Align2::CENTER_CENTER, sub, FontId::proportional(13.0), Color32::from_rgb(127, 231, 255));
        let bar = Rect::from_center_size(ctr + Vec2::new(0.0, 26.0), Vec2::new(240.0, 8.0));
        painter.rect_filled(bar, 4.0, glass);
        painter.rect_filled(Rect::from_min_size(bar.min, Vec2::new(240.0 * f as f32, 8.0)), 4.0, Color32::from_rgb(127, 231, 255));
    }
    if let Some(msg) = g.base.fade {
        painter.rect_filled(Rect::from_min_size(Pos2::ZERO, Vec2::new(sw, sh)), 0.0, Color32::from_black_alpha(210));
        painter.text(Pos2::new(sw * 0.5, sh * 0.5), Align2::CENTER_CENTER, msg, FontId::proportional(20.0), ink);
    }
    // etiqueta da obra da estufa, presa acima dela
    if let Some((at, pips, next, foot)) = g.site_label() {
        if let Some(p) = project(Vec3::new(at[0] as f32, at[1] as f32, at[2] as f32)) {
            let r = Rect::from_center_size(p, Vec2::new(250.0, 92.0));
            painter.rect_filled(r, 10.0, Color32::from_rgba_unmultiplied(8, 24, 32, 220));
            painter.rect_stroke(r, 10.0, Stroke::new(1.5, Color32::from_rgb(111, 231, 255)), egui::StrokeKind::Inside);
            painter.text(r.left_top() + Vec2::new(12.0, 8.0), Align2::LEFT_TOP, "Estufa", FontId::proportional(16.0), Color32::from_rgb(159, 240, 255));
            for (i, on) in pips.iter().enumerate() {
                let x = r.right() - 14.0 - (pips.len() - 1 - i) as f32 * 14.0;
                painter.circle_filled(Pos2::new(x, r.top() + 17.0), 5.0, if *on { Color32::from_rgb(127, 224, 138) } else { Color32::from_rgba_unmultiplied(127, 163, 173, 90) });
            }
            if let Some((name, cost)) = next {
                painter.text(r.left_top() + Vec2::new(12.0, 32.0), Align2::LEFT_TOP, name, FontId::proportional(14.0), Color32::WHITE);
                painter.text(r.left_top() + Vec2::new(12.0, 50.0), Align2::LEFT_TOP, cost, FontId::proportional(12.0), Color32::from_rgb(191, 234, 242));
            }
            painter.text(r.left_bottom() + Vec2::new(12.0, -8.0), Align2::LEFT_BOTTOM, foot, FontId::proportional(12.0), Color32::from_rgb(255, 211, 122));
        }
    }
    draw_mission(painter, g, ppp, &project, ink, glass);
    // avisos
    let mut y = c.screen.1 / ppp * 0.3;
    for (msg, t) in &g.toasts {
        let a = (t.min(1.0) * 230.0) as u8;
        let r = painter.text(Pos2::new(c.screen.0 / ppp * 0.5, y), Align2::CENTER_CENTER, msg, FontId::proportional(15.0), Color32::from_rgba_unmultiplied(255, 240, 220, a));
        painter.rect_filled(r.expand(6.0), 6.0, Color32::from_rgba_unmultiplied(10, 8, 24, a / 2));
        painter.text(Pos2::new(c.screen.0 / ppp * 0.5, y), Align2::CENTER_CENTER, msg, FontId::proportional(15.0), Color32::from_rgba_unmultiplied(255, 240, 220, a));
        y += 30.0;
    }

    // morte
    if let Some(d) = g.death {
        if d.t >= 1.6 {
            let ctr = Pos2::new(c.screen.0 / ppp * 0.5, c.screen.1 / ppp * 0.45);
            painter.rect_filled(Rect::from_center_size(ctr, Vec2::new(340.0, 130.0)), 10.0, Color32::from_rgba_unmultiplied(12, 8, 28, 220));
            painter.text(ctr - Vec2::new(0.0, 38.0), Align2::CENTER_CENTER, "Você morreu", FontId::proportional(22.0), Color32::from_rgb(255, 120, 100));
            painter.text(ctr - Vec2::new(0.0, 8.0), Align2::CENTER_CENTER, Game::death_text(d.cause), FontId::proportional(15.0), ink);
            if d.lost {
                painter.text(ctr + Vec2::new(0.0, 16.0), Align2::CENTER_CENTER, "Seus itens ficaram no chão", FontId::proportional(13.0), ink);
            }
            painter.text(ctr + Vec2::new(0.0, 44.0), Align2::CENTER_CENTER, "Toque para renascer no módulo", FontId::proportional(14.0), Color32::from_rgb(127, 231, 255));
        }
    }
}

fn label(b: Button) -> &'static str {
    match b {
        Button::Jump => "PULAR",
        Button::RotL => "<",
        Button::RotR => ">",
        Button::ZoomIn => "+",
        Button::ZoomOut => "-",
        Button::Stats => "i",
        Button::Planet => "M",
        Button::Vsync => "V",
        Button::Meteor => "*",
        Button::Bench => "B",
        Button::Build => "CONSTR.",
        Button::Slot(_) | Button::Use => "",
        Button::Close => "X",
        Button::Menu => "||",
        Button::Map => "MAPA",
        Button::Bag => "BOLSA",
    }
}

/// Cartão da missão (canto de cima à direita), banner de objetivo concluído e o marcador do objetivo: um losango em cima do
/// ponto, com a distância, ou uma seta na borda da tela quando ele está fora dela.
fn draw_mission(painter: &egui::Painter, g: &Game, ppp: f32, project: &dyn Fn(Vec3) -> Option<Pos2>, ink: Color32, glass: Color32) {
    let (w, h) = (g.screen.0 / ppp, g.screen.1 / ppp);
    let v = g.missions.view(&g.inv);
    let cyan = Color32::from_rgb(127, 231, 255);
    let card_w = 236.0;
    // embaixo dos medidores do traje (canto de cima à esquerda)
    let x0 = 8.0;
    let mut lines: Vec<(String, f32, Color32)> = vec![
        (if v.done { "Missão concluída".into() } else { format!("Missão {} de {}", v.index + 1, v.total) }, 11.0, cyan),
        (v.step.title.clone(), 15.0, Color32::WHITE),
        (v.step.text.clone(), 12.0, ink),
    ];
    if let Some(n) = &v.needs {
        for (item, have, need) in n {
            let col = if have >= need { Color32::from_rgb(140, 240, 160) } else { ink };
            lines.push((format!("{} {have}/{need}", item.data().name), 12.0, col));
        }
    }
    let bar = v.progress.filter(|_| v.needs.is_none());
    let galleys: Vec<_> = lines.iter().map(|(t, size, col)| painter.layout(t.clone(), FontId::proportional(*size), *col, card_w - 20.0)).collect();
    let text_h: f32 = galleys.iter().map(|g| g.size().y + 4.0).sum::<f32>() + if bar.is_some() { 14.0 } else { 0.0 };
    let rect = Rect::from_min_size(Pos2::new(x0, 174.0), Vec2::new(card_w, text_h + 12.0));
    painter.rect_filled(rect, 8.0, glass);
    let mut y = rect.min.y + 7.0;
    for (galley, (_, _, col)) in galleys.into_iter().zip(&lines) {
        let gh = galley.size().y;
        painter.galley(Pos2::new(x0 + 10.0, y), galley, *col);
        y += gh + 4.0;
    }
    if let Some(f) = bar {
        let b = Rect::from_min_size(Pos2::new(x0 + 10.0, y + 2.0), Vec2::new(card_w - 20.0 - 50.0, 7.0));
        painter.rect_filled(b, 3.0, Color32::from_black_alpha(90));
        painter.rect_filled(Rect::from_min_size(b.min, Vec2::new(b.width() * f as f32, 7.0)), 3.0, cyan);
        let label = v.collected.map_or(format!("{:.0}%", f * 100.0), |c| {
            let n = match v.step.kind {
                spacing_core::rules::data::StepKind::Collect { n, .. } => n,
                _ => 0,
            };
            format!("{c}/{n}")
        });
        painter.text(Pos2::new(b.max.x + 8.0, b.center().y), Align2::LEFT_CENTER, label, FontId::monospace(11.0), ink);
    }

    // objetivo concluído
    if let Some((title, t)) = &g.banner {
        let a = ((*t).min(0.5) / 0.5 * 235.0) as u8;
        let ctr = Pos2::new(w * 0.5, h * 0.18);
        painter.rect_filled(Rect::from_center_size(ctr, Vec2::new(360.0, 64.0)), 10.0, Color32::from_rgba_unmultiplied(10, 30, 40, a));
        painter.text(ctr - Vec2::new(0.0, 12.0), Align2::CENTER_CENTER, "Objetivo concluído", FontId::proportional(13.0), Color32::from_rgba_unmultiplied(127, 231, 255, a));
        painter.text(ctr + Vec2::new(0.0, 10.0), Align2::CENTER_CENTER, title, FontId::proportional(19.0), Color32::from_rgba_unmultiplied(255, 255, 255, a));
    }

    // marcador
    let Some(t) = g.mission_target() else { return };
    if g.base.indoor_view {
        return;
    }
    let p = g.player.pos;
    let dist = spacing_core::js::hypot(t[0] - p[0], t[2] - p[2]);
    let top = Vec3::new(t[0] as f32, t[1] as f32 + 1.6, t[2] as f32);
    let margin = 30.0;
    let on = project(top).filter(|q| q.x > margin && q.x < w - margin && q.y > margin && q.y < h - margin);
    match on {
        Some(q) => {
            let s = 8.0;
            let pts = vec![q + Vec2::new(0.0, -s), q + Vec2::new(s, 0.0), q + Vec2::new(0.0, s), q + Vec2::new(-s, 0.0)];
            painter.add(egui::Shape::convex_polygon(pts, Color32::from_rgba_unmultiplied(127, 231, 255, 200), Stroke::new(1.5, Color32::WHITE)));
            if dist > 4.0 {
                painter.text(q + Vec2::new(0.0, -18.0), Align2::CENTER_CENTER, format!("{dist:.0} m"), FontId::monospace(11.0), Color32::WHITE);
            }
        }
        None => {
            // direção na tela: do centro para o ponto projetado (atrás da câmera, invertido)
            let ctr = Pos2::new(w * 0.5, h * 0.5);
            let q = g.view_proj * top.extend(1.0);
            let mut d = Vec2::new(q.x / q.w.abs().max(1e-4), -q.y / q.w.abs().max(1e-4));
            if q.w < 0.0 {
                d = -d;
            }
            let d = if d.length() < 1e-4 { Vec2::new(0.0, -1.0) } else { d.normalized() };
            let k = ((w * 0.5 - margin) / d.x.abs().max(1e-4)).min((h * 0.5 - margin) / d.y.abs().max(1e-4));
            let at = ctr + d * k;
            let side = Vec2::new(-d.y, d.x);
            let pts = vec![at + d * 12.0, at - d * 6.0 + side * 9.0, at - d * 6.0 - side * 9.0];
            painter.add(egui::Shape::convex_polygon(pts, Color32::from_rgba_unmultiplied(127, 231, 255, 220), Stroke::new(1.5, Color32::WHITE)));
            painter.text(at - d * 22.0, Align2::CENTER_CENTER, format!("{dist:.0} m"), FontId::monospace(11.0), Color32::WHITE);
        }
    }
}

pub fn draw(ctx: &egui::Context, c: &Controls, info: &HudInfo) -> Vec<UiAction> {
    let mut actions = Vec::new();
    // telas abrem na hora (sem o esmaecer do egui) e opacas
    ctx.all_styles_mut(|s| {
        s.animation_time = 0.0;
        s.visuals.window_fill = Color32::from_rgb(16, 18, 34);
    });
    let item_screen = matches!(info.game.screen_open, Some(Screen::Bag | Screen::Station(_)));
    if let Some(screen) = info.game.screen_open.filter(|_| item_screen) {
        crate::items_screen::draw(ctx, info.game, screen, &mut actions);
    }
    if let Some(screen) = info.game.screen_open.filter(|_| !item_screen) {
        let r = ctx.content_rect();
        let size = egui::vec2(r.width() * 0.86, r.height() * 0.8);
        egui::Window::new("tela")
            .title_bar(false)
            .resizable(false)
            .collapsible(false)
            .fixed_size(size)
            .anchor(Align2::CENTER_CENTER, egui::vec2(0.0, -10.0))
            .show(ctx, |ui| {
                ui.style_mut().text_styles.insert(egui::TextStyle::Body, FontId::proportional(15.0));
                ui.style_mut().text_styles.insert(egui::TextStyle::Button, FontId::proportional(16.0));
                ui.style_mut().spacing.button_padding = egui::vec2(12.0, 7.0);
                match screen {
                    Screen::Bag | Screen::Station(_) => {}
                    Screen::Power => power_screen(ui, info.game),
                    Screen::Menu => menu_screen(ui, info, &mut actions),
                    Screen::Map => crate::map::map_screen(ui, info.game, &mut actions),
                }
            });
    }
    let ppp = ctx.pixels_per_point();
    let painter = ctx.layer_painter(egui::LayerId::background());
    let pt = |x: f32, y: f32| Pos2::new(x / ppp, y / ppp);
    let ink = Color32::from_rgba_unmultiplied(240, 236, 255, 230);
    let glass = Color32::from_rgba_unmultiplied(20, 16, 40, 120);
    let pressed = Color32::from_rgba_unmultiplied(255, 170, 90, 170);

    draw_play(&painter, c, info.game, ppp, ink, glass);
    if c.touched {
        for b in &c.buttons {
            if matches!(b.b, Button::Slot(_) | Button::Use) || (b.b == Button::Close) != c.modal {
                continue;
            }
            let on = b.b == Button::Build && info.game.interaction.build_mode;
            let fill = if c.pressed(b.b) || on { pressed } else { glass };
            painter.circle(pt(b.x, b.y), b.r / ppp, fill, Stroke::new(1.5, ink));
            let size = match b.b {
                Button::Jump => 15.0,
                Button::Build | Button::Map | Button::Bag => 11.0,
                _ => 18.0,
            };
            painter.text(pt(b.x, b.y), Align2::CENTER_CENTER, label(b.b), FontId::proportional(size), ink);
        }
        if let Some((ox, oy, x, y)) = c.stick() {
            painter.circle(pt(ox, oy), c.stick_r / ppp, glass, Stroke::new(1.5, ink));
            painter.circle_filled(pt(x, y), c.stick_r * 0.42 / ppp, Color32::from_rgba_unmultiplied(240, 236, 255, 150));
        }
    }

    let m = info.meter;
    let s = info.stats;
    let fps = format!("{:.0} FPS  {:.1} ms (pior {:.1})", m.fps, m.ms, m.worst_ms).replace('.', ",");
    let mut lines = vec![fps];
    if info.show_stats {
        let tris = if s.triangles >= 1_000_000 { format!("{:.2} mi", s.triangles as f64 / 1e6) } else { format!("{} mil", s.triangles / 1000) };
        lines.push(format!("{} chamadas (+{} na sombra) · {} triângulos · {} passadas de pós", s.draws, s.shadow_draws, tris, s.post_passes).replace('.', ","));
        lines.push(format!("chunks: {} na tela de {} ({} no mundo)", s.chunks_drawn, s.chunks_total, info.chunks));
        lines.push(format!("{} · cena {}×{} de {}×{} · MSAA {}x · {}", info.backend, info.scene.0, info.scene.1, info.size.0, info.size.1, info.msaa, info.present));
        lines.push(format!("{} · semente {} · nativo (Rust)", info.planet, info.seed));
        lines.push(format!("x {:.1}  y {:.1}  z {:.1}", info.pos[0], info.pos[1], info.pos[2]).replace('.', ","));
    }
    lines.extend(info.bench.iter().cloned());
    // à direita dos botões pequenos do canto (controls.rs: margem 28, raio 24)
    let x0 = if c.touched { 28.0 + 24.0 * 17.8 + 12.0 } else { 12.0 };
    let mut y = 10.0;
    for (i, l) in lines.iter().enumerate() {
        let font = FontId::monospace(if i == 0 { 15.0 } else { 12.5 });
        let r = painter.text(Pos2::new(x0 + 1.0, y + 1.0), Align2::LEFT_TOP, l, font.clone(), Color32::from_black_alpha(200));
        painter.text(Pos2::new(x0, y), Align2::LEFT_TOP, l, font, ink);
        y += r.height() + 3.0;
    }
    actions
}
