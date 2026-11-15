//! A tela de itens (porte de `src/ui/inventory/screen.ts`, `grid.ts`, `Bag.ts` e `station/StationScreen.ts`; docs/design/INVENTARIO.md
//! e ESTACOES.md, ADR 0019): **mochila e estações são a mesma tela**. O inventário fica sempre à direita (em pé, embaixo): três
//! fileiras da mochila e, separada por um fio, a barra de itens. O lado esquerdo muda: na mochila, o traje (equipamentos) e o item
//! escolhido; numa estação, a máquina (receitas, entrada, câmara, saída, lote, vagas).
//!
//! Os gestos são da mão (`hand.rs`). Esta tela só desenha, diz à mão o que está embaixo do dedo e transforma o que a mão pede em
//! `UiAction`s, que o jogo aplica. O estado da tela (receita escolhida, lote, calor do forno…) fica no contexto do egui.
use egui::{Align2, Color32, FontId, Pos2, Rect, Stroke, Vec2};
use spacing_core::rules::crafting::JobView;
use spacing_core::rules::data::{batchable, recipe_seconds, unit_seconds, Output};
use spacing_core::rules::{rules, EquipId, ItemId, RecipeId, StationId};

use crate::game::{Game, Screen};
use crate::hand::{Hand, HandOut, Spot};
use crate::hud::{output_name, UiAction};
use crate::icons::{paint_item, Icon, Icons};

// ---------- cores (fios de 1 px, um destaque frio; verde = pronto, vermelho = falta) ----------
const BG: Color32 = Color32::from_rgba_premultiplied(5, 7, 14, 232);
const PANEL: Color32 = Color32::from_rgba_premultiplied(12, 15, 28, 235);
const LINE: Color32 = Color32::from_rgb(52, 60, 84);
const SLOT_BG: Color32 = Color32::from_rgb(17, 21, 36);
const INK: Color32 = Color32::from_rgb(226, 232, 246);
const DIM: Color32 = Color32::from_rgb(132, 142, 170);
const CYAN: Color32 = Color32::from_rgb(127, 231, 255);
const GREEN: Color32 = Color32::from_rgb(120, 236, 150);
const RED: Color32 = Color32::from_rgb(255, 118, 100);

fn accent(st: StationId) -> Color32 {
    let n = u32::from_str_radix(st.data().accent.trim_start_matches('#'), 16).unwrap_or(0x7fe7ff);
    Color32::from_rgb((n >> 16) as u8, (n >> 8) as u8, n as u8)
}

/// o estado da tela entre um quadro e outro
#[derive(Clone, Default)]
struct State {
    hand: Hand,
    /// a tela aberta (trocou: tudo volta ao começo)
    screen: Option<Screen>,
    focused: Option<ItemId>,
    selected: Option<RecipeId>,
    batch: u32,
    slot_sel: Option<usize>,
    info: bool,
    confirm_cancel: f64,
    flash: Option<(String, f64)>,
    /// temperatura do forno (°C), na tela
    temp: f64,
    last_pos: (f32, f32),
}

fn key() -> egui::Id {
    egui::Id::unique("tela-de-itens")
}

/// onde ficam as coisas nesta tela
struct Layout {
    frame: Rect,
    left: Rect,
    inv: Rect,
    slots: Vec<Rect>,
    sort_btn: Rect,
}

const GAP: f32 = 4.0;
const PAD: f32 = 12.0;

fn layout(full: Rect) -> Layout {
    // margem à direita para o X do canto (controls.rs)
    let frame = Rect::from_min_max(full.min + Vec2::new(14.0, 10.0), full.max - Vec2::new(78.0, 10.0));
    let landscape = frame.width() > frame.height() * 1.15;
    let head = 30.0;
    let sep = 20.0;
    let (inv, slot) = if landscape {
        let s = ((frame.height() - 2.0 * PAD - head - sep - 3.0 * GAP) / 4.0).clamp(30.0, 58.0);
        let w = 8.0 * s + 7.0 * GAP + 2.0 * PAD;
        (Rect::from_min_size(Pos2::new(frame.max.x - w, frame.min.y), Vec2::new(w, frame.height())), s)
    } else {
        let s = ((frame.width() - 2.0 * PAD - 7.0 * GAP) / 8.0).clamp(28.0, 56.0);
        let h = 4.0 * s + 3.0 * GAP + 2.0 * PAD + head + sep;
        (Rect::from_min_size(Pos2::new(frame.min.x, frame.max.y - h), Vec2::new(frame.width(), h)), s)
    };
    let left = if landscape {
        Rect::from_min_max(frame.min, Pos2::new(inv.min.x - 10.0, frame.max.y))
    } else {
        Rect::from_min_max(frame.min, Pos2::new(frame.max.x, inv.min.y - 10.0))
    };
    let hb = rules().hotbar;
    let mut slots = vec![Rect::NOTHING; rules().slot_count()];
    let x0 = inv.center().x - (8.0 * slot + 7.0 * GAP) / 2.0;
    let y0 = inv.min.y + PAD + head;
    for (k, r) in slots.iter_mut().enumerate().skip(hb) {
        let k = k - hb;
        *r = Rect::from_min_size(Pos2::new(x0 + (k % 8) as f32 * (slot + GAP), y0 + (k / 8) as f32 * (slot + GAP)), Vec2::splat(slot));
    }
    let yb = y0 + 3.0 * (slot + GAP) + sep;
    for (i, r) in slots.iter_mut().enumerate().take(hb) {
        *r = Rect::from_min_size(Pos2::new(x0 + i as f32 * (slot + GAP), yb), Vec2::splat(slot));
    }
    let sort_btn = Rect::from_min_size(Pos2::new(inv.max.x - PAD - 92.0, inv.min.y + PAD - 2.0), Vec2::new(92.0, 24.0));
    Layout { frame, left, inv, slots, sort_btn }
}

/// os retângulos da estação (para a mão saber onde é a entrada e a saída)
struct StationRects {
    input: Rect,
    output: Rect,
}

fn station_rects(left: Rect) -> StationRects {
    let s = (left.width() * 0.14).clamp(40.0, 60.0);
    // no meio do espaço entre as receitas e a linha da receita (que fica embaixo)
    let top = left.min.y + 38.0 + 54.0 + 18.0;
    let line_y = left.max.y - PAD - 40.0 - 40.0 - 38.0;
    let io_y = top.max((top + line_y - s - 18.0) / 2.0 - 10.0);
    let input = Rect::from_min_size(Pos2::new(left.min.x + PAD, io_y), Vec2::new(left.width() * 0.3, s + 18.0));
    let output = Rect::from_min_size(Pos2::new(left.max.x - PAD - s, io_y + 18.0), Vec2::splat(s));
    StationRects { input, output }
}

