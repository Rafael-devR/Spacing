//! Os ícones dos itens, equipamentos e estações (render/icons.ts do jogo web): cada um é o próprio modelo 3D desenhado uma vez
//! (`Renderer::render_icons`) num atlas, que vira uma textura do egui. O atlas fica guardado no contexto do egui, para qualquer
//! tela achar (`Icons::of`).
use egui::{Color32, Pos2, Rect, Vec2};
use spacing_core::rules::{EquipId, ItemId, StationId};
use spacing_render::items::{equip_shape, icon_count, icon_of_equip, icon_of_item, icon_of_station, item_shape, model_shape};
use spacing_render::{load_glb, prop_shape, Renderer};

/// pixels de cada ícone no atlas
const CELL: u32 = 128;
const COLS: u32 = 8;

#[derive(Clone)]
pub struct Icons {
    tex: egui::TextureHandle,
    rows: u32,
}

fn key() -> egui::Id {
    egui::Id::unique("icones-dos-itens")
}

/// o que desenhar: um item, um equipamento ou uma estação
#[derive(Clone, Copy, Debug)]
pub enum Icon {
    Item(ItemId),
    Equip(EquipId),
    Station(StationId),
}

impl Icons {
    /// desenha o atlas, se ainda não existe neste contexto; devolve os pixels (RGBA) e o tamanho quando desenhou
    pub fn ensure(r: &Renderer, ctx: &egui::Context) -> Option<(Vec<u8>, u32, u32)> {
        if Self::of(ctx).is_some() {
            return None;
        }
        let t = std::time::Instant::now();
        let mut shapes = Vec::with_capacity(icon_count());
        shapes.extend(ItemId::all().map(|i| item_shape(i, &prop_shape)));
        shapes.extend(EquipId::all().map(equip_shape));
        for s in StationId::all() {
            let bytes = match s.key() {
                "workbench" => crate::base::WORKBENCH_GLB,
                "furnace" => crate::base::FURNACE_GLB,
                _ => crate::base::ELECTROLYZER_GLB,
            };
            shapes.push(load_glb(bytes).map(|m| model_shape(&m)).unwrap_or_default());
        }
        let px = r.render_icons(&shapes, CELL, COLS);
        let rows = (shapes.len() as u32).div_ceil(COLS);
        let img = egui::ColorImage::from_rgba_premultiplied([(COLS * CELL) as usize, (rows * CELL) as usize], &px);
        let tex = ctx.load_texture("ícones", img, egui::TextureOptions::LINEAR);
        log::info!("ícones: {} em {:.0} ms", shapes.len(), t.elapsed().as_secs_f64() * 1000.0);
        ctx.data_mut(|d| d.insert_temp(key(), Icons { tex, rows }));
        Some((px, COLS * CELL, rows * CELL))
    }

    pub fn of(ctx: &egui::Context) -> Option<Icons> {
        ctx.data(|d| d.get_temp(key()))
    }

    fn uv(&self, i: usize) -> Rect {
        let (c, r) = ((i as u32 % COLS) as f32, (i as u32 / COLS) as f32);
        let (w, h) = (1.0 / COLS as f32, 1.0 / self.rows as f32);
        Rect::from_min_size(Pos2::new(c * w, r * h), Vec2::new(w, h))
    }

    pub fn texture(&self) -> egui::TextureId {
        self.tex.id()
    }

    /// o retângulo do ícone no atlas (para `egui::Image::uv`)
    pub fn uv_of(&self, icon: Icon) -> Rect {
        self.uv(match icon {
            Icon::Item(i) => icon_of_item(i),
            Icon::Equip(e) => icon_of_equip(e),
            Icon::Station(s) => icon_of_station(s),
        })
    }

    /// pinta o ícone no retângulo (`tint` apaga: itens que faltam)
    pub fn paint(&self, painter: &egui::Painter, rect: Rect, icon: Icon, tint: Color32) {
        painter.image(self.tex.id(), rect, self.uv_of(icon), tint);
    }
}

/// pinta o ícone se o atlas existe; senão, um quadrado com a cor do item (as capturas sem atlas)
pub fn paint_item(painter: &egui::Painter, rect: Rect, item: ItemId, tint: Color32) {
    match Icons::of(painter.ctx()) {
        Some(ic) => ic.paint(painter, rect, Icon::Item(item), tint),
        None => {
            let c = crate::game::item_color(item);
            let s = |v: f64| (v.max(0.0).powf(1.0 / 2.2) * 255.0).min(255.0) as u8;
            painter.rect_filled(rect.shrink(rect.width() * 0.22), 3.0, Color32::from_rgb(s(c[0]), s(c[1]), s(c[2])));
        }
    }
}
