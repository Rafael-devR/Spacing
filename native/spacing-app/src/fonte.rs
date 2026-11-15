//! Teste da fonte de pixel (docs/design/INTERFACE_NATIVA.md): instala a Pixelify Sans (OFL, em `assets/fonts/pixelify-sans/`) como
//! fonte do egui e desenha uma folha de amostras por cima do mundo: tamanhos de texto, medidores, nomes de itens, números e os
//! acentos do português. Só para aprovar a fonte pela imagem; a estrutura das telas não entra aqui.
//! Uso: `spacing --fonte <pasta>` grava `fonte.png`.
use std::sync::Arc;

use egui::{Align2, Color32, FontData, FontDefinitions, FontFamily, FontId, Pos2, Rect, Stroke, Vec2};
use spacing_core::planet::{planet, PlanetId};
use spacing_render::Renderer;

use crate::game::{Game, Models};

static PIXELIFY: &[u8] = include_bytes!("../../assets/fonts/pixelify-sans/PixelifySans.ttf");

/// põe a Pixelify Sans como fonte padrão do egui (a primeira da lista de texto proporcional)
pub fn install(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert("pixelify".into(), Arc::new(FontData::from_static(PIXELIFY)));
    fonts.families.entry(FontFamily::Proportional).or_default().insert(0, "pixelify".into());
    ctx.set_fonts(fonts);
}

const INK: Color32 = Color32::from_rgb(226, 232, 246);
const DIM: Color32 = Color32::from_rgb(132, 142, 170);
const CYAN: Color32 = Color32::from_rgb(127, 231, 255);
const GREEN: Color32 = Color32::from_rgb(120, 236, 150);
const RED: Color32 = Color32::from_rgb(255, 118, 100);
const AMBER: Color32 = Color32::from_rgb(255, 196, 90);

/// uma linha de amostra: o texto no tamanho `size`, com a medida ao lado
fn line(p: &egui::Painter, at: Pos2, size: f32, col: Color32, text: &str) -> f32 {
    let g = p.layout_no_wrap(text.to_string(), FontId::new(size, FontFamily::Proportional), col);
    let h = g.size().y;
    p.rect_filled(Rect::from_min_size(at - Vec2::new(6.0, 2.0), Vec2::new(g.size().x + 12.0, h + 4.0)), 3.0, Color32::from_rgba_unmultiplied(5, 7, 14, 200));
    p.galley(at, g, col);
    h + 8.0
}

