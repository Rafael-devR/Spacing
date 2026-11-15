//! Teste de custo dos efeitos (docs/design/PORTE_RUST.md, M3; a ideia da matriz de efeitos do teste de desempenho web,
//! docs/design/BENCHMARK.md): com o astronauta parado, mede o tempo do quadro com cada efeito desligado e compara com
//! "tudo ligado" medido logo antes e logo depois. Precisa do FPS sem limite (vsync desligado), senão o tempo do quadro é
//! o da tela.
//!
//! Por que intercalado: a placa do celular muda de velocidade sozinha (esquenta, economiza bateria) mais do que um
//! efeito pequeno custa. Na primeira versão (tudo ligado uma vez, no começo, e depois cada efeito desligado em
//! sequência) a deriva dava números sem sentido, como a sombra "custando" -4 ms. Comparar cada etapa com as vizinhas
//! cancela a deriva lenta; duas rodadas mostram quanto o número ainda varia (o ±).
use spacing_render::Renderer;

/// segundos de cada etapa: espera (o quadro assenta) e medida
const WARMUP: f64 = 0.3;
const MEASURE: f64 = 0.8;
const ROUNDS: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Effect {
    All,
    Shadow,
    Bloom,
    Chromatic,
    Vignette,
    Noise,
    /// tudo desligado de uma vez (o que sobra é a cena crua)
    Nothing,
    /// a cena na resolução cheia da tela em vez da escala do jogo (o custo sai negativo: é quanto a mais custaria)
    FullRes,
}

impl Effect {
    pub fn name(self) -> &'static str {
        match self {
            Effect::All => "tudo ligado",
            Effect::Shadow => "sombra",
            Effect::Bloom => "bloom",
            Effect::Chromatic => "aberração",
            Effect::Vignette => "vinheta",
            Effect::Noise => "ruído",
            Effect::Nothing => "todos os efeitos",
            Effect::FullRes => "resolução reduzida",
        }
    }
}

const TESTED: [Effect; 7] = [Effect::Shadow, Effect::Bloom, Effect::Chromatic, Effect::Vignette, Effect::Noise, Effect::Nothing, Effect::FullRes];

/// a sequência de uma rodada: tudo, X1, tudo, X2, ..., tudo, Xn, tudo
fn round_steps() -> Vec<Effect> {
    let mut v = vec![Effect::All];
    for e in TESTED {
        v.push(e);
        v.push(Effect::All);
    }
    v
}

pub struct EffectBench {
    steps: Vec<Effect>,
    step: usize,
    t: f64,
    sum: f64,
    frames: u32,
    /// escala da cena do jogo (as etapas voltam a ela)
    scale: f32,
    /// ms por quadro de cada etapa, na ordem de `steps`
    times: Vec<f64>,
    pub done: bool,
}

impl EffectBench {
    pub fn new(r: &mut Renderer) -> Self {
        let mut steps = Vec::new();
        for _ in 0..ROUNDS {
            steps.extend(round_steps());
        }
        let b = Self { steps, step: 0, t: 0.0, sum: 0.0, frames: 0, scale: r.scale(), times: Vec::new(), done: false };
        b.apply(r);
        b
    }

    /// liga tudo e desliga só o efeito da etapa atual
    fn apply(&self, r: &mut Renderer) {
        let off = if self.done { Effect::All } else { self.steps[self.step] };
        r.shadows = !matches!(off, Effect::Shadow | Effect::Nothing);
        r.set_scale(if off == Effect::FullRes { 1.0 } else { self.scale });
        let s = r.post_settings();
        s.bloom = !matches!(off, Effect::Bloom | Effect::Nothing);
        s.chromatic = !matches!(off, Effect::Chromatic | Effect::Nothing);
        s.vignette = !matches!(off, Effect::Vignette | Effect::Nothing);
        s.noise = !matches!(off, Effect::Noise | Effect::Nothing);
    }

    /// Um quadro (`dt` = tempo real do quadro anterior). Devolve true no quadro em que acaba (e já religou tudo).
    pub fn frame(&mut self, dt: f64, r: &mut Renderer) -> bool {
        if self.done {
            return false;
        }
        self.t += dt;
        if self.t > WARMUP {
            self.sum += dt;
            self.frames += 1;
        }
        if self.t >= WARMUP + MEASURE {
            self.times.push(if self.frames > 0 { self.sum * 1000.0 / self.frames as f64 } else { 0.0 });
            self.step += 1;
            self.t = 0.0;
            self.sum = 0.0;
            self.frames = 0;
            self.done = self.step >= self.steps.len();
            self.apply(r);
            return self.done;
        }
        false
    }

    pub fn running_label(&self) -> String {
        let per = self.steps.len() / ROUNDS;
        let e = self.steps[self.step];
        let what = if e == Effect::All { "tudo ligado".to_string() } else { format!("sem {}", e.name()) };
        format!("medindo: {what} (etapa {}/{}, rodada {}/{ROUNDS})", self.step % per + 1, per, self.step / per + 1)
    }

    /// custo de cada efeito (ms) em cada rodada: média das duas medidas de "tudo ligado" vizinhas menos a medida sem ele
    fn costs(&self) -> Vec<(Effect, Vec<f64>)> {
        let per = self.steps.len() / ROUNDS;
        TESTED
            .iter()
            .enumerate()
            .map(|(k, &e)| {
                let v = (0..ROUNDS)
                    .filter_map(|round| {
                        let i = round * per + 2 * k + 1;
                        let (a, x, b) = (self.times.get(i - 1)?, self.times.get(i)?, self.times.get(i + 1)?);
                        Some((a + b) / 2.0 - x)
                    })
                    .collect();
                (e, v)
            })
            .collect()
    }

    /// linhas do resultado: quanto cada efeito custa (ms) e quanto o número variou entre as rodadas
    pub fn report(&self) -> Vec<String> {
        let all: Vec<f64> = self.times.iter().zip(&self.steps).filter(|(_, e)| **e == Effect::All).map(|(t, _)| *t).collect();
        if all.is_empty() {
            return Vec::new();
        }
        let base = all.iter().sum::<f64>() / all.len() as f64;
        let mut out = vec![format!("custo dos efeitos (tudo ligado: {:.2} ms, {:.0} FPS)", base, 1000.0 / base.max(0.001))];
        for (e, v) in self.costs() {
            if v.is_empty() {
                continue;
            }
            let mean = v.iter().sum::<f64>() / v.len() as f64;
            let spread = v.iter().map(|c| (c - mean).abs()).fold(0.0, f64::max);
            out.push(format!("  {}: {:+.2} ms (± {:.2})", e.name(), mean, spread));
        }
        out.push("± grande = número instável: repita parado".into());
        out.iter().map(|l| l.replace('.', ",")).collect()
    }
}
