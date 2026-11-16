//! Mapa do tablet (porte simplificado do `MapDirector.ts` e do `blockMap.ts`, docs/design/MAPA.md): só o que o astronauta já
//! descobriu (`Exploration`), com a cor do bloco do topo de cada coluna, mais claro no alto e mais escuro no fundo, e os
//! marcadores (astronauta, módulo, base, objetivo, itens caídos, minérios vistos). Gira com a câmera: para cima no mapa é
//! para a frente na tela do jogo.
//!
//! Diferença do jogo web: lá o mapa é um relevo 3D em blocos, na perspectiva da câmera, num tablet que sobe do pulso. Aqui é a
//! mesma informação vista de cima, numa imagem (um pixel por bloco); o tablet 3D fica para depois.
use std::collections::{HashMap, HashSet};

use egui::{Align2, Color32, FontId, Pos2, Rect, Stroke, Vec2};
use spacing_core::blocks::*;
use spacing_core::rules::exploration::MAP_CHUNK;
use spacing_core::terrain::{CS, LANDER};

use crate::game::Game;
use crate::hud::UiAction;

/// as colunas de um chunk: (altura do topo, bloco do topo); y < 0 = nada
type Columns = Vec<(i16, u8)>;

/// O topo das colunas descobertas, calculado aos poucos (gerar chunk é caro) e refeito quando um bloco muda.
#[derive(Default)]
pub struct MapSurface {
    cols: HashMap<(i32, i32), Columns>,
    /// muda quando algo muda (a imagem é refeita)
    pub version: u64,
}

impl MapSurface {
    /// um bloco mudou: a coluna do chunk dele é lida de novo
    pub fn invalidate(&mut self, x: i32, z: i32) {
        let k = (x.div_euclid(CS as i32), z.div_euclid(CS as i32));
        if self.cols.remove(&k).is_some() {
            self.version += 1;
        }
    }

    pub fn clear(&mut self) {
        self.cols.clear();
        self.version += 1;
    }
}

/// cores do mapa por tipo de chão (o PALETTE do blockMap.ts; minérios aparecem como a rocha em volta)
fn palette(id: u8) -> [u8; 3] {
    let hex = match id {
        REGOLITH => 0xded5c6,
        ROCK | IRON => 0xa69d94,
        BASALT | CRYSTAL => 0x7a7286,
        ICE => 0xcdeef7,
        BEDROCK => 0x4a4354,
        HULL => 0xf2f3f7,
        ANORTHOSITE => 0xece9e2,
        BRECCIA => 0x9c918c,
        NORITE | ILMENITE_ORE | GOLD_ORE => 0x716d78,
        GLASSY_BASALT => 0x4d475b,
        MARS_DUST => 0xc4795a,
        MARS_ROCK | HEMATITE => 0x9a5e4a,
        GYPSUM | SEDIMENT => 0xc9a07c,
        DARK_SAND => 0x5e4a48,
        VOLCANIC | OLIVINE => 0x6a5652,
        LAVA => 0xff7a2a,
        _ => 0xa69d94,
    };
    [(hex >> 16) as u8, (hex >> 8) as u8, hex as u8]
}

impl Game {
    /// Lê o topo das colunas descobertas que ainda não foram lidas, no máximo `budget` chunks (os mais perto primeiro).
    pub fn prepare_map(&mut self, budget: usize) {
        let p = self.player.pos;
        let mut todo: Vec<(i32, i32)> = self.exploration.chunks().filter(|k| !self.map.cols.contains_key(k)).collect();
        if todo.is_empty() {
            return;
        }
        let c = MAP_CHUNK as f64;
        todo.sort_by(|a, b| {
            let d = |k: &(i32, i32)| ((k.0 as f64 + 0.5) * c - p[0]).powi(2) + ((k.1 as f64 + 0.5) * c - p[2]).powi(2);
            d(a).total_cmp(&d(b))
        });
        for k in todo.into_iter().take(budget) {
            let mut cols = Vec::with_capacity(CS * CS);
            for lz in 0..CS as i32 {
                for lx in 0..CS as i32 {
                    let (x, z) = (k.0 * CS as i32 + lx, k.1 * CS as i32 + lz);
                    let y = self.world.top_y(x, z);
                    cols.push((y as i16, self.world.get_block(x, y, z)));
                }
            }
            self.map.cols.insert(k, cols);
            self.map.version += 1;
        }
    }
}

/// a imagem do mapa e onde ela fica no mundo
#[derive(Clone)]
struct MapTexture {
    key: (u64, u32),
    tex: egui::TextureHandle,
    /// canto (x, z) do mundo e tamanho em blocos
    x0: i32,
    z0: i32,
    w: i32,
    h: i32,
}