fn spot_at(p: Pos2, l: &Layout, st: Option<&StationRects>, buttons: &[Rect]) -> Spot {
    if buttons.iter().any(|b| b.contains(p)) {
        return Spot::Other;
    }
    if let Some(i) = l.slots.iter().position(|r| r.contains(p)) {
        return Spot::Slot(i);
    }
    if let Some(s) = st {
        if s.output.contains(p) {
            return Spot::Out(true);
        }
        if s.input.contains(p) {
            return Spot::Input;
        }
    }
    if l.inv.contains(p) {
        return Spot::Pane;
    }
    Spot::Other
}

/// cantoneiras no lugar de borda grossa (o escolhido)
fn corners(p: &egui::Painter, r: Rect, c: Color32) {
    let k = (r.width() * 0.22).min(10.0);
    let st = Stroke::new(2.0, c);
    for (a, dx, dy) in [(r.left_top(), 1.0, 1.0), (r.right_top(), -1.0, 1.0), (r.left_bottom(), 1.0, -1.0), (r.right_bottom(), -1.0, -1.0)] {
        p.line_segment([a, a + Vec2::new(k * dx, 0.0)], st);
        p.line_segment([a, a + Vec2::new(0.0, k * dy)], st);
    }
}

fn slot_box(p: &egui::Painter, r: Rect, stroke: Color32) {
    p.rect_filled(r, 3.0, SLOT_BG);
    p.rect_stroke(r, 3.0, Stroke::new(1.0, stroke), egui::StrokeKind::Inside);
}

fn count(p: &egui::Painter, r: Rect, n: u32, col: Color32) {
    if n > 1 {
        p.text(r.right_bottom() - Vec2::new(3.0, 1.0), Align2::RIGHT_BOTTOM, n.to_string(), FontId::monospace(11.0), col);
    }
}

fn icon_of(o: Output) -> Icon {
    match o {
        Output::Item { item, .. } => Icon::Item(item),
        Output::Equip { equip } => Icon::Equip(equip),
        Output::Station { station } => Icon::Station(station),
    }
}

fn paint_icon(p: &egui::Painter, r: Rect, icon: Icon, tint: Color32) {
    match (Icons::of(p.ctx()), icon) {
        (Some(ic), _) => ic.paint(p, r, icon, tint),
        (None, Icon::Item(i)) => paint_item(p, r, i, tint),
        _ => {}
    }
}

fn human_time(s: f64) -> String {
    if !s.is_finite() {
        return "parado (sem energia)".into();
    }
    let s = s.ceil() as u64;
    if s >= 60 {
        format!("{} min {} s", s / 60, s % 60)
    } else {
        format!("{s} s")
    }
}

fn clock(s: f64) -> String {
    if !s.is_finite() {
        return "--:--".into();
    }
    let s = s.ceil() as u64;
    format!("{}:{:02}", s / 60, s % 60)
}

// ---------- receitas (as escolhas da tela, como no StationScreen.ts) ----------

impl State {
    fn shown(&self, g: &Game, st: StationId) -> Option<RecipeId> {
        if let Some(r) = self.selected.filter(|r| r.data().station == st) {
            return Some(r);
        }
        let list: Vec<RecipeId> = spacing_core::rules::crafting::Crafting::recipes(st).collect();
        let check = |r: RecipeId| g.crafting.check(r, 1, &g.inv, &g.equip);
        list.iter().copied().find(|&r| check(r).ok).or_else(|| list.iter().copied().find(|&r| !check(r).owned)).or(list.first().copied())
    }

    fn top_batch(&self, g: &Game, r: Option<RecipeId>) -> u32 {
        match r {
            Some(r) if batchable(r.data()) => g.crafting.max_batch(r.data(), &g.inv).clamp(1, rules().max_batch),
            _ => 1,
        }
    }

    /// um item chegou na entrada: escolhe a receita desta estação que usa esse item e o lote que ele paga
    fn feed(&mut self, g: &Game, st: StationId, item: ItemId, n: u32, now: f64) -> bool {
        if !g.crafting.is_built(st) {
            return false;
        }
        let using: Vec<RecipeId> = spacing_core::rules::crafting::Crafting::recipes(st).filter(|r| r.data().inputs.iter().any(|&(i, _)| i == item)).collect();
        if using.is_empty() {
            self.flash = Some((format!("Esta estação não usa {}", item.data().name), now + 2.5));
            return false;
        }
        let check = |r: RecipeId| g.crafting.check(r, 1, &g.inv, &g.equip);
        let cur = self.shown(g, st);
        let r = match cur {
            Some(c) if using.contains(&c) => c,
            _ => using.iter().copied().find(|&r| check(r).ok).or_else(|| using.iter().copied().find(|&r| !check(r).owned)).unwrap_or(using[0]),
        };
        if self.selected != Some(r) {
            self.batch = 1;
        }
        self.selected = Some(r);
        self.slot_sel = None;
        self.info = false;
        if batchable(r.data()) {
            let need = r.data().inputs.iter().find(|&&(i, _)| i == item).map_or(1, |x| x.1);
            self.batch = (n / need).max(1).min(self.top_batch(g, Some(r)));
        }
        self.flash = None;
        true
    }
}

