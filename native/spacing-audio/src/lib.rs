//! Som do Spacing nativo (porte de `src/audio/` do jogo web; veja docs/design/AUDIO_NATIVO.md).
//!
//! O jogo só usa o [`Sfx`]: `sfx.play(Sound::Hit, 1.0, Some(ponto))`. Ele monta a receita do som e manda pronta para a
//! thread de áudio, que a toca no [`Mixer`]. Sem placa de som (servidor, teste, roteiro) o `Sfx` fica mudo ou só
//! registra o que foi pedido.
mod dsp;
mod mixer;
mod sounds;
mod spatial;

#[cfg(feature = "dispositivo")]
mod dispositivo;

use std::sync::{Arc, Mutex};

pub use dsp::{Biquad, Eco, Filtro, Onda, Osc, Rng};
pub use mixer::{Comando, Gen, Mixer, Voice, MASTER, REVERB};
pub use sounds::{duration, recipe, Kind, Layer, Sound};
pub use spatial::{
    distance_cutoff, distance_gain, equal_power, listener_position, pan, reverb_send, Perfil, Vec3, FAR, HUM, LISTENER_BACK, NEAR,
};

#[cfg(feature = "dispositivo")]
pub use dispositivo::Saida;

/// O que foi pedido ao `Sfx` (para o roteiro conferir que cada ação do jogo faz o som certo).
#[derive(Clone, Debug, PartialEq)]
pub struct Pedido {
    pub som: Sound,
    pub pitch: f32,
    pub at: Option<Vec3>,
}

struct Estado {
    fila: Vec<Comando>,
    ear: Vec3,
    rng: Rng,
    mudo: bool,
    abafo: f32,
    vento: f32,
    dentro: bool,
    pausado: bool,
    proximo: u32,
}

struct Interno {
    sr: f32,
    /// alguém consome a fila (a placa de som ou um `Renderer`)? Se não, os comandos nem são guardados
    vivo: bool,
    estado: Mutex<Estado>,
    registro: Option<Mutex<Vec<Pedido>>>,
}

/// O controle do som que o jogo usa. Barato de copiar (`clone`) e de passar entre threads.
#[derive(Clone, Default)]
pub struct Sfx {
    i: Option<Arc<Interno>>,
}

impl Sfx {
    /// Mudo: tudo é ignorado (jogo sem placa de som, capturas).
    pub fn silent() -> Self {
        Self { i: None }
    }

    /// Não toca, mas guarda cada pedido (`take_log`): para testes e para o roteiro.
    pub fn recording() -> Self {
        Self { i: Some(Arc::new(Interno::novo(48_000.0, false, true))) }
    }

    /// Um `Sfx` ligado a um `Renderer` que você mesmo chama (testes do mixer, gravação de `.wav`), sem placa de som.
    pub fn offline(sample_rate: f32) -> (Sfx, Renderer) {
        let i = Arc::new(Interno::novo(sample_rate, true, true));
        (Sfx { i: Some(i.clone()) }, Renderer { i, mixer: Mixer::new(sample_rate), local: Vec::with_capacity(64) })
    }

    /// Existe uma saída de verdade (ou um `Renderer`) do outro lado?
    pub fn ativo(&self) -> bool {
        self.i.as_ref().is_some_and(|i| i.vivo)
    }

    /// Toca um som. Com `at`, ele sai daquele ponto do mundo e devolve a voz (para mover ou parar); sem `at` é do
    /// capacete: no centro, sem eco, e não devolve voz. Som do mundo longe demais nem toca. `pitch` multiplica a
    /// frequência dos sons tonais.
    pub fn play(&self, som: Sound, pitch: f32, at: Option<Vec3>) -> Option<Voice> {
        self.play_after(som, pitch, at, 0.0)
    }