fn build_image(g: &Game) -> Option<(egui::ColorImage, i32, i32, i32, i32)> {
    let chunks: Vec<(i32, i32)> = g.exploration.chunks().collect();
    if chunks.is_empty() {
        return None;
    }
    let (cx0, cx1) = (chunks.iter().map(|k| k.0).min()?, chunks.iter().map(|k| k.0).max()?);
    let (cz0, cz1) = (chunks.iter().map(|k| k.1).min()?, chunks.iter().map(|k| k.1).max()?);
    let c = CS as i32;
    let (x0, z0) = (cx0 * c, cz0 * c);
    let (w, h) = (((cx1 - cx0 + 1) * c).min(2048), ((cz1 - cz0 + 1) * c).min(2048));
    let ref_y = g.base_height();
    let mut px = vec![Color32::TRANSPARENT; (w * h) as usize];
    let col = |x: i32, z: i32| -> Option<(i16, u8)> {
        let k = (x.div_euclid(c), z.div_euclid(c));
        let cols = g.map.cols.get(&k)?;
        let v = cols[(z.rem_euclid(c) * c + x.rem_euclid(c)) as usize];
        (v.0 >= 0).then_some(v)
    };
    for iz in 0..h {
        for ix in 0..w {
            let (x, z) = (x0 + ix, z0 + iz);
            if !g.exploration.at(x as f64, z as f64) {
                continue;
            }
            let Some((y, id)) = col(x, z) else { continue };
            // mais claro no alto, mais escuro no fundo (como o blockMap.ts), e um relevo pela diferença para o vizinho
            let mut tint = (0.86 + (y as f64 - ref_y) * 0.014).clamp(0.66, 1.14) * if (x + z) & 1 == 1 { 0.965 } else { 1.0 };
            if let Some((yn, _)) = col(x, z - 1) {
                tint *= (1.0 + (y - yn) as f64 * 0.07).clamp(0.75, 1.25);
            }
            let [r, gg, b] = palette(id);
            let f = |v: u8| (v as f64 * tint).clamp(0.0, 255.0) as u8;
            px[(iz * w + ix) as usize] = Color32::from_rgb(f(r), f(gg), f(b));
        }
    }
    let img = egui::ColorImage { size: [w as usize, h as usize], pixels: px, source_size: Vec2::new(w as f32, h as f32) };
    Some((img, x0, z0, w, h))
}

/// marcadores: cor e se tem nome
const PLAYER: Color32 = Color32::from_rgb(0xff, 0x7a, 0x2f);
const LANDER_C: Color32 = Color32::from_rgb(0xff, 0xd2, 0x7a);
const BASE_C: Color32 = Color32::from_rgb(0xf4, 0xf0, 0xe8);
const GOAL_C: Color32 = Color32::from_rgb(0x7f, 0xe7, 0xff);
const LOOT_C: Color32 = Color32::from_rgb(0xff, 0x9a, 0x4a);

fn ore_color(kind: &str) -> Option<(Color32, &'static str)> {
    Some(match kind {
        "meteorite" => (Color32::from_rgb(0xff, 0xb0, 0x70), "meteorito"),
        "crystal" => (Color32::from_rgb(0x8f, 0xf1, 0xff), "cristal"),
        "gold" => (Color32::from_rgb(0xff, 0xd3, 0x4a), "ouro"),
        "ilmenite" => (Color32::from_rgb(0xc9, 0xc3, 0xd9), "ilmenita"),
        _ => return None,
    })
}

