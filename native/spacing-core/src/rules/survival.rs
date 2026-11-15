//! Medidores do traje: oxigênio, bateria, integridade e a energia do corpo (porte de `src/systems/Survival.ts`,
//! docs/design/SOBREVIVENCIA.md). Roda no passo fixo, não desenha nada e publica eventos; o jogo decide a resposta.
use serde::{Deserialize, Serialize};

use super::events::{DeathCause, Meter};
use super::{rules, Events, GameEvent, ItemId};
use crate::js;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SurvivalSave {
    pub suit: String,
    pub o2: f64,
    pub battery: f64,
    pub integrity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy: Option<f64>,
}

/// o que o traje precisa saber do jogo neste passo
#[derive(Clone, Copy, Debug)]
pub struct SuitInput {
    pub pos: [f64; 3],
    /// andando (gasta mais oxigênio que parado)
    pub moving: bool,
    /// a furadeira está ligada
    pub mining: bool,
    /// centro da área pressurizada (módulo de pouso)
    pub pressure_center: [f64; 3],
    /// dentro da base: pressurizado e protegido de meteoros
    pub sheltered: bool,
    /// gasto de bateria da broca em uso (1 = a inicial)
    pub drill_drain: f64,
    /// na base, 0..1 de quanto a energia da base entrega para recarregar o traje
    pub base_charge: f64,
}

fn clamp(v: f64) -> f64 {
    v.clamp(0.0, 100.0)
}

#[derive(Clone, Debug)]
pub struct Survival {
    pub o2: f64,
    pub battery: f64,
    pub integrity: f64,
    /// energia do corpo, 0..100
    pub energy: f64,
    pub suit: usize,
    pub dead: bool,
    /// o teste de desempenho não pode matar o astronauta
    pub immortal: bool,
    /// segundos restantes sem levar dano
    pub invulnerable: f64,
    /// dentro da área pressurizada neste passo
    pub in_pressure: bool,
    /// sem energia: a integridade cai devagar
    pub starving: bool,
    fall_safe_speed: f64,
    o2_level: u8,
    battery_level: u8,
    energy_level: u8,
    asphyxia: bool,
}

impl Survival {
    /// `fall_safe_speed` vem do planeta (planet.rs)
    pub fn new(fall_safe_speed: f64, saved: Option<&SurvivalSave>) -> Self {
        let mut s = Self {
            o2: 100.0,
            battery: 100.0,
            integrity: 100.0,
            energy: rules().needs.energy.max,
            suit: 0,
            dead: false,
            immortal: false,
            invulnerable: 0.0,
            in_pressure: false,
            starving: false,
            fall_safe_speed,
            o2_level: 0,
            battery_level: 0,
            energy_level: 0,
            asphyxia: false,
        };
        if let Some(v) = saved {
            s.suit = rules().suits.iter().position(|x| x.id == v.suit).unwrap_or(0);
            s.o2 = clamp(v.o2);
            s.battery = clamp(v.battery);
            // salvou morto: volta inteiro
            s.integrity = if clamp(v.integrity) == 0.0 { 100.0 } else { clamp(v.integrity) };
            if let Some(e) = v.energy {
                s.energy = clamp(e);
            }
        }
        s.o2_level = Self::level_for(s.o2);
        s.energy_level = Self::energy_level_for(s.energy);
        s.battery_level = (s.battery / 100.0 < rules().survival.battery_warn) as u8;
        s
    }

    /// velocidade da furadeira (cai sem bateria)
    pub fn drill_rate(&self) -> f64 {
        if self.battery > 0.0 {
            1.0
        } else {
            rules().survival.no_battery_drill_rate
        }
    }

    pub fn step(&mut self, dt: f64, d: &SuitInput, ev: &mut Events) {
        if self.dead {
            return;
        }
        let sv = &rules().survival;
        let need = &rules().needs.energy;
        self.invulnerable = (self.invulnerable - dt).max(0.0);
        let (p, c) = (d.pos, d.pressure_center);
        let inside = (js::hypot(p[0] - c[0], p[2] - c[2]) < sv.pressure_radius && (p[1] - c[1]).abs() < 4.0) || d.sheltered;
        if inside != self.in_pressure {
            self.in_pressure = inside;
            ev.push(GameEvent::SuitRecharge { on: inside });
        }
        if inside {
            self.o2 = clamp(self.o2 + sv.refill.o2 * dt);
            // na base, a recarga vem da bateria da base (nada vem do nada)
            let k = if d.sheltered { d.base_charge } else { 1.0 };
            self.battery = clamp(self.battery + sv.refill.battery * k * dt);
            self.integrity = clamp(self.integrity + sv.refill.integrity * dt);
        } else {
            let s = &rules().suits[self.suit];
            let mul = if d.mining {
                s.o2_mine_mul
            } else if d.moving {
                1.0
            } else {
                s.o2_idle_mul
            };
            self.o2 = clamp(self.o2 - (100.0 / s.o2_seconds) * mul * dt);
        }
        if d.mining && self.battery > 0.0 {
            self.battery = clamp(self.battery - rules().suits[self.suit].drill_drain * d.drill_drain * dt);
        }
        if need.enabled {
            self.energy = clamp(self.energy - (need.hunger_per_minute / 60.0) * dt);
        }
        self.update_warnings(ev);
        let no_air = self.o2 <= 0.0;
        if no_air != self.asphyxia {
            self.asphyxia = no_air;
            ev.push(GameEvent::SuitAsphyxia { on: no_air });
        }
        if no_air {
            self.damage(sv.asphyxia_dps * dt, DeathCause::Asphyxia, true, p, ev);
        }
        self.starving = need.enabled && self.energy <= 0.0;
        if self.starving {
            self.damage(need.starve_dps * dt, DeathCause::Hunger, true, p, ev);
        }
    }

