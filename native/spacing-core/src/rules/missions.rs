//! Cadeia de missões (porte de `src/systems/Missions.ts`): interpreta os passos de `data/missions.ts` a partir dos eventos do
//! jogo. Não desenha nada: dá a vista (`view`), o ponto do marcador (`target`) e publica os eventos de missão. O que a regra
//! pergunta ao mundo (onde está o meteorito, se há meteoro no ar) chega em `MissionInput`; pedir um meteoro é o retorno.
use serde::{Deserialize, Serialize};

use super::data::{MissionStep, StepKind};
use super::inventory::Inventory;
use super::{rules, Events, GameEvent, ItemId};
use crate::js;
use crate::terrain::LANDER;

/// pausa entre um objetivo concluído e o próximo
const NEXT_DELAY: f64 = 1.6;
/// distância para "chegar" a um objeto
const REACH_DIST: f64 = 3.6;
/// raio de entrega ao redor do módulo
const DELIVER_DIST: f64 = 4.2;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MissionsSave {
    pub step: usize,
    pub count: u32,
}

/// o que a missão precisa saber do mundo neste passo
#[derive(Clone, Copy, Debug)]
pub struct MissionInput {
    pub player: [f64; 3],
    /// onde está o objeto do passo de agora (o meteorito), se existir
    pub prop: Option<[f64; 3]>,
    /// há meteoro no ar
    pub meteors_active: bool,
    /// altura do chão no módulo de pouso
    pub lander_y: f64,
}

/// pedido de um meteoro com meteorito (o passo "chegar" sem meteorito no chão)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MeteorRequest {
    /// sortear o alvo entre estas distâncias do jogador
    pub min: f64,
    pub max: f64,
    pub radius: f64,
    pub delay: f64,
}

#[derive(Clone, Debug)]
pub struct MissionView {
    pub index: usize,
    pub total: usize,
    pub step: &'static MissionStep,
    /// 0..1, ou None se o objetivo não tem barra
    pub progress: Option<f64>,
    pub collected: Option<u32>,
    /// entrega: (item, tem, precisa)
    pub needs: Option<Vec<(ItemId, u32, u32)>>,
    pub done: bool,
}

pub struct Missions {
    steps: &'static [MissionStep],
    step: usize,
    count: u32,
    wait: f64,
    meteor_retry: f64,
    deliver_warned: bool,
    lander: [f64; 2],
}

impl Missions {
    /// `marte`: a cadeia de Marte; `saved`: o que estava salvo
    pub fn new(marte: bool, saved: Option<MissionsSave>) -> Self {
        let m = &rules().missions;
        let steps: &'static [MissionStep] = if marte { &m.marte } else { &m.lua };
        let s = saved.unwrap_or_default();
        Self {
            steps,
            step: s.step.min(steps.len() - 1),
            count: s.count,
            wait: 0.0,
            meteor_retry: 0.0,
            deliver_warned: false,
            lander: [LANDER.0 + 0.5, LANDER.1 + 0.5],
        }
    }

