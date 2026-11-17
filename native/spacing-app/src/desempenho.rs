//! Teste de desempenho nativo (docs/design/BENCHMARK_NATIVO.md): sete cenários rodados sozinhos, sempre iguais, que medem o
//! tempo de cada quadro. Só observa: o `Teste` empurra a entrada do jogador (joystick, câmera, meteoro, blocos quebrados) e
//! guarda os tempos; quem trava o salvamento, silencia o som e recarrega o jogo no fim é o `lib.rs`.
use spacing_core::blocks::AIR;
use spacing_core::interaction::{Ctx, Interaction, Target};
use spacing_core::rules::Events;
use spacing_core::world::VoxelHit;

use crate::controls::Controls;
use crate::game::Game;

/// o que o cenário faz
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Acao {
    Parado,
    Circulo,
    Girar,
    Zoom,
    Quebrar,
    Meteoros,
    Tudo,
}

pub struct Cena {
    pub nome: &'static str,
    /// duração em segundos (com o aquecimento)
    pub s: f64,
    pub acao: Acao,
}

pub const CENAS: [Cena; 7] = [
    Cena { nome: "Parado olhando", s: 5.0, acao: Acao::Parado },
    Cena { nome: "Andar em círculo", s: 7.0, acao: Acao::Circulo },
    Cena { nome: "Girar a câmera", s: 6.0, acao: Acao::Girar },
    Cena { nome: "Zoom dentro e fora", s: 6.0, acao: Acao::Zoom },
    Cena { nome: "Quebrar blocos", s: 8.0, acao: Acao::Quebrar },
    Cena { nome: "Meteoros", s: 8.0, acao: Acao::Meteoros },
    Cena { nome: "Tudo ao mesmo tempo", s: 8.0, acao: Acao::Tudo },
];

/// o começo de cada cenário não conta (carrega pedaços do mundo, compila o que falta)
pub const AQUECE: f64 = 1.5;
/// blocos quebrados por segundo no cenário "Quebrar blocos" e no "Tudo ao mesmo tempo"
const QUEBRA_S: f64 = 20.0;
const QUEBRA_TUDO_S: f64 = 15.0;
/// segundos entre um meteoro e outro
const METEORO_S: f64 = 0.9;
const METEORO_TUDO_S: f64 = 1.2;

/// as contas de um cenário (tempos em ms)
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Medida {
    pub nome: String,
    pub quadros: usize,
    pub fps: f64,
    pub media: f64,
    pub mediana: f64,
    pub p95: f64,
    pub p99: f64,
    pub max: f64,
    /// média da diferença entre quadros vizinhos: a irregularidade
    pub jitter: f64,
    /// % de quadros acima de 1,5× o período de 60 e de 120 FPS
    pub perdidos60: f64,
    pub perdidos120: f64,
    /// tempo de CPU do quadro (o que o jogo gasta antes de entregar à placa)
    pub cpu: f64,
}

impl Medida {
    /// 99% dentro de 1,5× o período, no máximo 1% de quadros perdidos e FPS de pelo menos 95% do alvo
    pub fn sustenta(&self, alvo: f64) -> bool {
        let periodo = 1000.0 / alvo;
        let perdidos = if alvo >= 100.0 { self.perdidos120 } else { self.perdidos60 };
        self.quadros > 0 && self.p99 <= 1.5 * periodo && perdidos <= 1.0 && self.fps >= 0.95 * alvo
    }
}

/// o valor no percentil `p` (0..1) de uma lista já ordenada (posto mais próximo)
fn percentil(ordenado: &[f64], p: f64) -> f64 {
    if ordenado.is_empty() {
        return 0.0;
    }
    let i = ((ordenado.len() as f64 * p).ceil() as usize).clamp(1, ordenado.len()) - 1;
    ordenado[i]
}

