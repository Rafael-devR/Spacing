//! Fonte do jogo nativo (docs/design/INTERFACE_NATIVA.md): a Pixelify Sans (SIL OFL, em `assets/fonts/pixelify-sans/`) é a
//! fonte padrão do egui. Fica fora do módulo de captura para compilar também no Android, onde o APK precisa dela.
use std::sync::Arc;

use egui::{FontData, FontDefinitions, FontFamily};

static PIXELIFY: &[u8] = include_bytes!("../../assets/fonts/pixelify-sans/PixelifySans.ttf");

/// põe a Pixelify Sans como primeira fonte do texto proporcional (a que o egui usa por padrão)
pub fn install(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert("pixelify".into(), Arc::new(FontData::from_static(PIXELIFY)));
    fonts.families.entry(FontFamily::Proportional).or_default().insert(0, "pixelify".into());
    ctx.set_fonts(fonts);
}
