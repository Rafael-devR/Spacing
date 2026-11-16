//! Itens soltos (porte de `src/entities/ItemDrops.ts` e `LootPiles.ts`): o que sai de um bloco minerado salta e voa até o
//! astronauta; o que ele perde ao morrer fica em pilhas que brilham no chão até ele passar perto.
use crate::fx::Rng;
use crate::rules::inventory::Inventory;
use crate::rules::{rules, Counts, Events, ItemId};
use crate::world::World;

/// item voando até o jogador
#[derive(Clone, Debug)]
pub struct Drop {
    pub item: ItemId,
    pub amount: u32,
    /// negativo = ainda não saiu (saída em sequência)
    pub age: f64,
    pub pos: [f64; 3],
    vel: [f64; 3],
    /// encolhe ao chegar
    pub scale: f64,
    pub spin: [f64; 2],
}

/// tamanho do cubo de um item solto
pub const DROP_SIZE: f64 = 0.26;

pub struct ItemDrops {
    pub drops: Vec<Drop>,
    gravity: f64,
    rng: Rng,
}

impl ItemDrops {
    /// `gravity` = a dos pedaços (debris_gravity do planeta)
    pub fn new(gravity: f64, seed: u64) -> Self {
        Self { drops: Vec::new(), gravity, rng: Rng::new(seed) }
    }

    pub fn spawn(&mut self, item: ItemId, at: [f64; 3], n: u32) {
        for i in 0..n {
            let a = self.rng.f() * std::f64::consts::TAU;
            let up = 1.3 + self.rng.f() * 0.6;
            self.drops.push(Drop { item, amount: 1, age: -(i as f64) * 0.08, pos: at, vel: [a.cos() * 0.9, up, a.sin() * 0.9], scale: 1.0, spin: [0.0; 2] });
        }
    }

    /// um item que já está no chão sai voando até o jogador e entrega `amount` unidades
    pub fn fly(&mut self, item: ItemId, from: [f64; 3], amount: u32) {
        self.drops.push(Drop { item, amount, age: 0.45, pos: from, vel: [0.0; 3], scale: 1.0, spin: [0.0; 2] });
    }

    pub fn clear(&mut self) {
        self.drops.clear();
    }

    /// Um passo. Devolve o que chegou e não coube (vira pilha no chão).
    pub fn update(&mut self, dt: f64, target: [f64; 3], inv: &mut Inventory, ev: &mut Events) -> Vec<(ItemId, u32, [f64; 3])> {
        let mut over = Vec::new();
        let g = self.gravity;
        self.drops.retain_mut(|d| {
            d.age += dt;
            if d.age < 0.0 {
                return true;
            }
            if d.age < 0.45 {
                d.vel[1] -= g * dt;
                for k in 0..3 {
                    d.pos[k] += d.vel[k] * dt;
                }
            } else {
                let to = [target[0] - d.pos[0], target[1] - d.pos[1], target[2] - d.pos[2]];
                let dist = (to[0] * to[0] + to[1] * to[1] + to[2] * to[2]).sqrt();
                let sp = 4.0 + (d.age - 0.45) * 22.0;
                let step = dist.min(sp * dt) / dist.max(1e-9);
                for (p, t) in d.pos.iter_mut().zip(to) {
                    *p += t * step;
                }
                if dist < 1.0 {
                    d.scale *= 0.9;
                }
                if dist < 0.35 {
                    let left = inv.add(d.item, d.amount, true, ev);
                    if left > 0 {
                        over.push((d.item, left, d.pos));
                    }
                    return false;
                }
            }
            d.spin[0] += dt * 2.0;
            d.spin[1] += dt * 4.0;
            true
        });
        over
    }
}

/// no máximo este número de pedaços por item numa pilha
const MAX_PIECES_PER_ITEM: u32 = 4;
const HOVER: f64 = 0.38;

#[derive(Clone, Debug)]
pub struct LootPiece {
    pub item: ItemId,
    pub amount: u32,
    pub pile: u32,
    pub pos: [f64; 3],
    vel: [f64; 3],
    resting: bool,
    rest_y: f64,
    pub phase: f64,
    /// segundos até poder ser recolhido (não pega de volta no instante da morte)
    cooldown: f64,
}

