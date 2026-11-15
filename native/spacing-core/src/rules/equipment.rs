//! Equipamentos no traje, fora do inventário (porte de `src/systems/Equipment.ts`): um encaixe por tipo ("drill", "map").
use serde_json::{Map, Value};

use super::data::DrillId;
use super::{rules, EquipId, Events, GameEvent};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Equipment {
    /// (encaixe, equipamento), na ordem em que entraram (é a ordem do salvamento)
    slots: Vec<(&'static str, EquipId)>,
}

impl Equipment {
    pub fn new() -> Self {
        Self::default()
    }

    /// do salvamento `{ "drill": "drill_iron" }`: ignora o que não casa com o encaixe
    pub fn from_save(v: &Value) -> Self {
        let mut e = Self::default();
        for slot in &rules().equip_slots {
            let Some(id) = v.get(slot).and_then(|x| x.as_str()).and_then(EquipId::parse) else { continue };
            if id.data().slot == *slot {
                e.slots.push((slot.as_str(), id));
            }
        }
        e
    }

    pub fn in_slot(&self, slot: &str) -> Option<EquipId> {
        self.slots.iter().find(|(s, _)| *s == slot).map(|(_, id)| *id)
    }

    pub fn has(&self, id: EquipId) -> bool {
        self.in_slot(&id.data().slot) == Some(id)
    }

    /// a broca em uso: a equipada, ou a do traje
    pub fn drill(&self) -> DrillId {
        self.in_slot("drill").and_then(|id| id.data().drill.as_deref()).map_or(DrillId(0), DrillId::of)
    }

    /// já tem isto ou algo melhor no mesmo encaixe (broca de nível igual ou maior)
    pub fn covers(&self, id: EquipId) -> bool {
        if self.has(id) {
            return true;
        }
        id.data().drill.as_deref().is_some_and(|d| self.drill().data().tier >= DrillId::of(d).data().tier)
    }

    /// equipa (trocando o que estiver no encaixe)
    pub fn equip(&mut self, id: EquipId, ev: &mut Events) {
        let slot: &'static str = rules().equip_slots.iter().find(|s| **s == id.data().slot).map(|s| s.as_str()).expect("encaixe");
        match self.slots.iter_mut().find(|(s, _)| *s == slot) {
            Some((_, cur)) if *cur == id => return,
            Some((_, cur)) => *cur = id,
            None => self.slots.push((slot, id)),
        }
        ev.push(GameEvent::EquipmentChanged { slot, id });
    }

    pub fn serialize(&self) -> Value {
        Value::Object(self.slots.iter().map(|(s, id)| (s.to_string(), Value::from(id.key()))).collect::<Map<_, _>>())
    }
}