/// A tela inteira (mochila ou estação). Devolve as ações para o jogo.
pub fn draw(ctx: &egui::Context, g: &Game, screen: Screen, actions: &mut Vec<UiAction>) {
    let mut s: State = ctx.data(|d| d.get_temp(key())).unwrap_or_default();
    if s.screen != Some(screen) {
        s = State { screen: Some(screen), focused: g.inv.selected_item(), batch: 1, temp: 22.0, ..Default::default() };
    }
    let station = match screen {
        Screen::Station(st) => Some(st),
        _ => None,
    };
    let full = ctx.content_rect();
    let l = layout(full);
    let srects = station.filter(|&st| g.crafting.is_built(st)).map(|_| station_rects(l.left));
    let (now, dt, pos, pressed, released, sec_pressed, sec_released, shift) = ctx.input(|i| {
        (
            i.time,
            i.stable_dt.min(0.1) as f64,
            i.pointer.latest_pos(),
            i.pointer.primary_pressed(),
            i.pointer.primary_released(),
            i.pointer.secondary_pressed(),
            i.pointer.secondary_released(),
            i.modifiers.shift,
        )
    });
    let p = pos.unwrap_or(Pos2::new(s.last_pos.0, s.last_pos.1));
    s.last_pos = (p.x, p.y);
    // botões desta tela: a mão não pega o que cai neles
    let mut buttons = vec![l.sort_btn, Rect::from_min_size(l.left.min + Vec2::new(PAD - 4.0, PAD - 4.0), Vec2::splat(34.0))];
    if station.is_some() {
        buttons.push(Rect::from_min_max(Pos2::new(l.left.min.x, l.left.max.y - 112.0), l.left.max));
        buttons.push(Rect::from_min_size(Pos2::new(l.left.min.x, l.left.min.y + 38.0), Vec2::new(l.left.width(), 58.0)));
    }
    let spot = spot_at(p, &l, srects.as_ref(), &buttons);
    // tocar fora do quadro fecha (como no jogo web)
    if (pressed || sec_pressed) && !l.frame.contains(p) && !s.hand.busy() {
        actions.push(UiAction::Close);
    }

    // ---- gestos ----
    let mut outs = Vec::new();
    if pressed || sec_pressed {
        s.hand.down(p.x, p.y, spot, sec_pressed, now, &g.inv);
    }
    s.hand.update(now, &g.inv);
    if pos.is_some() {
        outs.extend(s.hand.moved(p.x, p.y, spot, &g.inv));
    }
    if released || sec_released {
        outs.extend(s.hand.up(p.x, p.y, spot, now, shift, &g.inv));
    }
    for o in outs {
        match o {
            HandOut::Move { from, to, n } => actions.push(UiAction::Move { from, to, n }),
            HandOut::Quick(from) => match station {
                Some(st) => {
                    if let Some(sl) = g.inv.slot(from) {
                        s.feed(g, st, sl.item, sl.n, now);
                    }
                }
                None => actions.push(UiAction::QuickMove(from)),
            },
            HandOut::Feed { from, n } => {
                if let (Some(st), Some(sl)) = (station, g.inv.slot(from)) {
                    s.feed(g, st, sl.item, n, now);
                }
            }
            HandOut::TakeOut => {
                if let Some(st) = station {
                    if g.crafting.has_ready(st) {
                        actions.push(UiAction::Take(st, None));
                    }
                }
            }
            HandOut::Focus(item) => s.focused = Some(item),
        }
    }

    egui::Area::new(egui::Id::unique("tela-de-itens-area"))
        .fixed_pos(Pos2::ZERO)
        .order(egui::Order::Middle)
        .show(ctx, |ui| {
            ui.set_min_size(full.size());
            let painter = ui.painter().clone();
            painter.rect_filled(full, 0.0, Color32::from_black_alpha(150));
            painter.rect_filled(l.frame, 10.0, BG);
            painter.rect_stroke(l.frame, 10.0, Stroke::new(1.0, LINE), egui::StrokeKind::Inside);
            draw_inventory(ui, &painter, g, &l, &s, station, actions);
            match station {
                Some(st) => draw_station(ui, &painter, g, st, &l, srects.as_ref(), &mut s, now, dt, actions),
                None => draw_bag(ui, &painter, g, &l, &s, actions),
            }
            // o item na mão segue o dedo
            let ghost = match (s.hand.drag, s.hand.half_shown) {
                (Some(d), _) => match d.src {
                    crate::hand::Src::Inv(i) => g.inv.slot(i).map(|sl| (Icon::Item(sl.item), d.n)),
                    crate::hand::Src::Out => station.and_then(|st| ready_icon(g, st)).map(|ic| (ic, 0)),
                },
                (None, Some((item, n))) => Some((Icon::Item(item), n)),
                _ => None,
            };
            if let Some((icon, n)) = ghost {
                let at = Pos2::new(s.hand.at.0, s.hand.at.1);
                let r = Rect::from_center_size(at - Vec2::new(0.0, 26.0), Vec2::splat(54.0));
                let fg = ui.ctx().layer_painter(egui::LayerId::new(egui::Order::Tooltip, egui::Id::unique("mao")));
                fg.rect_filled(r, 4.0, Color32::from_rgba_unmultiplied(20, 26, 44, 200));
                fg.rect_stroke(r, 4.0, Stroke::new(1.0, CYAN), egui::StrokeKind::Inside);
                paint_icon(&fg, r.shrink(4.0), icon, Color32::WHITE);
                count(&fg, r, n, INK);
            }
        });
    ctx.data_mut(|d| d.insert_temp(key(), s));
}

fn ready_icon(g: &Game, st: StationId) -> Option<Icon> {
    for j in g.crafting.slots(st, &|x| g.station_speed(x)).into_iter().flatten() {
        if let Some((i, _)) = j.waiting.iter().next() {
            return Some(Icon::Item(i));
        }
        if j.ready {
            return j.recipe.data().outputs.iter().find(|o| !matches!(o, Output::Item { .. })).map(|&o| icon_of(o));
        }
    }
    None
}