/// Mede um cenário a partir dos tempos de quadro (segundos) e do tempo de CPU de cada um (ms).
pub fn medir(nome: &str, dts: &[f32], cpus: &[f32]) -> Medida {
    if dts.is_empty() {
        return Medida { nome: nome.into(), ..Default::default() };
    }
    let ms: Vec<f64> = dts.iter().map(|d| *d as f64 * 1000.0).collect();
    let mut ord = ms.clone();
    ord.sort_by(|a, b| a.total_cmp(b));
    let media = ms.iter().sum::<f64>() / ms.len() as f64;
    let jitter = if ms.len() > 1 { ms.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f64>() / (ms.len() - 1) as f64 } else { 0.0 };
    let acima = |lim: f64| 100.0 * ms.iter().filter(|m| **m > lim).count() as f64 / ms.len() as f64;
    let cpu = if cpus.is_empty() { 0.0 } else { cpus.iter().map(|c| *c as f64).sum::<f64>() / cpus.len() as f64 };
    Medida {
        nome: nome.into(),
        quadros: ms.len(),
        fps: if media > 0.0 { 1000.0 / media } else { 0.0 },
        media,
        mediana: percentil(&ord, 0.5),
        p95: percentil(&ord, 0.95),
        p99: percentil(&ord, 0.99),
        max: *ord.last().unwrap_or(&0.0),
        jitter,
        perdidos60: acima(1.5 * 1000.0 / 60.0),
        perdidos120: acima(1.5 * 1000.0 / 120.0),
        cpu,
    }
}

/// o ambiente da medida (vai no arquivo e no painel)
pub struct Ambiente {
    pub placa: String,
    pub tela: (u32, u32),
    pub cena: (u32, u32),
    pub msaa: u32,
    pub apresentacao: String,
    pub planeta: &'static str,
}

pub struct Teste {
    cena: usize,
    t: f64,
    dts: Vec<f32>,
    cpus: Vec<f32>,
    pub medidas: Vec<Medida>,
    pub feito: bool,
    /// 1 = a duração de verdade; menos que isso acelera (só o roteiro de teste usa)
    k: f64,
    meteoro_t: f64,
    quebra_acc: f64,
    rng: u32,
    /// o cenário mudou neste quadro
    novo_cenario: bool,
}

impl Default for Teste {
    fn default() -> Self {
        Self::novo()
    }
}

impl Teste {
    pub fn novo() -> Self {
        Self::com_escala(1.0)
    }

    /// `k` encurta todas as durações (o roteiro de teste roda com 0,1)
    pub fn com_escala(k: f64) -> Self {
        Self { cena: 0, t: 0.0, dts: Vec::new(), cpus: Vec::new(), medidas: Vec::new(), feito: false, k, meteoro_t: 0.0, quebra_acc: 0.0, rng: 0x2545_F491, novo_cenario: true }
    }

    /// Um quadro. `dt` = tempo real do quadro que acabou de passar; `cpu_ms` = o que o jogo gastou nele. Guarda a medida e
    /// empurra a entrada do **próximo** quadro (antes do `game.update`).
    pub fn quadro(&mut self, dt: f64, cpu_ms: f64, g: &mut Game, c: &mut Controls) {
        if self.feito {
            return;
        }
        if !self.novo_cenario && self.t >= AQUECE * self.k {
            self.dts.push(dt as f32);
            self.cpus.push(cpu_ms as f32);
        }
        self.novo_cenario = false;
        self.t += dt;
        if self.t >= CENAS[self.cena].s * self.k {
            self.medidas.push(medir(CENAS[self.cena].nome, &self.dts, &self.cpus));
            self.dts.clear();
            self.cpus.clear();
            self.cena += 1;
            self.t = 0.0;
            self.meteoro_t = 0.0;
            self.quebra_acc = 0.0;
            self.novo_cenario = true;
            c.scripted = None;
            if self.cena >= CENAS.len() {
                self.feito = true;
                return;
            }
        }
        self.dirige(dt, g, c);
    }

    /// o que o jogador faria neste quadro
    fn dirige(&mut self, dt: f64, g: &mut Game, c: &mut Controls) {
        // o astronauta não morre durante o teste (só na memória: o salvamento está travado)
        g.survival.o2 = 100.0;
        g.survival.battery = 100.0;
        g.survival.integrity = 100.0;
        g.survival.energy = 100.0;
        let t = self.t;
        let acao = CENAS[self.cena].acao;
        let circulo = matches!(acao, Acao::Circulo | Acao::Tudo);
        c.scripted = circulo.then(|| ((t * 1.1).sin(), (t * 1.1).cos()));
        match acao {
            Acao::Girar => {
                // uma volta a cada 5 s
                let d = dt * std::f64::consts::TAU / 5.0;
                g.rig.yaw += d;
                g.rig.yaw_target += d;
            }
            Acao::Zoom => c.actions.zoom = if c.actions.zoom == 0.0 { 1.0 } else { c.actions.zoom } * (2.0 * dt * (t * 1.5).cos()).exp(),
            _ => {}
        }
        let (quebra, meteoro) = match acao {
            Acao::Quebrar => (QUEBRA_S, 0.0),
            Acao::Meteoros => (0.0, METEORO_S),
            Acao::Tudo => (QUEBRA_TUDO_S, METEORO_TUDO_S),
            _ => (0.0, 0.0),
        };
        if quebra > 0.0 {
            self.quebra_acc += quebra * dt;
            while self.quebra_acc >= 1.0 {
                self.quebra_acc -= 1.0;
                g.bench_quebrar(&mut self.rng);
            }
        }
        if meteoro > 0.0 {
            self.meteoro_t += dt;
            if self.meteoro_t >= meteoro {
                self.meteoro_t -= meteoro;
                c.actions.meteor = true;
            }
        }
    }

