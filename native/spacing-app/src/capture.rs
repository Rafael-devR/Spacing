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
    println!("desenho: {} ({}), MSAA {}x", r.adapter_name, r.backend, r.msaa());
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
    let shots = [(30, "1-pouso"), (150, "2-andando"), (200, "3-pulo"), (320, "4-girou"), (420, "5-longe")];
    let mut stats = Default::default();
    for f in 0..=420 {
        c.scripted = Some(match f {
            0..=60 => (0.0, 0.0),
            61..=180 => (0.0, 1.0),
            181..=260 => (0.6, 0.8),
            _ => (0.0, 0.0),
        });
        if f == 190 {
            c.actions.jump = true;
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
            msaa: r.msaa(),
            present: r.present_mode(),
            planet: planet(game.planet).name,
            seed: game.seed,
            pos: game.player.pos,
            chunks: game.world.chunk_count(),
            show_stats: true,
        };
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(w as f32, h as f32))),
            ..Default::default()
        };
        let out = egui.run_ui(raw, |ui| hud::draw(ui.ctx(), &c, &info));
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
        println!("  sprites: {} (baforadas {}, pedrinhas {})", game.sprite_count(), game.puffs.active(), game.particles.active());
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
}
