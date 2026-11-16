//! Os sons do jogo: traduz o que acontece (eventos das regras, passos, meteoros, clima, sobrevivência) em pedidos ao
//! `Sfx`. É o mesmo mapa do jogo web (`Game.wireEvents`, `SurvivalDirector`, `MeteorDirector`, `MarsDirector`,
//! `BaseDirector`), todo num lugar só para o `game.rs` não se encher de chamadas. Ver docs/design/AUDIO_NATIVO.md.
use std::collections::HashMap;

use spacing_audio::{Sfx, Sound, Vec3, Voice};
use spacing_core::mars_life::WeatherPhase;
use spacing_core::meteors::{Impact, Meteor};
use spacing_core::rules::events::{GameEvent, Meter};

/// as coletas em sequência (até 0,7 s entre uma e outra) sobem de tom
const COMBO_S: f64 = 0.7;
/// a mochila cheia só avisa de 2,5 em 2,5 s
const CHEIA_S: f64 = 2.5;

fn v(p: [f64; 3]) -> Vec3 {
    Vec3::de(p)
}

/// o centro de um bloco
fn centro(p: [i32; 3]) -> Vec3 {
    Vec3::new(p[0] as f32 + 0.5, p[1] as f32 + 0.5, p[2] as f32 + 0.5)
}

/// O que o jogo sabe do traje a cada quadro (para a respiração, o batimento e a carga).
pub struct Traje {
    pub o2: f64,
    pub battery: f64,
    pub integrity: f64,
    pub em_pressao: bool,
    /// o oxigênio em que a respiração começa a acelerar (`o2_warn[1]`, de 0 a 1)
    pub o2_critico: f64,
}

pub struct Sons {
    pub sfx: Sfx,
    pop_n: u32,
    pop_t: f64,
    cheia_t: f64,
    respira: f64,
    batida: f64,
    carga: f64,
    chia: f64,
    /// a voz de cada meteoro em voo (acompanha a cabeça dele)
    voos: HashMap<u32, Voice>,
    zumbido: Option<Voice>,
    laser: Option<Voice>,
    ui_aberta: bool,
    mapa_aberto: bool,
    tinha_loot: bool,
    fase: Option<WeatherPhase>,
}

impl Default for Sons {
    fn default() -> Self {
        Self::novo(Sfx::silent())
    }
}

impl Sons {
    pub fn novo(sfx: Sfx) -> Self {
        Self {
            sfx,
            pop_n: 0,
            pop_t: -10.0,
            cheia_t: -10.0,
            respira: 0.0,
            batida: 0.0,
            carga: 0.0,
            chia: 0.0,
            voos: HashMap::new(),
            zumbido: None,
            laser: None,
            ui_aberta: false,
            mapa_aberto: false,
            tinha_loot: false,
            fase: None,
        }
    }

    /// Liga o jogo ao som: limpa o que sobrou do jogo anterior, diz se o planeta tem ar e começa o zumbido do módulo.
    pub fn liga(&mut self, sfx: Sfx, ar: bool, modulo: [f64; 3]) {
        self.sfx.stop_all();
        self.sfx = sfx;
        self.sfx.stop_all();
        self.sfx.set_world(true);
        self.sfx.set_air(ar);
        self.sfx.set_muffled(0.0);
        self.sfx.set_wind(0.0);
        self.sfx.set_indoors(false);
        self.voos.clear();
        self.laser = None;
        self.zumbido = self.sfx.hum(v(modulo));
    }

    /// onde está o astronauta e para onde a câmera olha; a cada quadro
    pub fn ouvinte(&self, astronauta: [f64; 3], frente: [f64; 3]) {
        self.sfx.set_listener(astronauta, (frente[0], frente[2]));
    }

    pub fn tocar(&self, som: Sound, ponto: Option<[f64; 3]>) {
        self.sfx.play(som, 1.0, ponto.map(v));
    }

    pub fn do_capacete(&self, som: Sound) {
        self.sfx.play(som, 1.0, None);
    }

    // ---------- passos, pulo, pouso ----------

    pub fn passo(&self, p: [f64; 3]) {
        self.tocar(Sound::Step, Some(p));
    }

    pub fn pouso(&self, p: [f64; 3]) {
        self.tocar(Sound::Land, Some(p));
    }

    pub fn pulo(&self, p: [f64; 3]) {
        self.tocar(Sound::Jump, Some(p));
    }

