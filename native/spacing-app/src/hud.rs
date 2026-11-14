//! HUD mínimo do M2, desenhado com o egui: botões de toque, joystick, e o medidor (FPS, tempo do quadro, chamadas de
//! desenho, triângulos, chunks) para comparar com o jogo web na mesma semente.
use egui::{Align2, Color32, FontId, Pos2, Stroke};
use spacing_render::FrameStats;

use crate::controls::{Button, Controls};

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
    pub msaa: u32,
    pub planet: &'a str,
    pub seed: u32,
    pub pos: [f64; 3],
    pub chunks: usize,
    pub show_stats: bool,
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
    }
}

pub fn draw(ctx: &egui::Context, c: &Controls, info: &HudInfo) {
    let ppp = ctx.pixels_per_point();
    let painter = ctx.layer_painter(egui::LayerId::background());
    let pt = |x: f32, y: f32| Pos2::new(x / ppp, y / ppp);
    let ink = Color32::from_rgba_unmultiplied(240, 236, 255, 230);
    let glass = Color32::from_rgba_unmultiplied(20, 16, 40, 120);
    let pressed = Color32::from_rgba_unmultiplied(255, 170, 90, 170);

    if c.touched {
        for b in &c.buttons {
            let fill = if c.pressed(b.b) { pressed } else { glass };
            painter.circle(pt(b.x, b.y), b.r / ppp, fill, Stroke::new(1.5, ink));
            let size = if b.b == Button::Jump { 15.0 } else { 18.0 };
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
        lines.push(format!("{} chamadas · {} triângulos", s.draws, tris).replace('.', ","));
        lines.push(format!("chunks: {} na tela de {} ({} no mundo)", s.chunks_drawn, s.chunks_total, info.chunks));
        lines.push(format!("{} · {}×{} · MSAA {}x", info.backend, info.size.0, info.size.1, info.msaa));
        lines.push(format!("{} · semente {} · nativo (Rust)", info.planet, info.seed));
        lines.push(format!("x {:.1}  y {:.1}  z {:.1}", info.pos[0], info.pos[1], info.pos[2]).replace('.', ","));
    }
    // à direita dos dois botões pequenos do canto (controls.rs: margem 28, raio 24)
    let x0 = if c.touched { 28.0 + 24.0 * 4.8 + 12.0 } else { 12.0 };
    let mut y = 10.0;
    for (i, l) in lines.iter().enumerate() {
        let font = FontId::monospace(if i == 0 { 15.0 } else { 12.5 });
        let r = painter.text(Pos2::new(x0 + 1.0, y + 1.0), Align2::LEFT_TOP, l, font.clone(), Color32::from_black_alpha(200));
        painter.text(Pos2::new(x0, y), Align2::LEFT_TOP, l, font, ink);
        y += r.height() + 3.0;
    }
}
