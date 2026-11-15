//! HUD mínimo do M2, desenhado com o egui: botões de toque, joystick, e o medidor (FPS, tempo do quadro, chamadas de
//! desenho, triângulos, chunks) para comparar com o jogo web na mesma semente.
use egui::{Align2, Color32, FontId, Pos2, Rect, Stroke, Vec2};
use glam::Vec3;
use spacing_core::interaction::{AimState, Target};
use spacing_render::FrameStats;

use crate::controls::{Button, Controls};
use crate::game::{item_color, Game};

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
    pub game: &'a Game,
}

/// cor linear do jogo para a tela (sRGB)
fn srgb(c: [f64; 3], a: u8) -> Color32 {
    let f = |v: f64| {
        let v = v.clamp(0.0, 1.0);
        let s = if v <= 0.0031308 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 };
        (s * 255.0).round() as u8
    };
    Color32::from_rgba_unmultiplied(f(c[0]), f(c[1]), f(c[2]), a)
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
            let sw = Rect::from_center_size(r.center() - Vec2::new(0.0, 2.0), Vec2::splat(r.width() * 0.46));
            painter.rect_filled(sw, 3.0, srgb(item_color(st.item), 255));
            painter.text(r.right_bottom() - Vec2::new(4.0, 2.0), Align2::RIGHT_BOTTOM, st.n.to_string(), FontId::monospace(11.0), ink);
        }
    }
    if let (Some(item), Some(b)) = (g.inv.selected_item(), c.buttons.iter().find(|b| b.b == Button::Slot(g.inv.selected() as u8))) {
        let at = pt(c.screen.0 * 0.5, b.y - b.r - 6.0 * ppp);
        painter.text(at + Vec2::new(1.0, 1.0), Align2::CENTER_BOTTOM, &item.data().name, FontId::proportional(13.0), Color32::from_black_alpha(200));
        painter.text(at, Align2::CENTER_BOTTOM, &item.data().name, FontId::proportional(13.0), ink);
    }

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
        Button::Slot(_) => "",
    }
}

pub fn draw(ctx: &egui::Context, c: &Controls, info: &HudInfo) {
    let ppp = ctx.pixels_per_point();
    let painter = ctx.layer_painter(egui::LayerId::background());
    let pt = |x: f32, y: f32| Pos2::new(x / ppp, y / ppp);
    let ink = Color32::from_rgba_unmultiplied(240, 236, 255, 230);
    let glass = Color32::from_rgba_unmultiplied(20, 16, 40, 120);
    let pressed = Color32::from_rgba_unmultiplied(255, 170, 90, 170);

    draw_play(&painter, c, info.game, ppp, ink, glass);
    if c.touched {
        for b in &c.buttons {
            if matches!(b.b, Button::Slot(_)) {
                continue;
            }
            let on = b.b == Button::Build && info.game.interaction.build_mode;
            let fill = if c.pressed(b.b) || on { pressed } else { glass };
            painter.circle(pt(b.x, b.y), b.r / ppp, fill, Stroke::new(1.5, ink));
            let size = match b.b {
                Button::Jump => 15.0,
                Button::Build => 11.0,
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
    let x0 = if c.touched { 28.0 + 24.0 * 12.6 + 12.0 } else { 12.0 };
    let mut y = 10.0;
    for (i, l) in lines.iter().enumerate() {
        let font = FontId::monospace(if i == 0 { 15.0 } else { 12.5 });
        let r = painter.text(Pos2::new(x0 + 1.0, y + 1.0), Align2::LEFT_TOP, l, font.clone(), Color32::from_black_alpha(200));
        painter.text(Pos2::new(x0, y), Align2::LEFT_TOP, l, font, ink);
        y += r.height() + 3.0;
    }
}