    /// Como `play`, mas o som só começa daqui a `delay` segundos (o `setTimeout` do jogo web, no relógio da placa).
    pub fn play_after(&self, som: Sound, pitch: f32, at: Option<Vec3>, delay: f32) -> Option<Voice> {
        let i = self.i.as_ref()?;
        let mut e = i.estado.lock().ok()?;
        if e.mudo {
            return None;
        }
        if let Some(p) = at {
            if p.dist(e.ear) >= som.perfil().max {
                return None;
            }
        }
        if let Some(r) = &i.registro {
            if let Ok(mut r) = r.lock() {
                if r.len() < 4096 {
                    r.push(Pedido { som, pitch, at });
                }
            }
        }
        let id = e.proximo;
        e.proximo = e.proximo.wrapping_add(1);
        if i.vivo {
            let mut camadas = recipe(som, pitch, &mut e.rng);
            camadas.iter_mut().for_each(|l| l.delay += delay);
            let gens = camadas.iter().map(|l| Gen::de_camada(l, i.sr, e.rng.next_u32())).collect();
            e.fila.push(Comando::Play { id, gens, at: at.map(|p| (p, som.perfil())) });
        }
        at.map(|_| Voice(id))
    }

    /// Zumbido do módulo de pouso (bombas e ventilação), em laço, no ponto dado.
    pub fn hum(&self, at: Vec3) -> Option<Voice> {
        let i = self.i.as_ref()?;
        let mut e = i.estado.lock().ok()?;
        let id = e.proximo;
        e.proximo = e.proximo.wrapping_add(1);
        if i.vivo {
            let d = [(e.rng.f() - 0.5) * 10.0, (e.rng.f() - 0.5) * 10.0, (e.rng.f() - 0.5) * 10.0];
            let gen = Gen::zumbido(i.sr, e.rng.next_u32(), d);
            e.fila.push(Comando::Loop { id, gen, at, perfil: HUM });
        }
        Some(Voice(id))
    }

    /// Laser da bancada em laço, no ponto dado.
    pub fn laser(&self, at: Vec3) -> Option<Voice> {
        let i = self.i.as_ref()?;
        let mut e = i.estado.lock().ok()?;
        if e.mudo {
            return None;
        }
        let id = e.proximo;
        e.proximo = e.proximo.wrapping_add(1);
        if i.vivo {
            let gen = Gen::laser(i.sr, e.rng.next_u32());
            e.fila.push(Comando::Loop { id, gen, at, perfil: NEAR });
        }
        Some(Voice(id))
    }

    /// Move um som que está tocando (o meteoro em queda).
    pub fn move_voice(&self, v: Voice, at: Vec3) {
        self.manda(Comando::Move { id: v.0, at });
    }

    /// Para um som em laço (some em ~100 ms).
    pub fn stop(&self, v: Voice) {
        self.manda(Comando::Stop { id: v.0 });
    }

    /// Para todos os laços e sons com posição (ao trocar de jogo).
    pub fn stop_all(&self) {
        self.manda(Comando::StopAll);
    }

    /// A cada quadro: onde está o astronauta e para onde a câmera olha (`forward`, horizontal). O ouvinte fica um pouco
    /// atrás do astronauta, do lado da câmera.
    pub fn set_listener(&self, player: [f64; 3], forward: (f64, f64)) {
        let Some(i) = &self.i else { return };
        let Ok(mut e) = i.estado.lock() else { return };
        let p = Vec3::de(player);
        e.ear = p;
        if !i.vivo {
            return;
        }
        let c = Comando::Listener { player: p, forward: (forward.0 as f32, forward.1 as f32) };
        // um pedido de ouvinte por quadro basta: o novo substitui o que ainda não foi consumido
        match e.fila.last_mut() {
            Some(u @ Comando::Listener { .. }) => *u = c,
            _ => e.fila.push(c),
        }
    }

    pub fn set_muted(&self, m: bool) {
        let Some(i) = &self.i else { return };
        if let Ok(mut e) = i.estado.lock() {
            if e.mudo == m {
                return;
            }
            e.mudo = m;
            if i.vivo {
                e.fila.push(Comando::Muted(m));
            }
        }
    }

