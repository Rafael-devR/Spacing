//! Peças de sinal: ruído, filtro biquad (as contas do WebAudio), osciladores, suavização e o eco da cratera.
use std::f32::consts::TAU;

/// Ruído e sorteios baratos (xorshift32), um por voz: não trava a thread de áudio.
#[derive(Clone, Debug)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self(if seed == 0 { 0x9E37_79B9 } else { seed })
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// 0..1
    #[inline]
    pub fn f(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / 16_777_216.0
    }

    /// -1..1 (ruído branco)
    #[inline]
    pub fn noise(&mut self) -> f32 {
        self.f() * 2.0 - 1.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filtro {
    PassaBaixa,
    PassaAlta,
    PassaFaixa,
}

/// Filtro de dois polos (as fórmulas de `BiquadFilterNode`: no passa-baixa e no passa-alta o `q` é em dB, na faixa é linear).
#[derive(Clone, Copy, Debug, Default)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    pub fn new(tipo: Filtro, freq: f32, q: f32, sr: f32) -> Self {
        let mut f = Self::default();
        f.set(tipo, freq, q, sr);
        f
    }

    pub fn set(&mut self, tipo: Filtro, freq: f32, q: f32, sr: f32) {
        let f = freq.clamp(10.0, sr * 0.49);
        let w0 = TAU * f / sr;
        let (s, c) = w0.sin_cos();
        let (b0, b1, b2, alpha) = match tipo {
            Filtro::PassaBaixa => {
                let alpha = s / (2.0 * 10f32.powf(q / 20.0));
                ((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, alpha)
            }
            Filtro::PassaAlta => {
                let alpha = s / (2.0 * 10f32.powf(q / 20.0));
                ((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, alpha)
            }
            Filtro::PassaFaixa => {
                let alpha = s / (2.0 * q.max(0.01));
                (alpha, 0.0, -alpha, alpha)
            }
        };
        let a0 = 1.0 + alpha;
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = -2.0 * c / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Onda {
    Seno,
    Triangulo,
    Quadrada,
    Serra,
}

/// Oscilador de fase 0..1. Quadrada e dente de serra usam polyBLEP (sem serrilhado).
#[derive(Clone, Copy, Debug)]
pub struct Osc {
    pub onda: Onda,
    pub fase: f32,
}

impl Osc {
    pub fn new(onda: Onda, fase: f32) -> Self {
        Self { onda, fase }
    }

    /// uma amostra; `dt` = frequência / taxa de amostragem
    #[inline]
    pub fn tick(&mut self, dt: f32) -> f32 {
        let t = self.fase;
        let y = match self.onda {
            Onda::Seno => (t * TAU).sin(),
            Onda::Triangulo => 4.0 * (t - (t + 0.5).floor()).abs() - 1.0,
            Onda::Quadrada => (if t < 0.5 { 1.0 } else { -1.0 }) + blep(t, dt) - blep((t + 0.5).fract(), dt),
            Onda::Serra => 2.0 * t - 1.0 - blep(t, dt),
        };
        self.fase += dt;
        if self.fase >= 1.0 {
            self.fase -= 1.0;
        }
        y
    }
}

#[inline]
fn blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

/// Valor que persegue um alvo sem estalo (`setTargetAtTime`: constante de tempo `tau`).
#[derive(Clone, Copy, Debug)]
pub struct Suave {
    pub v: f32,
    a: f32,
}

impl Suave {
    pub fn new(v: f32, tau: f32, sr: f32) -> Self {
        Self { v, a: 1.0 - (-1.0 / (tau.max(1e-4) * sr)).exp() }
    }

    #[inline]
    pub fn tick(&mut self, alvo: f32) -> f32 {
        self.v += (alvo - self.v) * self.a;
        self.v
    }

    /// o mesmo que `n` chamadas de `tick` (para valores que só mudam uma vez por bloco)
    pub fn tick_n(&mut self, alvo: f32, n: usize) -> f32 {
        self.v += (alvo - self.v) * (1.0 - (1.0 - self.a).powi(n as i32));
        self.v
    }
}

// ---------- eco da cratera ----------

/// Pente com amortecimento (a cauda perde agudos, como numa cratera de rocha).
#[derive(Clone, Debug)]
struct Pente {
    buf: Vec<f32>,
    i: usize,
    g: f32,
    lp: f32,
    amort: f32,
}

impl Pente {
    fn new(atraso: usize, g: f32, amort: f32) -> Self {
        Self { buf: vec![0.0; atraso.max(1)], i: 0, g, lp: 0.0, amort }
    }

    #[inline]
    fn tick(&mut self, x: f32) -> f32 {
        let y = self.buf[self.i];
        self.lp = y * (1.0 - self.amort) + self.lp * self.amort;
        self.buf[self.i] = x + self.lp * self.g;
        self.i += 1;
        if self.i == self.buf.len() {
            self.i = 0;
        }
        y
    }
}

#[derive(Clone, Debug)]
struct PassaTudo {
    buf: Vec<f32>,
    i: usize,
}

impl PassaTudo {
    fn new(atraso: usize) -> Self {
        Self { buf: vec![0.0; atraso.max(1)], i: 0 }
    }

    #[inline]
    fn tick(&mut self, x: f32) -> f32 {
        let b = self.buf[self.i];
        let y = b - 0.5 * x;
        self.buf[self.i] = x + 0.5 * b;
        self.i += 1;
        if self.i == self.buf.len() {
            self.i = 0;
        }
        y
    }
}

/// Um canal do eco: quatro pentes em paralelo e dois passa-tudo em série.
#[derive(Clone, Debug)]
struct CanalEco {
    pentes: [Pente; 4],
    passa: [PassaTudo; 2],
}

/// Tempo (s) para a cauda cair 60 dB: a resposta do TS decai como `exp(-2,6·t)` (≈ 2,65 s).
const RT60: f32 = 2.65;

impl CanalEco {
    fn new(sr: f32, desloc: usize) -> Self {
        // atrasos primos entre si, em amostras a 44,1 kHz (Freeverb), escalados para a taxa de agora
        let k = sr / 44100.0;
        let atrasos = [1557usize, 1617, 1491, 1422];
        let mk = |a: usize| {
            let n = (((a + desloc) as f32) * k).round() as usize;
            Pente::new(n, 10f32.powf(-3.0 * n as f32 / (RT60 * sr)), 0.35)
        };
        Self {
            pentes: [mk(atrasos[0]), mk(atrasos[1]), mk(atrasos[2]), mk(atrasos[3])],
            passa: [PassaTudo::new((225.0 * k) as usize + desloc / 4), PassaTudo::new((556.0 * k) as usize + desloc / 4)],
        }
    }

    #[inline]
    fn tick(&mut self, x: f32) -> f32 {
        let mut s = 0.0;
        for p in &mut self.pentes {
            s += p.tick(x);
        }
        for a in &mut self.passa {
            s = a.tick(s);
        }
        s
    }
}

/// O eco da cratera (substitui o `ConvolverNode` do jogo web: mesma cauda difusa de ~2,6 s, bem mais barato).
/// Estéreo: cada lado tem atrasos um pouco diferentes, para o eco "abrir".
#[derive(Clone, Debug)]
pub struct Eco {
    esq: CanalEco,
    dir: CanalEco,
    ganho: f32,
}

/// A energia da resposta ao impulso depois da calibração. O `ConvolverNode` normaliza a resposta de 2,4 s do TS para
/// ~0,18 de energia (RMS 0,00125 em 115 mil amostras); o eco daqui é calibrado para o mesmo valor, então o volume do
/// eco (a constante `REVERB` do TS) vale igual nos dois.
const ENERGIA_ECO: f32 = 0.18;

impl Eco {
    pub fn new(sr: f32) -> Self {
        let mut e = Self { esq: CanalEco::new(sr, 0), dir: CanalEco::new(sr, 23), ganho: 1.0 };
        // mede a energia com um impulso e acerta o ganho
        let n = (sr * 4.0) as usize;
        let (mut soma, mut x) = (0.0f64, 1.0f32);
        for _ in 0..n {
            let (l, r) = (e.esq.tick(x), e.dir.tick(x));
            soma += ((l * l + r * r) as f64) * 0.5;
            x = 0.0;
        }
        e.ganho = (ENERGIA_ECO / soma.max(1e-9) as f32).sqrt();
        e.esq = CanalEco::new(sr, 0);
        e.dir = CanalEco::new(sr, 23);
        e
    }

    #[inline]
    pub fn tick(&mut self, l: f32, r: f32) -> (f32, f32) {
        (self.esq.tick(l) * self.ganho, self.dir.tick(r) * self.ganho)
    }
}

/// Freio suave para o pico: abaixo de 0,9 não mexe; acima, curva até 1 sem cortar seco.
#[inline]
pub fn limita(x: f32) -> f32 {
    let a = x.abs();
    if a <= 0.9 {
        x
    } else {
        x.signum() * (0.9 + 0.1 * ((a - 0.9) / 0.1).tanh())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48000.0;

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt()
    }

    #[test]
    fn ruido_fica_entre_menos_um_e_um_e_sem_media() {
        let mut r = Rng::new(7);
        let v: Vec<f32> = (0..50_000).map(|_| r.noise()).collect();
        assert!(v.iter().all(|x| (-1.0..=1.0).contains(x)));
        assert!((v.iter().sum::<f32>() / v.len() as f32).abs() < 0.02);
        assert!((rms(&v) - 0.577).abs() < 0.02, "ruído branco uniforme: rms ≈ 0,577");
    }

    #[test]
    fn passa_baixa_deixa_o_grave_e_corta_o_agudo() {
        let seno = |f: f32| {
            let mut o = Osc::new(Onda::Seno, 0.0);
            let mut b = Biquad::new(Filtro::PassaBaixa, 1000.0, 1.0, SR);
            let y: Vec<f32> = (0..9600).map(|_| b.tick(o.tick(f / SR))).collect();
            rms(&y[4800..])
        };
        assert!(seno(100.0) > 0.65, "grave passa (~0,707)");
        assert!(seno(10_000.0) < 0.02, "agudo some");
    }

    #[test]
    fn passa_alta_e_passa_faixa() {
        let medir = |tipo, f_filtro, f_sinal| {
            let mut o = Osc::new(Onda::Seno, 0.0);
            let mut b = Biquad::new(tipo, f_filtro, 1.0, SR);
            let y: Vec<f32> = (0..9600).map(|_| b.tick(o.tick(f_sinal / SR))).collect();
            rms(&y[4800..])
        };
        assert!(medir(Filtro::PassaAlta, 2000.0, 8000.0) > 0.65);
        assert!(medir(Filtro::PassaAlta, 2000.0, 200.0) < 0.02);
        assert!(medir(Filtro::PassaFaixa, 1000.0, 1000.0) > 0.65, "no centro da faixa o ganho é 1");
        assert!(medir(Filtro::PassaFaixa, 1000.0, 100.0) < 0.2);
    }

    #[test]
    fn osciladores_ficam_limitados_e_na_frequencia() {
        for onda in [Onda::Seno, Onda::Triangulo, Onda::Quadrada, Onda::Serra] {
            let mut o = Osc::new(onda, 0.0);
            let y: Vec<f32> = (0..48_000).map(|_| o.tick(220.0 / SR)).collect();
            let pico = y.iter().fold(0.0f32, |m, x| m.max(x.abs()));
            assert!(pico < 1.3, "{onda:?} pico {pico}");
            // 220 ciclos por segundo: conta as passagens por zero subindo
            let ciclos = y.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
            assert!((ciclos as i32 - 220).abs() <= 2, "{onda:?}: {ciclos} ciclos");
        }
    }

    #[test]
    fn suave_em_bloco_e_igual_a_varias_chamadas() {
        let (mut a, mut b) = (Suave::new(0.0, 0.05, SR), Suave::new(0.0, 0.05, SR));
        for _ in 0..64 {
            a.tick(1.0);
        }
        b.tick_n(1.0, 64);
        assert!((a.v - b.v).abs() < 1e-5);
    }

    #[test]
    fn suave_chega_no_alvo_em_cerca_de_quatro_constantes_de_tempo() {
        let mut s = Suave::new(0.0, 0.04, SR);
        for _ in 0..(0.04 * SR) as usize {
            s.tick(1.0);
        }
        assert!((s.v - 0.632).abs() < 0.01, "1 tau = 63%: {}", s.v);
        for _ in 0..(0.12 * SR) as usize {
            s.tick(1.0);
        }
        assert!(s.v > 0.98);
    }

    #[test]
    fn eco_tem_a_energia_calibrada_e_a_cauda_de_mais_de_dois_segundos() {
        let mut e = Eco::new(SR);
        let n = (SR * 5.0) as usize;
        let mut saida = Vec::with_capacity(n);
        let mut x = 1.0;
        for _ in 0..n {
            let (l, r) = e.tick(x, x);
            saida.push((l, r));
            x = 0.0;
        }
        let energia: f32 = saida.iter().map(|(l, r)| (l * l + r * r) * 0.5).sum();
        assert!((energia - ENERGIA_ECO).abs() < 0.03, "energia {energia}");
        assert!(saida.iter().all(|(l, r)| l.is_finite() && r.is_finite()));
        // cai ~60 dB em ~2,65 s (com folga): aos 1 s ainda há som, aos 4,5 s quase nada
        let janela = |a: f32, b: f32| {
            let s: f32 = saida[(a * SR) as usize..(b * SR) as usize].iter().map(|(l, r)| l * l + r * r).sum();
            (s / ((b - a) * SR)).sqrt()
        };
        assert!(janela(1.0, 1.2) > 20.0 * janela(4.4, 4.6), "a cauda decai");
        assert!(janela(2.0, 2.2) > 0.0, "cauda de 2 s");
        // os dois lados não são iguais (o eco "abre")
        assert!(saida.iter().skip(2000).take(20000).any(|(l, r)| (l - r).abs() > 1e-4));
    }

    #[test]
    fn limitador_so_age_no_pico() {
        assert_eq!(limita(0.5), 0.5);
        assert!(limita(3.0) <= 1.0 && limita(3.0) > 0.99);
        assert!(limita(-3.0) >= -1.0);
        assert!(limita(0.95) > 0.9 && limita(0.95) < 1.0);
    }
}
