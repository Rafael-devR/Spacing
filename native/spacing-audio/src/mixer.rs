//! A mesa de som: soma as vozes, põe cada som do mundo no seu lugar, aplica eco, abafamento e volume.
//! Não conhece placa de som nem o jogo: recebe `Comando`s e escreve blocos estéreo em `render`. É o equivalente ao grafo
//! de `AudioNode`s do `Sfx.ts` (docs/design/AUDIO_NATIVO.md).
use crate::dsp::{limita, Biquad, Eco, Filtro, Onda, Osc, Rng, Suave};
use crate::sounds::{Kind, Layer};
use crate::spatial::{distance_cutoff, distance_gain, equal_power, listener_position, pan, reverb_send, Perfil, Vec3};

/// volume geral (MASTER do TS)
pub const MASTER: f32 = 0.55;
/// volume do eco da cratera
pub const REVERB: f32 = 0.55;
/// fundo grave da cratera (lá fora) e ventilação da base (dentro)
const AMBIENT: f32 = 0.05;
const AMBIENT_FORA_DA_BASE: f32 = 0.008;
const INDOOR_AMBIENT: f32 = 0.035;
/// quantas amostras o mixer processa de uma vez (os parâmetros de distância e de filtro mudam a cada bloco)
const BLOCO: usize = 64;
const MAX_EMISSORES: usize = 32;
const MAX_VOZES_SOLTAS: usize = 64;

/// Um som que está tocando e que o jogo pode mover ou parar (o meteoro em queda, o zumbido do módulo).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Voice(pub u32);

/// O que o jogo pede ao mixer.
pub enum Comando {
    /// camadas prontas; com `at`, o som sai daquele ponto (com o perfil de distância), sem `at` é do capacete
    Play { id: u32, gens: Vec<Gen>, at: Option<(Vec3, Perfil)> },
    /// laço no ponto dado (zumbido do módulo, laser da bancada)
    Loop { id: u32, gen: Gen, at: Vec3, perfil: Perfil },
    Move { id: u32, at: Vec3 },
    Stop { id: u32 },
    /// para todos os laços e emissores (troca de jogo)
    StopAll,
    /// onde está o astronauta e para onde a câmera olha (horizontal, tamanho 1)
    Listener { player: Vec3, forward: (f32, f32) },
    Muted(bool),
    /// 0 = normal, 1 = quase só graves
    Muffled(f32),
    Paused(bool),
    Indoors(bool),
    /// Marte: 0 (brisa) a 1 (tempestade)
    Wind(f32),
    /// o planeta tem ar (Marte): liga o vento e o abafamento do ar ralo
    Air(bool),
    /// há um jogo rodando: liga os sons de fundo (no título e no carregamento só se ouvem os cliques)
    World(bool),
}

// ---------- geradores (uma "camada" tocando) ----------

#[derive(Clone, Debug)]
pub struct Tom {
    atraso: u32,
    osc: Osc,
    freq: f32,
    rf: f32,
    g: f32,
    ra: f32,
    rd: f32,
    n: u32,
    ataque: u32,
    dur: u32,
    total: u32,
    sr: f32,
}

#[derive(Clone, Debug)]
pub struct Ruido {
    atraso: u32,
    rng: Rng,
    filtro: Biquad,
    tipo: Filtro,
    q: f32,
    freq: f32,
    rf: f32,
    varre: bool,
    g: f32,
    rd: f32,
    n: u32,
    dur: u32,
    total: u32,
    sr: f32,
}

/// Zumbido do módulo de pouso: bombas (um "tum" lento), um grave elétrico e a ventilação (chiado leve).
#[derive(Clone, Debug)]
pub struct Zumbido {
    oscs: [(Osc, f32, f32); 3],
    bomba: Osc,
    lp: Biquad,
    rng: Rng,
    chiado: Biquad,
    sr: f32,
}

/// Laser da bancada: zumbido agudo que "chia" e estalos.
#[derive(Clone, Debug)]
pub struct Laser {
    tom: Osc,
    faixa: Biquad,
    lfo: Osc,
    rng: Rng,
    alta: Biquad,
    saida: Suave,
    sr: f32,
}