/// uma pilha da morte no salvamento (`LootSave` do TS)
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LootSave {
    pub item: ItemId,
    pub amount: u32,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub pile: u32,
}

pub struct LootPiles {
    pub pieces: Vec<LootPiece>,
    next_pile: u32,
    gravity: f64,
    rng: Rng,
}

impl LootPiles {
    /// `gravity` = loot_gravity do planeta
    pub fn new(gravity: f64, seed: u64) -> Self {
        Self { pieces: Vec::new(), next_pile: 1, gravity, rng: Rng::new(seed) }
    }

    pub fn serialize(&self) -> Vec<LootSave> {
        self.pieces
            .iter()
            .map(|p| LootSave {
                item: p.item,
                amount: p.amount,
                pile: p.pile,
                x: p.pos[0],
                y: if p.resting { p.rest_y + HOVER } else { p.pos[1] },
                z: p.pos[2],
            })
            .collect()
    }

    /// ao carregar, os pedaços assentam no chão sem esperar
    pub fn load(&mut self, list: &[LootSave]) {
        for l in list {
            let phase = self.rng.f() * 6.0;
            self.pieces.push(LootPiece {
                item: l.item,
                amount: l.amount,
                pile: l.pile,
                pos: [l.x, l.y, l.z],
                vel: [0.0; 3],
                resting: false,
                rest_y: l.y,
                phase,
                cooldown: 0.0,
            });
            self.next_pile = self.next_pile.max(l.pile + 1);
        }
    }

