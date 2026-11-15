//! Roteiro jogado sem janela (computador): `spacing --roteiro <pasta>`. O equivalente nativo do `tools/visual-check/play.mjs`
//! do jogo web, mais as missões e o salvamento (M4d): começa um jogo novo, minera um bloco com a mira, cumpre a cadeia de
//! missões da Lua (o meteorito da missão cai de verdade e é minerado), salva, abre o menu e o mapa, morre sem oxigênio,
//! renasce, recolhe os itens caídos, carrega o salvamento de novo e abre um salvamento antigo do jogo web. Cada etapa diz
//! OK ou FALHOU; no fim sai com erro se alguma falhou. As capturas ficam na pasta.
use spacing_core::planet::{planet, PlanetId};
use spacing_core::rules::{Counts, EquipId, Events, ItemId};
use spacing_core::terrain::LANDER;
use spacing_render::Renderer;

use crate::controls::Controls;
use crate::game::{world_gen, Game, Models, Screen};
use crate::storage::Store;
use crate::{capture, hud};

const DT: f64 = 1.0 / 60.0;

struct Run {
    r: Renderer,
    models: Models,
    egui: egui::Context,
    c: Controls,
    meter: hud::Meter,
    stats: spacing_render::FrameStats,
    game: Game,
    store: Store,
    dir: String,
    results: Vec<String>,
    failed: usize,
    /// relógio do egui nos quadros com toque (toque longo e toque duplo dependem dele)
    ui_t: f64,
    /// letras e texturas novas dos quadros sem desenho (vão junto na próxima captura)
    pending: egui::TexturesDelta,
}

impl Run {
    fn check(&mut self, name: &str, ok: bool, detail: impl Into<String>) {
        let d = detail.into();
        let line = format!("{} {name}{}", if ok { "OK    " } else { "FALHOU" }, if d.is_empty() { String::new() } else { format!(" ({d})") });
        println!("{line}");
        if !ok {
            self.failed += 1;
        }
        self.results.push(line);
    }

    /// um quadro do jogo (a câmera é montada para a mira achar o alvo; o desenho só nas capturas)
    fn step(&mut self) {
        self.game.update(DT, &mut self.c);
        self.game.sync(&mut self.r);
        let (w, h) = self.r.size();
        let _ = self.game.frame(&self.models, w as f64 / h as f64);
    }

    fn steps(&mut self, n: usize) {
        for _ in 0..n {
            self.step();
        }
    }

    /// anda o jogo até `cond` valer ou passar `secs` segundos de jogo
    fn wait(&mut self, secs: f64, cond: impl Fn(&Game) -> bool) -> bool {
        let n = (secs / DT) as usize;
        for _ in 0..n {
            if cond(&self.game) {
                return true;
            }
            self.step();
        }
        cond(&self.game)
    }

    fn shot(&mut self, name: &str) {
        // espera as threads entregarem os chunks antes de fotografar
        for _ in 0..200 {
            if self.game.world.update(self.game.player.pos[0], self.game.player.pos[2], 2) == 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
            self.game.sync(&mut self.r);
        }
        self.game.sync(&mut self.r);
        let path = format!("{}/{name}.png", self.dir);
        self.stats = capture::shoot(&mut self.r, &self.models, &self.egui, &self.c, &mut self.game, &self.meter, self.stats, &path, Some(&mut self.pending));
        println!("       captura {path}");
    }

