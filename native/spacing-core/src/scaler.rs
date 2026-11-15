//! Resolução dinâmica (porte de `src/render/scaler.ts`, ADR 0012): quando o desenho não acompanha a tela por causa da
//! GPU, baixa a resolução um degrau; quando sobra folga por bastante tempo, tenta subir de novo. Puro (sem gráficos).
//!
//! Só mexe quando o atraso é da GPU: um quadro lento em que o jogo gastou quase todo o tempo em CPU (gerar chunk, por
//! exemplo) não melhora com menos pixels, então não conta.

/// degraus da escala (multiplicam a resolução escolhida)
pub const SCALE_STEPS: [f64; 4] = [1.0, 0.85, 0.72, 0.6];

pub struct ScalerTuning {
    /// quadros por janela de decisão
    pub window: u32,
    /// quadro lento: mais que isto vezes o tempo de um quadro
    pub slow_factor: f64,
    /// baixa um degrau se esta fração da janela foi lenta por causa da GPU
    pub down_at: f64,
    /// quadro lento é "da GPU" se a CPU gastou menos que esta fração dele
    pub gpu_share: f64,
    /// sobe um degrau depois de tantas janelas seguidas sem nenhum quadro lento
    pub up_after: u32,
    /// quadros com mais que isto (ms) são pausa: não contam
    pub ignore_over: f64,
}

pub const SCALER: ScalerTuning = ScalerTuning { window: 90, slow_factor: 1.5, down_at: 0.1, gpu_share: 0.7, up_after: 5, ignore_over: 250.0 };

pub struct ResolutionScaler {
    step: usize,
    frames: u32,
    slow_gpu: u32,
    slow_any: u32,
    calm: u32,
    /// janelas a esperar antes de tentar subir (dobra cada vez que a subida deu errado)
    hold: u32,
    since_up: u32,
}

impl Default for ResolutionScaler {
    fn default() -> Self {
        Self { step: 0, frames: 0, slow_gpu: 0, slow_any: 0, calm: 0, hold: SCALER.up_after, since_up: 99 }
    }
}

impl ResolutionScaler {
    pub fn scale(&self) -> f64 {
        SCALE_STEPS[self.step]
    }

    /// volta ao máximo (mudou a qualidade, o tamanho da tela ou a resolução escolhida)
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Um quadro: `period_ms` desde o quadro anterior, `cpu_ms` gasto pelo jogo nele, `budget_ms` o tempo de um quadro na
    /// taxa alvo (16,7 para 60). Devolve a escala nova se mudou.
    pub fn frame(&mut self, period_ms: f64, cpu_ms: f64, budget_ms: f64) -> Option<f64> {
        if period_ms > SCALER.ignore_over || period_ms <= 0.0 {
            return None;
        }
        self.frames += 1;
        if period_ms > budget_ms * SCALER.slow_factor {
            self.slow_any += 1;
            if cpu_ms < period_ms * SCALER.gpu_share {
                self.slow_gpu += 1;
            }
        }
        if self.frames < SCALER.window {
            return None;
        }
        let gpu_fraction = self.slow_gpu as f64 / self.frames as f64;
        let calm = self.slow_any == 0;
        self.frames = 0;
        self.slow_gpu = 0;
        self.slow_any = 0;
        self.since_up += 1;
        if gpu_fraction >= SCALER.down_at && self.step < SCALE_STEPS.len() - 1 {
            // descer logo depois de subir: a subida foi cedo demais; espera o dobro da próxima vez
            if self.since_up <= 2 {
                self.hold = (self.hold * 2).min(80);
            }
            self.step += 1;
            self.calm = 0;
            return Some(self.scale());
        }
        self.calm = if calm { self.calm + 1 } else { 0 };
        if self.calm >= self.hold && self.step > 0 {
            self.step -= 1;
            self.calm = 0;
            self.since_up = 0;
            return Some(self.scale());
        }
        None
    }
}

#[cfg(test)]
mod tests {
    //! os mesmos casos de tests/scaler.test.ts
    use super::*;

    const B: f64 = 1000.0 / 60.0;

    fn window(s: &mut ResolutionScaler, slow: u32, cpu: f64) -> Option<f64> {
        let mut out = None;
        for i in 0..SCALER.window {
            let r = if i < slow { s.frame(33.4, cpu, B) } else { s.frame(16.7, 6.0, B) };
            out = out.or(r);
        }
        out
    }

    #[test]
    fn comeca_no_maximo_e_nao_muda_se_acompanha() {
        let mut s = ResolutionScaler::default();
        assert_eq!(s.scale(), 1.0);
        for _ in 0..10 {
            assert_eq!(window(&mut s, 0, 6.0), None);
        }
    }

    #[test]
    fn baixa_quando_a_gpu_atrasa() {
        let mut s = ResolutionScaler::default();
        assert_eq!(window(&mut s, 30, 8.0), Some(SCALE_STEPS[1]));
        assert_eq!(window(&mut s, 30, 8.0), Some(SCALE_STEPS[2]));
    }

    #[test]
    fn nao_baixa_quando_o_atraso_e_de_cpu() {
        let mut s = ResolutionScaler::default();
        for _ in 0..6 {
            assert_eq!(window(&mut s, 40, 30.0), None);
        }
        for _ in 0..6 {
            assert_eq!(window(&mut s, 5, 8.0), None);
        }
    }

    #[test]
    fn para_no_ultimo_degrau_e_sobe_depois() {
        let mut s = ResolutionScaler::default();
        for _ in 0..10 {
            window(&mut s, 40, 8.0);
        }
        assert_eq!(s.scale(), SCALE_STEPS[3]);
        let mut s = ResolutionScaler::default();
        window(&mut s, 30, 8.0);
        for _ in 0..SCALER.up_after - 1 {
            assert_eq!(window(&mut s, 0, 6.0), None);
        }
        assert_eq!(window(&mut s, 0, 6.0), Some(1.0));
    }

    #[test]
    fn subida_errada_dobra_a_espera() {
        let mut s = ResolutionScaler::default();
        window(&mut s, 30, 8.0);
        for _ in 0..SCALER.up_after {
            window(&mut s, 0, 6.0);
        }
        assert_eq!(s.scale(), 1.0);
        window(&mut s, 30, 8.0);
        assert_eq!(s.scale(), SCALE_STEPS[1]);
        for _ in 0..SCALER.up_after {
            assert_eq!(window(&mut s, 0, 6.0), None);
        }
        for _ in 0..SCALER.up_after {
            window(&mut s, 0, 6.0);
        }
        assert_eq!(s.scale(), 1.0);
    }

    #[test]
    fn ignora_pausas() {
        let mut s = ResolutionScaler::default();
        for _ in 0..500 {
            assert_eq!(s.frame(900.0, 5.0, B), None);
        }
        window(&mut s, 30, 8.0);
        s.reset();
        assert_eq!(s.scale(), 1.0);
    }
}