#[derive(Clone, Debug)]
pub enum Gen {
    Tom(Tom),
    Ruido(Ruido),
    Zumbido(Zumbido),
    Laser(Laser),
}

impl Gen {
    /// monta o gerador de uma camada da receita (`sr` = taxa da placa, `seed` para o ruído)
    pub fn de_camada(l: &Layer, sr: f32, seed: u32) -> Gen {
        let atraso = (l.delay * sr).round() as u32;
        match l.kind {
            Kind::Tone { f0, f1, dur, gain, wave } => {
                let n_dur = (dur * sr).max(1.0);
                let n_ataque = (0.01 * sr).max(1.0);
                let n_queda = (n_dur - n_ataque).max(1.0);
                Gen::Tom(Tom {
                    atraso,
                    osc: Osc::new(wave, 0.0),
                    freq: f0,
                    rf: (f1 / f0).powf(1.0 / n_dur),
                    g: 0.0001,
                    ra: (gain / 0.0001f32).powf(1.0 / n_ataque),
                    rd: (0.0001 / gain).powf(1.0 / n_queda),
                    n: 0,
                    ataque: n_ataque as u32,
                    dur: n_dur as u32,
                    total: ((dur + 0.02) * sr) as u32,
                    sr,
                })
            }
            Kind::Noise { dur, filter, freq, gain, q, sweep } => {
                let n_dur = (dur * sr).max(1.0);
                let alvo = (freq * sweep).max(40.0);
                Gen::Ruido(Ruido {
                    atraso,
                    rng: Rng::new(seed),
                    filtro: Biquad::new(filter, freq, q, sr),
                    tipo: filter,
                    q,
                    freq,
                    rf: (alvo / freq).powf(1.0 / n_dur),
                    varre: (alvo - freq).abs() > 1e-3,
                    g: gain,
                    rd: (0.001 / gain).powf(1.0 / n_dur),
                    n: 0,
                    dur: n_dur as u32,
                    total: ((dur + 0.05) * sr) as u32,
                    sr,
                })
            }
        }
    }

    /// o zumbido do módulo de pouso; `desafina` são três desvios em centésimos de tom (o TS sorteia ±5)
    pub fn zumbido(sr: f32, seed: u32, desafina: [f32; 3]) -> Gen {
        let c = |f: f32, cents: f32| f * 2f32.powf(cents / 1200.0);
        Gen::Zumbido(Zumbido {
            oscs: [
                (Osc::new(Onda::Serra, 0.0), c(58.0, desafina[0]), 0.5),
                (Osc::new(Onda::Seno, 0.0), c(116.5, desafina[1]), 0.35),
                (Osc::new(Onda::Triangulo, 0.0), c(174.0, desafina[2]), 0.12),
            ],
            bomba: Osc::new(Onda::Seno, 0.0),
            lp: Biquad::new(Filtro::PassaBaixa, 420.0, 1.0, sr),
            rng: Rng::new(seed),
            chiado: Biquad::new(Filtro::PassaFaixa, 1600.0, 0.8, sr),
            sr,
        })
    }

    pub fn laser(sr: f32, seed: u32) -> Gen {
        Gen::Laser(Laser {
            tom: Osc::new(Onda::Serra, 0.0),
            faixa: Biquad::new(Filtro::PassaFaixa, 1900.0, 3.0, sr),
            lfo: Osc::new(Onda::Seno, 0.0),
            rng: Rng::new(seed),
            alta: Biquad::new(Filtro::PassaAlta, 4200.0, 1.0, sr),
            saida: Suave::new(0.0, 0.08, sr),
            sr,
        })
    }

    /// laços não acabam sozinhos
    pub fn eh_laco(&self) -> bool {
        matches!(self, Gen::Zumbido(_) | Gen::Laser(_))
    }

    #[inline]
    fn acabou(&self) -> bool {
        match self {
            Gen::Tom(t) => t.atraso == 0 && t.n >= t.total,
            Gen::Ruido(r) => r.atraso == 0 && r.n >= r.total,
            _ => false,
        }
    }

