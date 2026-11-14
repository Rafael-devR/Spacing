//! A rampa do teste (docs/design/NATIVO.md). Mede a taxa da tela com a cena vazia; depois sobe a carga em degraus de 25% até
//! a média do quadro passar de 60 Hz, primeiro em **chamadas de desenho** (muitos pedaços pequenos, como os chunks do jogo) e
//! depois em **triângulos** (poucos pedaços enormes). Guarda o maior degrau que coube em 60 e em 120 quadros por segundo.
//! A versão em Three.js (`web/three.ts`) segue exatamente estes números.

/// tempo para a carga nova assentar antes de medir (subir buffers, compilar)
pub const WARMUP_S: f64 = 0.6;
/// tempo medido em cada degrau
pub const MEASURE_S: f64 = 1.5;
/// quanto a carga cresce a cada degrau
pub const STEP: f64 = 1.25;
/// média do quadro (ms) que ainda conta como 60 e como 120 quadros por segundo (com folga do sincronismo da tela)
pub const MS_60: f64 = 17.5;
pub const MS_120: f64 = 8.8;

/// fase 1: pedaços de 32 cubos (384 triângulos), começando com 16 e indo até 16 384 chamadas de desenho
pub const DRAW_START: u32 = 16;
pub const DRAW_MAX: u32 = 16384;
pub const DRAW_CUBES: u32 = 32;
/// fase 2: 16 pedaços, cada um com cada vez mais cubos (de 512 até 131 072 cubos, ou 25 milhões de triângulos no total)
pub const TRIS_CHUNKS: u32 = 16;
pub const TRIS_START: u32 = 512;
pub const TRIS_MAX: u32 = 131072;
/// triângulos por cubo (6 faces × 2)
pub const CUBE_TRIS: u64 = 12;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    /// cena vazia: descobre a taxa da tela (60, 90, 120 Hz…)
    Refresh,
    Draws,
    Tris,
    Done,
}

#[derive(Clone, Debug)]
pub struct Ramp {
    pub phase: Phase,
    /// chamadas de desenho (fase Draws) ou cubos por pedaço (fase Tris)
    pub level: u32,
    t: f64,
    sum_ms: f64,
    frames: u32,
    /// média do último degrau medido
    pub last_ms: f64,
    pub hz: f64,
    pub draws60: u32,
    pub draws120: u32,
    pub tris60: u64,
    pub tris120: u64,
}

impl Default for Ramp {
    fn default() -> Self {
        Self::new()
    }
}

fn next(level: u32, max: u32) -> u32 {
    ((level as f64 * STEP).ceil() as u32).min(max)
}

impl Ramp {
    pub fn new() -> Self {
        Self {
            phase: Phase::Refresh,
            level: 0,
            t: 0.0,
            sum_ms: 0.0,
            frames: 0,
            last_ms: 0.0,
            hz: 0.0,
            draws60: 0,
            draws120: 0,
            tris60: 0,
            tris120: 0,
        }
    }

    /// a cena que o degrau atual pede: (chamadas de desenho, cubos por chamada)
    pub fn load(&self) -> (u32, u32) {
        match self.phase {
            Phase::Draws => (self.level, DRAW_CUBES),
            Phase::Tris => (TRIS_CHUNKS, self.level),
            Phase::Refresh | Phase::Done => (0, 0),
        }
    }

    /// triângulos desenhados por quadro no degrau atual
    pub fn triangles(&self) -> u64 {
        let (d, c) = self.load();
        d as u64 * c as u64 * CUBE_TRIS
    }

    /// Conta um quadro de `dt` segundos. Devolve `true` quando a carga mudou (refazer a cena).
    pub fn frame(&mut self, dt: f64) -> bool {
        if self.phase == Phase::Done {
            return false;
        }
        self.t += dt;
        if self.t < WARMUP_S {
            return false;
        }
        self.sum_ms += dt * 1000.0;
        self.frames += 1;
        if self.t < WARMUP_S + MEASURE_S {
            return false;
        }
        let avg = self.sum_ms / self.frames as f64;
        self.last_ms = avg;
        self.t = 0.0;
        self.sum_ms = 0.0;
        self.frames = 0;
        match self.phase {
            Phase::Refresh => {
                self.hz = 1000.0 / avg;
                self.phase = Phase::Draws;
                self.level = DRAW_START;
            }
            Phase::Draws => {
                if avg <= MS_120 {
                    self.draws120 = self.level;
                }
                let n = next(self.level, DRAW_MAX);
                if avg <= MS_60 {
                    self.draws60 = self.level;
                    if n != self.level {
                        self.level = n;
                        return true;
                    }
                }
                self.phase = Phase::Tris;
                self.level = TRIS_START;
            }
            Phase::Tris => {
                let tris = self.triangles();
                if avg <= MS_120 {
                    self.tris120 = tris;
                }
                let n = next(self.level, TRIS_MAX);
                if avg <= MS_60 {
                    self.tris60 = tris;
                    if n != self.level {
                        self.level = n;
                        return true;
                    }
                }
                self.phase = Phase::Done;
                self.level = 0;
            }
            Phase::Done => {}
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// roda a rampa com um "aparelho" que leva `ms(carga)` por quadro
    fn run(ms: impl Fn(&Ramp) -> f64) -> Ramp {
        let mut r = Ramp::new();
        for _ in 0..200_000 {
            let dt = ms(&r) / 1000.0;
            r.frame(dt);
            if r.phase == Phase::Done {
                break;
            }
        }
        r
    }

    #[test]
    fn mede_a_tela_e_termina() {
        let r = run(|_| 1000.0 / 120.0);
        assert_eq!(r.phase, Phase::Done);
        assert!((r.hz - 120.0).abs() < 0.5);
        // aparelho infinito: chega no teto das duas fases
        assert_eq!(r.draws60, DRAW_MAX);
        assert_eq!(r.draws120, DRAW_MAX);
        assert_eq!(r.tris60, TRIS_CHUNKS as u64 * TRIS_MAX as u64 * CUBE_TRIS);
    }

    #[test]
    fn para_no_degrau_que_passou_de_60() {
        // 1 ms a cada 100 chamadas de desenho, 1 ms a cada 100 mil triângulos, piso de 8,3 ms (tela de 120 Hz)
        let r = run(|r| match r.phase {
            Phase::Draws => (r.level as f64 / 100.0).max(8.3),
            Phase::Tris => (r.triangles() as f64 / 100_000.0).max(8.3),
            _ => 8.3,
        });
        assert!(r.draws60 <= 1750 && r.draws60 > 1750 / 2, "{}", r.draws60);
        assert!(r.draws120 <= 880 && r.draws120 > 880 / 2, "{}", r.draws120);
        assert!(r.tris60 <= 1_750_000 && r.tris60 > 1_750_000 / 2, "{}", r.tris60);
    }

    #[test]
    fn tela_de_60_hz_nao_tem_resultado_em_120() {
        let r = run(|_| 1000.0 / 60.0);
        assert_eq!(r.draws120, 0);
        assert_eq!(r.tris120, 0);
        assert!(r.draws60 > 0);
    }
}