    /// um quadro da interface com estes toques (pontos de tela); o que a tela pedir vai para o jogo
    fn ui(&mut self, events: Vec<egui::Event>, dt: f64) {
        self.ui_t += dt;
        let (w, h) = self.r.size();
        let actions = {
            let info = hud::HudInfo {
                meter: &self.meter,
                stats: self.stats,
                backend: &self.r.backend,
                size: (w, h),
                scene: self.r.scene_size(),
                msaa: self.r.msaa(),
                present: self.r.present_mode(),
                planet: planet(self.game.planet).name,
                seed: self.game.seed,
                pos: self.game.player.pos,
                chunks: self.game.world.chunk_count(),
                show_stats: false,
                bench: Vec::new(),
                saved_ago: None,
                save_path: None,
                game: &self.game,
            };
            let raw = egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(w as f32, h as f32))),
                time: Some(self.ui_t),
                events,
                ..Default::default()
            };
            let mut actions = Vec::new();
            let out = self.egui.run_ui(raw, |ui| actions = hud::draw(ui.ctx(), &self.c, &info));
            self.pending.append(out.textures_delta);
            actions
        };
        for a in actions {
            self.game.ui_action(a);
        }
        self.c.modal = self.game.screen_open.is_some();
        self.step();
    }

    /// apertar ou soltar o dedo num ponto
    fn touch(&mut self, at: egui::Pos2, pressed: bool) {
        self.ui(vec![egui::Event::PointerMoved(at), egui::Event::PointerButton { pos: at, button: egui::PointerButton::Primary, pressed, modifiers: Default::default() }], 0.03);
    }

    /// arrastar de um ponto a outro (com uns quadros no caminho)
    fn drag(&mut self, a: egui::Pos2, b: egui::Pos2) {
        self.ui(vec![egui::Event::PointerMoved(a)], 0.03);
        self.touch(a, true);
        for k in 1..=4 {
            self.ui(vec![egui::Event::PointerMoved(a + (b - a) * (k as f32 / 4.0))], 0.03);
        }
        self.touch(b, false);
    }

    fn slot_center(&self, i: usize) -> egui::Pos2 {
        let (w, h) = self.r.size();
        crate::items_screen::slot_rect(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(w as f32, h as f32)), i).center()
    }

    fn teleport(&mut self, x: f64, z: f64) {
        let g = &mut self.game;
        let y = g.world.top_y(x.floor() as i32, z.floor() as i32) as f64 + 1.05;
        g.player.pos = [x, y, z];
        g.player.prev_pos = g.player.pos;
        g.player.vel = [0.0; 3];
    }

    /// o ponto do mundo na tela (pixels)
    fn screen_of(&self, p: [f64; 3]) -> (f32, f32) {
        let (w, h) = self.r.size();
        let q = self.game.view_proj * glam::Vec4::new(p[0] as f32, p[1] as f32, p[2] as f32, 1.0);
        ((q.x / q.w * 0.5 + 0.5) * w as f32, (0.5 - q.y / q.w * 0.5) * h as f32)
    }

    /// segura o botão do mouse num ponto até `done` valer (minerar); devolve se valeu
    fn hold_on(&mut self, p: [f64; 3], secs: f64, done: impl Fn(&Game) -> bool) -> bool {
        let (w, _) = self.r.size();
        let (x, y) = self.screen_of(p);
        self.c.finger_down(7, x, y, w as f32, false);
        let ok = self.wait(secs, done);
        self.c.touch_end(7);
        self.step();
        ok
    }

    /// itens "coletados no mundo" (contam para a missão, como se viessem da mineração)
    fn collect(&mut self, list: &[(&str, u32)]) {
        let mut ev = Events::new();
        for &(k, n) in list {
            self.game.inv.add(ItemId::of(k), n, true, &mut ev);
        }
        self.game.react(ev);
    }

    fn mission(&self) -> &'static str {
        &self.game.missions.current().id
    }
}

fn same(a: &Counts, b: &Counts) -> bool {
    let mut x: Vec<_> = a.iter().collect();
    let mut y: Vec<_> = b.iter().collect();
    x.sort();
    y.sort();
    x == y
}

fn fmt(c: &Counts) -> String {
    c.iter().map(|(i, n)| format!("{} {n}", i.key())).collect::<Vec<_>>().join(", ")
}

