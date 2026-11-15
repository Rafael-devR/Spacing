//! Os fatos que as regras publicam (o catálogo de `src/app/events.ts`, só os que as regras portadas emitem até agora).
//! Quem muda algo empurra numa fila (`Events`); o jogo esvazia a fila a cada passo e repassa.
use serde_json::{json, Value};

use super::{EquipId, ItemId, RecipeId, StationId};

pub type Events = Vec<GameEvent>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Meter {
    O2,
    Battery,
    Integrity,
    Energy,
}

impl Meter {
    pub fn key(self) -> &'static str {
        match self {
            Meter::O2 => "o2",
            Meter::Battery => "battery",
            Meter::Integrity => "integrity",
            Meter::Energy => "energy",
        }
    }
}

/// `Heat` = lava (Marte)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeathCause {
    Asphyxia,
    Meteor,
    Fall,
    Heat,
    Hunger,
}

impl DeathCause {
    pub fn key(self) -> &'static str {
        match self {
            DeathCause::Asphyxia => "asphyxia",
            DeathCause::Meteor => "meteor",
            DeathCause::Fall => "fall",
            DeathCause::Heat => "heat",
            DeathCause::Hunger => "hunger",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum GameEvent {
    /// um item chegou ao inventário vindo do mundo
    ItemCollected { item: ItemId, amount: u32 },
    /// contagem do inventário mudou (None = vários itens)
    InventoryChanged { item: Option<ItemId> },
    /// outro espaço da barra selecionado
    InventorySelected { index: usize, item: Option<ItemId> },
    /// não coube tudo; `amount` ficou de fora
    InventoryFull { item: ItemId, amount: u32 },
    EquipmentChanged { slot: &'static str, id: EquipId },
    CraftStarted { station: StationId, recipe: RecipeId, seconds: f64, slot: usize, batch: u32 },
    CraftReady { station: StationId, recipe: RecipeId, slot: usize },
    CraftTaken { station: StationId, recipe: RecipeId, partial: bool },
    CraftPaused { station: StationId, slot: usize, paused: bool },
    CraftCancelled { station: StationId, slot: usize, recipe: RecipeId },
    /// medidor cruzou um limite de aviso; 0 = voltou ao normal
    SuitWarning { meter: Meter, level: u8 },
    SuitAsphyxia { on: bool },
    /// entrou ou saiu da área pressurizada
    SuitRecharge { on: bool },
    PlayerDamaged { amount: f64, cause: DeathCause, integrity: f64 },
    PlayerDied { pos: [f64; 3], cause: DeathCause },
    /// o jogador quebrou um bloco
    BlockBroken { pos: [i32; 3], id: u8 },
    BlockPlaced { pos: [i32; 3], id: u8 },
    /// o jogador minerou um objeto solto
    PropBroken { pos: [f64; 3], kind: &'static str },
    PropPlaced { pos: [i32; 3], kind: &'static str },
    /// um golpe da broca acertou
    MineHit { pos: [f64; 3], block: bool },
    /// a broca é fraca para o alvo (`tier` = nível que ele pede)
    DrillWeak { tier: u32, target: &'static str },
    /// ação recusada: "notBlock", "noItems", "blocked", "emptySlot"
    ActionDenied { reason: &'static str, item: Option<ItemId> },
    BuildMode { on: bool },
    /// tocou um bloco com um projeto na mão (estufa, canteiro): o jogo decide
    SiteTap { pos: [i32; 3], item: ItemId },
}

impl GameEvent {
    /// o nome e o conteúdo como no TS (comparar com os roteiros de referência, mostrar no `?eventos`)
    pub fn to_ts(&self) -> (&'static str, Value) {
        use GameEvent::*;
        let opt = |i: &Option<ItemId>| i.map_or(Value::Null, |i| json!(i.key()));
        match self {
            ItemCollected { item, amount } => ("item:collected", json!({ "item": item.key(), "amount": amount })),
            InventoryChanged { item } => ("inventory:changed", json!({ "item": opt(item) })),
            InventorySelected { index, item } => ("inventory:selected", json!({ "index": index, "item": opt(item) })),
            InventoryFull { item, amount } => ("inventory:full", json!({ "item": item.key(), "amount": amount })),
            EquipmentChanged { slot, id } => ("equipment:changed", json!({ "slot": slot, "id": id.key() })),
            CraftStarted { station, recipe, seconds, slot, batch } => {
                ("craft:started", json!({ "station": station.key(), "recipe": recipe.key(), "seconds": seconds, "slot": slot, "batch": batch }))
            }
            CraftReady { station, recipe, slot } => ("craft:ready", json!({ "station": station.key(), "recipe": recipe.key(), "slot": slot })),
            CraftTaken { station, recipe, partial } => ("craft:taken", json!({ "station": station.key(), "recipe": recipe.key(), "partial": partial })),
            CraftPaused { station, slot, paused } => ("craft:paused", json!({ "station": station.key(), "slot": slot, "paused": paused })),
            CraftCancelled { station, slot, recipe } => ("craft:cancelled", json!({ "station": station.key(), "slot": slot, "recipe": recipe.key() })),
            SuitWarning { meter, level } => ("suit:warning", json!({ "meter": meter.key(), "level": level })),
            SuitAsphyxia { on } => ("suit:asphyxia", json!({ "on": on })),
            SuitRecharge { on } => ("suit:recharge", json!({ "on": on })),
            PlayerDamaged { amount, cause, integrity } => ("player:damaged", json!({ "amount": amount, "cause": cause.key(), "integrity": integrity })),
            PlayerDied { pos, cause } => ("player:died", json!({ "x": pos[0], "y": pos[1], "z": pos[2], "cause": cause.key() })),
            BlockBroken { pos, id } => ("block:broken", json!({ "x": pos[0], "y": pos[1], "z": pos[2], "id": id })),
            BlockPlaced { pos, id } => ("block:placed", json!({ "x": pos[0], "y": pos[1], "z": pos[2], "id": id })),
            PropBroken { pos, kind } => ("prop:broken", json!({ "x": pos[0], "y": pos[1], "z": pos[2], "type": kind })),
            PropPlaced { pos, kind } => ("prop:placed", json!({ "x": pos[0], "y": pos[1], "z": pos[2], "type": kind })),
            MineHit { pos, block } => ("mine:hit", json!({ "x": pos[0], "y": pos[1], "z": pos[2], "target": if *block { "block" } else { "prop" } })),
            DrillWeak { tier, target } => ("drill:weak", json!({ "tier": tier, "target": target })),
            ActionDenied { reason, item } => ("action:denied", json!({ "reason": reason, "item": opt(item) })),
            BuildMode { on } => ("build:mode", json!({ "on": on })),
            SiteTap { pos, item } => ("site:tap", json!({ "x": pos[0], "y": pos[1], "z": pos[2], "item": item.key() })),
        }
    }
}