fn draw_inventory(ui: &mut egui::Ui, p: &egui::Painter, g: &Game, l: &Layout, s: &State, _station: Option<StationId>, actions: &mut Vec<UiAction>) {
    p.rect_filled(l.inv, 8.0, PANEL);
    p.rect_stroke(l.inv, 8.0, Stroke::new(1.0, LINE), egui::StrokeKind::Inside);
    let top = l.inv.min + Vec2::new(PAD, PAD);
    p.text(top, Align2::LEFT_TOP, "MOCHILA", FontId::proportional(10.0), DIM);
    p.text(top + Vec2::new(0.0, 11.0), Align2::LEFT_TOP, "Inventário", FontId::proportional(15.0), INK);
    if s.hand.held.is_some() {
        p.text(Pos2::new(l.sort_btn.min.x - 8.0, top.y + 12.0), Align2::RIGHT_CENTER, "toque no destino", FontId::proportional(11.0), CYAN);
    }
    if ui.put(l.sort_btn, egui::Button::new(egui::RichText::new("Organizar").size(12.0))).clicked() {
        actions.push(UiAction::Sort);
    }
    let hb = rules().hotbar;
    let sep_y = l.slots[0].min.y - 11.0;
    p.line_segment([Pos2::new(l.inv.min.x + PAD, sep_y), Pos2::new(l.inv.max.x - PAD, sep_y)], Stroke::new(1.0, LINE));
    p.text(Pos2::new(l.inv.center().x, sep_y), Align2::CENTER_CENTER, " BARRA DE ITENS ", FontId::proportional(9.5), DIM);
    let dragging = s.hand.drag;
    let src = s.hand.source();
    for (i, r) in l.slots.iter().enumerate() {
        let hover = dragging.is_some() && s.hand.hover == Some(Spot::Slot(i));
        let ok = match dragging {
            Some(d) => !matches!(d.src, crate::hand::Src::Inv(f) if f == i),
            None => false,
        };
        slot_box(p, *r, if hover { if ok { GREEN } else { RED } } else { LINE });
        if i < hb {
            p.text(r.left_top() + Vec2::new(3.0, 1.0), Align2::LEFT_TOP, (i + 1).to_string(), FontId::monospace(9.0), DIM);
            if g.inv.selected() == i {
                corners(p, r.expand(1.0), CYAN);
            }
        }
        if let Some(sl) = g.inv.slot(i) {
            let dim = src == Some(i);
            let tint = if dim { Color32::from_white_alpha(70) } else { Color32::WHITE };
            paint_item(p, r.shrink(r.width() * 0.1), sl.item, tint);
            count(p, *r, sl.n, if dim { DIM } else { INK });
            if s.hand.held.is_some_and(|h| h.index == i) {
                p.rect_stroke(*r, 3.0, Stroke::new(1.5, CYAN), egui::StrokeKind::Inside);
            }
        }
    }
    if dragging.is_some_and(|d| d.src == crate::hand::Src::Out) && s.hand.hover.is_some_and(|h| matches!(h, Spot::Pane | Spot::Slot(_))) {
        p.rect_stroke(l.inv, 8.0, Stroke::new(2.0, GREEN), egui::StrokeKind::Inside);
    }
}

fn back_button(ui: &mut egui::Ui, l: &Layout, actions: &mut Vec<UiAction>) {
    let r = Rect::from_min_size(l.left.min + Vec2::new(PAD - 4.0, PAD - 4.0), Vec2::splat(34.0));
    if ui.put(r, egui::Button::new(egui::RichText::new("‹").size(22.0))).clicked() {
        actions.push(UiAction::Close);
    }
}

fn header(p: &egui::Painter, l: &Layout, kicker: &str, title: &str, col: Color32) {
    let at = l.left.min + Vec2::new(PAD + 40.0, PAD - 2.0);
    p.text(at, Align2::LEFT_TOP, kicker.to_uppercase(), FontId::proportional(10.0), col);
    p.text(at + Vec2::new(0.0, 11.0), Align2::LEFT_TOP, title, FontId::proportional(17.0), INK);
}