    #[inline]
    fn tick(&mut self) -> f32 {
        match self {
            Gen::Tom(t) => {
                if t.atraso > 0 {
                    t.atraso -= 1;
                    return 0.0;
                }
                if t.n >= t.total {
                    return 0.0;
                }
                if t.n < t.ataque {
                    t.g *= t.ra;
                } else if t.n < t.dur {
                    t.g *= t.rd;
                } else {
                    t.g = 0.0;
                }
                let y = t.osc.tick(t.freq / t.sr) * t.g;
                t.freq *= t.rf;
                t.n += 1;
                y
            }
            Gen::Ruido(r) => {
                if r.atraso > 0 {
                    r.atraso -= 1;
                    return 0.0;
                }
                if r.n >= r.total {
                    return 0.0;
                }
                if r.varre && r.n < r.dur {
                    r.freq *= r.rf;
                    if r.n % 16 == 0 {
                        r.filtro.set(r.tipo, r.freq, r.q, r.sr);
                    }
                }
                if r.n < r.dur {
                    r.g *= r.rd;
                }
                let y = r.filtro.tick(r.rng.noise()) * r.g;
                r.n += 1;
                y
            }
            Gen::Zumbido(z) => {
                let bomba = z.bomba.tick(0.9 / z.sr);
                let mut corpo = 0.0;
                for (o, f, g) in &mut z.oscs {
                    corpo += o.tick(*f / z.sr) * *g;
                }
                let corpo = z.lp.tick(corpo * (0.26 + 0.09 * bomba));
                corpo + z.chiado.tick(z.rng.noise()) * 0.05
            }
            Gen::Laser(l) => {
                let lfo = l.lfo.tick(37.0 / l.sr);
                let tom = l.faixa.tick(l.tom.tick(1240.0 / l.sr)) * (0.05 + 0.03 * lfo);
                let estalo = l.alta.tick(l.rng.noise()) * 0.09;
                (tom + estalo) * l.saida.tick(0.5)
            }
        }
    }
}

// ---------- emissor: um som com posição ----------

struct Emissor {
    id: u32,
    pos: Vec3,
    perfil: Perfil,
    gens: Vec<Gen>,
    laco: bool,
    lp: Biquad,
    ganho: Suave,
    envio: Suave,
    esq: Suave,
    dir: Suave,
    fade: Suave,
    parando: bool,
}

/// o "panner" divide o som entre os dois lados (-3 dB no centro): o TS compensa com ganho 1,4 na entrada
const ENTRADA: f32 = 1.4;

impl Emissor {
    #[allow(clippy::too_many_arguments)]
    fn novo(id: u32, pos: Vec3, perfil: Perfil, gens: Vec<Gen>, ear: Vec3, lpos: Vec3, fwd: (f32, f32), sr: f32) -> Self {
        let d = pos.dist(ear);
        let (gl, gr) = equal_power(pan(lpos, fwd, pos));
        Self {
            id,
            pos,
            perfil,
            laco: gens.iter().any(Gen::eh_laco),
            gens,
            lp: Biquad::new(Filtro::PassaBaixa, distance_cutoff(d, perfil), 1.0, sr),
            // valores iniciais sem rampa, para o começo do som já sair certo
            ganho: Suave::new(distance_gain(d, perfil), 0.04, sr),
            envio: Suave::new(reverb_send(d, perfil), 0.04, sr),
            esq: Suave::new(gl, 0.04, sr),
            dir: Suave::new(gr, 0.04, sr),
            fade: Suave::new(1.0, 0.03, sr),
            parando: false,
        }
    }
}

// ---------- o mixer ----------

