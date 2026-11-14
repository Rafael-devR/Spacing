//! A rampa do teste, versão 2 (docs/design/NATIVO.md). Para cada um de quatro números (chamadas de desenho e triângulos, cada um
//! em 60 e em 120 quadros por segundo) procura a **maior carga que ainda cabe**: sobe de 60% em 60% até falhar e depois divide ao
//! meio entre o último que coube e o primeiro que falhou (precisão de uns 3%). Mede a taxa da tela no começo de cada rodada.
//! Faz 3 rodadas e mostra a mediana e o intervalo. A versão em Three.js (`web/three.ts`) segue exatamente estas contas.
//!
//! A tela do celular pode ser adaptativa (só vai a 120 Hz com toque): se a taxa medida ficar abaixo de 100 Hz, os testes de 120 FPS
//! daquela rodada são pulados (não adianta medir 120 numa tela a 60) e a tela pede para mexer o dedo.

/// tempo para a carga nova assentar antes de medir (subir buffers, compilar)
pub const WARMUP_S: f64 = 0.4;
/// tempo medido em cada passo
pub const MEASURE_S: f64 = 1.0;
/// quanto a carga cresce a cada passo da subida
pub const GALLOP: f64 = 1.6;
/// quantas divisões ao meio, no máximo, depois da subida
pub const BISECT_MAX: u32 = 6;
/// quantas vezes o teste todo se repete
pub const ROUNDS: u32 = 3;
/// média do quadro (ms) que ainda conta como 60 e como 120 quadros por segundo (com folga do sincronismo da tela)
pub const MS_60: f64 = 17.5;
pub const MS_120: f64 = 8.8;
/// abaixo desta taxa de tela não se mede 120 FPS
pub const MIN_HZ_120: f64 = 100.0;

/// pedaços de 32 cubos (384 triângulos); a carga é o número de pedaços (chamadas de desenho)
pub const DRAW_START: u32 = 16;
pub const DRAW_MAX: u32 = 16384;
pub const DRAW_CUBES: u32 = 32;
/// 16 pedaços; a carga é quantos cubos cada um tem
pub const TRIS_CHUNKS: u32 = 16;
pub const TRIS_START: u32 = 512;
pub const TRIS_MAX: u32 = 131072;
/// triângulos por cubo (6 faces × 2)
pub const CUBE_TRIS: u64 = 12;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Draws60,
    Draws120,
    Tris60,
    Tris120,
}

pub const KINDS: [Kind; 4] = [Kind::Draws60, Kind::Draws120, Kind::Tris60, Kind::Tris120];

impl Kind {
    pub fn index(self) -> usize {
        self as usize
    }
    pub fn is_draws(self) -> bool {
        matches!(self, Kind::Draws60 | Kind::Draws120)
    }
    pub fn is_120(self) -> bool {
        matches!(self, Kind::Draws120 | Kind::Tris120)
    }
    pub fn target_ms(self) -> f64 {
        if self.is_120() { MS_120 } else { MS_60 }
    }
    pub fn start(self) -> u32 {
        if self.is_draws() { DRAW_START } else { TRIS_START }
    }
    pub fn max(self) -> u32 {
        if self.is_draws() { DRAW_MAX } else { TRIS_MAX }
    }
    /// o mesmo tipo na meta de 60 FPS (a de 120 nunca passa dela)
    fn at_60(self) -> Kind {
        if self.is_draws() { Kind::Draws60 } else { Kind::Tris60 }
    }
    /// carga (nível) → número que a tela mostra: chamadas de desenho ou triângulos
    pub fn amount(self, level: u32) -> u64 {
        if self.is_draws() { level as u64 } else { TRIS_CHUNKS as u64 * level as u64 * CUBE_TRIS }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    /// cena vazia: descobre a taxa da tela (60, 90, 120 Hz…)
    Refresh,
    Search(Kind),
    Done,
}

#[derive(Clone, Debug)]
pub struct Ramp {
    pub phase: Phase,
    /// rodada atual (0, 1, 2…)
    pub round: u32,
    /// carga do passo atual: pedaços (chamadas de desenho) ou cubos por pedaço (triângulos)
    pub level: u32,
    t: f64,
    sum_ms: f64,
    frames: u32,
    /// média do último passo medido
    pub last_ms: f64,
    /// taxa da tela medida no começo da rodada atual
    pub hz: f64,
    /// a tela estava abaixo de 100 Hz nesta rodada: os testes de 120 FPS foram pulados
    pub no120: bool,
    lo: u32,
    hi: Option<u32>,
    iter: u32,
    /// resultado da rodada atual, por `Kind` (nível que coube; `None` = ainda não medido ou pulado)
    cur: [Option<u32>; 4],
    /// rodadas já terminadas
    pub rounds: Vec<[Option<u32>; 4]>,
}

impl Default for Ramp {
    fn default() -> Self {
        Self::new()
    }
}

impl Ramp {
    pub fn new() -> Self {
        Self {
            phase: Phase::Refresh,
            round: 0,
            level: 0,
            t: 0.0,
            sum_ms: 0.0,
            frames: 0,
            last_ms: 0.0,
            hz: 0.0,
            no120: false,
            lo: 0,
            hi: None,
            iter: 0,
            cur: [None; 4],
            rounds: Vec::new(),
        }
    }