    pub fn current(&self) -> &'static MissionStep {
        &self.steps[self.step]
    }

    pub fn serialize(&self) -> MissionsSave {
        MissionsSave { step: self.step, count: self.count }
    }

    /// esperando o próximo objetivo começar
    pub fn waiting(&self) -> bool {
        self.wait > 0.0
    }

    fn changed(&self, ev: &mut Events) {
        ev.push(GameEvent::MissionUpdated { step: self.step });
    }

    fn begin(&mut self, ev: &mut Events) {
        let s = self.current();
        self.count = 0;
        self.deliver_warned = false;
        self.changed(ev);
        ev.push(GameEvent::MissionStarted { id: &s.id, hint: s.hint.as_deref() });
    }

    fn complete(&mut self, ev: &mut Events) {
        let s = self.current();
        ev.push(GameEvent::MissionCompleted { id: &s.id, title: &s.title });
        self.step = (self.step + 1).min(self.steps.len() - 1);
        self.wait = NEXT_DELAY;
        self.changed(ev);
    }

    /// reage a um evento do jogo (no TS, os assinantes do barramento). As reações entram na fila logo depois dele.
    pub fn on_event(&mut self, e: &GameEvent, ev: &mut Events) {
        match e {
            GameEvent::ItemCollected { item, amount } => {
                if self.wait > 0.0 {
                    return;
                }
                if let StepKind::Collect { item: want, n } = self.current().kind {
                    if want != *item {
                        return;
                    }
                    self.count += amount;
                    self.changed(ev);
                    if self.count >= n {
                        self.complete(ev);
                    }
                }
            }
            GameEvent::PropBroken { kind, .. } => {
                if self.wait > 0.0 {
                    return;
                }
                match &self.current().kind {
                    StepKind::Reach { prop } if prop == kind => {
                        // minerou antes de "chegar": pula direto o passo de minerar
                        self.step += 1;
                        self.complete(ev);
                    }
                    StepKind::Prop { prop } if prop == kind => self.complete(ev),
                    _ => {}
                }
            }
            GameEvent::InventoryChanged { .. } => {
                if matches!(self.current().kind, StepKind::Deliver { .. }) {
                    self.changed(ev);
                }
            }
            _ => {}
        }
    }

    /// repassa a fila inteira: cada evento seguido das reações dele (a ordem do barramento do TS)
    pub fn react(&mut self, events: Events) -> Events {
        let mut out = Events::new();
        for e in events {
            let mut more = Events::new();
            self.on_event(&e, &mut more);
            out.push(e);
            out.extend(more);
        }
        out
    }

    /// Só no modo de teste: dá a missão de agora por cumprida.
    pub fn skip(&mut self, ev: &mut Events) {
        if self.wait > 0.0 {
            self.wait = 0.001;
        } else {
            self.complete(ev);
        }
    }

    /// o objeto que o passo de agora procura (para o jogo achar onde ele está)
    pub fn wanted_prop(&self) -> Option<&'static str> {
        match &self.current().kind {
            StepKind::Reach { prop } | StepKind::Prop { prop } => Some(prop),
            _ => None,
        }
    }

    /// ponto que o marcador de objetivo deve indicar, se houver
    pub fn target(&self, prop: Option<[f64; 3]>, lander_y: f64) -> Option<[f64; 3]> {
        if self.wait > 0.0 {
            return None;
        }
        match self.current().kind {
            StepKind::Reach { .. } | StepKind::Prop { .. } => prop,
            StepKind::Deliver { .. } => Some([self.lander[0], lander_y, self.lander[1]]),
            _ => None,
        }
    }

    pub fn view(&self, inv: &Inventory) -> MissionView {
        let s = self.current();
        let mut v = MissionView {
            index: self.step,
            total: self.steps.len() - 1,
            step: s,
            progress: None,
            collected: None,
            needs: None,
            done: matches!(s.kind, StepKind::End),
        };
        match &s.kind {
            StepKind::Collect { n, .. } => {
                v.collected = Some(self.count.min(*n));
                v.progress = Some((self.count as f64 / *n as f64).min(1.0));
            }
            StepKind::Deliver { needs } => {
                let list: Vec<_> = needs.iter().map(|&(item, need)| (item, inv.count(item).min(need), need)).collect();
                let got: u32 = list.iter().map(|n| n.1).sum();
                let need: u32 = list.iter().map(|n| n.2).sum();
                v.progress = Some(if need > 0 { got as f64 / need as f64 } else { 1.0 });
                v.needs = Some(list);
            }
            _ => {}
        }
        v
    }

    /// um passo; devolve um pedido de meteoro quando o passo "chegar" precisa de um meteorito
    pub fn update(&mut self, dt: f64, inp: &MissionInput, inv: &mut Inventory, ev: &mut Events) -> Option<MeteorRequest> {
        if self.wait > 0.0 {
            self.wait -= dt;
            if self.wait <= 0.0 {
                self.begin(ev);
            }
            return None;
        }
        let p = inp.player;
        let mut req = None;
        match &self.current().kind {
            StepKind::Reach { .. } => match inp.prop {
                None if !inp.meteors_active => {
                    self.meteor_retry -= dt;
                    if self.meteor_retry <= 0.0 {
                        self.meteor_retry = 2.0;
                        req = Some(MeteorRequest { min: 13.0, max: 19.0, radius: 2.4, delay: 1.2 });
                    }
                }
                Some(m) => {
                    let (dx, dy, dz) = (m[0] - p[0], m[1] - p[1], m[2] - p[2]);
                    if (dx * dx + dy * dy + dz * dz).sqrt() < REACH_DIST {
                        self.complete(ev);
                    }
                }
                None => {}
            },
            StepKind::Deliver { needs } => {
                let dist = js::hypot(p[0] - self.lander[0], p[2] - self.lander[1]);
                if dist < DELIVER_DIST {
                    let missing: Vec<(ItemId, u32)> = needs.iter().filter(|&&(k, n)| !inv.has(k, n)).copied().collect();
                    if missing.is_empty() {
                        let mut inner = Events::new();
                        inv.remove_all(needs, &mut inner);
                        let inner = self.react(inner);
                        ev.extend(inner);
                        self.complete(ev);
                    } else if !self.deliver_warned {
                        self.deliver_warned = true;
                        ev.push(GameEvent::MissionMissing {
                            items: missing.iter().map(|&(item, n)| (item, n - inv.count(item))).collect(),
                        });
                    }
                } else if dist > 6.0 {
                    self.deliver_warned = false;
                }
            }
            _ => {}
        }
        req
    }
}