    /// Abafa o som (0 = normal, 1 = quase só graves), como ouvir de dentro do capacete.
    pub fn set_muffled(&self, a: f32) {
        let Some(i) = &self.i else { return };
        if let Ok(mut e) = i.estado.lock() {
            if (e.abafo - a).abs() < 0.002 {
                return;
            }
            e.abafo = a;
            if i.vivo {
                e.fila.push(Comando::Muffled(a));
            }
        }
    }

    /// Congela todo o som (menu de pausa, app no fundo).
    pub fn set_paused(&self, p: bool) {
        let Some(i) = &self.i else { return };
        if let Ok(mut e) = i.estado.lock() {
            if e.pausado == p {
                return;
            }
            e.pausado = p;
            if i.vivo {
                e.fila.push(Comando::Paused(p));
            }
        }
    }

    /// Dentro (true) ou fora da base: lá fora o fundo da cratera some, o eco encurta e entra a ventilação.
    pub fn set_indoors(&self, d: bool) {
        let Some(i) = &self.i else { return };
        if let Ok(mut e) = i.estado.lock() {
            if e.dentro == d {
                return;
            }
            e.dentro = d;
            if i.vivo {
                e.fila.push(Comando::Indoors(d));
            }
        }
    }

    /// Vento de Marte, 0 (brisa) a 1 (tempestade).
    pub fn set_wind(&self, l: f32) {
        let Some(i) = &self.i else { return };
        if let Ok(mut e) = i.estado.lock() {
            if (e.vento - l).abs() < 0.005 {
                return;
            }
            e.vento = l;
            if i.vivo {
                e.fila.push(Comando::Wind(l));
            }
        }
    }

    /// Há um jogo rodando: liga os sons de fundo (cratera, ventilação, vento).
    pub fn set_world(&self, on: bool) {
        self.manda(Comando::World(on));
    }

    /// O planeta tem ar (Marte): liga o vento e o abafamento do ar ralo.
    pub fn set_air(&self, a: bool) {
        self.manda(Comando::Air(a));
    }

    /// Tira (e esvazia) o registro dos pedidos feitos desde a última vez; vazio se o `Sfx` não registra.
    pub fn take_log(&self) -> Vec<Pedido> {
        let Some(r) = self.i.as_ref().and_then(|i| i.registro.as_ref()) else { return Vec::new() };
        r.lock().map(|mut r| std::mem::take(&mut *r)).unwrap_or_default()
    }

    fn manda(&self, c: Comando) {
        let Some(i) = &self.i else { return };
        if !i.vivo {
            return;
        }
        if let Ok(mut e) = i.estado.lock() {
            e.fila.push(c);
        }
    }
}

impl Interno {
    fn novo(sr: f32, vivo: bool, registra: bool) -> Self {
        Self {
            sr,
            vivo,
            estado: Mutex::new(Estado {
                fila: Vec::with_capacity(64),
                ear: Vec3::default(),
                rng: Rng::new(0x5F3759DF),
                mudo: false,
                abafo: 0.0,
                vento: 0.0,
                dentro: false,
                pausado: false,
                proximo: 1,
            }),
            registro: registra.then(|| Mutex::new(Vec::new())),
        }
    }
}

/// O lado da thread de áudio: pega os comandos que o jogo deixou na fila e toca. A placa de som chama `render`
/// a cada bloco; os testes e o `--som` chamam na mão.
pub struct Renderer {
    i: Arc<Interno>,
    mixer: Mixer,
    local: Vec<Comando>,
}

impl Renderer {
    /// Preenche `out` com quadros estéreo intercalados (L, R, L, R…). Se o jogo estiver escrevendo na fila neste
    /// instante, os comandos novos esperam o próximo bloco (o som nunca trava).
    pub fn render(&mut self, out: &mut [f32]) {
        if let Ok(mut e) = self.i.estado.try_lock() {
            std::mem::swap(&mut e.fila, &mut self.local);
        }
        for c in self.local.drain(..) {
            self.mixer.aplica(c);
        }
        self.mixer.render(out);
    }

    pub fn mixer(&self) -> &Mixer {
        &self.mixer
    }
}

#[cfg(test)]
mod testes;