    /// o aviso no alto durante o teste
    pub fn rotulo(&self) -> String {
        let falta: f64 = CENAS.iter().skip(self.cena).map(|c| c.s * self.k).sum::<f64>() - self.t;
        let nome = CENAS.get(self.cena).map_or("", |c| c.nome);
        format!("Teste de desempenho: {nome} ({}/{}), faltam {:.0} s. Abrir a Pausa cancela.", self.cena + 1, CENAS.len(), falta.max(0.0))
    }

    /// o resultado em linhas de texto (o painel do HUD); `anterior` = o resultado do teste de antes, para comparar
    pub fn linhas(&self, amb: &Ambiente, anterior: Option<&[Medida]>) -> Vec<String> {
        let mut v = vec![format!(
            "teste de desempenho: {} · tela {}×{} · cena {}×{} · MSAA {}× · {} · {}",
            amb.placa, amb.tela.0, amb.tela.1, amb.cena.0, amb.cena.1, amb.msaa, amb.apresentacao, amb.planeta
        )];
        for m in &self.medidas {
            let mut l = format!("{}: {:.0} FPS · 99% {:.1} ms · máx {:.0} ms · perdidos {:.1}% · CPU {:.1} ms", m.nome, m.fps, m.p99, m.max, m.perdidos60, m.cpu);
            if let Some(a) = anterior.and_then(|a| a.iter().find(|a| a.nome == m.nome)) {
                if a.fps > 0.0 {
                    l.push_str(&format!(" (antes {:.0} FPS, {:+.0}%)", a.fps, (m.fps / a.fps - 1.0) * 100.0));
                }
            }
            v.push(l);
        }
        for alvo in [60.0, 120.0] {
            let falha: Vec<&str> = self.medidas.iter().filter(|m| !m.sustenta(alvo)).map(|m| m.nome.as_str()).collect();
            v.push(if falha.is_empty() { format!("sustenta {alvo:.0} FPS em todos os cenários") } else { format!("não sustenta {alvo:.0} FPS em: {}", falha.join(", ")) });
        }
        v.into_iter().map(|l| l.replace('.', ",")).collect()
    }

    /// o resultado como JSON (guardado em `desempenho/`)
    pub fn json(&self, amb: &Ambiente, quando_ms: f64) -> serde_json::Value {
        let cenas: Vec<_> = self
            .medidas
            .iter()
            .map(|m| {
                serde_json::json!({
                    "nome": m.nome, "quadros": m.quadros, "fps": m.fps, "media_ms": m.media, "mediana_ms": m.mediana,
                    "p95_ms": m.p95, "p99_ms": m.p99, "max_ms": m.max, "jitter_ms": m.jitter,
                    "perdidos60_pct": m.perdidos60, "perdidos120_pct": m.perdidos120, "cpu_ms": m.cpu,
                    "sustenta60": m.sustenta(60.0), "sustenta120": m.sustenta(120.0),
                })
            })
            .collect();
        serde_json::json!({
            "versao": env!("CARGO_PKG_VERSION"),
            "quando_ms": quando_ms,
            "ambiente": {
                "placa": amb.placa, "tela": [amb.tela.0, amb.tela.1], "cena": [amb.cena.0, amb.cena.1], "msaa": amb.msaa,
                "apresentacao": amb.apresentacao, "planeta": amb.planeta, "android": cfg!(target_os = "android"),
            },
            "cenas": cenas,
        })
    }
}

/// lê as medidas de um resultado guardado (para comparar com o novo)
pub fn ler_medidas(v: &serde_json::Value) -> Vec<Medida> {
    v["cenas"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|c| Medida {
                    nome: c["nome"].as_str().unwrap_or("").to_string(),
                    quadros: c["quadros"].as_u64().unwrap_or(0) as usize,
                    fps: c["fps"].as_f64().unwrap_or(0.0),
                    p99: c["p99_ms"].as_f64().unwrap_or(0.0),
                    ..Default::default()
                })
                .collect()
        })
        .unwrap_or_default()
}