pub struct Mixer {
    sr: f32,
    ear: Vec3,
    lpos: Vec3,
    fwd: (f32, f32),
    mudo: bool,
    pausado: bool,
    mundo: bool,
    ar: bool,
    dentro: bool,
    vento: f32,
    abafo: f32,
    mestre: Suave,
    pausa: Suave,
    abafador: [Biquad; 2],
    abafo_f: Suave,
    soltas: Vec<Gen>,
    emissores: Vec<Emissor>,
    eco: Eco,
    molhado: Suave,
    camas: Camas,
    // blocos de trabalho (sem alocar na thread de áudio)
    l: [f32; BLOCO],
    r: [f32; BLOCO],
    el: [f32; BLOCO],
    er: [f32; BLOCO],
}

/// O som de fundo: o grave da cratera (fora), a ventilação da base (dentro) e o vento de Marte.
struct Camas {
    grave: [Osc; 3],
    grave_f: [f32; 3],
    grave_lfo: Osc,
    grave_lp: Biquad,
    fora: Suave,
    ar: Biquad,
    ar_rng: Rng,
    ar_lfo: Osc,
    maquina: Osc,
    dentro: Suave,
    vento_rng: Rng,
    vento_f: Biquad,
    vento_lfo: Osc,
    vento: Suave,
    vento_corte: Suave,
    n: u32,
}

impl Camas {
    fn novo(sr: f32) -> Self {
        let mut rng = Rng::new(0xC0FFEE);
        let desf = |r: &mut Rng, f: f32| f * 2f32.powf((r.f() - 0.5) * 12.0 / 1200.0);
        Self {
            grave: [Osc::new(Onda::Triangulo, 0.0); 3],
            grave_f: [desf(&mut rng, 55.0), desf(&mut rng, 82.4), desf(&mut rng, 110.3)],
            grave_lfo: Osc::new(Onda::Seno, 0.0),
            grave_lp: Biquad::new(Filtro::PassaBaixa, 380.0, 1.0, sr),
            fora: Suave::new(0.0, 0.5, sr),
            ar: Biquad::new(Filtro::PassaFaixa, 900.0, 0.6, sr),
            ar_rng: Rng::new(0xA1B2C3),
            ar_lfo: Osc::new(Onda::Seno, 0.0),
            maquina: Osc::new(Onda::Seno, 0.0),
            dentro: Suave::new(0.0, 0.5, sr),
            vento_rng: Rng::new(0x5EED5),
            vento_f: Biquad::new(Filtro::PassaFaixa, 380.0, 0.7, sr),
            vento_lfo: Osc::new(Onda::Seno, 0.0),
            vento: Suave::new(0.0, 0.6, sr),
            vento_corte: Suave::new(380.0, 0.6, sr),
            n: 0,
        }
    }
}

impl Mixer {
    pub fn new(sr: f32) -> Self {
        Self {
            sr,
            ear: Vec3::default(),
            lpos: Vec3::default(),
            fwd: (0.0, -1.0),
            mudo: false,
            pausado: false,
            mundo: false,
            ar: false,
            dentro: false,
            vento: 0.0,
            abafo: 0.0,
            mestre: Suave::new(MASTER, 0.05, sr),
            pausa: Suave::new(1.0, 0.015, sr),
            abafador: [Biquad::new(Filtro::PassaBaixa, 20000.0, 1.0, sr); 2],
            abafo_f: Suave::new(20000.0, 0.15, sr),
            soltas: Vec::with_capacity(MAX_VOZES_SOLTAS),
            emissores: Vec::with_capacity(MAX_EMISSORES),
            eco: Eco::new(sr),
            molhado: Suave::new(REVERB, 0.5, sr),
            camas: Camas::novo(sr),
            l: [0.0; BLOCO],
            r: [0.0; BLOCO],
            el: [0.0; BLOCO],
            er: [0.0; BLOCO],
        }
    }

    pub fn sample_rate(&self) -> f32 {
        self.sr
    }

    /// quantos sons com posição estão tocando
    pub fn emissores(&self) -> usize {
        self.emissores.len()
    }

    pub fn vozes_soltas(&self) -> usize {
        self.soltas.len()
    }

