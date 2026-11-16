//! Salvamento com versão e migração (porte de `src/core/save.ts`): o mesmo formato JSON do jogo web, versão 12. Qualquer
//! versão conhecida (v1 a v12) vira a atual com `migrate`, campo por campo como no TS; campos estragados caem no padrão.
//! `renew_world` faz o que o TS faz quando o gerador do mundo mudou: o progresso fica, o mundo é refeito.
//! A paridade com o TS está nos roteiros de `native/golden/rules.json` (caso "save" de tests/rules.rs).
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::drops::LootSave;
use crate::rules::crafting::{CraftingSave, JobSave};
use crate::rules::equipment::Equipment;
use crate::rules::exploration::ExplorationSave;
use crate::rules::greenhouse::{Bed, Crop, GreenhouseSave, Site};
use crate::rules::inventory::{Inventory, InventorySave, Stack};
use crate::rules::missions::MissionsSave;
use crate::rules::survival::SurvivalSave;
use crate::rules::{rules, Counts, Events, ItemId, StationId};
use crate::world::WorldSave;

pub const SAVE_VERSION: u32 = 12;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pos {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaseSave {
    pub inside: bool,
    /// "lander" ou "base"
    pub respawn: String,
    /// já viu a base
    pub visited: bool,
}

impl Default for BaseSave {
    fn default() -> Self {
        Self { inside: false, respawn: "lander".into(), visited: false }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PowerSave {
    pub battery: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveData {
    pub version: u32,
    pub seed: f64,
    /// versão do gerador que fez este mundo; se o gerador mudou, o mundo é refeito (`renew_world`)
    pub world_gen: i64,
    pub saved_at: f64,
    pub world: WorldSave,
    pub inventory: InventorySave,
    pub player: Option<Pos>,
    pub missions: MissionsSave,
    /// medidores do traje; None = traje cheio
    pub suit: Option<SurvivalSave>,
    pub loot: Vec<LootSave>,
    /// equipamento por encaixe: `{ "drill": "drill_iron" }`
    pub equipment: Value,
    pub base: BaseSave,
    pub explored: ExplorationSave,
    pub crafting: CraftingSave,
    pub power: Option<PowerSave>,
    pub greenhouse: GreenhouseSave,
}

// ---------- leitura tolerante, como as funções do TS ----------

fn obj(v: Option<&Value>) -> Option<&Map<String, Value>> {
    v.and_then(|v| v.as_object())
}

/// número finito ou o padrão (`num` do TS)
fn num(v: Option<&Value>, fallback: f64) -> f64 {
    v.and_then(|v| v.as_f64()).filter(|x| x.is_finite()).unwrap_or(fallback)
}

fn is_true(v: Option<&Value>) -> bool {
    v == Some(&Value::Bool(true))
}

fn int(v: Option<&Value>) -> Option<f64> {
    v.and_then(|v| v.as_f64()).filter(|x| x.fract() == 0.0)
}

fn item_of(v: Option<&Value>) -> Option<ItemId> {
    v.and_then(|v| v.as_str()).and_then(ItemId::parse)
}

fn station_of(v: Option<&Value>) -> Option<StationId> {
    v.and_then(|v| v.as_str()).and_then(StationId::parse)
}

fn to_u32(x: f64) -> u32 {
    x.clamp(0.0, u32::MAX as f64) as u32
}

/// Diferença de propósito: no TS uma edição com número quebrado ou negativo passa e estraga o chunk; aqui ela some.
fn clean_world(v: Option<&Value>) -> WorldSave {
    let mut out = WorldSave::default();
    let Some(w) = obj(v) else { return out };
    if let Some(edits) = obj(w.get("edits")) {
        for (k, list) in edits {
            let Some(list) = list.as_array() else { continue };
            let mut l = Vec::new();
            for e in list {
                let Some(e) = e.as_array() else { continue };
                if let (Some(i), Some(id)) = (e.first().and_then(|x| x.as_u64()), e.get(1).and_then(|x| x.as_u64())) {
                    if id <= u8::MAX as u64 {
                        l.push((i as usize, id as u8));
                    }
                }
            }
            out.edits.insert(k.clone(), l);
        }
    }
    if let Some(r) = w.get("removedProps").and_then(|x| x.as_array()) {
        out.removed_props = r.iter().filter_map(|k| k.as_str().map(String::from)).collect();
    }
    if let Some(e) = w.get("extraProps").and_then(|x| x.as_array()) {
        out.extra_props = e.iter().filter(|x| x.is_object()).cloned().collect();
    }
    out
}

fn clean_suit(v: Option<&Value>) -> Option<SurvivalSave> {
    let v = obj(v)?;
    let suit = v.get("suit").and_then(|s| s.as_str()).filter(|s| rules().suits.iter().any(|d| d.id == *s)).unwrap_or("emergency");
    let m = |k: &str| num(v.get(k), 100.0).clamp(0.0, 100.0);
    Some(SurvivalSave {
        suit: suit.into(),
        o2: m("o2"),
        battery: m("battery"),
        integrity: m("integrity"),
        energy: v.get("energy").filter(|e| e.is_number()).map(|_| m("energy")),
    })
}

fn clean_loot(v: Option<&Value>) -> Vec<LootSave> {
    let Some(list) = v.and_then(|v| v.as_array()) else { return Vec::new() };
    let mut out = Vec::new();
    for l in list {
        let Some(l) = l.as_object() else { continue };
        let Some(item) = item_of(l.get("item")) else { continue };
        let amount = match l.get("amount").and_then(|a| a.as_f64()) {
            Some(a) if a > 0.0 => a,
            _ => continue,
        };
        let (x, y, z) = (num(l.get("x"), f64::NAN), num(l.get("y"), f64::NAN), num(l.get("z"), f64::NAN));
        if ![x, y, z].iter().all(|c| c.is_finite()) {
            continue;
        }
        out.push(LootSave { item, amount: to_u32(amount.floor()), x, y, z, pile: to_u32(num(l.get("pile"), 0.0).floor()) });
    }
    out
}

fn clean_equipment(v: Option<&Value>) -> Value {
    match v {
        Some(v) if v.is_object() => Equipment::from_save(v).serialize(),
        _ => Value::Object(Map::new()),
    }
}

fn clean_base(v: Option<&Value>) -> BaseSave {
    let Some(b) = obj(v) else { return BaseSave::default() };
    BaseSave {
        inside: is_true(b.get("inside")),
        respawn: if b.get("respawn").and_then(|r| r.as_str()) == Some("base") { "base" } else { "lander" }.into(),
        visited: is_true(b.get("visited")),
    }
}

/// item → quantidade inteira positiva
fn counts(v: Option<&Value>) -> Option<Counts> {
    let o = obj(v)?;
    let mut c = Counts::new();
    for (k, n) in o {
        if let (Some(item), Some(n)) = (ItemId::parse(k), n.as_f64()) {
            if n > 0.0 {
                c.set(item, to_u32(n.floor()));
            }
        }
    }
    Some(c)
}

/// v1 a v3: quantidades por item. Vira espaços na ordem de coleta.
fn counts_to_slots(v: Option<&Value>) -> InventorySave {
    Inventory::from_counts(&counts(v).unwrap_or_default()).serialize()
}

/// v4: espaços. Espaços inválidos ficam vazios.
fn clean_slots(v: Option<&Value>) -> InventorySave {
    let o = obj(v);
    let raw = o.and_then(|o| o.get("slots")).and_then(|s| s.as_array()).cloned().unwrap_or_default();
    let slots = raw
        .iter()
        .map(|s| {
            let s = s.as_object()?;
            let item = item_of(s.get("item"))?;
            let n = s.get("n").and_then(|n| n.as_f64()).filter(|&n| n > 0.0)?;
            Some(Stack { item, n: to_u32(n.floor()) })
        })
        .collect();
    let sel = o.map_or(0.0, |o| num(o.get("selected"), 0.0).floor());
    let selected = if sel >= 0.0 && (sel as usize) < rules().hotbar { sel as usize } else { usize::MAX };
    Inventory::from_save(&InventorySave { slots, selected }).serialize()
}

/// v6: só chaves "cx,cz" com máscara inteira de 1 a 0xffff
fn clean_explored(v: Option<&Value>) -> ExplorationSave {
    let mut out = ExplorationSave::new();
    let Some(o) = obj(v) else { return out };
    for (k, m) in o {
        let ok_key = k.split_once(',').is_some_and(|(a, b)| {
            let digits = |s: &str| {
                let s = s.strip_prefix('-').unwrap_or(s);
                !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit())
            };
            digits(a) && digits(b)
        });
        match int(Some(m)) {
            Some(m) if ok_key && m > 0.0 && m <= 65535.0 => {
                out.insert(k.clone(), m as u32);
            }
            _ => {}
        }
    }
    out
}

/// v7 a v9: estações construídas e trabalhos (ver o comentário do TS em `cleanCrafting`)
fn clean_crafting(v: Option<&Value>, version: u32) -> CraftingSave {
    let mut out = CraftingSave::default();
    let Some(c) = obj(v) else { return out };
    if let Some(b) = c.get("built").and_then(|b| b.as_array()) {
        out.built = b.iter().filter_map(|id| station_of(Some(id))).filter(|s| !s.data().built_in).collect();
    }
    let Some(jobs) = c.get("jobs").and_then(|j| j.as_array()) else { return out };
    for j in jobs {
        let Some(j) = j.as_object() else { continue };
        let Some(station) = station_of(j.get("station")) else { continue };
        let Some(recipe) = j.get("recipe").and_then(|r| r.as_str()) else { continue };
        let slot = if version >= 8 { num(j.get("slot"), 0.0).floor().max(0.0) } else { 0.0 };
        let batch = if version >= 8 { num(j.get("batch"), 1.0).floor().max(1.0) } else { 1.0 };
        let total = (if version >= 8 { num(j.get("work"), 0.0) } else { num(j.get("duration"), 0.0) }).max(0.0);
        let mut job = if version >= 9 {
            JobSave {
                station,
                slot: slot as usize,
                recipe: recipe.into(),
                batch,
                prep: num(j.get("prep"), 0.0).max(0.0),
                unit: num(j.get("unit"), 0.0).max(0.0),
                done: num(j.get("done"), 0.0).max(0.0),
                taken: Counts::new(),
                delivered: false,
                paused: false,
                leftover: None,
            }
        } else {
            let done = if version >= 8 { num(j.get("done"), 0.0) } else { num(j.get("t"), 0.0) }.max(0.0);
            JobSave {
                station,
                slot: slot as usize,
                recipe: recipe.into(),
                batch,
                prep: 0.0,
                unit: total / batch,
                done,
                taken: Counts::new(),
                delivered: false,
                paused: false,
                leftover: None,
            }
        };
        if version >= 9 {
            if let Some(t) = counts(j.get("taken")) {
                job.taken = t;
            }
            job.leftover = counts(j.get("leftover"));
            job.delivered = is_true(j.get("delivered"));
            job.paused = is_true(j.get("paused"));
        } else if job.done >= job.unit * batch && job.unit > 0.0 {
            // pronto na v7/v8: o que faltava entregar vira sobra; equipamento/estação entregue vira `delivered`
            if let Some(left) = counts(j.get("left")).filter(|l| !l.is_empty()) {
                job.leftover = Some(left);
            }
            if j.get("rest") == Some(&Value::Bool(false)) {
                job.delivered = true;
            }
        }
        out.jobs.push(job);
    }
    out
}

/// v11: o baú e a obra da estufa. v12: o baú em lotes e os canteiros (ver `cleanGreenhouse` no TS)
fn clean_greenhouse(v: Option<&Value>, version: u32) -> GreenhouseSave {
    let empty = Map::new();
    let g = obj(v).unwrap_or(&empty);
    let gh = &rules().greenhouse;
    let chest = if version >= 12 {
        let given = g.get("chest").and_then(|c| c.as_array());
        gh.chest
            .iter()
            .filter(|l| given.is_some_and(|a| a.iter().any(|x| x.as_str() == Some(&l.id))))
            .map(|l| l.id.clone())
            .collect()
    } else if is_true(g.get("chestOpened")) {
        vec!["estufa".to_string()]
    } else {
        Vec::new()
    };
    let mut out = GreenhouseSave { chest, site: None };
    let Some(s) = obj(g.get("site")) else { return out };
    let finite = |k: &str| s.get(k).and_then(|x| x.as_f64()).is_some();
    if !(finite("x") && finite("z") && finite("floorY")) {
        return out;
    }
    let given = s.get("parts").and_then(|p| p.as_array());
    let parts: Vec<String> = gh
        .parts
        .iter()
        .filter(|p| given.is_some_and(|a| a.iter().any(|x| x.as_str() == Some(&p.id))))
        .map(|p| p.id.clone())
        .collect();
    let x = num(s.get("x"), 0.0).floor() as i32;
    let z = num(s.get("z"), 0.0).floor() as i32;
    let done = is_true(s.get("done")) && parts.len() == gh.parts.len();
    let mut beds: Vec<Bed> = Vec::new();
    if let (true, true, Some(list)) = (done, version >= 12, s.get("beds").and_then(|b| b.as_array())) {
        for b in list {
            let Some(b) = b.as_object() else { continue };
            let (Some(bx), Some(bz)) = (int(b.get("x")), int(b.get("z"))) else { continue };
            let (bx, bz) = (bx as i32, bz as i32);
            if bx <= x || bx >= x + gh.size - 1 || bz <= z || bz >= z + gh.size - 1 || beds.iter().any(|o| o.x == bx && o.z == bz) {
                continue;
            }
            let soil = is_true(b.get("soil"));
            let crop = match obj(b.get("crop")) {
                Some(c) if soil => Some(Crop { growth: num(c.get("growth"), 0.0).clamp(0.0, 1.0) }),
                _ => None,
            };
            beds.push(Bed { x: bx, z: bz, soil, water: num(b.get("water"), 0.0).clamp(0.0, 1.0), crop });
        }
    }
    out.site = Some(Site { x, z, floor_y: num(s.get("floorY"), 1.0).floor() as i32, parts, done, beds });
    out
}

/// Receitas novas da v7: o Mapa passou a pedir uma placa de circuito. Quem ainda não tem o Mapa recebe a placa.
pub fn with_starter_circuit(inv: InventorySave, equipment: &Value) -> InventorySave {
    if equipment.get("map").is_some() {
        return inv;
    }
    let mut i = Inventory::from_save(&inv);
    let circuit = ItemId::of("circuit");
    if i.count(circuit) > 0 {
        return inv;
    }
    i.add(circuit, 1, false, &mut Events::new());
    i.serialize()
}

/// Converte qualquer formato conhecido para o atual (a lista das versões está no `migrate` do TS). Versão futura ou
/// desconhecida: None (não arrisca).
pub fn migrate(raw: &Value, seed: f64) -> Option<SaveData> {
    let r = raw.as_object()?;
    let version = match r.get("version") {
        None => 1.0,
        Some(v) => int(Some(v))?,
    };
    if !(1.0..=SAVE_VERSION as f64).contains(&version) {
        return None;
    }
    let version = version as u32;
    let empty = Map::new();
    let m = obj(r.get("missions")).unwrap_or(&empty);
    let equipment = if version >= 5 { clean_equipment(r.get("equipment")) } else { Value::Object(Map::new()) };
    let inventory = if version >= 4 { clean_slots(r.get("inventory")) } else { counts_to_slots(r.get("inventory")) };
    Some(SaveData {
        version: SAVE_VERSION,
        seed: if version == 1 { seed } else { num(r.get("seed"), seed) },
        world_gen: if version >= 10 { num(r.get("worldGen"), 1.0).floor().max(1.0) as i64 } else { 1 },
        saved_at: num(r.get("savedAt"), 0.0),
        world: clean_world(r.get("world")),
        inventory: if version >= 7 { inventory } else { with_starter_circuit(inventory, &equipment) },
        player: obj(r.get("player")).map(|p| Pos { x: num(p.get("x"), 0.5), y: num(p.get("y"), 30.0), z: num(p.get("z"), 0.5) }),
        missions: MissionsSave {
            step: num(m.get("step"), 0.0).floor().max(0.0) as usize,
            count: to_u32(num(m.get("count"), 0.0).floor()),
        },
        suit: if version >= 3 { clean_suit(r.get("suit")) } else { None },
        loot: if version >= 3 { clean_loot(r.get("loot")) } else { Vec::new() },
        equipment,
        base: if version >= 5 { clean_base(r.get("base")) } else { BaseSave::default() },
        explored: if version >= 6 { clean_explored(r.get("explored")) } else { ExplorationSave::new() },
        crafting: if version >= 7 { clean_crafting(r.get("crafting"), version) } else { CraftingSave::default() },
        power: match obj(r.get("power")) {
            Some(p) if version >= 8 && p.get("battery").and_then(|b| b.as_f64()).is_some() => {
                Some(PowerSave { battery: num(p.get("battery"), 0.0).max(0.0) })
            }
            _ => None,
        },
        greenhouse: if version >= 11 { clean_greenhouse(r.get("greenhouse"), version) } else { GreenhouseSave::default() },
    })
}

/// lê o texto de um salvamento (JSON); estragado ou de versão futura: None
pub fn parse(text: &str, seed: f64) -> Option<SaveData> {
    migrate(&serde_json::from_str(text).ok()?, seed)
}

/// O gerador do mundo mudou (docs/design/MUNDO.md): o progresso fica, o mundo é outro, com semente nova. Somem as edições,
/// o mapa descoberto, a posição e os itens caídos; os painéis solares, a estufa e os canteiros voltam para o inventário.
pub fn renew_world(save: &SaveData, seed: f64, world_gen: i64) -> SaveData {
    let mut ev = Events::new();
    let mut inv = Inventory::from_save(&save.inventory);
    let gone = &save.world.removed_props;
    for e in &save.world.extra_props {
        let key = e.get("key").and_then(|k| k.as_str());
        if e.get("type").and_then(|t| t.as_str()) == Some("solarPanel") && !key.is_some_and(|k| gone.iter().any(|g| g == k)) {
            inv.add(ItemId::of("solar_panel"), 1, false, &mut ev);
        }
    }
    let mut greenhouse = save.greenhouse.clone();
    if let Some(site) = greenhouse.site.take() {
        inv.add(ItemId::of("greenhouse_plan"), 1, false, &mut ev);
        for id in &site.parts {
            if let Some(p) = rules().greenhouse.parts.iter().find(|p| p.id == *id) {
                for &(k, n) in &p.cost {
                    inv.add(k, n, false, &mut ev);
                }
            }
        }
        for b in &site.beds {
            inv.add(ItemId::of("planter"), 1, false, &mut ev);
            if b.soil {
                inv.add(ItemId::of("soil"), 1, false, &mut ev);
            }
            if let Some(c) = &b.crop {
                inv.add(ItemId::of("potato"), if c.growth >= 1.0 { rules().greenhouse.farm.harvest } else { 1 }, false, &mut ev);
            }
        }
    }
    SaveData {
        greenhouse,
        seed,
        world_gen,
        world: WorldSave::default(),
        inventory: inv.serialize(),
        player: None,
        loot: Vec::new(),
        explored: ExplorationSave::new(),
        ..save.clone()
    }
}

/// o texto para gravar (com a versão e a hora)
pub fn to_text(save: &SaveData, saved_at: f64) -> String {
    let mut s = save.clone();
    s.version = SAVE_VERSION;
    s.saved_at = saved_at;
    serde_json::to_string(&s).expect("salvamento em JSON")
}