impl Game {
    /// Quebra um bloco do chão por perto, pelo mesmo caminho da broca (destroços, partículas, itens e o evento). Só o teste
    /// de desempenho chama. Não cava embaixo do astronauta.
    pub fn bench_quebrar(&mut self, rng: &mut u32) {
        let mut sorteia = |n: u32| {
            *rng ^= *rng << 13;
            *rng ^= *rng >> 17;
            *rng ^= *rng << 5;
            (*rng % n) as i32
        };
        let (dx, dz) = (sorteia(13) - 6, sorteia(13) - 6);
        if dx.abs() <= 1 && dz.abs() <= 1 {
            return;
        }
        let p = self.player.pos;
        let (x, z) = (p[0].floor() as i32 + dx, p[2].floor() as i32 + dz);
        let y = self.world.top_y(x, z);
        let id = self.world.get_block(x, y, z);
        if id == AIR {
            return;
        }
        let alvo = Target::Block(VoxelHit { x, y, z, id, normal: [0, 1, 0], t: 0.0 });
        let mut ev = Events::new();
        {
            let mut cx = Ctx {
                world: &mut self.world,
                player: &mut self.player,
                inv: &mut self.inv,
                debris: &mut self.debris,
                drops: &mut self.drops,
                particles: &mut self.particles,
                ev: &mut ev,
            };
            Interaction::break_target(&alvo, &mut cx);
        }
        self.react(ev);
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn lote(ms: &[f32]) -> Vec<f32> {
        ms.iter().map(|m| m / 1000.0).collect()
    }

    #[test]
    fn quadros_regulares_a_120() {
        let m = medir("a", &lote(&[8.33; 240]), &[2.0; 240]);
        assert!((m.fps - 120.0).abs() < 0.5, "{}", m.fps);
        assert!(m.jitter < 0.01 && m.perdidos60 == 0.0 && m.perdidos120 == 0.0);
        assert!((m.cpu - 2.0).abs() < 1e-6);
        assert!(m.sustenta(120.0) && m.sustenta(60.0));
    }

    #[test]
    fn trancos_aparecem_no_99_e_nos_perdidos() {
        // 97 quadros de 8,3 ms e 3 de 60 ms
        let mut v = vec![8.33f32; 97];
        v.extend([60.0; 3]);
        let m = medir("a", &lote(&v), &[]);
        assert_eq!(m.quadros, 100);
        assert!((m.perdidos120 - 3.0).abs() < 1e-9 && (m.perdidos60 - 3.0).abs() < 1e-9, "{} {}", m.perdidos120, m.perdidos60);
        assert!((m.max - 60.0).abs() < 1e-3);
        assert!(m.p99 > 50.0 && m.mediana < 9.0);
        assert!(!m.sustenta(120.0) && !m.sustenta(60.0));
    }

    #[test]
    fn sessenta_fluido_nao_sustenta_cento_e_vinte() {
        let m = medir("a", &lote(&[16.67; 200]), &[]);
        assert!(m.sustenta(60.0) && !m.sustenta(120.0));
        // o jitter de um 60 irregular (8,3 / 25 alternando) é alto
        let v: Vec<f32> = (0..200).map(|i| if i % 2 == 0 { 8.33 } else { 25.0 }).collect();
        assert!(medir("a", &lote(&v), &[]).jitter > 16.0);
    }

    #[test]
    fn sem_quadros_nao_sustenta() {
        let m = medir("a", &[], &[]);
        assert_eq!(m.quadros, 0);
        assert!(!m.sustenta(60.0));
    }

    #[test]
    fn json_volta_a_ser_lido() {
        let mut t = Teste::novo();
        t.medidas.push(medir("Parado olhando", &lote(&[10.0; 100]), &[3.0; 100]));
        let amb = Ambiente { placa: "teste".into(), tela: (1, 1), cena: (1, 1), msaa: 4, apresentacao: "Fifo".into(), planeta: "Lua" };
        let v = t.json(&amb, 1.0);
        let lidas = ler_medidas(&v);
        assert_eq!(lidas.len(), 1);
        assert_eq!(lidas[0].nome, "Parado olhando");
        assert!((lidas[0].fps - 100.0).abs() < 0.1);
        let linhas = t.linhas(&amb, Some(&lidas));
        assert!(linhas.iter().any(|l| l.contains("antes 100 FPS")), "{linhas:?}");
    }

    #[test]
    fn as_cenas_somam_menos_de_um_minuto() {
        let total: f64 = CENAS.iter().map(|c| c.s).sum();
        assert!((40.0..60.0).contains(&total), "{total}");
    }
}
