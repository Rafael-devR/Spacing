//! Fabricação nas estações da base (porte de `src/systems/Crafting.ts`, docs/design/CRAFTING.md). Cada estação tem vagas
//! (forno 3, eletrolisador 2, bancada 1); as receitas que andam ao mesmo tempo dividem a energia da estação. Um lote sai
//! uma unidade de cada vez depois do preparo, e cada unidade pronta já pode ser pega. Pausar não gasta energia; cancelar
//! devolve os materiais do que não ficou pronto.
use serde::{Deserialize, Serialize};

use super::data::{batchable, roll_times, unit_seconds, Output, Recipe};
use super::equipment::Equipment;
use super::inventory::Inventory;
use super::{rules, Counts, Events, GameEvent, ItemId, RecipeId, StationId};
use crate::js;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct JobSave {
    pub station: StationId,
    pub slot: usize,
    pub recipe: String,
    pub batch: f64,
    /// segundos de preparo e por unidade (com a variação) e trabalho já feito
    pub prep: f64,
    pub unit: f64,
    pub done: f64,
    #[serde(default, skip_serializing_if = "Counts::is_empty")]
    pub taken: Counts,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub delivered: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub paused: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leftover: Option<Counts>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CraftingSave {
    pub built: Vec<StationId>,
    pub jobs: Vec<JobSave>,
}

#[derive(Clone, Debug)]
struct Job {
    station: StationId,
    slot: usize,
    recipe: RecipeId,
    batch: u32,
    prep: f64,
    unit: f64,
    done: f64,
    taken: Counts,
    delivered: bool,
    paused: bool,
    /// trabalho cancelado: só o que sobrou para pegar
    leftover: Option<Counts>,
}

impl Job {
    fn work(&self) -> f64 {
        self.prep + self.unit * self.batch as f64
    }

    fn finished(&self) -> bool {
        self.leftover.is_some() || self.done >= self.work() - 1e-9
    }

    /// unidades prontas
    fn units_done(&self) -> u32 {
        if self.leftover.is_some() {
            return self.batch;
        }
        if self.done < self.prep {
            return 0;
        }
        (((self.done - self.prep) / self.unit.max(1e-9) + 1e-9).floor() as u32).min(self.batch)
    }

    fn r(&self) -> &'static Recipe {
        self.recipe.data()
    }

    /// itens prontos ainda não pegos
    fn waiting(&self) -> Counts {
        if let Some(l) = &self.leftover {
            return l.clone();
        }
        let mut made = Counts::new();
        let u = self.units_done();
        for o in &self.r().outputs {
            if let Output::Item { item, n } = o {
                made.add(*item, n * u);
            }
        }
        let mut out = Counts::new();
        for (k, n) in made.iter() {
            out.add(k, n.saturating_sub(self.taken.get(k)));
        }
        out
    }

    /// equipamento ou estação pronta e não entregue
    fn rest_pending(&self) -> bool {
        self.leftover.is_none() && !self.delivered && self.finished() && self.r().outputs.iter().any(|o| !matches!(o, Output::Item { .. }))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RecipeCheck {
    pub ok: bool,
    /// já tem esse equipamento ou essa estação
    pub owned: bool,
    /// todas as vagas ocupadas
    pub full: bool,
    /// a estação ainda não foi construída
    pub locked: bool,
    /// já há um trabalho igual (equipamento e estação: um de cada vez)
    pub pending: bool,
    pub missing: Vec<(ItemId, u32)>,
    /// quantas vezes dá para fazer com o que tem
    pub max: u32,
}

/// o que a tela mostra de um trabalho
#[derive(Clone, Debug, PartialEq)]
pub struct JobView {
    pub station: StationId,
    pub slot: usize,
    pub recipe: RecipeId,
    pub batch: u32,
    /// 0..1 do trabalho todo
    pub progress: f64,
    /// unidades prontas (pegas ou não)
    pub units: u32,
    /// 0..1 da unidade de agora
    pub unit_progress: f64,
    /// segundos que faltam na velocidade de agora (infinito sem energia ou pausado)
    pub remaining: f64,
    pub ready: bool,
    pub paused: bool,
    /// etapa atual (receita.process.steps)
    pub step: usize,
    /// 0..1 da energia da estação que vai para este trabalho
    pub share: f64,
    pub waiting: Counts,
    pub waiting_count: u32,
    pub leftover: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TakeResult {
    pub items: Counts,
    pub delivered: Vec<Output>,
    /// sobrou algo na estação (inventário cheio)
    pub partial: bool,
    pub recipes: Vec<RecipeId>,
}

/// Quanto de energia cada estação recebe agora (0..1). O jogo liga isso à energia da base.
pub type Speed<'a> = &'a dyn Fn(StationId) -> f64;

pub fn full_speed(_: StationId) -> f64 {
    1.0
}

#[derive(Clone, Debug)]
pub struct Crafting {
    jobs: Vec<Job>,
    /// estações construídas, na ordem em que entraram
    built: Vec<StationId>,
}

impl Default for Crafting {
    fn default() -> Self {
        Self { jobs: Vec::new(), built: StationId::all().filter(|s| s.data().built_in).collect() }
    }
}

impl Crafting {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_save(saved: &CraftingSave) -> Self {
        let mut c = Self::default();
        for &s in &saved.built {
            c.unlock(s);
        }
        for j in &saved.jobs {
            let Some(recipe) = RecipeId::parse(&j.recipe) else { continue };
            let r = recipe.data();
            if r.station != j.station || j.slot >= j.station.data().slots || c.job_at(j.station, j.slot).is_some() {
                continue;
            }
            let fb = j.batch.floor();
            let batch = if batchable(r) { (if fb >= 1.0 { fb } else { 1.0 }).min(rules().max_batch as f64) as u32 } else { 1 };
            let unit = if j.unit > 0.0 { j.unit } else { unit_seconds(r) };
            let mut job = Job {
                station: j.station,
                slot: j.slot,
                recipe,
                batch,
                prep: j.prep.max(0.0),
                unit,
                done: 0.0,
                taken: j.taken.clone(),
                delivered: j.delivered,
                paused: j.paused,
                leftover: j.leftover.clone(),
            };
            job.done = j.done.min(job.work()).max(0.0);
            c.jobs.push(job);
        }
        c
    }

    pub fn recipes(station: StationId) -> impl Iterator<Item = RecipeId> {
        RecipeId::all().filter(move |r| r.data().station == station)
    }

    pub fn is_built(&self, s: StationId) -> bool {
        self.built.contains(&s)
    }

    /// instala a estação sem fabricá-la (modo de teste)
    pub fn unlock(&mut self, s: StationId) {
        if !self.built.contains(&s) {
            self.built.push(s);
        }
    }

    fn job_at(&self, station: StationId, slot: usize) -> Option<usize> {
        self.jobs.iter().position(|j| j.station == station && j.slot == slot)
    }

    /// algum trabalho na estação (andando, pausado ou esperando)
    pub fn busy(&self, station: StationId) -> bool {
        self.jobs.iter().any(|j| j.station == station)
    }

    fn running_in(&self, station: StationId) -> impl Iterator<Item = usize> + '_ {
        self.jobs.iter().enumerate().filter(move |(_, j)| j.station == station && !j.paused && !j.finished()).map(|(i, _)| i)
    }

    /// a estação gasta energia agora
    pub fn working(&self, station: StationId) -> bool {
        self.running_in(station).next().is_some()
    }

    pub fn free_slot(&self, station: StationId) -> Option<usize> {
        (0..station.data().slots).find(|&s| self.job_at(station, s).is_none())
    }

    fn view(&self, j: &Job, speed: Speed) -> JobView {
        let w = j.work();
        let ready = j.finished();
        let running = self.running_in(j.station).count();
        let share = if !ready && !j.paused { 1.0 / running.max(1) as f64 } else { 0.0 };
        let rate = share * speed(j.station);
        let steps = j.r().process.steps.len();
        let progress = if ready { 1.0 } else { (j.done / w).min(1.0) };
        let units = j.units_done();
        let unit_progress = if ready || units >= j.batch {
            1.0
        } else if j.done < j.prep {
            0.0
        } else {
            ((j.done - j.prep) % j.unit) / j.unit
        };
        let waiting = j.waiting();
        let waiting_count = waiting.total() + j.rest_pending() as u32;
        JobView {
            station: j.station,
            slot: j.slot,
            recipe: j.recipe,
            batch: j.batch,
            progress,
            units,
            unit_progress,
            remaining: if ready {
                0.0
            } else if rate > 0.0 {
                (w - j.done) / rate
            } else {
                f64::INFINITY
            },
            ready,
            paused: j.paused,
            step: (steps - 1).min((progress * steps as f64).floor() as usize),
            share,
            waiting,
            waiting_count,
            leftover: j.leftover.is_some(),
        }
    }

    /// trabalhos da estação, na ordem das vagas
    pub fn slots(&self, station: StationId, speed: Speed) -> Vec<Option<JobView>> {
        (0..station.data().slots).map(|s| self.job_at(station, s).map(|i| self.view(&self.jobs[i], speed))).collect()
    }

    /// algo pronto para pegar
    pub fn has_ready(&self, station: StationId) -> bool {
        self.jobs.iter().any(|j| j.station == station && (!j.waiting().is_empty() || j.rest_pending()))
    }

    /// todos os trabalhos (HUD), por estação e vaga
    pub fn active_jobs(&self, speed: Speed) -> Vec<JobView> {
        let mut v: Vec<&Job> = self.jobs.iter().collect();
        v.sort_by_key(|j| (j.station.0, j.slot));
        v.into_iter().map(|j| self.view(j, speed)).collect()
    }

    /// já tem o que a receita entrega (equipamento igual ou melhor, estação construída)
    pub fn owned(&self, r: &Recipe, eq: &Equipment) -> bool {
        r.outputs.iter().any(|o| match o {
            Output::Equip { equip } => eq.covers(*equip),
            Output::Station { station } => self.is_built(*station),
            Output::Item { .. } => false,
        })
    }

    pub fn max_batch(&self, r: &Recipe, inv: &Inventory) -> u32 {
        let mut max = if batchable(r) { rules().max_batch } else { 1 };
        for &(item, n) in &r.inputs {
            max = max.min(inv.count(item) / n);
        }
        max
    }

    pub fn check(&self, id: RecipeId, batch: u32, inv: &Inventory, eq: &Equipment) -> RecipeCheck {
        let r = id.data();
        let owned = self.owned(r, eq);
        let full = self.free_slot(r.station).is_none();
        let locked = !self.is_built(r.station);
        let pending = !batchable(r) && self.jobs.iter().any(|j| j.recipe == id && j.leftover.is_none());
        let missing: Vec<(ItemId, u32)> =
            r.inputs.iter().filter(|&&(item, n)| !inv.has(item, n * batch)).map(|&(item, n)| (item, n * batch - inv.count(item))).collect();
        let max = self.max_batch(r, inv);
        let ok_batch = batch >= 1 && batch <= if batchable(r) { rules().max_batch } else { 1 };
        RecipeCheck { ok: ok_batch && !owned && !full && !locked && !pending && missing.is_empty(), owned, full, locked, pending, missing, max }
    }

    /// Começa `batch` vezes numa vaga livre; os materiais saem na hora. `rand` sorteia a variação do tempo (só é
    /// chamado se a receita começar).
    pub fn start(&mut self, id: RecipeId, batch: u32, inv: &mut Inventory, eq: &Equipment, rand: &mut dyn FnMut() -> f64, ev: &mut Events) -> bool {
        if !self.check(id, batch, inv, eq).ok {
            return false;
        }
        let r = id.data();
        let needs: Vec<(ItemId, u32)> = r.inputs.iter().map(|&(k, n)| (k, n * batch)).collect();
        if !inv.remove_all(&needs, ev) {
            return false;
        }
        let slot = self.free_slot(r.station).expect("vaga");
        let (prep, unit) = roll_times(r, rand());
        self.jobs.push(Job {
            station: r.station,
            slot,
            recipe: id,
            batch,
            prep,
            unit,
            done: 0.0,
            taken: Counts::new(),
            delivered: false,
            paused: false,
            leftover: None,
        });
        ev.push(GameEvent::CraftStarted { station: r.station, recipe: id, seconds: prep + unit * batch as f64, slot, batch });
        true
    }

    /// avança as estações com a energia de cada uma, dividida entre os trabalhos que andam
    pub fn update(&mut self, dt: f64, speed: Speed, ev: &mut Events) {
        for station in StationId::all() {
            let active: Vec<usize> = self.running_in(station).collect();
            if active.is_empty() {
                continue;
            }
            let step = dt * speed(station) / active.len() as f64;
            for i in active {
                let j = &mut self.jobs[i];
                j.done = j.work().min(j.done + step);
                if j.finished() {
                    ev.push(GameEvent::CraftReady { station, recipe: j.recipe, slot: j.slot });
                }
            }
        }
    }

    /// pausa ou retoma a vaga; pausado não gasta energia
    pub fn toggle_pause(&mut self, station: StationId, slot: usize, ev: &mut Events) -> bool {
        let Some(i) = self.job_at(station, slot) else { return false };
        let j = &mut self.jobs[i];
        if j.finished() {
            return false;
        }
        j.paused = !j.paused;
        ev.push(GameEvent::CraftPaused { station, slot, paused: j.paused });
        true
    }

    /// Cancela a vaga: o pronto vai para o inventário e os materiais do que não ficou pronto voltam. O que não couber fica
    /// na vaga para pegar depois. Devolve o que voltou.
    pub fn cancel(&mut self, station: StationId, slot: usize, inv: &mut Inventory, ev: &mut Events) -> Option<Counts> {
        let i = self.job_at(station, slot)?;
        let j = &self.jobs[i];
        if j.leftover.is_some() || j.finished() {
            return None;
        }
        let mut back = j.waiting();
        let not_done = j.batch - j.units_done();
        for &(item, n) in &j.r().inputs {
            back.add(item, n * not_done);
        }
        let mut left = Counts::new();
        for (item, n) in back.iter() {
            left.add(item, inv.add(item, n, false, ev));
        }
        let mut j = self.jobs.remove(i);
        let recipe = j.recipe;
        if !left.is_empty() {
            j.done = j.work();
            j.paused = false;
            j.leftover = Some(left);
            j.delivered = true;
            self.jobs.push(j);
        }
        ev.push(GameEvent::CraftCancelled { station, slot, recipe });
        Some(back)
    }

    /// Pega o que está pronto na estação (ou só numa vaga): itens vão para o inventário (o que não couber espera),
    /// equipamento é equipado e estação é construída. None = nada pronto.
    pub fn take(&mut self, station: StationId, slot: Option<usize>, inv: &mut Inventory, eq: &mut Equipment, ev: &mut Events) -> Option<TakeResult> {
        let idx: Vec<usize> = (0..self.jobs.len()).filter(|&i| self.jobs[i].station == station && slot.is_none_or(|s| self.jobs[i].slot == s)).collect();
        let mut items = Counts::new();
        let mut delivered = Vec::new();
        let mut recipes = Vec::new();
        let (mut any, mut partial) = (false, false);
        for &i in &idx {
            let wait = self.jobs[i].waiting();
            let mut gave = false;
            for (item, n) in wait.iter() {
                let left = inv.add(item, n, true, ev);
                let got = n - left;
                if got > 0 {
                    items.add(item, got);
                    gave = true;
                    let j = &mut self.jobs[i];
                    match &mut j.leftover {
                        Some(l) => {
                            let cur = l.get(item);
                            l.set(item, cur.saturating_sub(got));
                        }
                        None => j.taken.add(item, got),
                    }
                }
                if left > 0 {
                    partial = true;
                }
            }
            if self.jobs[i].rest_pending() {
                for o in &self.jobs[i].r().outputs {
                    match o {
                        Output::Equip { equip } => eq.equip(*equip, ev),
                        Output::Station { station } => self.unlock(*station),
                        Output::Item { .. } => continue,
                    }
                    delivered.push(*o);
                }
                self.jobs[i].delivered = true;
                gave = true;
            }
            if gave {
                any = true;
                recipes.push(self.jobs[i].recipe);
            }
        }
        // trabalho terminado e todo entregue sai da vaga
        for &i in idx.iter().rev() {
            let j = &self.jobs[i];
            if j.finished() && j.waiting().is_empty() && !j.rest_pending() {
                self.jobs.remove(i);
            }
        }
        if !any {
            return None;
        }
        ev.push(GameEvent::CraftTaken { station, recipe: recipes[0], partial });
        Some(TakeResult { items, delivered, partial, recipes })
    }

    pub fn serialize(&self) -> CraftingSave {
        let r1 = |v: f64| js::round(v * 100.0) / 100.0;
        let built = self.built.iter().copied().filter(|s| !s.data().built_in).collect();
        let jobs = self
            .jobs
            .iter()
            .map(|j| JobSave {
                station: j.station,
                slot: j.slot,
                recipe: j.recipe.key().to_string(),
                batch: j.batch as f64,
                prep: r1(j.prep),
                unit: r1(j.unit),
                done: if j.finished() { r1(j.prep) + r1(j.unit) * j.batch as f64 } else { r1(j.done) },
                taken: j.taken.clone(),
                delivered: j.delivered,
                paused: j.paused,
                leftover: j.leftover.clone(),
            })
            .collect();
        CraftingSave { built, jobs }
    }
}