pub fn sheet(ctx: &egui::Context) {
    let p = ctx.layer_painter(egui::LayerId::new(egui::Order::Foreground, egui::Id::unique("fonte")));
    let (w, h) = {
        let r = ctx.content_rect();
        (r.width(), r.height())
    };
    let mut y = 14.0;
    let x = 14.0;
    p.text(Pos2::new(x, y), Align2::LEFT_TOP, "Pixelify Sans · amostras", FontId::new(18.0, FontFamily::Proportional), CYAN);
    y += 30.0;
    p.text(Pos2::new(x, y), Align2::LEFT_TOP, "tamanhos de texto: 12 · 14 · 18 pt (no celular a escala é maior, pela densidade da tela)", FontId::new(12.0, FontFamily::Proportional), DIM);
    y += 24.0;

    // o mesmo texto nos três tamanhos
    for size in [12.0, 14.0, 18.0] {
        y += line(&p, Pos2::new(x, y), size, INK, &format!("{size:.0} pt · Arraste para mover · segure para pegar metade · toque duas vezes para mandar à barra"));
    }
    y += 10.0;

    // medidores do traje (como estão no HUD)
    p.text(Pos2::new(x, y), Align2::LEFT_TOP, "medidores", FontId::new(12.0, FontFamily::Proportional), DIM);
    y += 18.0;
    for (name, v, col) in [("O₂", 100, CYAN), ("Bateria", 99, CYAN), ("Traje", 100, CYAN), ("Energia", 42, AMBER), ("Fome", 9, RED)] {
        let bar = Rect::from_min_size(Pos2::new(x + 120.0, y + 4.0), Vec2::new(120.0, 8.0));
        p.text(Pos2::new(x, y), Align2::LEFT_TOP, name, FontId::new(14.0, FontFamily::Proportional), INK);
        p.rect_filled(bar, 3.0, Color32::from_rgba_unmultiplied(20, 16, 40, 160));
        p.rect_filled(Rect::from_min_size(bar.min, Vec2::new(bar.width() * v as f32 / 100.0, 8.0)), 3.0, col);
        p.text(Pos2::new(x + 250.0, y), Align2::LEFT_TOP, format!("{v}"), FontId::monospace(13.0), INK);
        y += 22.0;
    }
    y += 10.0;

    // nomes de itens e a receita
    p.text(Pos2::new(x, y), Align2::LEFT_TOP, "nomes e receitas", FontId::new(12.0, FontFamily::Proportional), DIM);
    y += 18.0;
    for t in ["Placa de circuito", "Barra de ferro", "Óxido de titânio", "Cilindro de O₂", "Lingote de titânio", "Projeto da estufa"] {
        y += line(&p, Pos2::new(x, y), 14.0, INK, t);
    }
    y += 10.0;

    // números, unidades e símbolos
    p.text(Pos2::new(x, y), Align2::LEFT_TOP, "números e unidades", FontId::new(12.0, FontFamily::Proportional), DIM);
    y += 18.0;
    y += line(&p, Pos2::new(x, y), 14.0, GREEN, "0123456789 · 1600 °C · 1,6 kW · 12:34 · 4 s · 3/12 · ×6");
    y += line(&p, Pos2::new(x, y), 14.0, RED, "Faltam: 4 minério de ferro, 2 gelo · falta energia");
    y += 10.0;

    // acentos
    p.text(Pos2::new(x, y), Align2::LEFT_TOP, "acentos", FontId::new(12.0, FontFamily::Proportional), DIM);
    y += 18.0;
    y += line(&p, Pos2::new(x, y), 14.0, INK, "áéíóúàâêôãõç ÁÉÍÓÚÀÂÊÔÃÕÇ ü ñ");
    line(&p, Pos2::new(x, y), 14.0, INK, "Missão 1 de 6 · Primeiros passos · Colete regolito da superfície");

    // lado direito: cartão de missão e objetivo, como apareceriam
    let rx = w - 300.0;
    let card = Rect::from_min_size(Pos2::new(rx, 14.0), Vec2::new(286.0, 96.0));
    p.rect_filled(card, 6.0, Color32::from_rgba_unmultiplied(5, 7, 14, 232));
    p.rect_stroke(card, 6.0, Stroke::new(1.0, Color32::from_rgb(52, 60, 84)), egui::StrokeKind::Inside);
    p.text(card.min + Vec2::new(10.0, 8.0), Align2::LEFT_TOP, "Missão 1 de 6", FontId::new(12.0, FontFamily::Proportional), CYAN);
    p.text(card.min + Vec2::new(10.0, 24.0), Align2::LEFT_TOP, "Primeiros passos", FontId::new(18.0, FontFamily::Proportional), INK);
    p.text(card.min + Vec2::new(10.0, 52.0), Align2::LEFT_TOP, "Colete regolito da superfície", FontId::new(14.0, FontFamily::Proportional), DIM);
    p.text(card.min + Vec2::new(10.0, 74.0), Align2::LEFT_TOP, "0/8", FontId::monospace(12.0), INK);
    // marcador com distância
    let c = Pos2::new(w * 0.5, h * 0.45);
    p.text(c + Vec2::new(0.0, -18.0), Align2::CENTER_CENTER, "Objetivo · 450 m", FontId::new(14.0, FontFamily::Proportional), CYAN);
    p.rect_filled(Rect::from_center_size(c, Vec2::splat(14.0)), 1.0, CYAN);
    // aviso
    p.text(Pos2::new(w * 0.5, h - 60.0), Align2::CENTER_CENTER, "Oxigênio baixo", FontId::new(18.0, FontFamily::Proportional), AMBER);
}

pub fn run(dir: &str) {
    let _ = std::fs::create_dir_all(dir);
    let (w, h) = (1280u32, 720u32);
    let mut r = match pollster::block_on(Renderer::new_headless(w, h, planet(PlanetId::Lua))) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("sem desenho: {e}");
            std::process::exit(1);
        }
    };
    let models = Models::load(&mut r);
    let egui = egui::Context::default();
    install(&egui);
    let mut game = Game::new(PlanetId::Lua, crate::DEFAULT_SEED, 2);
    for _ in 0..60 {
        game.update(1.0 / 60.0, &mut crate::controls::Controls::default());
        game.sync(&mut r);
    }
    let path = format!("{dir}/fonte.png");
    crate::capture::shoot_with(&mut r, &models, &egui, &mut game, &path, None, &|ctx, _g| sheet(ctx));
    println!("{path}");
}