fn draw_bag(ui: &mut egui::Ui, p: &egui::Painter, g: &Game, l: &Layout, s: &State, actions: &mut Vec<UiAction>) {
    p.rect_filled(l.left, 8.0, PANEL);
    p.rect_stroke(l.left, 8.0, Stroke::new(1.0, LINE), egui::StrokeKind::Inside);
    back_button(ui, l, actions);
    header(p, l, "Traje", "Mochila", CYAN);
    let x = l.left.min.x + PAD;
    let w = l.left.width() - 2.0 * PAD;
    let mut y = l.left.min.y + 54.0;
    // o item escolhido
    let big = Rect::from_min_size(Pos2::new(x, y), Vec2::splat(64.0));
    slot_box(p, big, LINE);
    let tx = x + 76.0;
    let tw = w - 76.0;
    match s.focused.filter(|&i| g.inv.count(i) > 0) {
        Some(item) => {
            paint_item(p, big.shrink(6.0), item, Color32::WHITE);
            let d = item.data();
            let kind = if d.block.is_some() {
                "Bloco"
            } else if d.place.is_some() || d.site.is_some() {
                "Para colocar"
            } else if d.food.is_some() {
                "Comida"
            } else {
                "Recurso"
            };
            p.text(Pos2::new(tx, y), Align2::LEFT_TOP, format!("{} · {}", kind.to_uppercase(), g.inv.count(item)), FontId::proportional(10.0), CYAN);
            p.text(Pos2::new(tx, y + 12.0), Align2::LEFT_TOP, &d.name, FontId::proportional(16.0), INK);
            let gal = p.layout(d.about.clone(), FontId::proportional(12.0), DIM, tw);
            let gh = gal.size().y;
            p.galley(Pos2::new(tx, y + 32.0), gal, DIM);
            y += (32.0 + gh).max(70.0);
        }
        None => {
            p.text(Pos2::new(tx, y + 4.0), Align2::LEFT_TOP, "Nenhum item escolhido", FontId::proportional(15.0), INK);
            let gal = p.layout("Toque num item para ver o que ele é e para que serve.".into(), FontId::proportional(12.0), DIM, tw);
            p.galley(Pos2::new(tx, y + 24.0), gal, DIM);
            y += 74.0;
        }
    }
    y += 10.0;
    p.text(Pos2::new(x, y), Align2::LEFT_TOP, "EQUIPAMENTO NO TRAJE", FontId::proportional(10.0), DIM);
    y += 16.0;
    let slot_name = |slot: &str| if slot == "map" { "Mapa" } else { "Broca" };
    let empty = |slot: &str| if slot == "map" { "Mapa: fabrique na bancada da base" } else { "Broca de regolito (a do traje)" };
    for slot in &rules().equip_slots {
        let r = Rect::from_min_size(Pos2::new(x, y), Vec2::splat(42.0));
        let id: Option<EquipId> = g.equip.in_slot(slot);
        slot_box(p, r, if id.is_some() { CYAN } else { LINE });
        if let Some(e) = id {
            paint_icon(p, r.shrink(4.0), Icon::Equip(e), Color32::WHITE);
        }
        let (name, sub) = match id {
            Some(e) => (e.data().name.clone(), "no traje".to_string()),
            None => (slot_name(slot).to_string(), empty(slot).to_string()),
        };
        p.text(Pos2::new(x + 52.0, y + 6.0), Align2::LEFT_TOP, name, FontId::proportional(13.0), INK);
        p.text(Pos2::new(x + 52.0, y + 24.0), Align2::LEFT_TOP, sub, FontId::proportional(11.0), DIM);
        y += 50.0;
    }
    let tips = "Arraste para mover · segure para pegar metade · toque duas vezes para mandar à barra";
    let gal = p.layout(tips.into(), FontId::proportional(11.0), DIM, w);
    let gh = gal.size().y;
    if y + gh < l.left.max.y - PAD {
        p.galley(Pos2::new(x, l.left.max.y - PAD - gh), gal, DIM);
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_station(ui: &mut egui::Ui, p: &egui::Painter, g: &Game, st: StationId, l: &Layout, sr: Option<&StationRects>, s: &mut State, now: f64, dt: f64, actions: &mut Vec<UiAction>) {
    let d = st.data();
    let acc = accent(st);
    let left = l.left;
    p.rect_filled(left, 8.0, PANEL);
    p.rect_stroke(left, 8.0, Stroke::new(1.0, LINE), egui::StrokeKind::Inside);
    back_button(ui, l, actions);
    let sub = match st.key() {
        "workbench" => "1 vaga · monta peças com dois lasers",
        "furnace" => "3 cadinhos · funde, sinteriza e reduz",
        _ => "2 células · separa água e óxidos",
    };
    header(p, l, sub, &d.name, acc);
    // energia
    let speed = g.station_speed(st);
    let ebar = Rect::from_min_size(Pos2::new(left.max.x - PAD - 90.0, left.min.y + PAD + 16.0), Vec2::new(90.0, 4.0));
    p.text(ebar.right_top() - Vec2::new(0.0, 4.0), Align2::RIGHT_BOTTOM, format!("{} {:.0}%", if d.energy == "sun" { "SOL" } else { "REDE" }, speed * 100.0), FontId::monospace(10.0), if speed < 0.5 { RED } else { DIM });
    p.rect_filled(ebar, 1.0, LINE);
    p.rect_filled(Rect::from_min_size(ebar.min, Vec2::new(ebar.width() * speed.clamp(0.0, 1.0) as f32, 4.0)), 1.0, acc);
    let Some(sr) = sr else {
        let gal = p.layout(
            format!("O {} ainda não existe. Fabrique as peças dele na bancada; a máquina aparece aqui quando você pegar.", d.name),
            FontId::proportional(14.0),
            DIM,
            left.width() - 2.0 * PAD,
        );
        p.galley(left.min + Vec2::new(PAD, 70.0), gal, DIM);
        return;
    };
    let jobs: Vec<Option<JobView>> = g.crafting.slots(st, &|x| g.station_speed(x));
    if s.slot_sel.is_some_and(|i| jobs.get(i).is_none_or(|j| j.is_none())) {
        s.slot_sel = None;
    }
    let shown = s.shown(g, st);
    let top = s.top_batch(g, shown);
    s.batch = s.batch.clamp(1, top);

    // receitas: quadrados com o ícone do que sai (ponto verde = dá para fazer; ✓ = já tem; apagado = falta material)
    let rs = 40.0;
    let mut x = left.min.x + PAD;
    let mut y = left.min.y + 44.0;
    for r in spacing_core::rules::crafting::Crafting::recipes(st) {
        if x + rs > left.max.x - PAD {
            x = left.min.x + PAD;
            y += rs + GAP;
        }
        let rect = Rect::from_min_size(Pos2::new(x, y), Vec2::splat(rs));
        let ch = g.crafting.check(r, 1, &g.inv, &g.equip);
        let resp = ui.interact(rect, egui::Id::unique(("receita", r.0)), egui::Sense::click());
        slot_box(p, rect, if resp.hovered() { acc } else { LINE });
        let tint = if ch.ok || ch.owned { Color32::WHITE } else { Color32::from_white_alpha(90) };
        paint_icon(p, rect.shrink(4.0), icon_of(r.data().outputs[0]), tint);
        if ch.owned {
            let c = rect.right_top() + Vec2::new(-8.0, 8.0);
            p.line_segment([c + Vec2::new(-4.0, 0.0), c + Vec2::new(-1.0, 3.0)], Stroke::new(2.0, GREEN));
            p.line_segment([c + Vec2::new(-1.0, 3.0), c + Vec2::new(4.0, -3.0)], Stroke::new(2.0, GREEN));
        } else if ch.ok {
            p.circle_filled(rect.right_top() + Vec2::new(-6.0, 6.0), 3.0, GREEN);
        }
        if shown == Some(r) && s.slot_sel.is_none() {
            corners(p, rect.expand(1.0), acc);
        }
        if resp.clicked() {
            if s.selected != Some(r) {
                s.batch = 1;
            }
            s.selected = Some(r);
            s.slot_sel = None;
            s.info = false;
            s.flash = None;
        }
        x += rs + GAP;
    }

    // entrada → câmara → saída
    let job = s.slot_sel.and_then(|i| jobs[i].clone());
    let (rid, batch, used) = match &job {
        Some(j) => (Some(j.recipe), j.batch, true),
        None => (shown, s.batch, false),
    };
    let io = sr.input;
    p.text(io.min, Align2::LEFT_TOP, "ENTRADA", FontId::proportional(10.0), DIM);
    let dragging_ok = s.hand.drag.is_some_and(|dd| match dd.src {
        crate::hand::Src::Inv(i) => g.inv.slot(i).is_some_and(|sl| spacing_core::rules::crafting::Crafting::recipes(st).any(|r| r.data().inputs.iter().any(|&(it, _)| it == sl.item))),
        _ => false,
    });
    if s.hand.drag.is_some() && s.hand.hover == Some(Spot::Input) {
        p.rect_stroke(io.expand(3.0), 4.0, Stroke::new(1.5, if dragging_ok { GREEN } else { RED }), egui::StrokeKind::Inside);
    }
    let ss = sr.output.width();
    let mut ok_all = true;
    if let Some(r) = rid {
        let ins = &r.data().inputs;
        let w = ((io.width() - GAP * (ins.len() as f32 - 1.0)) / ins.len().max(1) as f32).min(ss);
        for (k, &(item, n)) in ins.iter().enumerate() {
            let rect = Rect::from_min_size(Pos2::new(io.min.x + k as f32 * (w + GAP), io.min.y + 18.0), Vec2::splat(w));
            let need = n * batch;
            let have = g.inv.count(item);
            let short = !used && have < need;
            ok_all &= !short;
            slot_box(p, rect, if short { RED } else { LINE });
            paint_item(p, rect.shrink(w * 0.12), item, if used { Color32::from_white_alpha(120) } else { Color32::WHITE });
            let txt = if used { need.to_string() } else { format!("{have}/{need}") };
            p.text(rect.right_bottom() - Vec2::new(2.0, 1.0), Align2::RIGHT_BOTTOM, txt, FontId::monospace(10.0), if short { RED } else { INK });
        }
    }
    // a câmara
    let ch_rect = Rect::from_min_max(Pos2::new(io.max.x + 22.0, io.min.y + 4.0), Pos2::new(sr.output.min.x - 22.0, io.max.y + 4.0));
    let working = jobs.iter().flatten().any(|j| !j.ready && !j.paused && !j.leftover);
    let ready = g.crafting.has_ready(st);
    draw_chamber(p, ch_rect, st, &jobs, speed, working, now, dt, s, acc);
    // fios tracejados que correm enquanto trabalha
    let flow = (now * (0.6 + speed * 1.6)).fract() as f32;
    for (a, b) in [(Pos2::new(io.max.x + 2.0, sr.output.center().y), Pos2::new(ch_rect.min.x - 2.0, sr.output.center().y)), (Pos2::new(ch_rect.max.x + 2.0, sr.output.center().y), Pos2::new(sr.output.min.x - 4.0, sr.output.center().y))] {
        let n = 4;
        for k in 0..n {
            let t0 = (k as f32 + if working { flow } else { 0.0 }) / n as f32;
            let t1 = (t0 + 0.5 / n as f32).min(1.0);
            p.line_segment([a + (b - a) * t0, a + (b - a) * t1], Stroke::new(1.5, if working { acc } else { LINE }));
        }
    }
    // saída
    p.text(sr.output.left_top() - Vec2::new(0.0, 18.0), Align2::LEFT_TOP, "SAÍDA", FontId::proportional(10.0), DIM);
    slot_box(p, sr.output, if ready { GREEN } else { LINE });
    if ready {
        let total: u32 = jobs.iter().flatten().map(|j| j.waiting_count).sum();
        if let Some(ic) = ready_icon(g, st) {
            paint_icon(p, sr.output.shrink(5.0), ic, Color32::WHITE);
        }
        count(p, sr.output, total, GREEN);
        p.text(sr.output.center_bottom() + Vec2::new(0.0, 3.0), Align2::CENTER_TOP, "tocar: pegar", FontId::proportional(9.5), GREEN);
    } else if let Some(r) = rid {
        let o = r.data().outputs[0];
        paint_icon(p, sr.output.shrink(5.0), icon_of(o), Color32::from_white_alpha(70));
        if let Output::Item { n, .. } = o {
            count(p, sr.output, n * batch, DIM);
        }
    }

    // linha da receita, controles e vagas (de baixo para cima)
    let bottom = left.max.y - PAD;
    let jobs_y = bottom - 40.0;
    let ctrl_y = jobs_y - 40.0;
    let line_y = ctrl_y - 38.0;
    let lx = left.min.x + PAD;
    let lw = left.width() - 2.0 * PAD;
    match (&job, rid) {
        (Some(j), _) => {
            let name = j.recipe.data().outputs.iter().map(|&o| output_name(o)).collect::<Vec<_>>().join(" + ");
            p.text(Pos2::new(lx, line_y), Align2::LEFT_TOP, format!("V{} · {name}", j.slot + 1), FontId::proportional(14.0), INK);
            let state = if j.leftover {
                "sobra esperando".to_string()
            } else if j.ready {
                "pronto".to_string()
            } else if j.paused {
                "pausado".to_string()
            } else {
                format!("falta {}", clock(j.remaining))
            };
            p.text(Pos2::new(lx, line_y + 18.0), Align2::LEFT_TOP, format!("{}/{} prontos · {state}", j.units, j.batch), FontId::proportional(11.5), DIM);
        }
        (None, Some(r)) => {
            let rd = r.data();
            let name = rd.outputs.iter().map(|&o| output_name(o)).collect::<Vec<_>>().join(" + ");
            p.text(Pos2::new(lx, line_y), Align2::LEFT_TOP, name, FontId::proportional(14.0), INK);
            let others = if g.crafting.free_slot(st).is_some() { jobs.iter().flatten().filter(|j| !j.ready && !j.paused).count() } else { 0 };
            let est = recipe_seconds(rd, s.batch) * (others + 1) as f64 / speed.max(1e-4);
            let mut hint = format!("Tempo {}", human_time(if speed > 0.001 { est } else { f64::INFINITY }));
            if batchable(rd) && s.batch > 1 {
                hint += &format!(" · {} cada", human_time(unit_seconds(rd) / speed.max(1e-4)));
            }
            if others > 0 {
                hint += &format!(" · dividindo a energia com {} trabalhos", others + 1);
            }
            let (txt, col) = match &s.flash {
                Some((f, until)) if now < *until => (f.clone(), RED),
                _ => (hint, DIM),
            };
            p.text(Pos2::new(lx, line_y + 18.0), Align2::LEFT_TOP, txt, FontId::proportional(11.5), col);
            let ib = Rect::from_min_size(Pos2::new(left.max.x - PAD - 28.0, line_y), Vec2::splat(26.0));
            if ui.put(ib, egui::Button::new("i").selected(s.info)).clicked() {
                s.info = !s.info;
            }
            if s.info {
                // a ciência da receita, por cima da câmara
                let box_r = Rect::from_min_max(Pos2::new(lx, io.min.y - 4.0), Pos2::new(left.max.x - PAD, line_y - 6.0));
                p.rect_filled(box_r, 6.0, Color32::from_rgba_unmultiplied(8, 10, 20, 245));
                p.rect_stroke(box_r, 6.0, Stroke::new(1.0, acc), egui::StrokeKind::Inside);
                let text = format!(
                    "{}\n{}\n{}",
                    rd.process.reaction,
                    rd.process.steps.iter().enumerate().map(|(i, s)| format!("{}. {s}", i + 1)).collect::<Vec<_>>().join("  ·  "),
                    rd.process.note
                );
                let gal = p.layout(text, FontId::proportional(11.5), INK, box_r.width() - 16.0);
                p.galley(box_r.min + Vec2::new(8.0, 6.0), gal, INK);
            }
        }
        _ => {}
    }
    // controles
    let put = |ui: &mut egui::Ui, x: f32, w: f32, label: String, enabled: bool, strong: Option<Color32>| -> bool {
        let r = Rect::from_min_size(Pos2::new(x, ctrl_y), Vec2::new(w, 32.0));
        let mut b = egui::Button::new(egui::RichText::new(label).size(13.0).color(if enabled { INK } else { DIM }));
        if let Some(c) = strong.filter(|_| enabled) {
            b = b.fill(c.gamma_multiply(0.45)).stroke(Stroke::new(1.0, c));
        }
        ui.add_enabled_ui(enabled, |ui| ui.put(r, b)).inner.clicked()
    };
    match &job {
        Some(j) => {
            let take = if j.waiting_count > 0 { format!("Pegar {}", j.waiting_count) } else { "Pegar".into() };
            let mut x = lx;
            if put(ui, x, 96.0, take, j.waiting_count > 0, Some(GREEN)) {
                actions.push(UiAction::Take(st, Some(j.slot)));
            }
            x += 102.0;
            if !j.ready && !j.leftover {
                if put(ui, x, 90.0, if j.paused { "Retomar".into() } else { "Pausar".into() }, true, None) {
                    actions.push(UiAction::Pause(st, j.slot));
                }
                x += 96.0;
                let sure = now - s.confirm_cancel < 3.0;
                if put(ui, x, 100.0, if sure { "Confirmar?".into() } else { "Cancelar".into() }, true, if sure { Some(RED) } else { None }) {
                    if sure {
                        actions.push(UiAction::Cancel(st, j.slot));
                        s.slot_sel = None;
                        s.confirm_cancel = -10.0;
                    } else {
                        s.confirm_cancel = now;
                    }
                }
            }
            if put(ui, left.max.x - PAD - 34.0, 34.0, "×".into(), true, None) {
                s.slot_sel = None;
            }
        }
        None => {
            if let Some(r) = rid {
                let rd = r.data();
                let check = g.crafting.check(r, s.batch, &g.inv, &g.equip);
                let mut x = lx;
                if batchable(rd) {
                    if put(ui, x, 32.0, "−".into(), s.batch > 1, None) {
                        s.batch -= 1;
                    }
                    x += 36.0;
                    p.text(Pos2::new(x + 22.0, ctrl_y + 16.0), Align2::CENTER_CENTER, format!("{}×", s.batch), FontId::monospace(14.0), INK);
                    x += 44.0;
                    if put(ui, x, 32.0, "+".into(), s.batch < top, None) {
                        s.batch += 1;
                    }
                    x += 36.0;
                    if put(ui, x, 52.0, "Tudo".into(), top > 1 && s.batch < top, None) {
                        s.batch = top;
                    }
                }
                let label = if check.owned {
                    if matches!(rd.outputs[0], Output::Station { .. }) { "Instalada".to_string() } else { "Equipado".to_string() }
                } else if check.pending {
                    "Trabalhando…".into()
                } else if check.full {
                    "Vagas cheias".into()
                } else if !check.missing.is_empty() {
                    "Faltam itens".into()
                } else if s.batch > 1 {
                    format!("Fazer {}×", s.batch)
                } else {
                    "Fabricar".into()
                };
                let w = 120.0f32.min(left.max.x - PAD - x - 6.0);
                if put(ui, left.max.x - PAD - w, w, label, check.ok && ok_all, Some(acc)) {
                    actions.push(UiAction::Start(r, s.batch));
                }
            }
        }
    }
    // vagas: uma ficha por vaga, com ícone, barra por unidade e tempo; tocar troca os controles pelos daquela vaga
    let n = jobs.len().max(1);
    let cw = ((lw - GAP * (n as f32 - 1.0)) / n as f32).min(150.0);
    for (i, j) in jobs.iter().enumerate() {
        let r = Rect::from_min_size(Pos2::new(lx + i as f32 * (cw + GAP), jobs_y), Vec2::new(cw, 36.0));
        let resp = ui.interact(r, egui::Id::unique(("vaga", st.0, i)), egui::Sense::click());
        let on = s.slot_sel == Some(i);
        let col = match j {
            Some(j) if j.ready || j.waiting_count > 0 => GREEN,
            Some(_) if on => acc,
            _ => LINE,
        };
        p.rect_filled(r, 4.0, SLOT_BG);
        p.rect_stroke(r, 4.0, Stroke::new(if on { 2.0 } else { 1.0 }, col), egui::StrokeKind::Inside);
        p.text(r.left_top() + Vec2::new(4.0, 2.0), Align2::LEFT_TOP, format!("V{}", i + 1), FontId::monospace(9.0), DIM);
        match j {
            None => {
                p.text(r.center(), Align2::CENTER_CENTER, "LIVRE", FontId::proportional(10.0), DIM);
            }
            Some(j) => {
                let ic = Rect::from_min_size(r.min + Vec2::new(18.0, 4.0), Vec2::splat(28.0));
                paint_icon(p, ic, icon_of(j.recipe.data().outputs[0]), Color32::WHITE);
                let t = if j.leftover {
                    "SOBRA".into()
                } else if j.ready {
                    "PRONTO".into()
                } else if j.paused {
                    "PAUSA".into()
                } else {
                    clock(j.remaining)
                };
                p.text(Pos2::new(r.max.x - 4.0, r.min.y + 4.0), Align2::RIGHT_TOP, t, FontId::monospace(10.0), if j.ready { GREEN } else { INK });
                // uma célula por unidade (até 10)
                let cells = j.batch.min(10) as usize;
                let per = j.batch as f64 / cells as f64;
                let bx0 = ic.max.x + 4.0;
                let cwid = ((r.max.x - 4.0 - bx0) - 2.0 * (cells as f32 - 1.0)) / cells as f32;
                for k in 0..cells {
                    let done = j.units as f64 / per;
                    let fill = if (k as f64) < (done + 1e-6).floor() { 1.0 } else if k == (done + 1e-6).floor() as usize && !j.ready { j.unit_progress } else { 0.0 };
                    let c = Rect::from_min_size(Pos2::new(bx0 + k as f32 * (cwid + 2.0), r.max.y - 9.0), Vec2::new(cwid, 5.0));
                    p.rect_filled(c, 1.0, LINE);
                    p.rect_filled(Rect::from_min_size(c.min, Vec2::new(c.width() * fill as f32, 5.0)), 1.0, if j.ready { GREEN } else { acc });
                }
                if resp.clicked() {
                    s.slot_sel = if on { None } else { Some(i) };
                    s.confirm_cancel = -10.0;
                    s.info = false;
                }
            }
        }
    }
}

/// a câmara animada (core.ts): forno = cadinho que esquenta; bancada = mesa com dois lasers e a peça crescendo; eletrolisador =
/// célula com eletrodos e bolhas. A leitura principal fica embaixo.
#[allow(clippy::too_many_arguments)]
fn draw_chamber(p: &egui::Painter, r: Rect, st: StationId, jobs: &[Option<JobView>], speed: f64, working: bool, now: f64, dt: f64, s: &mut State, acc: Color32) {
    p.rect_filled(r, 6.0, Color32::from_rgb(7, 9, 18));
    p.rect_stroke(r, 6.0, Stroke::new(1.0, LINE), egui::StrokeKind::Inside);
    let run = jobs.iter().flatten().find(|j| !j.ready && !j.paused && !j.leftover);
    let t = now as f32;
    let inner = r.shrink(8.0);
    let reading: String = match st.data().chamber.as_str() {
        "heat" => {
            // calor (thermal.ts): sobe rápido com trabalho, esfria devagar sem ele
            let target = jobs
                .iter()
                .flatten()
                .filter(|j| !j.ready && !j.paused && !j.leftover)
                .map(|j| j.recipe.data().process.temp.unwrap_or(1200.0))
                .fold(0.0, f64::max);
            let target = if target > 0.0 { 22.0 + (target - 22.0) * speed.clamp(0.0, 1.0) } else { 22.0 };
            let tau = if target > s.temp { 1.4 } else { 3.2 };
            s.temp += (target - s.temp) * (1.0 - (-dt / tau).exp());
            let k = ((s.temp - 22.0) / 1500.0).clamp(0.0, 1.0) as f32;
            let glow = if k < 0.5 {
                Color32::from_rgb((60.0 + 380.0 * k) as u8, (30.0 + 60.0 * k) as u8, 20)
            } else {
                Color32::from_rgb(250, (60.0 + 330.0 * (k - 0.5)).min(235.0) as u8, (20.0 + 300.0 * (k - 0.5)) as u8)
            };
            let cru = Rect::from_center_size(inner.center() + Vec2::new(0.0, 4.0), Vec2::new(inner.width() * 0.42, inner.height() * 0.5));
            p.rect_filled(cru.expand(4.0), 4.0, Color32::from_rgb(40, 44, 60));
            p.rect_filled(cru, 3.0, glow);
            if k > 0.25 {
                for i in 0..6 {
                    let ph = (t * 1.3 + i as f32 * 0.37).fract();
                    let x = cru.min.x + cru.width() * ((i as f32 * 0.61).fract());
                    p.circle_filled(Pos2::new(x, cru.min.y - ph * 18.0), 1.4, glow.gamma_multiply(1.0 - ph));
                }
            }
            format!("{:.0} °C", s.temp)
        }
        "laser" => {
            let bed = Rect::from_min_max(Pos2::new(inner.min.x + 6.0, inner.max.y - 14.0), Pos2::new(inner.max.x - 6.0, inner.max.y - 8.0));
            p.rect_filled(bed, 1.0, Color32::from_rgb(60, 66, 90));
            let prog = run.map_or(0.0, |j| j.progress) as f32;
            if prog > 0.0 {
                let h = (inner.height() - 30.0) * prog;
                let part = Rect::from_min_max(Pos2::new(bed.center().x - 16.0, bed.min.y - h), Pos2::new(bed.center().x + 16.0, bed.min.y));
                p.rect_filled(part, 1.0, acc.gamma_multiply(0.7));
                if run.is_some() {
                    for side in [-1.0f32, 1.0] {
                        let from = Pos2::new(if side < 0.0 { inner.min.x } else { inner.max.x }, inner.min.y + 4.0);
                        let x = part.center().x + (t * 3.0 * side).sin() * 14.0;
                        p.line_segment([from, Pos2::new(x, part.min.y)], Stroke::new(1.2, Color32::from_rgb(255, 80, 80)));
                    }
                }
            }
            format!("{:.0}%", prog * 100.0)
        }
        _ => {
            let cell = inner.shrink2(Vec2::new(inner.width() * 0.18, 6.0));
            p.rect_stroke(cell, 4.0, Stroke::new(1.0, Color32::from_rgb(90, 110, 150)), egui::StrokeKind::Inside);
            p.rect_filled(Rect::from_min_max(cell.min + Vec2::new(0.0, cell.height() * 0.3), cell.max), 3.0, Color32::from_rgba_unmultiplied(60, 120, 200, 70));
            for (i, side) in [0.3f32, 0.7].iter().enumerate() {
                let x = cell.min.x + cell.width() * side;
                p.line_segment([Pos2::new(x, cell.min.y + 2.0), Pos2::new(x, cell.max.y - 4.0)], Stroke::new(3.0, Color32::from_rgb(170, 175, 190)));
                if working {
                    // mais bolhas do lado do hidrogênio
                    let n = if i == 0 { 7 } else { 4 };
                    for b in 0..n {
                        let ph = (t * (0.6 + speed as f32) + b as f32 / n as f32).fract();
                        let y = cell.max.y - 6.0 - ph * (cell.height() * 0.7);
                        p.circle_stroke(Pos2::new(x + ((b as f32 * 1.7).sin()) * 5.0, y), 1.6 + b as f32 % 2.0, Stroke::new(1.0, Color32::from_rgb(200, 230, 255)));
                    }
                }
            }
            format!("{:.1} kW", st.data().kw * if run.is_some() { speed } else { 0.0 })
        }
    };
    let status = if working {
        "TRABALHANDO"
    } else if jobs.iter().flatten().any(|j| j.ready || j.waiting_count > 0) {
        "PRONTO"
    } else {
        "PARADA"
    };
    p.text(r.left_top() + Vec2::new(6.0, 4.0), Align2::LEFT_TOP, status, FontId::proportional(9.0), if working { acc } else { DIM });
    p.text(r.center_bottom() - Vec2::new(0.0, 4.0), Align2::CENTER_BOTTOM, reading, FontId::monospace(12.0), INK);
}

/// onde fica o espaço `i` do inventário numa tela deste tamanho (pontos): para o roteiro jogado tocar nele
pub fn slot_rect(screen: Rect, i: usize) -> Rect {
    layout(screen).slots[i]
}

/// onde fica a entrada da estação numa tela deste tamanho
pub fn input_rect(screen: Rect) -> Rect {
    station_rects(layout(screen).left).input
}