    /// destrocos que batem no chão e pedaços chutados (`debris:clink`, `debris:kick`)
    pub fn destrocos(&self, clinks: &[(bool, [f64; 3])]) {
        for &(chute, p) in clinks {
            self.tocar(if chute { Sound::Kick } else { Sound::Clink }, Some(p));
        }
    }

    // ---------- fatos das regras ----------

    /// Os sons dos eventos de um passo do jogo. `jogando` = vivo e no jogo (os avisos do traje só tocam assim).
    pub fn eventos(&mut self, ev: &[GameEvent], tempo: f64, jogando: bool) {
        for e in ev {
            match e {
                GameEvent::MineHit { pos, .. } => self.tocar(Sound::Hit, Some(*pos)),
                GameEvent::BlockBroken { pos, .. } => {
                    self.sfx.play(Sound::Break, 1.0, Some(centro(*pos)));
                }
                GameEvent::PropBroken { pos, .. } => self.tocar(Sound::Break, Some(*pos)),
                GameEvent::BlockPlaced { pos, .. } => {
                    self.sfx.play(Sound::Place, 1.0, Some(centro(*pos)));
                }
                GameEvent::PropPlaced { kind, .. } if *kind == "solarPanel" => self.do_capacete(Sound::Equip),
                GameEvent::ActionDenied { .. } | GameEvent::DrillWeak { .. } => self.do_capacete(Sound::Deny),
                GameEvent::ItemCollected { .. } => {
                    self.pop_n = if tempo - self.pop_t < COMBO_S { (self.pop_n + 1).min(10) } else { 0 };
                    self.pop_t = tempo;
                    self.sfx.play(Sound::Pop, 1.0 + self.pop_n as f32 * 0.06, None);
                }
                GameEvent::InventoryFull { .. } => {
                    if tempo - self.cheia_t >= CHEIA_S {
                        self.cheia_t = tempo;
                        self.do_capacete(Sound::Deny);
                    }
                }
                GameEvent::InventorySelected { .. } | GameEvent::BuildMode { .. } => self.do_capacete(Sound::Ui),
                GameEvent::MissionCompleted { .. } => self.do_capacete(Sound::Chime),
                GameEvent::SuitWarning { meter, level } if jogando => match (meter, level) {
                    (Meter::O2, 1) => self.do_capacete(Sound::Beep),
                    (Meter::O2, 2) => self.do_capacete(Sound::Alarm),
                    (Meter::Energy, 2) => self.do_capacete(Sound::Alarm),
                    (Meter::Energy, 1) => self.do_capacete(Sound::Beep),
                    (Meter::Battery, 1) => self.do_capacete(Sound::PowerDown),
                    _ => {}
                },
                GameEvent::SuitAsphyxia { on: true } if jogando => self.do_capacete(Sound::Alarm),
                GameEvent::SuitRecharge { on: true } if jogando => self.carga = 0.0,
                GameEvent::PlayerDamaged { .. } => self.do_capacete(Sound::Hurt),
                _ => {}
            }
        }
    }

    // ---------- sobrevivência (SurvivalDirector) ----------

    pub fn morreu(&self) {
        self.do_capacete(Sound::Death);
        self.sfx.set_muffled(0.85);
    }

    pub fn renasceu(&self) {
        self.sfx.set_muffled(0.0);
        self.do_capacete(Sound::Respawn);
    }

    /// o cilindro de O₂ de reserva conectou
    pub fn reserva_de_o2(&self) {
        self.sfx.play(Sound::Pressurize, 1.3, None);
    }

    /// Respiração que acelera, batimento do coração e o som de carga no módulo; abafa quando falta ar.
    pub fn ciclos(&mut self, dt: f64, jogando: bool, t: &Traje, loot_vazio: bool) {
        if jogando {
            if t.o2 / 100.0 <= t.o2_critico && t.o2 > 0.0 {
                self.respira -= dt;
                if self.respira <= 0.0 {
                    // a respiração acelera conforme o ar acaba
                    self.respira = 0.5 + (t.o2 / 100.0) * 4.0;
                    self.do_capacete(Sound::Breath);
                }
            }
            if t.o2 <= 0.0 {
                self.batida -= dt;
                if self.batida <= 0.0 {
                    // o coração dispara perto do fim
                    self.batida = 0.45 + (t.integrity / 100.0) * 0.5;
                    self.do_capacete(Sound::Heartbeat);
                }
            }
            if t.em_pressao && t.o2.min(t.battery).min(t.integrity) < 99.5 {
                self.carga -= dt;
                if self.carga <= 0.0 {
                    self.carga = 0.32;
                    let pitch = 0.8 + ((t.o2 + t.battery + t.integrity) / 300.0) as f32 * 0.8;
                    self.sfx.play(Sound::Charge, pitch, None);
                }
            }
            self.sfx.set_muffled(if t.o2 <= 0.0 { (0.4 + (1.0 - t.integrity / 100.0) * 0.4) as f32 } else { 0.0 });
            // itens caídos: avisa quando recolheu tudo
            if self.tinha_loot && loot_vazio {
                self.do_capacete(Sound::PickupBig);
            }
        }
        self.tinha_loot = !loot_vazio;
    }