    /// espalha os itens a partir de um ponto (morte); devolve quantos pedaços
    pub fn drop(&mut self, at: [f64; 3], items: &Counts) -> usize {
        let pile = self.next_pile;
        self.next_pile += 1;
        let mut n = 0;
        for item in ItemId::all() {
            let total = items.get(item);
            if total == 0 {
                continue;
            }
            let parts = total.min(MAX_PIECES_PER_ITEM);
            for k in 0..parts {
                let amount = total / parts + u32::from(k < total % parts);
                let a = self.rng.f() * std::f64::consts::TAU;
                let sp = 1.5 + self.rng.f() * 2.5;
                let vy = 4.0 + self.rng.f() * 3.0;
                let phase = self.rng.f() * 6.0;
                self.pieces.push(LootPiece {
                    item,
                    amount,
                    pile,
                    pos: [at[0], at[1] + 0.9, at[2]],
                    vel: [a.cos() * sp, vy, a.sin() * sp],
                    resting: false,
                    rest_y: at[1] + 0.9,
                    phase,
                    cooldown: 1.2,
                });
                n += 1;
            }
        }
        n
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update(&mut self, dt: f64, t: f64, world: &mut World, player_center: [f64; 3], can_collect: bool, inv: &Inventory, drops: &mut ItemDrops) {
        let pc = player_center;
        let g = self.gravity;
        let pickup = rules().survival.pickup_radius;
        let mut taken = Vec::new();
        for (i, p) in self.pieces.iter_mut().enumerate() {
            p.cooldown = (p.cooldown - dt).max(0.0);
            if !p.resting {
                p.vel[1] -= g * dt;
                p.vel[0] *= 1.0 - dt * 0.6;
                p.vel[2] *= 1.0 - dt * 0.6;
                for k in 0..3 {
                    p.pos[k] += p.vel[k] * dt;
                }
                let ground = world.top_y(p.pos[0].floor() as i32, p.pos[2].floor() as i32) as f64 + 1.0;
                if p.pos[1] <= ground + HOVER && p.vel[1] < 0.0 {
                    if p.vel[1] < -3.0 {
                        // um quique
                        p.vel[1] *= -0.35;
                        p.pos[1] = ground + HOVER;
                    } else {
                        p.resting = true;
                        p.rest_y = ground;
                    }
                }
            }
            if p.resting {
                let ground = world.top_y(p.pos[0].floor() as i32, p.pos[2].floor() as i32) as f64 + 1.0;
                if ground < p.rest_y - 0.01 {
                    p.resting = false;
                    p.vel = [0.0; 3];
                } else {
                    p.rest_y = ground;
                    p.pos[1] = ground + HOVER + (t * 2.2 + p.phase).sin() * 0.08;
                }
            }
            if can_collect && p.cooldown <= 0.0 {
                let (dx, dz, dy) = (pc[0] - p.pos[0], pc[2] - p.pos[2], pc[1] - p.pos[1]);
                if dx.hypot(dz) < pickup && dy.abs() < 2.0 && inv.can_add(p.item, p.amount) {
                    taken.push(i);
                }
            }
        }
        for i in taken.into_iter().rev() {
            let p = self.pieces.remove(i);
            drops.fly(p.item, p.pos, p.amount);
        }
    }

    /// centro da pilha mais recente (marcador)
    pub fn latest(&self) -> Option<[f64; 3]> {
        let best = self.pieces.iter().map(|p| p.pile).max()?;
        let same: Vec<_> = self.pieces.iter().filter(|p| p.pile == best).collect();
        let n = same.len() as f64;
        let mut c = [0.0; 3];
        for p in &same {
            for (ck, pk) in c.iter_mut().zip(p.pos) {
                *ck += pk / n;
            }
        }
        c[1] = same.iter().map(|p| p.rest_y).fold(f64::MIN, f64::max);
        Some(c)
    }

    pub fn totals(&self) -> Counts {
        let mut c = Counts::new();
        for p in &self.pieces {
            c.add(p.item, p.amount);
        }
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planet::PlanetId;

    #[test]
    fn item_minerado_chega_ao_inventario() {
        let mut d = ItemDrops::new(0.45, 1);
        let mut inv = Inventory::new();
        let mut ev = Events::new();
        d.spawn(ItemId::of("regolith"), [0.0, 20.0, 0.0], 3);
        for _ in 0..240 {
            d.update(1.0 / 60.0, [1.0, 20.0, 1.0], &mut inv, &mut ev);
        }
        assert!(d.drops.is_empty());
        assert_eq!(inv.count(ItemId::of("regolith")), 3);
        assert!(ev.iter().any(|e| matches!(e, crate::rules::GameEvent::ItemCollected { .. })));
    }

    #[test]
    fn pilha_da_morte_cai_e_e_recolhida() {
        let mut w = World::new(PlanetId::Lua, 12345);
        w.update(0.5, 0.5, crate::world::SYNC_BUDGET);
        let top = w.top_y(0, 0) as f64 + 1.0;
        let mut loot = LootPiles::new(9.0, 2);
        let mut drops = ItemDrops::new(0.45, 3);
        let mut inv = Inventory::new();
        let mut ev = Events::new();
        let items = Counts::from_pairs(&[(ItemId::of("iron"), 10), (ItemId::of("ice"), 2)]);
        assert_eq!(loot.drop([0.5, top, 0.5], &items), 6);
        // longe: nada é recolhido
        for i in 0..240 {
            loot.update(1.0 / 60.0, i as f64 / 60.0, &mut w, [30.0, top, 30.0], true, &inv, &mut drops);
        }
        assert_eq!(loot.totals().total(), 12);
        assert!(loot.latest().is_some());
        // o astronauta passa por cima de cada pedaço: tudo volta
        for i in 0..900 {
            let p = loot.pieces.first().map_or([0.5, top, 0.5], |p| p.pos);
            let at = [p[0] + 0.3, p[1] + 0.3, p[2]];
            loot.update(1.0 / 60.0, 4.0 + i as f64 / 60.0, &mut w, at, true, &inv, &mut drops);
            drops.update(1.0 / 60.0, at, &mut inv, &mut ev);
        }
        assert!(loot.pieces.is_empty(), "sobrou {:?}", loot.totals());
        assert_eq!(inv.count(ItemId::of("iron")), 10);
        assert_eq!(inv.count(ItemId::of("ice")), 2);
    }
}
