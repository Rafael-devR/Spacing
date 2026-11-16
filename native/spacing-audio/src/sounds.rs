//! A receita de cada som: camadas de tom (oscilador com varredura de frequência) e de ruído (ruído filtrado com
//! varredura de corte), cada uma com seu envelope e seu atraso. É o `play()` de `src/audio/Sfx.ts`, camada por camada;
//! onde o TS usa `setTimeout`, aqui a camada tem `delay` (segundos), contado pelo relógio da placa de som.
use crate::dsp::{Filtro, Onda, Rng};
use crate::spatial::{Perfil, FAR, NEAR};

/// Os sons do jogo (os mesmos nomes do `SoundName` do TS).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Sound {
    Hit,
    Break,
    Pop,
    Step,
    Land,
    Jump,
    Place,
    Deny,
    Ui,
    Clink,
    Kick,
    Whoosh,
    Boom,
    Chime,
    Beep,
    Alarm,
    Breath,
    Heartbeat,
    Hurt,
    Death,
    Respawn,
    Charge,
    PowerDown,
    PickupBig,
    Door,
    Pressurize,
    Depressurize,
    Rest,
    CraftDone,
    Equip,
    TabletOpen,
    TabletClose,
    // Marte
    Rumble,
    Sizzle,
    Gust,
}

impl Sound {
    pub const TODOS: [Sound; 35] = [
        Sound::Hit,
        Sound::Break,
        Sound::Pop,
        Sound::Step,
        Sound::Land,
        Sound::Jump,
        Sound::Place,
        Sound::Deny,
        Sound::Ui,
        Sound::Clink,
        Sound::Kick,
        Sound::Whoosh,
        Sound::Boom,
        Sound::Chime,
        Sound::Beep,
        Sound::Alarm,
        Sound::Breath,
        Sound::Heartbeat,
        Sound::Hurt,
        Sound::Death,
        Sound::Respawn,
        Sound::Charge,
        Sound::PowerDown,
        Sound::PickupBig,
        Sound::Door,
        Sound::Pressurize,
        Sound::Depressurize,
        Sound::Rest,
        Sound::CraftDone,
        Sound::Equip,
        Sound::TabletOpen,
        Sound::TabletClose,
        Sound::Rumble,
        Sound::Sizzle,
        Sound::Gust,
    ];