    /// O laser da bancada zumbe enquanto ela imprime (e só então).
    pub fn laser(&mut self, trabalhando: bool, onde: [f64; 3]) {
        match (trabalhando, self.laser) {
            (true, None) => self.laser = self.sfx.laser(v(onde)),
            (false, Some(voz)) => {
                self.sfx.stop(voz);
                self.laser = None;
            }
            _ => {}
        }
    }

    /// o chiado da lava no traje, de 0,35 em 0,35 s
    pub fn queimando(&mut self, dt: f64, queimando: bool) {
        self.chia -= dt;
        if queimando && self.chia <= 0.0 {
            self.chia = 0.35;
            self.do_capacete(Sound::Sizzle);
        }
    }

    // ---------- meteoros (MeteorDirector) ----------

    /// A voz de cada meteoro em voo acompanha a cabeça dele; cada impacto estronda no ponto de queda.
    pub fn meteoros(&mut self, ativos: &[Meteor], impactos: &[Impact]) {
        for m in ativos {
            match self.voos.get(&m.id) {
                Some(voz) => self.sfx.move_voice(*voz, v(m.head)),
                None => {
                    if let Some(voz) = self.sfx.play(Sound::Whoosh, 1.0, Some(v(m.head))) {
                        self.voos.insert(m.id, voz);
                    }
                }
            }
        }
        let vivos: Vec<u32> = ativos.iter().map(|m| m.id).collect();
        self.voos.retain(|id, _| vivos.contains(id));
        for i in impactos {
            // um tremor grave que chega pelo casco, se estiver dentro da base, é só mais abafado: o mixer já faz
            self.sfx.play(Sound::Boom, 1.0, Some(v(i.pos)));
        }
    }

    // ---------- Marte (MarsDirector) ----------

    /// O vento acompanha a tempestade (dentro da base some); a rajada marca a chegada e o redemoinho; o ronco, a erupção.
    pub fn marte(&mut self, fase: WeatherPhase, nivel: f64, dentro: bool, jogando: bool, redemoinho: bool, erupcao: bool) {
        self.sfx.set_wind(if dentro { 0.0 } else { nivel as f32 });
        let mudou = self.fase.is_some_and(|f| f != fase);
        self.fase = Some(fase);
        if jogando && !dentro && ((mudou && fase == WeatherPhase::Coming) || redemoinho) {
            self.do_capacete(Sound::Gust);
        }
        if jogando && erupcao {
            self.do_capacete(Sound::Rumble);
        }
    }

    // ---------- telas ----------

    /// Abrir ou fechar uma tela por cima do jogo: o tablet liga e desliga com seus sons; as outras, um clique.
    pub fn telas(&mut self, aberta: bool, mapa: bool) {
        if mapa != self.mapa_aberto {
            self.do_capacete(if mapa { Sound::TabletOpen } else { Sound::TabletClose });
        } else if aberta != self.ui_aberta {
            self.do_capacete(Sound::Ui);
        }
        self.mapa_aberto = mapa;
        self.ui_aberta = aberta;
    }
}

impl Drop for Sons {
    /// o jogo acabou (voltou ao título, trocou de planeta): nada do mundo continua tocando
    fn drop(&mut self) {
        self.sfx.stop_all();
        self.sfx.set_world(false);
        self.sfx.set_muffled(0.0);
        self.sfx.set_wind(0.0);
        self.sfx.set_indoors(false);
        let _ = self.zumbido.take();
    }
}

// ---------- `spacing --som <pasta>` ----------

