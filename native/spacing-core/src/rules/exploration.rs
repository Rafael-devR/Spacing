//! Mapa descoberto aos poucos (porte de `src/systems/Exploration.ts`, docs/design/MAPA.md). O mundo é dividido em ladrilhos de
//! `TILE` × `TILE` blocos; andar revela os ladrilhos num raio em volta do astronauta. Guardado por chunk de 16 blocos: cada
//! chunk tem 4 × 4 ladrilhos, uma máscara de 16 bits.
use std::collections::BTreeMap;

use super::{Events, GameEvent};

/// blocos por lado de um ladrilho do mapa
pub const TILE: i32 = 4;
/// raio (em blocos) que o astronauta descobre em volta de si
pub const REVEAL_RADIUS: f64 = 22.0;
/// blocos por lado de um chunk do mapa (o mesmo do mundo)
pub const MAP_CHUNK: i32 = 16;
const PER: i32 = MAP_CHUNK / TILE;

/// "cx,cz" → máscara de 16 bits dos ladrilhos revelados (o formato do salvamento)
pub type ExplorationSave = BTreeMap<String, u32>;

#[derive(Clone, Debug, Default)]
pub struct Exploration {
    masks: BTreeMap<(i32, i32), u16>,
    /// quantos ladrilhos foram revelados
    pub revealed: u32,
}

fn bit(tx: i32, tz: i32) -> u32 {
    (tz.rem_euclid(PER) * PER + tx.rem_euclid(PER)) as u32
}

fn key(cx: i32, cz: i32) -> String {
    format!("{cx},{cz}")
}

/// "cx,cz" → (cx, cz)
pub fn parse_key(k: &str) -> Option<(i32, i32)> {
    let (a, b) = k.split_once(',')?;
    Some((a.parse().ok()?, b.parse().ok()?))
}

impl Exploration {
    pub fn new(saved: Option<&ExplorationSave>) -> Self {
        let mut e = Self::default();
        for (k, &m) in saved.into_iter().flatten() {
            let mask = (m & 0xffff) as u16;
            if let (Some(c), true) = (parse_key(k), mask != 0) {
                e.masks.insert(c, mask);
                e.revealed += mask.count_ones();
            }
        }
        e
    }

    /// o ladrilho (tx, tz) já foi visto
    pub fn tile(&self, tx: i32, tz: i32) -> bool {
        let c = (tx.div_euclid(PER), tz.div_euclid(PER));
        self.masks.get(&c).is_some_and(|m| m & (1 << bit(tx, tz)) != 0)
    }

    /// o bloco (x, z) fica num ladrilho já visto
    pub fn at(&self, x: f64, z: f64) -> bool {
        self.tile((x / TILE as f64).floor() as i32, (z / TILE as f64).floor() as i32)
    }

    /// máscara do chunk do mapa (0 = nada visto)
    pub fn chunk_mask(&self, cx: i32, cz: i32) -> u16 {
        self.masks.get(&(cx, cz)).copied().unwrap_or(0)
    }

    /// chunks com algo visto
    pub fn chunks(&self) -> impl Iterator<Item = (i32, i32)> + '_ {
        self.masks.keys().copied()
    }

    /// Revela os ladrilhos cujo centro está a até `radius` blocos de (x, z). Devolve quantos eram novos e avisa
    /// (`map:revealed`) com os chunks que mudaram.
    pub fn reveal_around(&mut self, x: f64, z: f64, radius: f64, ev: &mut Events) -> u32 {
        let t = TILE as f64;
        let (t0x, t1x) = (((x - radius) / t).floor() as i32, ((x + radius) / t).floor() as i32);
        let (t0z, t1z) = (((z - radius) / t).floor() as i32, ((z + radius) / t).floor() as i32);
        let mut changed: Vec<(i32, i32)> = Vec::new();
        let mut n = 0;
        let r2 = radius * radius;
        for tz in t0z..=t1z {
            for tx in t0x..=t1x {
                let dx = (tx * TILE) as f64 + t / 2.0 - x;
                let dz = (tz * TILE) as f64 + t / 2.0 - z;
                if dx * dx + dz * dz > r2 {
                    continue;
                }
                let c = (tx.div_euclid(PER), tz.div_euclid(PER));
                let m = self.masks.entry(c).or_insert(0);
                let b = 1u16 << bit(tx, tz);
                if *m & b != 0 {
                    continue;
                }
                *m |= b;
                if !changed.contains(&c) {
                    changed.push(c);
                }
                n += 1;
            }
        }
        // o TS só cria a chave quando revela algo
        self.masks.retain(|_, m| *m != 0);
        if n > 0 {
            self.revealed += n;
            ev.push(GameEvent::MapRevealed { chunks: changed.iter().map(|&(a, b)| key(a, b)).collect() });
        }
        n
    }

    pub fn serialize(&self) -> ExplorationSave {
        self.masks.iter().map(|(&(a, b), &m)| (key(a, b), m as u32)).collect()
    }
}