    /// a cena que o passo atual pede: (chamadas de desenho, cubos por chamada)
    pub fn load(&self) -> (u32, u32) {
        match self.phase {
            Phase::Search(k) if k.is_draws() => (self.level, DRAW_CUBES),
            Phase::Search(_) => (TRIS_CHUNKS, self.level),
            Phase::Refresh | Phase::Done => (0, 0),
        }
    }

    /// triângulos desenhados por quadro no passo atual
    pub fn triangles(&self) -> u64 {
        let (d, c) = self.load();
        d as u64 * c as u64 * CUBE_TRIS
    }

    /// o que está sendo medido agora
    pub fn kind(&self) -> Option<Kind> {
        if let Phase::Search(k) = self.phase { Some(k) } else { None }
    }

    /// (mediana, menor, maior) do nível que coube em `k`, entre as rodadas terminadas e a atual
    pub fn stats(&self, k: Kind) -> Option<(u32, u32, u32)> {
        let mut v: Vec<u32> = self.rounds.iter().filter_map(|r| r[k.index()]).collect();
        if let Some(c) = self.cur[k.index()] {
            v.push(c);
        }
        if v.is_empty() {
            return None;
        }
        v.sort_unstable();
        Some((v[v.len() / 2], v[0], v[v.len() - 1]))
    }

    fn begin(&mut self, k: Kind) {
        self.phase = Phase::Search(k);
        self.lo = 0;
        self.hi = None;
        self.iter = 0;
        let mut start = k.start();
        if k.is_120() {
            // a capacidade em 120 nunca passa da de 60: começa mais perto dela
            start = start.max(self.cur[k.at_60().index()].unwrap_or(0) / 6);
        }
        self.level = start.min(k.max());
    }

    fn next_after(&mut self, k: Kind) {
        let next = match k {
            Kind::Draws60 => Some(Kind::Draws120),
            Kind::Draws120 => Some(Kind::Tris60),
            Kind::Tris60 => Some(Kind::Tris120),
            Kind::Tris120 => None,
        };
        match next {
            Some(n) if n.is_120() && self.no120 => {
                self.cur[n.index()] = None;
                self.next_after(n);
            }
            Some(n) => self.begin(n),
            None => {
                self.rounds.push(self.cur);
                self.cur = [None; 4];
                self.round += 1;
                self.level = 0;
                self.phase = if self.round >= ROUNDS { Phase::Done } else { Phase::Refresh };
            }
        }
    }

    fn finish(&mut self, k: Kind) {
        self.cur[k.index()] = Some(self.lo);
        self.next_after(k);
    }

    fn bisect_or_finish(&mut self, k: Kind) {
        let hi = self.hi.unwrap_or(self.level);
        if self.iter >= BISECT_MAX || hi - self.lo <= (self.lo / 32).max(1) {
            self.finish(k);
        } else {
            self.level = self.lo + (hi - self.lo) / 2;
        }
    }