/// Grava um `.wav` de cada som (do capacete, sozinho) e de algumas cenas (sons do mundo à direita e à esquerda, o módulo,
/// a base, Marte, um meteoro passando), e imprime o volume de cada um. É o jeito de ouvir o som no computador e de
/// medir sem placa de som. Só no computador.
#[cfg(not(target_os = "android"))]
pub fn gravar(dir: &str) {
    use spacing_audio::{duration, recipe, Renderer, Rng};
    const SR: f32 = 48_000.0;
    let _ = std::fs::create_dir_all(dir);

    fn toca(r: &mut Renderer, seg: f32, out: &mut Vec<f32>) {
        let n = (SR * seg) as usize;
        let mut buf = vec![0.0f32; n * 2];
        r.render(&mut buf);
        out.extend(buf);
    }

    fn wav(path: &str, amostras: &[f32]) {
        let n = amostras.len() as u32;
        let mut b = Vec::with_capacity(44 + amostras.len() * 2);
        b.extend(b"RIFF");
        b.extend((36 + n * 2).to_le_bytes());
        b.extend(b"WAVEfmt ");
        b.extend(16u32.to_le_bytes());
        b.extend(1u16.to_le_bytes()); // PCM
        b.extend(2u16.to_le_bytes()); // estéreo
        b.extend((SR as u32).to_le_bytes());
        b.extend((SR as u32 * 4).to_le_bytes());
        b.extend(4u16.to_le_bytes());
        b.extend(16u16.to_le_bytes());
        b.extend(b"data");
        b.extend((n * 2).to_le_bytes());
        for s in amostras {
            b.extend(((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
        if let Err(e) = std::fs::write(path, b) {
            eprintln!("não gravou {path}: {e}");
        }
    }

    fn db(x: f32) -> f32 {
        20.0 * x.max(1e-6).log10()
    }

    fn relatorio(nome: &str, a: &[f32]) {
        let pico = a.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        let (mut l, mut r) = (0.0f32, 0.0f32);
        for q in a.chunks_exact(2) {
            l += q[0] * q[0];
            r += q[1] * q[1];
        }
        let n = (a.len() / 2).max(1) as f32;
        println!("{nome:<18} pico {:>6.1} dBFS   L {:>6.1}   R {:>6.1}   {:>4.1} s", db(pico), db((l / n).sqrt()), db((r / n).sqrt()), n / SR);
    }

    println!("som                volume (0 dBFS = o máximo possível)");
    // 1) cada som do capacete, sozinho
    let mut rng = Rng::new(7);
    for s in Sound::TODOS {
        let (sfx, mut r) = Sfx::offline(SR);
        sfx.set_listener([0.0; 3], (0.0, -1.0));
        let dur = duration(&recipe(s, 1.0, &mut rng)) + 0.4;
        sfx.play(s, 1.0, None);
        let mut a = Vec::new();
        toca(&mut r, dur, &mut a);
        wav(&format!("{dir}/{}.wav", s.nome()), &a);
        relatorio(s.nome(), &a);
    }

    // 2) cenas
    let cena = |nome: &str, f: &dyn Fn(&Sfx, &mut Renderer, &mut Vec<f32>)| {
        let (sfx, mut r) = Sfx::offline(SR);
        sfx.set_listener([0.0; 3], (0.0, -1.0));
        sfx.set_world(true);
        let mut a = Vec::new();
        f(&sfx, &mut r, &mut a);
        wav(&format!("{dir}/cena-{nome}.wav"), &a);
        relatorio(&format!("cena-{nome}"), &a);
    };
    let p = |x: f32, z: f32| Vec3::new(x, 0.0, z);
    cena("direita-esquerda", &|s, r, a| {
        toca(r, 1.0, a);
        for (som, x) in [(Sound::Step, 4.0), (Sound::Step, -4.0), (Sound::Break, 10.0), (Sound::Break, -10.0), (Sound::Break, 24.0), (Sound::Break, -24.0)] {
            s.play(som, 1.0, Some(p(x, 0.0)));
            toca(r, 1.0, a);
        }
        for x in [40.0, -40.0, 100.0] {
            s.play(Sound::Boom, 1.0, Some(p(x, 0.0)));
            toca(r, 3.2, a);
        }
    });
    cena("modulo", &|s, r, a| {
        let v = s.hum(p(3.0, 0.0));
        toca(r, 2.0, a);
        if v.is_some() {
            // o astronauta se afasta do módulo (ele vai ficando para trás)
            for k in 0..20 {
                s.set_listener([-(k as f64) * 1.5, 0.0, 0.0], (0.0, -1.0));
                toca(r, 0.25, a);
            }
        }
    });
    cena("base", &|s, r, a| {
        toca(r, 2.0, a);
        s.set_indoors(true);
        toca(r, 3.0, a);
        s.play_after(Sound::Door, 1.0, Some(p(2.0, 0.0)), 0.0);
        toca(r, 1.0, a);
        s.play_after(Sound::Pressurize, 1.0, None, 0.3);
        toca(r, 2.2, a);
        s.set_indoors(false);
        toca(r, 2.0, a);
    });
    cena("marte", &|s, r, a| {
        s.set_air(true);
        for k in 0..=6 {
            s.set_wind(k as f32 / 6.0);
            toca(r, 1.0, a);
        }
        s.play(Sound::Gust, 1.0, None);
        toca(r, 2.0, a);
        s.play(Sound::Rumble, 1.0, None);
        toca(r, 3.2, a);
    });
    cena("meteoro", &|s, r, a| {
        toca(r, 0.5, a);
        let v = s.play(Sound::Whoosh, 1.0, Some(p(-60.0, 0.0)));
        for k in 0..28 {
            if let Some(v) = v {
                s.move_voice(v, p(-60.0 + k as f32 * 3.0, -40.0 + k as f32 * 1.4));
            }
            toca(r, 0.06, a);
        }
        s.play(Sound::Boom, 1.0, Some(p(25.0, 0.0)));
        toca(r, 3.5, a);
    });
    cena("traje", &|s, r, a| {
        toca(r, 0.5, a);
        for _ in 0..4 {
            s.play(Sound::Breath, 1.0, None);
            toca(r, 0.9, a);
        }
        s.set_muffled(0.8);
        for _ in 0..3 {
            s.play(Sound::Heartbeat, 1.0, None);
            toca(r, 0.7, a);
        }
        s.play(Sound::Death, 1.0, None);
        toca(r, 1.8, a);
        s.set_muffled(0.0);
        s.play(Sound::Respawn, 1.0, None);
        toca(r, 1.6, a);
    });
    println!("\nWAVs em {dir}");
}

#[cfg(test)]
mod testes {
    use super::*;
    use spacing_audio::Sound as S;

    fn sons() -> (Sons, Sfx) {
        let sfx = Sfx::recording();
        sfx.set_listener([0.0; 3], (0.0, -1.0));
        let mut s = Sons::default();
        s.sfx = sfx.clone();
        (s, sfx)
    }

    fn nomes(sfx: &Sfx) -> Vec<S> {
        sfx.take_log().into_iter().map(|p| p.som).collect()
    }

    #[test]
    fn coletas_em_sequencia_sobem_de_tom_e_depois_voltam() {
        let (mut s, sfx) = sons();
        let ev = [GameEvent::ItemCollected { item: spacing_core::rules::ItemId::of("o2"), amount: 1 }];
        for k in 0..4 {
            s.eventos(&ev, k as f64 * 0.2, true);
        }
        s.eventos(&ev, 10.0, true);
        let p: Vec<f32> = sfx.take_log().iter().map(|p| p.pitch).collect();
        assert_eq!(p.len(), 5);
        assert!(p[0] < p[1] && p[1] < p[2] && p[2] < p[3], "{p:?}");
        assert!((p[4] - 1.0).abs() < 1e-6, "depois de um tempo, volta ao tom normal");
    }

    #[test]
    fn mochila_cheia_avisa_de_vez_em_quando() {
        let (mut s, sfx) = sons();
        let ev = [GameEvent::InventoryFull { item: spacing_core::rules::ItemId::of("o2"), amount: 1 }];
        s.eventos(&ev, 1.0, true);
        s.eventos(&ev, 2.0, true);
        s.eventos(&ev, 4.0, true);
        assert_eq!(nomes(&sfx), vec![S::Deny, S::Deny]);
    }

    #[test]
    fn avisos_do_traje_so_com_o_jogo_rodando() {
        let (mut s, sfx) = sons();
        let ev = [
            GameEvent::SuitWarning { meter: Meter::O2, level: 1 },
            GameEvent::SuitWarning { meter: Meter::O2, level: 2 },
            GameEvent::SuitWarning { meter: Meter::Battery, level: 1 },
            GameEvent::SuitWarning { meter: Meter::Energy, level: 2 },
        ];
        s.eventos(&ev, 0.0, true);
        assert_eq!(nomes(&sfx), vec![S::Beep, S::Alarm, S::PowerDown, S::Alarm]);
        s.eventos(&ev, 0.0, false);
        assert!(nomes(&sfx).is_empty(), "morto: sem aviso");
    }

    #[test]
    fn golpe_bloco_e_peca_saem_do_ponto_certo() {
        let (mut s, sfx) = sons();
        s.eventos(&[GameEvent::BlockBroken { pos: [3, 4, 5], id: 1 }, GameEvent::BlockPlaced { pos: [-1, 0, 2], id: 1 }], 0.0, true);
        let l = sfx.take_log();
        assert_eq!((l[0].som, l[1].som), (S::Break, S::Place));
        assert_eq!(l[0].at, Some(Vec3::new(3.5, 4.5, 5.5)), "o centro do bloco");
        assert_eq!(l[1].at, Some(Vec3::new(-0.5, 0.5, 2.5)));
    }

    #[test]
    fn respiracao_acelera_e_o_coracao_so_sem_ar() {
        let (mut s, sfx) = sons();
        let mut traje = Traje { o2: 20.0, battery: 100.0, integrity: 100.0, em_pressao: false, o2_critico: 0.25 };
        let mut n = 0;
        for _ in 0..600 {
            s.ciclos(0.05, true, &traje, true);
            n += nomes(&sfx).iter().filter(|x| **x == S::Breath).count();
        }
        let respiracoes_a_20 = n;
        traje.o2 = 5.0;
        let mut n = 0;
        for _ in 0..600 {
            s.ciclos(0.05, true, &traje, true);
            n += nomes(&sfx).iter().filter(|x| **x == S::Breath).count();
        }
        assert!(n > respiracoes_a_20, "com menos ar respira mais rápido: {n} vs {respiracoes_a_20}");
        traje.o2 = 0.0;
        s.ciclos(0.05, true, &traje, true);
        assert!(nomes(&sfx).contains(&S::Heartbeat));
        traje = Traje { o2: 90.0, battery: 100.0, integrity: 100.0, em_pressao: false, o2_critico: 0.25 };
        s.ciclos(5.0, true, &traje, true);
        assert!(!nomes(&sfx).contains(&S::Breath), "com ar de sobra, nada de respiração");
    }

    #[test]
    fn carga_no_modulo_toca_enquanto_o_traje_nao_esta_cheio() {
        let (mut s, sfx) = sons();
        let mut t = Traje { o2: 50.0, battery: 100.0, integrity: 100.0, em_pressao: true, o2_critico: 0.25 };
        s.ciclos(0.1, true, &t, true);
        assert_eq!(nomes(&sfx), vec![S::Charge]);
        t.o2 = 100.0;
        s.ciclos(1.0, true, &t, true);
        assert!(nomes(&sfx).is_empty(), "traje cheio: sem carga");
    }

    #[test]
    fn recolher_tudo_do_chao_toca_o_acorde_grande() {
        let (mut s, sfx) = sons();
        let t = Traje { o2: 100.0, battery: 100.0, integrity: 100.0, em_pressao: false, o2_critico: 0.25 };
        s.ciclos(0.1, true, &t, false); // há itens no chão
        s.ciclos(0.1, true, &t, true); // recolheu tudo
        assert_eq!(nomes(&sfx), vec![S::PickupBig]);
    }

    #[test]
    fn tablet_e_telas_fazem_barulhos_diferentes() {
        let (mut s, sfx) = sons();
        s.telas(true, true);
        s.telas(false, false);
        s.telas(true, false);
        s.telas(true, false);
        assert_eq!(nomes(&sfx), vec![S::TabletOpen, S::TabletClose, S::Ui]);
    }

    #[test]
    fn marte_gust_na_chegada_da_tempestade_e_ronco_na_erupcao() {
        let (mut s, sfx) = sons();
        s.marte(WeatherPhase::Calm, 0.0, false, true, false, false);
        s.marte(WeatherPhase::Coming, 0.3, false, true, false, false);
        s.marte(WeatherPhase::Coming, 0.4, false, true, false, false);
        s.marte(WeatherPhase::Storm, 1.0, false, true, true, true);
        assert_eq!(nomes(&sfx), vec![S::Gust, S::Gust, S::Rumble]);
        // dentro da base: nada de rajada
        s.marte(WeatherPhase::Calm, 0.0, true, true, true, false);
        s.marte(WeatherPhase::Coming, 0.3, true, true, false, false);
        assert!(nomes(&sfx).is_empty());
    }

    #[test]
    fn dano_morte_e_renascer() {
        let (s, sfx) = sons();
        s.morreu();
        s.renasceu();
        assert_eq!(nomes(&sfx), vec![S::Death, S::Respawn]);
    }
}
