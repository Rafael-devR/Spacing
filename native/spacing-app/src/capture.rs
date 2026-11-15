//! Capturas de teste sem janela (computador): `spacing --captura <pasta> [lua|marte] [semente]`. Joga um roteiro curto (parado,
//! andando, pulando, girando a câmera) e salva PNGs, para olhar o jogo num servidor sem placa de vídeo (como o
//! tools/visual-check do jogo web). O tempo de quadro daqui não vale para o celular.
use std::time::Instant;

use spacing_core::planet::planet;
use spacing_render::{Renderer, Ui};

use crate::controls::Controls;
use crate::game::{Game, Models};
use crate::{hud, Options};

pub fn run(dir: &str, opts: Options) {
    let _ = std::fs::create_dir_all(dir);
    let (w, h) = (1280u32, 720u32);
    let mut r = match pollster::block_on(Renderer::new_headless(w, h, planet(opts.planet))) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("sem desenho: {e}");
            std::process::exit(1);
        }
    };
    // SPACING_ESCALA=0.7 desenha a cena menor, como no celular (a interface continua na resolução cheia)
    if let Some(sc) = std::env::var("SPACING_ESCALA").ok().and_then(|v| v.parse::<f32>().ok()) {
        r.set_scale(sc);
    }
    println!("desenho: {} ({}), MSAA {}x, cena {:?}", r.adapter_name, r.backend, r.msaa(), r.scene_size());
    let models = Models::load(&mut r);
    let t0 = Instant::now();
    let mut game = Game::new(opts.planet, opts.seed, 3);
    println!("mundo inicial: {:.0} ms", t0.elapsed().as_secs_f64() * 1000.0);
    let mut c = Controls::default();
    c.layout(w as f32, h as f32, 1.0);
    c.touched = true;
    let egui = egui::Context::default();
    let meter = hud::Meter::default();
    let dt = 1.0 / 60.0;
    // (quadro, nome da captura)
    let shots = [(30, "1-pouso"), (150, "2-andando"), (200, "3-pulo"), (275, "6-meteoro-voo"), (312, "7-meteoro-impacto"), (330, "8-meteoro-onda"), (360, "4-girou"), (420, "5-longe"), (450, "9-minerando"), (530, "10-quebrou"), (575, "11-construiu"), (690, "12-morte"), (740, "13-renasceu"), (770, "14-base-fora"), (800, "15-camara"), (1000, "16-dentro"), (1040, "16b-estacao"), (1100, "16c-maquinas"), (1360, "17-saiu"), (1380, "18-estufa-obra"), (1420, "19-estufa-pronta")];
    let mut stats = Default::default();
    game.meteors.auto_spawn = false;
    for f in 0..=1420 {
        c.scripted = Some(match f {
            0..=60 => (0.0, 0.0),
            61..=180 => (0.0, 1.0),
            181..=260 => (0.6, 0.8),
            _ => (0.0, 0.0),
        });
        if f == 190 {
            c.actions.jump = true;
        }
        // um meteoro: aviso de 1,6 s e voo de 1,7 s, cai por volta do quadro 310
        if f == 112 {
            c.actions.meteor = true;
        }
        if f == 270 {
            c.actions.rotate = 1.0;
        }
        if f == 340 {
            c.actions.zoom = 1.45;
        }
        // Marte: um redemoinho perto no quadro 300 e a tempestade no auge para a última foto
        if f == 300 {
            let p = game.player.pos;
            if let Some(m) = &mut game.mars {
                m.force_devil(&mut game.world, p);
            }
        }
        if f == 400 {
            if let Some(m) = &mut game.mars {
                m.force_storm();
            }
        }
        // minerar: o mouse segura num bloco do chão logo à frente; depois constrói com o que saiu
        let screen_of = |game: &Game, p: [f64; 3]| {
            let q = game.view_proj * glam::Vec4::new(p[0] as f32, p[1] as f32, p[2] as f32, 1.0);
            ((q.x / q.w * 0.5 + 0.5) * w as f32, (0.5 - q.y / q.w * 0.5) * h as f32)
        };
        if f == 425 {
            c.layout(w as f32, h as f32, 1.0);
            let p = game.player.pos;
            let ground = [p[0].floor() + 2.5, p[1] - 0.5, p[2].floor() + 0.5];
            let (x, y) = screen_of(&game, ground);
            c.finger_down(7, x, y, w as f32, false);
        }
        if f == 526 {
            c.touch_end(7);
            // o que saiu vai para a barra (os itens voam até o astronauta nesses quadros)
        }
        if f == 580 {
            // dá regolito e coloca no espaço 2 da barra, para a morte espalhar alguma coisa
            let mut ev = Vec::new();
            game.inv.add(spacing_core::rules::ItemId::of("regolith"), 12, false, &mut ev);
            game.hurt_player(500.0);
        }
        if f == 700 {
            c.tap(10.0, 10.0, false);
        }
        // a base: vai até a porta, entra, olha o interior e sai
        if f == 745 {
            let o = game.base.layout.outside;
            let gy = game.world.top_y(o[0].floor() as i32, o[2].floor() as i32) as f64 + 1.0;
            game.player.pos = [o[0], gy, o[2] + 0.4];
            game.player.prev_pos = game.player.pos;
            c.actions.zoom = 0.75;
        }
        // as estações: material, o forno e o eletrolisador instalados, receitas começadas, a tela da bancada aberta
        if f == 1001 {
            use spacing_core::rules::{ItemId, RecipeId, StationId};
            let mut ev = Vec::new();
            for (k, n) in [("iron_bar", 12), ("glass", 6), ("brick", 6), ("silicon", 6), ("gold", 3), ("regolith", 40), ("rock", 10), ("iron", 10), ("ice", 6)] {
                game.inv.add(ItemId::of(k), n, false, &mut ev);
            }
            game.crafting.unlock(StationId::of("furnace"));
            game.crafting.unlock(StationId::of("electrolyzer"));
            game.ui_action(crate::hud::UiAction::Start(RecipeId::of("brick"), 4));
            game.ui_action(crate::hud::UiAction::Start(RecipeId::of("glass"), 1));
            game.ui_action(crate::hud::UiAction::Start(RecipeId::of("water"), 2));
            game.ui_action(crate::hud::UiAction::Start(RecipeId::of("solar_panel"), 1));
            game.screen_open = Some(crate::game::Screen::Station(StationId::of("furnace")));
            c.modal = true;
        }
        if f == 1060 {
            game.screen_open = None;
            c.modal = false;
        }
        // a estufa: assenta perto, entrega três peças; depois termina e planta
        if f == 1362 {
            let ok = game.test_place_site();
            println!("  estufa assentada: {ok}");
            if let Some(s) = game.greenhouse.site.clone() {
                let mut ev = Vec::new();
                for (k, n) in [("brick", 12), ("iron_bar", 8)] {
                    game.inv.add(spacing_core::rules::ItemId::of(k), n, false, &mut ev);
                }
                for _ in 0..3 {
                    game.site_use(crate::greenhouse::SiteUse::Build);
                }
                let gy = game.world.top_y(s.x + 3, s.z + 10) as f64 + 1.0;
                game.player.pos = [s.x as f64 + 3.5, gy, s.z as f64 + 9.0];
                game.player.prev_pos = game.player.pos;
            }
        }
        if f == 1390 {
            game.test_build_and_farm(0.55);
        }
        if f == 775 || f == 1110 {
            println!("  base: {:?} usar {:?}", game.base.mode, game.base.use_label);
            c.actions.use_ = true;
        }
        if f == 545 {
            c.actions.toggle_build = true;
        }
        if f == 560 {
            let p = game.player.pos;
            let (x, y) = screen_of(&game, [p[0].floor() - 1.5, p[1] - 0.5, p[2].floor() + 0.5]);
            c.tap(x, y, false);
        }
        game.update(dt, &mut c);
        game.sync(&mut r);
        let Some((_, name)) = shots.iter().find(|s| s.0 == f) else { continue };
        // espera as threads entregarem o que falta antes de fotografar
        for _ in 0..200 {
            if game.world.update(game.player.pos[0], game.player.pos[2], 2) == 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
            game.sync(&mut r);
        }
        game.sync(&mut r);
        let info = hud::HudInfo {
            meter: &meter,
            stats,
            backend: &r.backend,
            size: (w, h),
            scene: r.scene_size(),
            msaa: r.msaa(),
            present: r.present_mode(),
            planet: planet(game.planet).name,
            seed: game.seed,
            pos: game.player.pos,
            chunks: game.world.chunk_count(),
            show_stats: true,
            bench: Vec::new(),
            game: &game,
        };
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(w as f32, h as f32))),
            ..Default::default()
        };
        // uma janela nova do egui só aparece no segundo quadro (o primeiro mede)
        let first = egui.run_ui(raw.clone(), |ui| {
            hud::draw(ui.ctx(), &c, &info);
        });
        let mut out = egui.run_ui(raw, |ui| {
            hud::draw(ui.ctx(), &c, &info);
        });
        // as texturas do primeiro quadro (a fonte) precisam chegar ao desenho
        let mut tex = first.textures_delta;
        tex.append(std::mem::take(&mut out.textures_delta));
        out.textures_delta = tex;
        let prims = egui.tessellate(out.shapes, out.pixels_per_point);
        let frame = game.frame(&models, w as f64 / h as f64);
        let t = Instant::now();
        stats = r.render(&frame, Some(Ui { primitives: &prims, textures: &out.textures_delta, pixels_per_point: 1.0 })).unwrap_or_default();
        let px = r.read_pixels().expect("pixels");
        let path = format!("{dir}/{name}.png");
        let file = std::fs::File::create(&path).expect("arquivo");
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().and_then(|mut wr| wr.write_image_data(&px)).expect("png");
        println!("  sprites: {} (baforadas {}, pedrinhas {}), pedaços {}, itens voando {}, inventário {:?}", game.sprite_count(), game.puffs.active(), game.particles.active(), game.debris.count(), game.drops.drops.len(), game.inv.totals());
        println!("  base {:?} vista de dentro {} porta {:.2}", game.base.mode, game.base.indoor_view, game.base.door);
        println!("  mira {:?} progresso {:?} alvo {:?} dureza {:?}", game.interaction.aim, game.interaction.progress, game.interaction.target.as_ref().map(|t| t.key()), game.interaction.target.as_ref().map(|t| t.hardness()));
        println!(
            "{path}: {} chamadas, {} triângulos, {}/{} chunks, {:.0} ms (software), jogador {:.1} {:.1} {:.1}",
            stats.draws,
            stats.triangles,
            stats.chunks_drawn,
            stats.chunks_total,
            t.elapsed().as_secs_f64() * 1000.0,
            game.player.pos[0],
            game.player.pos[1],
            game.player.pos[2]
        );
    }
    // troca de planeta com o mesmo desenho (como no app: o Android não deixa recriar a superfície)
    let other = match opts.planet {
        spacing_core::planet::PlanetId::Lua => spacing_core::planet::PlanetId::Marte,
        spacing_core::planet::PlanetId::Marte => spacing_core::planet::PlanetId::Lua,
    };
    r.set_planet(planet(other));
    let mut game = Game::new(other, opts.seed, 3);
    for _ in 0..30 {
        game.update(dt, &mut c);
        game.sync(&mut r);
    }
    let frame = game.frame(&models, w as f64 / h as f64);
    r.render(&frame, None).expect("quadro depois da troca");
    let px = r.read_pixels().expect("pixels");
    let file = std::fs::File::create(format!("{dir}/6-trocou.png")).expect("arquivo");
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header().and_then(|mut wr| wr.write_image_data(&px)).expect("png");
    println!("troca de planeta ok");
    // teste de custo dos efeitos (os números daqui são do desenho por software)
    let mut bench = crate::effects::EffectBench::new(&mut r);
    let mut last = Instant::now();
    while !bench.done {
        let frame = game.frame(&models, w as f64 / h as f64);
        r.render(&frame, None);
        let now = Instant::now();
        bench.frame((now - last).as_secs_f64(), &mut r);
        last = now;
    }
    for l in bench.report() {
        println!("{l}");
    }
}