    fn step(&mut self, k: Kind, avg: f64) {
        let pass = avg <= k.target_ms();
        if self.hi.is_none() {
            // subida
            if pass {
                self.lo = self.level;
                if self.level >= k.max() {
                    self.finish(k);
                } else {
                    self.level = ((self.level as f64 * GALLOP).ceil() as u32).min(k.max());
                }
            } else {
                self.hi = Some(self.level);
                self.iter = 0;
                self.bisect_or_finish(k);
            }
        } else {
            // divisão ao meio
            if pass {
                self.lo = self.level;
            } else {
                self.hi = Some(self.level);
            }
            self.iter += 1;
            self.bisect_or_finish(k);
        }
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
                self.no120 = self.hz < MIN_HZ_120;
                self.begin(Kind::Draws60);
            }
            Phase::Search(k) => self.step(k, avg),
            Phase::Done => {}
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// roda a rampa com um "aparelho": `cost(tipo, carga)` em ms por quadro, com piso na taxa da tela
    fn run(hz: f64, cost: impl Fn(&Ramp) -> f64) -> Ramp {
        let mut r = Ramp::new();
        let floor = 1000.0 / hz;
        for _ in 0..2_000_000 {
            let ms = cost(&r).max(floor);
            r.frame(ms / 1000.0);
            if r.phase == Phase::Done {
                break;
            }
        }
        r
    }

    /// 1 ms a cada 400 chamadas de desenho, e a cada 500 mil triângulos
    fn device(r: &Ramp) -> f64 {
        match r.phase {
            Phase::Search(k) if k.is_draws() => r.level as f64 / 400.0,
            Phase::Search(_) => r.triangles() as f64 / 500_000.0,
            _ => 0.0,
        }
    }

    fn near(v: u32, truth: f64) -> bool {
        (v as f64) <= truth * 1.001 && (v as f64) >= truth * 0.94
    }

    #[test]
    fn acha_o_limite_com_precisao_e_termina() {
        let r = run(120.0, device);
        assert_eq!(r.phase, Phase::Done);
        assert_eq!(r.rounds.len(), ROUNDS as usize);
        assert!((r.hz - 120.0).abs() < 0.5);
        for (k, truth) in [
            (Kind::Draws60, 17.5 * 400.0),
            (Kind::Draws120, 8.8 * 400.0),
            (Kind::Tris60, 17.5 * 500_000.0 / (TRIS_CHUNKS as f64 * CUBE_TRIS as f64)),
            (Kind::Tris120, 8.8 * 500_000.0 / (TRIS_CHUNKS as f64 * CUBE_TRIS as f64)),
        ] {
            let (med, lo, hi) = r.stats(k).expect("tem resultado");
            assert!(near(med, truth), "{k:?}: {med} (verdade {truth})");
            assert!(lo <= med && med <= hi);
        }
    }

    #[test]
    fn tela_a_60_hz_pula_os_testes_de_120() {
        let r = run(60.0, device);
        assert_eq!(r.phase, Phase::Done);
        assert!(r.no120);
        assert!(r.stats(Kind::Draws120).is_none());
        assert!(r.stats(Kind::Tris120).is_none());
        assert!(r.stats(Kind::Draws60).is_some());
    }

    #[test]
    fn aparelho_infinito_chega_no_teto() {
        let r = run(120.0, |_| 0.0);
        assert_eq!(r.stats(Kind::Draws60).unwrap().0, DRAW_MAX);
        assert_eq!(r.stats(Kind::Tris120).unwrap().0, TRIS_MAX);
    }

    #[test]
    fn aparelho_que_falha_ja_no_primeiro_passo_nao_trava() {
        let r = run(120.0, |r| if r.kind().is_some() { 100.0 } else { 0.0 });
        assert_eq!(r.phase, Phase::Done);
        assert_eq!(r.stats(Kind::Draws60).unwrap().0, 0);
    }

    #[test]
    fn mediana_de_tres_rodadas() {
        let mut r = Ramp::new();
        r.rounds = vec![[Some(10), None, None, None], [Some(30), None, None, None]];
        r.cur[0] = Some(20);
        assert_eq!(r.stats(Kind::Draws60), Some((20, 10, 30)));
    }
}