    pub fn aplica(&mut self, c: Comando) {
        match c {
            Comando::Play { id, gens, at } => match at {
                Some((pos, perfil)) => {
                    if self.emissores.len() < MAX_EMISSORES {
                        self.emissores.push(Emissor::novo(id, pos, perfil, gens, self.ear, self.lpos, self.fwd, self.sr));
                    }
                }
                None => {
                    // o capacete: sem posição, sempre no centro
                    for g in gens {
                        if self.soltas.len() < MAX_VOZES_SOLTAS {
                            self.soltas.push(g);
                        }
                    }
                }
            },
            Comando::Loop { id, gen, at, perfil } => {
                if self.emissores.len() < MAX_EMISSORES {
                    self.emissores.push(Emissor::novo(id, at, perfil, vec![gen], self.ear, self.lpos, self.fwd, self.sr));
                }
            }
            Comando::Move { id, at } => {
                if let Some(e) = self.emissores.iter_mut().find(|e| e.id == id) {
                    e.pos = at;
                }
            }
            Comando::Stop { id } => {
                if let Some(e) = self.emissores.iter_mut().find(|e| e.id == id) {
                    e.parando = true;
                }
            }
            Comando::StopAll => {
                for e in &mut self.emissores {
                    e.parando = true;
                }
            }
            Comando::Listener { player, forward } => {
                self.ear = player;
                self.fwd = forward;
                self.lpos = listener_position(player, forward);
            }
            Comando::Muted(m) => self.mudo = m,
            Comando::Muffled(a) => self.abafo = a.clamp(0.0, 1.0),
            Comando::Paused(p) => self.pausado = p,
            Comando::Indoors(d) => self.dentro = d,
            Comando::Wind(l) => self.vento = l.clamp(0.0, 1.0),
            Comando::Air(a) => self.ar = a,
            Comando::World(m) => self.mundo = m,
        }
    }

    /// Escreve `out.len() / 2` quadros estéreo intercalados (L, R, L, R…).
    pub fn render(&mut self, out: &mut [f32]) {
        let mut i = 0;
        while i + 1 < out.len() {
            let n = ((out.len() - i) / 2).min(BLOCO);
            self.bloco(n);
            for k in 0..n {
                out[i + 2 * k] = self.l[k];
                out[i + 2 * k + 1] = self.r[k];
            }
            i += 2 * n;
        }
        // sobrou uma amostra solta (saída ímpar): silêncio
        if i < out.len() {
            out[i] = 0.0;
        }
    }

    fn bloco(&mut self, n: usize) {
        // pausa: depois do fade-out o tempo do som para de verdade (como o `AudioContext.suspend`)
        let alvo_pausa = if self.pausado { 0.0 } else { 1.0 };
        if self.pausado && self.pausa.v < 1e-4 {
            self.l[..n].fill(0.0);
            self.r[..n].fill(0.0);
            return;
        }
        let sr = self.sr;
        self.l[..n].fill(0.0);
        self.r[..n].fill(0.0);
        self.el[..n].fill(0.0);
        self.er[..n].fill(0.0);

        // 1) sons do capacete
        for g in &mut self.soltas {
            for k in 0..n {
                let s = g.tick();
                self.l[k] += s;
                self.r[k] += s;
            }
        }
        self.soltas.retain(|g| !g.acabou());

        // 2) camas de ambiente
        self.camas_bloco(n);

        // 3) sons do mundo
        let (ear, lpos, fwd) = (self.ear, self.lpos, self.fwd);
        for e in &mut self.emissores {
            let d = e.pos.dist(ear);
            let (gt, ct, st) = (distance_gain(d, e.perfil), distance_cutoff(d, e.perfil), reverb_send(d, e.perfil));
            let (pl, pr) = equal_power(pan(lpos, fwd, e.pos));
            e.lp.set(Filtro::PassaBaixa, ct, 1.0, sr);
            let fade_alvo = if e.parando { 0.0 } else { 1.0 };
            for k in 0..n {
                let mut s = 0.0;
                for g in &mut e.gens {
                    s += g.tick();
                }
                let s = e.lp.tick(s * ENTRADA) * e.ganho.tick(gt) * e.fade.tick(fade_alvo);
                let (l, r) = (s * e.esq.tick(pl), s * e.dir.tick(pr));
                self.l[k] += l;
                self.r[k] += r;
                let envio = e.envio.tick(st);
                self.el[k] += l * envio;
                self.er[k] += r * envio;
            }
            e.gens.retain(|g| !g.acabou());
        }
        self.emissores.retain(|e| !(e.fade.v < 1e-3 && e.parando) && (!e.gens.is_empty() || e.laco));

        // 4) eco da cratera (entra no mesmo ponto do grafo do TS: depois do panner, soma no mestre)
        let molhado_alvo = if self.dentro { REVERB * 0.25 } else { REVERB };
        for k in 0..n {
            let (wl, wr) = self.eco.tick(self.el[k], self.er[k]);
            let w = self.molhado.tick(molhado_alvo);
            self.l[k] += wl * w;
            self.r[k] += wr * w;
        }

        // 5) mestre → abafador (capacete, asfixia) → freio de pico
        let top = if self.ar { 6500.0 } else { 20000.0 };
        let f_alvo = top * (250.0f32 / top).powf(self.abafo);
        let f = self.abafo_f.tick_n(f_alvo, n);
        for b in &mut self.abafador {
            b.set(Filtro::PassaBaixa, f, 1.0, sr);
        }
        let mestre_alvo = if self.mudo { 0.0 } else { MASTER };
        for k in 0..n {
            let m = self.mestre.tick(mestre_alvo) * self.pausa.tick(alvo_pausa);
            self.l[k] = limita(self.abafador[0].tick(self.l[k] * m));
            self.r[k] = limita(self.abafador[1].tick(self.r[k] * m));
        }
    }