    /// o nome do TS (`SoundName`), para os arquivos de teste e o registro do roteiro
    pub fn nome(self) -> &'static str {
        use Sound::*;
        match self {
            Hit => "hit",
            Break => "break",
            Pop => "pop",
            Step => "step",
            Land => "land",
            Jump => "jump",
            Place => "place",
            Deny => "deny",
            Ui => "ui",
            Clink => "clink",
            Kick => "kick",
            Whoosh => "whoosh",
            Boom => "boom",
            Chime => "chime",
            Beep => "beep",
            Alarm => "alarm",
            Breath => "breath",
            Heartbeat => "heartbeat",
            Hurt => "hurt",
            Death => "death",
            Respawn => "respawn",
            Charge => "charge",
            PowerDown => "powerDown",
            PickupBig => "pickupBig",
            Door => "door",
            Pressurize => "pressurize",
            Depressurize => "depressurize",
            Rest => "rest",
            CraftDone => "craftDone",
            Equip => "equip",
            TabletOpen => "tabletOpen",
            TabletClose => "tabletClose",
            Rumble => "rumble",
            Sizzle => "sizzle",
            Gust => "gust",
        }
    }

    /// o perfil de distância quando o som sai de um ponto do mundo: sons grandes (explosão, meteoro) se ouvem de longe
    pub fn perfil(self) -> Perfil {
        match self {
            Sound::Boom | Sound::Whoosh => FAR,
            _ => NEAR,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    /// oscilador: frequência de `f0` a `f1` (varredura exponencial) em `dur` s; volume sobe em 10 ms e cai até `dur`
    Tone { f0: f32, f1: f32, dur: f32, gain: f32, wave: Onda },
    /// ruído filtrado: corte de `freq` a `freq·sweep` (mínimo 40 Hz) em `dur` s; volume cai de `gain` até 0,001
    Noise { dur: f32, filter: Filtro, freq: f32, gain: f32, q: f32, sweep: f32 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layer {
    /// segundos até a camada começar
    pub delay: f32,
    pub kind: Kind,
}

impl Layer {
    /// quando a camada acaba de vez (s depois do início do som)
    pub fn end(&self) -> f32 {
        self.delay
            + match self.kind {
                Kind::Tone { dur, .. } => dur + 0.02,
                Kind::Noise { dur, .. } => dur + 0.05,
            }
    }
}

/// monta as camadas de um som; `pitch` multiplica a frequência dos sons tonais (coletas em sequência sobem de tom)
pub fn recipe(name: Sound, pitch: f32, rng: &mut Rng) -> Vec<Layer> {
    use Filtro::{PassaAlta as HP, PassaBaixa as LP, PassaFaixa as BP};
    use Onda::{Quadrada, Seno, Serra, Triangulo};
    let mut v: Vec<Layer> = Vec::with_capacity(6);
    let tone = |v: &mut Vec<Layer>, delay: f32, f0: f32, f1: f32, dur: f32, gain: f32, wave: Onda| {
        v.push(Layer { delay, kind: Kind::Tone { f0, f1, dur, gain, wave } });
    };
    let noise = |v: &mut Vec<Layer>, delay: f32, dur: f32, filter: Filtro, freq: f32, gain: f32, q: f32, sweep: f32| {
        v.push(Layer { delay, kind: Kind::Noise { dur, filter, freq, gain, q, sweep } });
    };
    let r = rng;
    match name {
        Sound::Hit => noise(&mut v, 0.0, 0.07, BP, 900.0 + r.f() * 700.0, 0.35, 2.5, 1.0),
        Sound::Break => {
            noise(&mut v, 0.0, 0.25, LP, 2200.0, 0.5, 1.0, 0.15);
            tone(&mut v, 0.0, 140.0, 55.0, 0.22, 0.35, Seno);
        }
        Sound::Pop => tone(&mut v, 0.0, (520.0 + r.f() * 40.0) * pitch, 1150.0 * pitch, 0.09, 0.12, Seno),
        Sound::PickupBig => {
            for (i, m) in [1.0f32, 1.26, 1.5].into_iter().enumerate() {
                tone(&mut v, i as f32 * 0.06, 520.0 * m, 1040.0 * m, 0.12, 0.1, Seno);
            }
        }
        Sound::Step => noise(&mut v, 0.0, 0.06, LP, 500.0, 0.14, 1.0, 1.0),
        Sound::Land => noise(&mut v, 0.0, 0.18, LP, 700.0, 0.3, 1.0, 0.3),
        Sound::Jump => tone(&mut v, 0.0, 220.0, 360.0, 0.14, 0.07, Triangulo),
        Sound::Place => {
            tone(&mut v, 0.0, 200.0, 95.0, 0.12, 0.3, Seno);
            noise(&mut v, 0.0, 0.08, LP, 1200.0, 0.2, 1.0, 1.0);
        }
        Sound::Deny => tone(&mut v, 0.0, 180.0, 150.0, 0.12, 0.12, Quadrada),
        Sound::Ui => tone(&mut v, 0.0, 660.0, 880.0, 0.05, 0.06, Seno),
        Sound::Clink => {
            tone(&mut v, 0.0, 900.0 + r.f() * 900.0, 600.0 + r.f() * 300.0, 0.07, 0.05, Triangulo);
            noise(&mut v, 0.0, 0.04, HP, 2500.0, 0.06, 1.0, 1.0);
        }
        Sound::Kick => {
            noise(&mut v, 0.0, 0.09, BP, 600.0 + r.f() * 400.0, 0.22, 1.5, 1.0);
            tone(&mut v, 0.0, 300.0, 160.0, 0.08, 0.08, Triangulo);
        }
        Sound::Whoosh => {
            noise(&mut v, 0.0, 1.7, BP, 250.0, 0.35, 2.0, 9.0);
            noise(&mut v, 0.0, 1.7, LP, 180.0, 0.25, 1.0, 3.0);
        }
        Sound::Rumble => {
            tone(&mut v, 0.0, 46.0, 28.0, 2.8, 0.8, Seno);
            noise(&mut v, 0.0, 2.6, LP, 240.0, 0.9, 1.0, 0.4);
        }
        Sound::Sizzle => noise(&mut v, 0.0, 0.45, HP, 2600.0, 0.12, 1.0, 1.0),
        Sound::Gust => noise(&mut v, 0.0, 1.6, BP, 420.0, 0.5, 0.8, 2.2),
        Sound::Boom => {
            // impacto de meteoro em camadas: estalo, corpo, queda grave, ronco que fica e chuva de pedaços
            noise(&mut v, 0.0, 0.12, HP, 2500.0, 0.45, 1.0, 1.0);
            noise(&mut v, 0.0, 1.4, LP, 1700.0, 0.8, 0.8, 0.05);
            tone(&mut v, 0.0, 80.0, 22.0, 1.8, 0.75, Seno);
            noise(&mut v, 0.0, 2.6, LP, 320.0, 0.4, 1.0, 0.3);
            for s in [0.5f32, 0.9, 1.3, 1.8] {
                noise(&mut v, s, 0.06, BP, 800.0 + r.f() * 900.0, 0.1, 2.5, 1.0);
            }
        }
        Sound::Beep => tone(&mut v, 0.0, 1320.0, 1320.0, 0.09, 0.07, Quadrada),
        Sound::Alarm => {
            tone(&mut v, 0.0, 880.0, 660.0, 0.16, 0.09, Quadrada);
            tone(&mut v, 0.2, 880.0, 660.0, 0.16, 0.09, Quadrada);
        }
        Sound::Breath => noise(&mut v, 0.0, 0.42, BP, 900.0, 0.16, 0.7, 0.55),
        Sound::Heartbeat => {
            tone(&mut v, 0.0, 70.0, 45.0, 0.12, 0.6, Seno);
            tone(&mut v, 0.17, 62.0, 40.0, 0.14, 0.45, Seno);
        }
        Sound::Hurt => {
            noise(&mut v, 0.0, 0.2, LP, 1400.0, 0.6, 1.0, 0.2);
            tone(&mut v, 0.0, 320.0, 120.0, 0.22, 0.25, Serra);
            tone(&mut v, 0.12, 990.0, 990.0, 0.08, 0.06, Quadrada);
        }
        Sound::Death => {
            tone(&mut v, 0.0, 330.0, 55.0, 1.6, 0.35, Serra);
            noise(&mut v, 0.0, 1.4, LP, 900.0, 0.4, 1.0, 0.1);
        }
        Sound::Respawn => {
            for (i, f) in [392.0f32, 523.25, 659.25, 783.99].into_iter().enumerate() {
                tone(&mut v, i as f32 * 0.08, f, f * 1.01, 0.4, 0.08, Triangulo);
            }
            noise(&mut v, 0.0, 0.8, BP, 300.0, 0.2, 2.0, 8.0);
        }
        Sound::Charge => tone(&mut v, 0.0, 240.0 * pitch, 260.0 * pitch, 0.12, 0.05, Triangulo),
        Sound::PowerDown => tone(&mut v, 0.0, 520.0, 70.0, 0.6, 0.14, Serra),
        Sound::Door => {
            noise(&mut v, 0.0, 0.45, BP, 380.0, 0.3, 1.2, 3.2);
            tone(&mut v, 0.0, 120.0, 90.0, 0.4, 0.06, Triangulo);
            tone(&mut v, 0.38, 85.0, 55.0, 0.18, 0.3, Seno);
        }
        Sound::Pressurize => {
            noise(&mut v, 0.0, 1.7, HP, 1800.0, 0.22, 0.7, 2.2);
            tone(&mut v, 0.0, 160.0, 520.0, 1.6, 0.045, Seno);
            tone(&mut v, 1.5, 880.0, 1320.0, 0.14, 0.06, Seno);
        }
        Sound::Depressurize => {
            noise(&mut v, 0.0, 1.5, HP, 3600.0, 0.2, 0.7, 0.35);
            tone(&mut v, 0.0, 520.0, 150.0, 1.4, 0.045, Seno);
        }
        Sound::Rest => {
            for (i, f) in [659.25f32, 523.25, 392.0, 329.63].into_iter().enumerate() {
                tone(&mut v, i as f32 * 0.18, f, f, 0.6, 0.05, Triangulo);
            }
        }
        Sound::CraftDone => {
            noise(&mut v, 0.0, 0.35, BP, 2400.0, 0.25, 2.0, 0.3);
            tone(&mut v, 0.0, 1400.0, 700.0, 0.3, 0.08, Triangulo);
        }
        Sound::TabletOpen => {
            // o tablet liga: varredura que sobe e um chiado de tela
            tone(&mut v, 0.0, 380.0, 1320.0, 0.32, 0.06, Seno);
            noise(&mut v, 0.0, 0.4, BP, 2400.0, 0.05, 3.0, 1.8);
            tone(&mut v, 0.3, 1320.0, 1320.0, 0.08, 0.04, Triangulo);
        }
        Sound::TabletClose => {
            tone(&mut v, 0.0, 1100.0, 360.0, 0.24, 0.05, Seno);
            noise(&mut v, 0.0, 0.18, BP, 1800.0, 0.035, 3.0, 0.5);
        }
        Sound::Equip => {
            for (i, f) in [523.25f32, 783.99, 1046.5].into_iter().enumerate() {
                tone(&mut v, i as f32 * 0.07, f, f * 1.01, 0.22, 0.08, Triangulo);
            }
        }
        Sound::Chime => {
            for (i, f) in [523.25f32, 659.25, 783.99, 1046.5].into_iter().enumerate() {
                tone(&mut v, i as f32 * 0.09, f, f * 1.002, 0.5, 0.09, Seno);
            }
        }
    }
    v
}

/// quanto dura o som inteiro (s), contando os atrasos
pub fn duration(layers: &[Layer]) -> f32 {
    layers.iter().map(Layer::end).fold(0.0, f32::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todo_som_tem_receita_e_todos_estao_na_lista() {
        let mut r = Rng::new(1);
        for s in Sound::TODOS {
            let v = recipe(s, 1.0, &mut r);
            assert!(!v.is_empty(), "{s:?} sem camadas");
            assert!(duration(&v) > 0.03 && duration(&v) < 4.0, "{s:?} dura {}", duration(&v));
            for l in &v {
                match l.kind {
                    Kind::Tone { f0, f1, dur, gain, .. } => {
                        assert!(f0 > 20.0 && f1 > 20.0 && f0 < 20_000.0 && f1 < 20_000.0, "{s:?}: frequência");
                        assert!(dur > 0.02 && gain > 0.0 && gain <= 1.0);
                    }
                    Kind::Noise { dur, freq, gain, q, sweep, .. } => {
                        assert!(dur > 0.02 && freq >= 40.0 && gain > 0.0 && gain <= 1.0 && q > 0.0 && sweep > 0.0);
                    }
                }
            }
        }
        // sem repetição na lista
        let mut nomes: Vec<_> = Sound::TODOS.iter().map(|s| s.nome()).collect();
        nomes.sort();
        nomes.dedup();
        assert_eq!(nomes.len(), 35);
    }

    #[test]
    fn so_estrondo_e_assobio_usam_o_perfil_de_longe() {
        for s in Sound::TODOS {
            assert_eq!(s.perfil() == FAR, matches!(s, Sound::Boom | Sound::Whoosh), "{s:?}");
        }
    }

    #[test]
    fn tom_da_coleta_sobe_com_o_pitch() {
        let mut r = Rng::new(3);
        let f = |p: f32, r: &mut Rng| match recipe(Sound::Pop, p, r)[0].kind {
            Kind::Tone { f1, .. } => f1,
            _ => unreachable!(),
        };
        assert!(f(1.5, &mut r) > f(1.0, &mut r) * 1.4);
    }

    #[test]
    fn sons_em_sequencia_tem_atraso_crescente() {
        let mut r = Rng::new(3);
        let v = recipe(Sound::Chime, 1.0, &mut r);
        assert_eq!(v.len(), 4);
        assert!(v.windows(2).all(|w| w[1].delay > w[0].delay));
        let b = recipe(Sound::Boom, 1.0, &mut r);
        assert_eq!(b.len(), 8);
        assert!(duration(&b) > 2.6);
    }
}
