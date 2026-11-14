//! Teste de custo dos efeitos (docs/design/PORTE_RUST.md, M3; a ideia da matriz de efeitos do teste de desempenho web,
//! docs/design/BENCHMARK.md): com o astronauta parado, mede o tempo do quadro com tudo ligado e depois com cada efeito
//! desligado, um de cada vez. A diferença é quanto o efeito custa neste aparelho. Precisa do FPS sem limite (vsync
//! desligado), senão o tempo do quadro é o da tela.
use spacing_render::Renderer;

/// segundos de cada etapa: espera (o quadro assenta) e medida
const WARMUP: f64 = 0.6;
const MEASURE: f64 = 2.4;

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
        }
    }
}

const STEPS: [Effect; 7] = [Effect::All, Effect::Shadow, Effect::Bloom, Effect::Chromatic, Effect::Vignette, Effect::Noise, Effect::Nothing];

pub struct EffectBench {
    step: usize,
    t: f64,
    sum: f64,
    frames: u32,
    /// (efeito, ms por quadro na etapa)
    pub results: Vec<(Effect, f64)>,
    pub done: bool,
}

impl EffectBench {
    pub fn new(r: &mut Renderer) -> Self {
        let b = Self { step: 0, t: 0.0, sum: 0.0, frames: 0, results: Vec::new(), done: false };
        b.apply(r);
        b
    }

    /// liga tudo e desliga só o efeito da etapa atual
    fn apply(&self, r: &mut Renderer) {
        let off = STEPS.get(self.step).copied().unwrap_or(Effect::All);
        r.shadows = !matches!(off, Effect::Shadow | Effect::Nothing);
        let s = r.post_settings();
        s.bloom = !matches!(off, Effect::Bloom | Effect::Nothing);
        s.chromatic = !matches!(off, Effect::Chromatic | Effect::Nothing);
        s.vignette = !matches!(off, Effect::Vignette | Effect::Nothing);
        s.noise = !matches!(off, Effect::Noise | Effect::Nothing);
    }

    /// Um quadro (`dt` = tempo real do quadro anterior). Devolve true quando acabou (e já religou tudo).
    pub fn frame(&mut self, dt: f64, r: &mut Renderer) -> bool {
        if self.done {
            return true;
        }
        self.t += dt;
        if self.t > WARMUP {
            self.sum += dt;
            self.frames += 1;
        }
        if self.t >= WARMUP + MEASURE {
            let ms = if self.frames > 0 { self.sum * 1000.0 / self.frames as f64 } else { 0.0 };
            self.results.push((STEPS[self.step], ms));
            self.step += 1;
            self.t = 0.0;
            self.sum = 0.0;
            self.frames = 0;
            if self.step >= STEPS.len() {
                self.done = true;
                self.step = 0;
            }
            self.apply(r);
        }
        self.done
    }

    pub fn running_label(&self) -> String {
        format!("medindo: sem {} ({}/{})", STEPS[self.step].name(), self.step + 1, STEPS.len()).replace("sem tudo ligado", "tudo ligado")
    }

    /// linhas do resultado: quanto cada efeito custa (ms) contra "tudo ligado"
    pub fn report(&self) -> Vec<String> {
        let Some(&(_, base)) = self.results.first() else { return Vec::new() };
        let mut out = vec![format!("custo dos efeitos (tudo ligado: {:.2} ms, {:.0} FPS)", base, 1000.0 / base.max(0.001))];
        for &(e, ms) in self.results.iter().skip(1) {
            out.push(format!("  {}: {:+.2} ms", e.name(), base - ms));
        }
        out.iter().map(|l| l.replace('.', ",")).collect()
    }
}