    fn camas_bloco(&mut self, n: usize) {
        let sr = self.sr;
        let c = &mut self.camas;
        let dentro = self.dentro;
        // alvos
        let mundo = self.mundo;
        let fora_alvo = if !mundo { 0.0 } else if dentro { AMBIENT_FORA_DA_BASE } else { AMBIENT };
        let dentro_alvo = if dentro && mundo { INDOOR_AMBIENT } else { 0.0 };
        let (vento_alvo, corte_alvo) = if self.ar && mundo {
            ((if dentro { 0.15 } else { 1.0 }) * (0.05 + self.vento * 0.42), 380.0 + self.vento * 520.0)
        } else {
            (0.0, 380.0)
        };
        // o corte do passa-baixa da cratera passeia ±160 Hz devagar (LFO de 0,07 Hz)
        let lfo = c.grave_lfo.tick(0.07 / sr * n as f32);
        c.grave_lp.set(Filtro::PassaBaixa, 380.0 + 160.0 * lfo, 1.0, sr);
        let corte = c.vento_corte.tick_n(corte_alvo, n);
        if self.ar {
            c.vento_f.set(Filtro::PassaFaixa, corte, 0.7, sr);
        }
        let ar_mod = 0.55 + 0.2 * c.ar_lfo.tick(0.18 / sr * n as f32);
        let vento_mod = 0.8 + 0.35 * c.vento_lfo.tick(0.11 / sr * n as f32);
        for k in 0..n {
            let fora = c.fora.tick(fora_alvo);
            let ger = c.dentro.tick(dentro_alvo);
            let mut s = 0.0;
            if fora > 1e-5 {
                let mut g = 0.0;
                for (o, f) in c.grave.iter_mut().zip(c.grave_f) {
                    g += o.tick(f / sr);
                }
                s += c.grave_lp.tick(g) * fora;
            }
            if ger > 1e-5 || dentro {
                let ar = c.ar_rng.noise();
                let m = c.maquina.tick(96.0 / sr) * 0.6;
                s += (c.ar.tick(ar) * ar_mod + m) * ger;
            }
            if self.ar {
                let v = c.vento.tick(vento_alvo);
                s += c.vento_f.tick(c.vento_rng.noise()) * vento_mod * v;
            }
            self.l[k] += s;
            self.r[k] += s;
        }
        c.n = c.n.wrapping_add(n as u32);
    }
}