    /// um meteoro caiu a `distance` blocos (`meteor:impact` no TS)
    pub fn on_meteor(&mut self, distance: f64, sheltered: bool, pos: [f64; 3], ev: &mut Events) {
        let sv = &rules().survival;
        if !sheltered && distance < sv.meteor_radius {
            self.damage(sv.meteor_max_damage * (1.0 - distance / sv.meteor_radius), DeathCause::Meteor, false, pos, ev);
        }
    }

    /// o astronauta tocou o chão a `speed` (`player:land` no TS)
    pub fn on_land(&mut self, speed: f64, pos: [f64; 3], ev: &mut Events) {
        if speed > self.fall_safe_speed {
            self.damage((speed - self.fall_safe_speed) * rules().survival.fall_damage_per_speed, DeathCause::Fall, false, pos, ev);
        }
    }

    fn energy_level_for(e: f64) -> u8 {
        let n = &rules().needs.energy;
        let f = e / n.max;
        if f <= n.warn[1] {
            2
        } else if f <= n.warn[0] {
            1
        } else {
            0
        }
    }

    fn level_for(o2: f64) -> u8 {
        let w = rules().survival.o2_warn;
        let f = o2 / 100.0;
        if f <= w[1] {
            2
        } else if f <= w[0] {
            1
        } else {
            0
        }
    }

    fn update_warnings(&mut self, ev: &mut Events) {
        let level = Self::level_for(self.o2);
        if level != self.o2_level {
            // avisa ao piorar; ao melhorar só quando volta ao normal
            if level > self.o2_level || level == 0 {
                ev.push(GameEvent::SuitWarning { meter: Meter::O2, level });
            }
            self.o2_level = level;
        }
        if rules().needs.energy.enabled {
            let el = Self::energy_level_for(self.energy);
            if el != self.energy_level {
                if el > self.energy_level {
                    ev.push(GameEvent::SuitWarning { meter: Meter::Energy, level: el });
                }
                self.energy_level = el;
            }
        }
        let bl = (self.battery / 100.0 < rules().survival.battery_warn) as u8;
        if bl != self.battery_level {
            self.battery_level = bl;
            ev.push(GameEvent::SuitWarning { meter: Meter::Battery, level: bl });
        }
    }

    /// Dano à integridade. `continuous` = por segundo (asfixia, fome): só a morte é publicada.
    pub fn damage(&mut self, amount: f64, cause: DeathCause, continuous: bool, pos: [f64; 3], ev: &mut Events) {
        if self.dead || self.immortal || amount <= 0.0 {
            return;
        }
        if self.invulnerable > 0.0 && !continuous {
            return;
        }
        self.integrity = clamp(self.integrity - amount);
        if !continuous {
            ev.push(GameEvent::PlayerDamaged { amount, cause, integrity: self.integrity });
        }
        if self.integrity <= 0.0 {
            self.dead = true;
            ev.push(GameEvent::PlayerDied { pos, cause });
        }
    }

    /// comer: devolve energia se o item for comida
    pub fn eat(&mut self, item: ItemId) -> bool {
        let Some(food) = item.data().food else { return false };
        self.energy = clamp(self.energy + food);
        self.energy_level = Self::energy_level_for(self.energy);
        true
    }

    /// descansar na base: traje cheio (não substitui a comida)
    pub fn rest(&mut self, ev: &mut Events) {
        if self.dead {
            return;
        }
        self.o2 = 100.0;
        self.battery = 100.0;
        self.integrity = 100.0;
        self.update_warnings(ev);
    }

    /// traje de emergência novo: medidores cheios e alguns segundos sem dano
    pub fn respawn(&mut self, ev: &mut Events) {
        let need = &rules().needs.energy;
        self.suit = 0;
        self.o2 = 100.0;
        self.battery = 100.0;
        self.integrity = 100.0;
        self.energy = self.energy.max(need.respawn);
        self.energy_level = Self::energy_level_for(self.energy);
        self.dead = false;
        self.invulnerable = rules().survival.respawn_invulnerable;
        if self.asphyxia {
            self.asphyxia = false;
            ev.push(GameEvent::SuitAsphyxia { on: false });
        }
        if self.o2_level != 0 {
            ev.push(GameEvent::SuitWarning { meter: Meter::O2, level: 0 });
        }
        if self.battery_level != 0 {
            ev.push(GameEvent::SuitWarning { meter: Meter::Battery, level: 0 });
        }
        self.o2_level = 0;
        self.battery_level = 0;
    }

    pub fn serialize(&self) -> SurvivalSave {
        SurvivalSave {
            suit: rules().suits[self.suit].id.clone(),
            o2: self.o2,
            battery: self.battery,
            integrity: self.integrity,
            energy: rules().needs.energy.enabled.then_some(self.energy),
        }
    }
}