pub fn run(dir: &str) {
    let _ = std::fs::create_dir_all(dir);
    let saves = std::path::PathBuf::from(dir).join("salvamentos");
    let _ = std::fs::remove_dir_all(&saves);
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
    let _ = crate::icons::Icons::ensure(&r, &egui);
    let store = Store::new(Some(saves));
    let mut c = Controls::default();
    c.layout(w as f32, h as f32, 1.0);
    c.touched = true;
    let seed = crate::DEFAULT_SEED;
    let game = Game::load(PlanetId::Lua, store.load(PlanetId::Lua, seed).as_ref(), seed, 3);
    let mut t = Run { r, models, egui, c, meter: hud::Meter::default(), stats: Default::default(), game, store, dir: dir.into(), results: Vec::new(), failed: 0, ui_t: 0.0, pending: Default::default() };
    t.game.meteors.auto_spawn = false;

    // ---- começo ----
    t.steps(30);
    t.check("jogo novo começa na primeira missão", t.mission() == "regolith", t.mission());
    t.check("jogo novo traz a placa de circuito", t.game.inv.count(ItemId::of("circuit")) == 1, "");
    t.check("o mapa em volta do pouso já foi descoberto", t.game.exploration.revealed > 0, format!("{} ladrilhos", t.game.exploration.revealed));

    // ---- minerar um bloco do chão à frente, com a mira ----
    let p = t.game.player.pos;
    let (bx, bz) = (p[0].floor() as i32 + 2, p[2].floor() as i32);
    let by = t.game.world.top_y(bx, bz);
    let id = t.game.world.get_block(bx, by, bz);
    let broke = t.hold_on([bx as f64 + 0.5, by as f64 + 0.95, bz as f64 + 0.5], 20.0, |g| g.world.peek_block(bx, by, bz) == 0);
    t.check("bloco minerado", broke, format!("bloco {id} em {bx},{by},{bz}"));
    let got = t.wait(10.0, |g| g.inv.totals().total() > 1);
    t.check("item chegou ao inventário", got, fmt(&t.game.inv.totals()));
    t.shot("r1-minerado");

    // ---- missões: coletar ----
    let before = t.game.missions.serialize().count;
    t.collect(&[("regolith", 8)]);
    t.check("coletar regolito conta para a missão", t.game.missions.waiting() || t.game.missions.serialize().count > before, "");
    t.wait(3.0, |g| g.missions.current().id == "ice" && !g.missions.waiting());
    t.check("primeira missão concluída, segunda começou", t.mission() == "ice", t.mission());
    t.collect(&[("ice", 3)]);
    t.wait(3.0, |g| g.missions.current().id == "iron" && !g.missions.waiting());
    t.collect(&[("iron", 4)]);
    t.wait(3.0, |g| g.missions.current().id == "meteor" && !g.missions.waiting());
    t.check("terceira missão concluída, a do meteorito começou", t.mission() == "meteor", t.mission());

    // ---- o meteorito da missão cai de verdade ----
    let fell = t.wait(20.0, |g| g.world.find_prop("meteorite").is_some());
    let m = t.game.world.find_prop("meteorite");
    t.check("a missão soltou um meteoro com meteorito", fell, format!("{m:?}"));
    t.steps(20);
    t.shot("r2-meteorito-marcador");
    if let Some(m) = m {
        t.teleport(m[0] - 2.2, m[2]);
        let reached = t.wait(3.0, |g| g.missions.current().id == "sample");
        t.check("chegar perto do meteorito cumpre a missão", reached, t.mission());
        t.wait(3.0, |g| !g.missions.waiting());
        t.steps(10);
        let mined = t.hold_on([m[0], m[1] + 0.45, m[2]], 25.0, |g| g.world.find_prop("meteorite").is_none());
        t.check("meteorito minerado", mined, "");
        let next = t.wait(3.0, |g| g.missions.current().id == "repair");
        t.check("minerar o meteorito cumpre a missão", next, t.mission());
    }
    // ---- entregar no módulo ----
    t.wait(3.0, |g| !g.missions.waiting());
    t.collect(&[("rock", 6), ("iron", 4), ("crystal", 3)]);
    let need: Vec<(ItemId, u32)> = [("rock", 6), ("iron", 4), ("crystal", 3)].iter().map(|&(k, n)| (ItemId::of(k), n)).collect();
    let had: Vec<u32> = need.iter().map(|&(i, _)| t.game.inv.count(i)).collect();
    t.teleport(LANDER.0 + 0.5 + 2.5, LANDER.1 + 0.5);
    let delivered = t.wait(4.0, |g| g.missions.current().id == "done");
    t.check("entregar no módulo cumpre a última missão", delivered, t.mission());
    let took = need.iter().zip(&had).all(|(&(i, n), &h)| t.game.inv.count(i) == h - n);
    t.check("a entrega tirou o material da mochila", took, fmt(&t.game.inv.totals()));
    t.steps(20);
    t.shot("r3-missao-cumprida");

    // ---- salvar e o menu ----
    let saved = t.game.can_save() && t.store.write(PlanetId::Lua, &t.game.to_save());
    let file = t.store.path(PlanetId::Lua).and_then(|p| std::fs::read_to_string(p).ok());
    let back = file.as_deref().and_then(|s| spacing_core::save::parse(s, 1.0));
    t.check("salvou no arquivo, versão 12", saved && back.as_ref().is_some_and(|s| s.version == 12), t.store.path(PlanetId::Lua).map(|p| p.display().to_string()).unwrap_or_default());
    t.check("missão e inventário no salvamento", back.as_ref().is_some_and(|s| s.missions.step == 6 && s.inventory.slots.iter().any(|x| x.is_some())), "");
    t.game.screen_open = Some(Screen::Menu);
    t.c.modal = true;
    t.shot("r4-menu");
    t.game.screen_open = None;
    t.c.modal = false;

    // ---- mapa do tablet ----
    t.game.toggle_map();
    t.check("sem o Mapa equipado o tablet não abre", t.game.screen_open.is_none(), "");
    t.game.equip.equip(EquipId::of("map"), &mut Events::new());
    t.game.toggle_map();
    t.check("com o Mapa equipado o tablet abre", t.game.screen_open == Some(Screen::Map), "");
    t.c.modal = true;
    t.steps(30);
    t.shot("r5-mapa");
    t.game.screen_open = None;
    t.c.modal = false;

    // ---- sobrevivência: recarregar, morrer sem oxigênio, itens no chão, renascer, recolher ----
    t.teleport(LANDER.0 + 0.5 + 1.0, LANDER.1 + 0.5);
    t.steps(5);
    let before = t.game.inv.totals();
    t.game.survival.o2 = 40.0;
    let refilled = t.wait(30.0, |g| g.survival.o2 > 60.0);
    t.check("perto do módulo o oxigênio recarrega", refilled, format!("O₂ {:.0}", t.game.survival.o2));
    let (x, z) = (t.game.player.pos[0] + 12.0, t.game.player.pos[2]);
    t.teleport(x, z);
    t.steps(30);
    t.game.survival.o2 = 0.0;
    t.game.survival.integrity = 3.0;
    let died = t.wait(30.0, |g| g.death.is_some());
    t.check("sem oxigênio, o astronauta morre", died, "");
    t.check("não salva morto", !t.game.can_save(), "");
    let loot = {
        let mut c = Counts::new();
        for p in &t.game.loot.pieces {
            c.add(p.item, p.amount);
        }
        c
    };
    t.check("inventário esvaziou na morte", t.game.inv.totals().is_empty(), fmt(&t.game.inv.totals()));
    t.check("itens caíram no chão", same(&loot, &before), format!("chão: {}", fmt(&loot)));
    t.steps(110);
    t.shot("r6-morte");
    t.c.tap(10.0, 10.0, false);
    t.steps(10);
    let g = &t.game;
    let dist = spacing_core::js::hypot(g.player.pos[0] - (LANDER.0 + 0.5), g.player.pos[2] - (LANDER.1 + 0.5));
    let (o2, hp) = (g.survival.o2, g.survival.integrity);
    t.check("renasce jogando", t.game.death.is_none(), "");
    t.check("traje cheio ao renascer", o2 == 100.0 && hp == 100.0, format!("O₂ {o2}, integridade {hp}"));
    t.check("renasce dentro da área pressurizada", dist < 4.5, format!("{dist:.1} blocos do módulo"));
    t.check("itens continuam no chão", !t.game.loot.pieces.is_empty(), "");
    let s = t.game.to_save();
    t.check("itens caídos estão no salvamento", !s.loot.is_empty(), format!("{} pilhas", s.loot.len()));
    t.shot("r7-renasceu");
    for _ in 0..60 {
        let Some(p) = t.game.loot.pieces.first().map(|p| p.pos) else { break };
        t.teleport(p[0], p[2]);
        t.steps(40);
    }
    t.check("passar por cima recolhe os itens", t.game.loot.pieces.is_empty(), format!("{} restam", t.game.loot.pieces.len()));
    let back_in = t.wait(10.0, |g| same(&g.inv.totals(), &before));
    t.check("inventário voltou ao que era", back_in, fmt(&t.game.inv.totals()));

    // ---- tela de itens (mochila): arrastar, toque duplo, metade, organizar ----
    t.c.actions.bag = true;
    t.ui(Vec::new(), 0.03);
    t.ui(Vec::new(), 0.03);
    t.check("o botão da mochila abre a tela de itens", t.game.screen_open == Some(Screen::Bag), format!("{:?}", t.game.screen_open));
    t.shot("r8-mochila");
    let first = (0..8).find(|&i| t.game.inv.slot(i).is_some()).unwrap_or(0);
    let what = t.game.inv.slot(first);
    let (a, b) = (t.slot_center(first), t.slot_center(20));
    t.drag(a, b);
    t.check("arrastar leva a pilha para a mochila", t.game.inv.slot(first).is_none() && t.game.inv.slot(20) == what, format!("{:?} → {:?}", what, t.game.inv.slot(20)));
    let c20 = t.slot_center(20);
    t.touch(c20, true);
    t.touch(c20, false);
    t.ui(Vec::new(), 0.05);
    t.touch(c20, true);
    t.touch(c20, false);
    let back = (0..8).any(|i| t.game.inv.slot(i) == what);
    t.check("toque duplo manda de volta para a barra", t.game.inv.slot(20).is_none() && back, "");
    // metade: segura parado e arrasta para um espaço vazio
    let big = (0..32).find(|&i| t.game.inv.slot(i).is_some_and(|s| s.n >= 4));
    if let Some(i) = big {
        let n = t.game.inv.slot(i).unwrap().n;
        let empty = (8..32).find(|&k| t.game.inv.slot(k).is_none()).unwrap();
        let (a, b) = (t.slot_center(i), t.slot_center(empty));
        t.ui(vec![egui::Event::PointerMoved(a)], 0.03);
        t.touch(a, true);
        for _ in 0..20 {
            t.ui(Vec::new(), 0.03);
        }
        for k in 1..=4 {
            t.ui(vec![egui::Event::PointerMoved(a + (b - a) * (k as f32 / 4.0))], 0.03);
        }
        t.touch(b, false);
        let (x, y) = (t.game.inv.slot(i).map_or(0, |s| s.n), t.game.inv.slot(empty).map_or(0, |s| s.n));
        t.check("segurar pega metade", y == n.div_ceil(2) && x + y == n, format!("{n} → {x} + {y}"));
    }
    t.game.ui_action(hud::UiAction::Sort);
    let bag: Vec<bool> = (8..32).map(|k| t.game.inv.slot(k).is_some()).collect();
    t.check("organizar junta a mochila no começo", bag.windows(2).all(|w| w[0] || !w[1]), "");
    t.shot("r9-mochila-mexida");
    t.ui(vec![], 0.03);
    t.game.screen_open = None;
    // ---- estação: soltar um item na entrada escolhe a receita; fabricar ----
    {
        use spacing_core::rules::{RecipeId, StationId};
        let mut ev = Events::new();
        t.game.inv.add(ItemId::of("iron"), 12, false, &mut ev);
        t.game.inv.add(ItemId::of("regolith"), 20, false, &mut ev);
        t.game.crafting.unlock(StationId::of("furnace"));
        t.game.screen_open = Some(Screen::Station(StationId::of("furnace")));
        t.ui(Vec::new(), 0.03);
        t.ui(Vec::new(), 0.03);
        let iron = (0..32).find(|&k| t.game.inv.slot(k).is_some_and(|s| s.item == ItemId::of("iron"))).unwrap();
        let (w, h) = t.r.size();
        let input = crate::items_screen::input_rect(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(w as f32, h as f32))).center();
        let before = t.game.inv.count(ItemId::of("iron"));
        t.drag(t.slot_center(iron), input);
        t.check("soltar na entrada não tira nada da mochila", t.game.inv.count(ItemId::of("iron")) == before, "");
        t.game.ui_action(hud::UiAction::Start(RecipeId::of("iron_bar"), 3));
        t.steps(90);
        t.ui(Vec::new(), 0.5);
        t.check("a estação trabalha", t.game.crafting.working(StationId::of("furnace")), "");
        t.shot("r10-forno");
        t.game.screen_open = None;
        t.c.modal = false;
    }

    // ---- carregar de novo ----
    t.steps(30);
    let a = t.game.to_save();
    t.store.write(PlanetId::Lua, &a);
    let loaded = t.store.load(PlanetId::Lua, 1);
    t.check("o salvamento lê de volta", loaded.is_some(), "");
    if let Some(s) = loaded {
        let g2 = Game::load(PlanetId::Lua, Some(&s), 1, 3);
        let b = g2.to_save();
        t.check("carregar volta na mesma missão", b.missions == a.missions, format!("{:?}", b.missions));
        t.check("carregar volta com o mesmo inventário", b.inventory == a.inventory, "");
        t.check("carregar volta com o mesmo mapa descoberto", b.explored == a.explored, format!("{} chunks", b.explored.len()));
        t.check("carregar volta com o Mapa equipado", b.equipment == a.equipment, "");
        let (pa, pb) = (a.player.unwrap(), b.player.unwrap());
        t.check("carregar volta no mesmo lugar", (pa.x - pb.x).abs() < 1e-6 && (pa.z - pb.z).abs() < 1e-6, "");
        t.check("carregar volta com a mesma semente", b.seed == a.seed, format!("{}", b.seed));
    }

    // ---- um salvamento antigo do jogo web (v5, de antes do mapa e das estações) ----
    let old = serde_json::json!({
        "version": 5, "seed": 321, "savedAt": 1700000000000.0,
        "world": { "edits": { "0,0": [[5, 3]] }, "removedProps": [] },
        "inventory": { "slots": [{ "item": "iron", "n": 3 }, null, { "item": "ice", "n": 2 }], "selected": 0 },
        "player": { "x": 1.5, "y": 40, "z": 2.5 },
        "missions": { "step": 2, "count": 1 },
        "suit": { "suit": "emergency", "o2": 50, "battery": 80, "integrity": 90 },
        "loot": [], "equipment": {}, "base": { "inside": false, "respawn": "base", "visited": true }
    });
    match spacing_core::save::migrate(&old, 999.0) {
        Some(s) => {
            // o gerador do mundo mudou desde a v5: o mundo é refeito, o progresso fica (o app faz o mesmo ao abrir)
            let renew = s.world_gen != world_gen(PlanetId::Lua);
            let s = if renew { spacing_core::save::renew_world(&s, 777.0, world_gen(PlanetId::Lua)) } else { s };
            let g = Game::load(PlanetId::Lua, Some(&s), 1, 3);
            t.check("salvamento v5 do jogo web abre", true, "");
            t.check("v5: o mundo de um gerador antigo é refeito", renew && g.seed == 777, format!("semente {}", g.seed));
            t.check("v5: a missão continua", g.missions.current().id == "iron", g.missions.current().id.clone());
            t.check("v5: o inventário continua, com a placa de circuito nova", g.inv.count(ItemId::of("iron")) == 3 && g.inv.count(ItemId::of("ice")) == 2 && g.inv.count(ItemId::of("circuit")) == 1, fmt(&g.inv.totals()));
            t.check("v5: o traje e o renascer na base continuam", g.survival.o2 == 50.0 && g.base.respawn_base, format!("O₂ {}", g.survival.o2));
        }
        None => t.check("salvamento v5 do jogo web abre", false, "migrate recusou"),
    }

    println!("\n{} etapas, {} falharam", t.results.len(), t.failed);
    if t.failed > 0 {
        std::process::exit(1);
    }
}
