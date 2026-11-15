//! Regras do jogo sem gráficos (M4 do porte, docs/design/PORTE_RUST.md): itens, inventário, equipamento, fabricação nas
//! estações, energia da base, sobrevivência e estufa. Cada módulo é o porte de um `src/systems/*.ts` e é provado igual a
//! ele pelos roteiros de `native/golden/rules.json` (tests/rules.rs).
//!
//! Os dados (nomes, receitas, números) vêm de `native/assets/rules.json`, que o `npm run golden` exporta do TS: os dois
//! jogos usam os mesmos números. No TS os sistemas publicam num barramento; aqui quem muda algo recebe `&mut Events` e
//! empurra os fatos numa fila, que o jogo esvazia e repassa a quem se interessa (missões, sons, avisos).
pub mod counts;
pub mod crafting;
pub mod data;
pub mod equipment;
pub mod events;
pub mod greenhouse;
pub mod inventory;
pub mod power;
pub mod survival;

pub use counts::Counts;
pub use data::{rules, EquipId, ItemId, RecipeId, StationId};
pub use events::{Events, GameEvent};