pub fn map_screen(ui: &mut egui::Ui, g: &Game, actions: &mut Vec<UiAction>) {
    let accent = Color32::from_rgb(127, 231, 255);
    let ctx = ui.ctx().clone();
    let zoom_id = egui::Id::unique("mapa-zoom");
    let mut span: f32 = ctx.data(|d| d.get_temp(zoom_id)).unwrap_or(80.0);
    ui.horizontal(|ui| {
        ui.heading(egui::RichText::new("Mapa").color(accent).strong());
        ui.label(egui::RichText::new(format!("{} ladrilhos descobertos", g.exploration.revealed)).weak());
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if ui.button("Fechar").clicked() {
                actions.push(UiAction::Close);
            }
            if ui.button("−").clicked() {
                span = (span * 1.4).min(420.0);
            }
            if ui.button("+").clicked() {
                span = (span / 1.4).max(30.0);
            }
        });
    });
    ctx.data_mut(|d| d.insert_temp(zoom_id, span));

    // a imagem, refeita quando algo muda
    let tex_id = egui::Id::unique("mapa-textura");
    let key = (g.map.version, g.exploration.revealed);
    let cached: Option<MapTexture> = ctx.data(|d| d.get_temp(tex_id));
    let tex = match cached {
        Some(t) if t.key == key => Some(t),
        old => build_image(g).map(|(img, x0, z0, w, h)| {
            let tex = match old {
                Some(mut t) => {
                    t.tex.set(img, egui::TextureOptions::NEAREST);
                    t.tex
                }
                None => ctx.load_texture("mapa", img, egui::TextureOptions::NEAREST),
            };
            let t = MapTexture { key, tex, x0, z0, w, h };
            ctx.data_mut(|d| d.insert_temp(tex_id, t.clone()));
            t
        }),
    };

    let (rect, _) = ui.allocate_exact_size(ui.available_size() - Vec2::new(0.0, 22.0), egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 8.0, Color32::from_rgb(8, 9, 20));
    let p = g.player.pos;
    let yaw = g.rig.yaw;
    let ppb = rect.width().min(rect.height()) / span;
    let ctr = rect.center();
    // do mundo para a tela: para cima = para a frente da câmera
    let (c, s) = (yaw.cos() as f32, yaw.sin() as f32);
    let to_screen = |x: f64, z: f64| -> Pos2 {
        let (dx, dz) = ((x - p[0]) as f32, (z - p[2]) as f32);
        ctr + Vec2::new(dx * c - dz * s, dx * s + dz * c) * ppb
    };
    if let Some(t) = &tex {
        let (x0, z0, x1, z1) = (t.x0 as f64, t.z0 as f64, (t.x0 + t.w) as f64, (t.z0 + t.h) as f64);
        let mut mesh = egui::Mesh::with_texture(t.tex.id());
        let corners = [(x0, z0, 0.0, 0.0), (x1, z0, 1.0, 0.0), (x1, z1, 1.0, 1.0), (x0, z1, 0.0, 1.0)];
        for (x, z, u, v) in corners {
            mesh.vertices.push(egui::epaint::Vertex { pos: to_screen(x, z), uv: Pos2::new(u, v), color: Color32::WHITE });
        }
        mesh.indices.extend_from_slice(&[0, 1, 2, 0, 2, 3]);
        painter.add(egui::Shape::mesh(mesh));
    }
    let pin = |at: Pos2, col: Color32, label: Option<&str>| {
        painter.circle_filled(at, 5.0, col);
        painter.circle_stroke(at, 5.0, Stroke::new(1.2, Color32::from_black_alpha(200)));
        if let Some(l) = label {
            painter.text(at + Vec2::new(0.0, -13.0), Align2::CENTER_CENTER, l, FontId::proportional(12.0), col);
        }
    };
    // minérios e meteoritos vistos (dos chunks carregados, onde já foi descoberto)
    let mut seen = HashSet::new();
    for ch in g.world.chunks.values() {
        for pr in &ch.props {
            let Some((col, _)) = ore_color(pr.kind) else { continue };
            if g.exploration.at(pr.wx as f64, pr.wz as f64) && seen.insert((pr.wx, pr.wz)) {
                let at = to_screen(pr.wx as f64 + 0.5, pr.wz as f64 + 0.5);
                painter.rect_filled(Rect::from_center_size(at, Vec2::splat(6.0)), 1.0, col);
            }
        }
    }
    for l in &g.loot.pieces {
        pin(to_screen(l.pos[0], l.pos[2]), LOOT_C, None);
    }
    let b = g.base.layout.center;
    pin(to_screen(b[0], b[2]), BASE_C, Some("Base"));
    pin(to_screen(LANDER.0 + 0.5, LANDER.1 + 0.5), LANDER_C, Some("Módulo"));
    if let Some(t) = g.mission_target() {
        pin(to_screen(t[0], t[2]), GOAL_C, Some("Objetivo"));
    }
    // astronauta: seta para onde ele olha
    let f = g.player.facing;
    let dir = {
        let (dx, dz) = (f.sin() as f32, f.cos() as f32);
        Vec2::new(dx * c - dz * s, dx * s + dz * c)
    };
    let side = Vec2::new(-dir.y, dir.x);
    let a = to_screen(p[0], p[2]);
    painter.add(egui::Shape::convex_polygon(vec![a + dir * 11.0, a - dir * 6.0 + side * 7.0, a - dir * 6.0 - side * 7.0], PLAYER, Stroke::new(1.5, Color32::WHITE)));

    // legenda
    let legend = [(PLAYER, "você"), (LANDER_C, "módulo"), (BASE_C, "base"), (GOAL_C, "objetivo"), (LOOT_C, "itens caídos")];
    ui.horizontal(|ui| {
        for (col, name) in legend {
            ui.label(egui::RichText::new(name).color(col));
        }
        for k in ["meteorite", "crystal", "gold", "ilmenite"] {
            let (col, name) = ore_color(k).unwrap();
            ui.label(egui::RichText::new(name).color(col));
        }
    });
}
