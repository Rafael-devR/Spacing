//! Inventário em espaços (porte de `src/systems/Inventory.ts`, docs/design/INVENTARIO.md): a barra são os primeiros
//! `hotbar` espaços e a mochila os seguintes. Coletar junta primeiro nas pilhas do mesmo item que ainda cabem e depois
//! ocupa o primeiro espaço vazio, da barra para a mochila.
use serde::{Deserialize, Serialize};

use super::{rules, Counts, Events, GameEvent, ItemId};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stack {
    pub item: ItemId,
    pub n: u32,
}

pub type Slot = Option<Stack>;

/// o formato do salvamento (v4 em diante)
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InventorySave {
    pub slots: Vec<Slot>,
    /// espaço selecionado na barra
    pub selected: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Inventory {
    slots: Vec<Slot>,
    selected: usize,
}

impl Default for Inventory {
    fn default() -> Self {
        Self { slots: vec![None; rules().slot_count()], selected: 0 }
    }
}

fn hotbar() -> usize {
    rules().hotbar
}

impl Inventory {
    pub fn new() -> Self {
        Self::default()
    }

    /// do salvamento: espaços de item desconhecido ou vazios são ignorados; pilhas grandes demais são cortadas
    pub fn from_save(s: &InventorySave) -> Self {
        let mut inv = Self::default();
        for (i, st) in s.slots.iter().take(inv.slots.len()).enumerate() {
            if let Some(st) = st {
                if st.n > 0 {
                    inv.slots[i] = Some(Stack { item: st.item, n: st.n.min(st.item.stack()) });
                }
            }
        }
        if s.selected < hotbar() {
            inv.selected = s.selected;
        }
        inv
    }

    /// de quantidades soltas (formatos antigos e testes), na ordem de referência dos itens
    pub fn from_counts(c: &Counts) -> Self {
        let mut inv = Self::default();
        for item in ItemId::all() {
            let n = c.get(item);
            if n > 0 {
                inv.put(item, n);
            }
        }
        inv
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.iter().all(|s| s.is_none())
    }

    /// total de um item somando todos os espaços
    pub fn count(&self, item: ItemId) -> u32 {
        self.slots.iter().flatten().filter(|s| s.item == item).map(|s| s.n).sum()
    }

    pub fn has(&self, item: ItemId, n: u32) -> bool {
        self.count(item) >= n
    }

    pub fn slot(&self, i: usize) -> Slot {
        self.slots.get(i).copied().flatten()
    }

    /// quantas unidades ainda cabem (pilhas do mesmo item + espaços vazios)
    pub fn room(&self, item: ItemId) -> u32 {
        let max = item.stack();
        self.slots
            .iter()
            .map(|s| match s {
                None => max,
                Some(s) if s.item == item => max - s.n,
                _ => 0,
            })
            .sum()
    }

    pub fn can_add(&self, item: ItemId, n: u32) -> bool {
        self.room(item) >= n
    }

    /// coloca seguindo a ordem de coleta; devolve o que não coube
    fn put(&mut self, item: ItemId, mut n: u32) -> u32 {
        let max = item.stack();
        for s in self.slots.iter_mut().flatten() {
            if n == 0 {
                break;
            }
            if s.item == item && s.n < max {
                let k = (max - s.n).min(n);
                s.n += k;
                n -= k;
            }
        }
        for s in self.slots.iter_mut() {
            if n == 0 {
                break;
            }
            if s.is_none() {
                let k = max.min(n);
                *s = Some(Stack { item, n: k });
                n -= k;
            }
        }
        n
    }

    /// Adiciona; devolve quantos **não couberam**. `collected` = veio do mundo (publica `ItemCollected`).
    pub fn add(&mut self, item: ItemId, n: u32, collected: bool, ev: &mut Events) -> u32 {
        if n == 0 {
            return 0;
        }
        let left = self.put(item, n);
        let added = n - left;
        if added > 0 {
            if collected {
                ev.push(GameEvent::ItemCollected { item, amount: added });
            }
            ev.push(GameEvent::InventoryChanged { item: Some(item) });
        }
        if left > 0 {
            ev.push(GameEvent::InventoryFull { item, amount: left });
        }
        left
    }

    /// tira das últimas pilhas para as primeiras (poupa a barra)
    fn take(&mut self, item: ItemId, n: u32) -> u32 {
        let mut taken = 0;
        for s in self.slots.iter_mut().rev() {
            if taken >= n {
                break;
            }
            let Some(st) = s else { continue };
            if st.item != item {
                continue;
            }
            let k = st.n.min(n - taken);
            st.n -= k;
            taken += k;
            if st.n == 0 {
                *s = None;
            }
        }
        taken
    }

    /// remove até n; devolve quantos saíram
    pub fn remove(&mut self, item: ItemId, n: u32, ev: &mut Events) -> u32 {
        let taken = self.take(item, n);
        if taken > 0 {
            ev.push(GameEvent::InventoryChanged { item: Some(item) });
        }
        taken
    }

    /// tira do espaço selecionado da barra (construir)
    pub fn remove_selected(&mut self, n: u32, ev: &mut Events) -> u32 {
        let i = self.selected;
        let Some(s) = &mut self.slots[i] else { return 0 };
        let k = n.min(s.n);
        s.n -= k;
        let item = s.item;
        if s.n == 0 {
            self.slots[i] = None;
        }
        ev.push(GameEvent::InventoryChanged { item: Some(item) });
        k
    }

    /// remove um conjunto só se houver tudo
    pub fn remove_all(&mut self, needs: &[(ItemId, u32)], ev: &mut Events) -> bool {
        if !needs.iter().all(|&(k, n)| self.has(k, n)) {
            return false;
        }
        for &(k, n) in needs {
            self.take(k, n);
        }
        ev.push(GameEvent::InventoryChanged { item: None });
        true
    }

    /// esvazia tudo e devolve o total de cada item (morte)
    pub fn take_everything(&mut self, ev: &mut Events) -> Counts {
        let out = self.totals();
        self.slots.iter_mut().for_each(|s| *s = None);
        ev.push(GameEvent::InventoryChanged { item: None });
        out
    }

    fn valid(&self, i: i64) -> bool {
        i >= 0 && (i as usize) < self.slots.len()
    }

    /// move a pilha inteira de `from` para `to`
    pub fn move_slot(&mut self, from: i64, to: i64, ev: &mut Events) {
        if !self.valid(from) {
            return;
        }
        if let Some(a) = self.slots[from as usize] {
            self.move_n(from, to, a.n as i64, ev);
        }
    }

    /// Move até `n` unidades de `from` para `to` (a "mão" da tela): vazio recebe; mesmo item junta até encher; item
    /// diferente (ou pilha cheia) só troca de lugar se a pilha inteira estiver indo. Devolve quantas mudaram de espaço.
    pub fn move_n(&mut self, from: i64, to: i64, n: i64, ev: &mut Events) -> u32 {
        if from == to || !self.valid(from) || !self.valid(to) {
            return 0;
        }
        let (f, t) = (from as usize, to as usize);
        let Some(mut a) = self.slots[f] else { return 0 };
        let n = n.min(a.n as i64);
        if n <= 0 {
            return 0;
        }
        let n = n as u32;
        let moved;
        match self.slots[t] {
            None => {
                self.slots[t] = Some(Stack { item: a.item, n });
                a.n -= n;
                moved = n;
                self.slots[f] = (a.n > 0).then_some(a);
            }
            Some(mut b) if b.item == a.item && b.n < a.item.stack() => {
                moved = (a.item.stack() - b.n).min(n);
                b.n += moved;
                a.n -= moved;
                self.slots[t] = Some(b);
                self.slots[f] = (a.n > 0).then_some(a);
            }
            Some(b) if n == a.n => {
                // outro item (ou pilha cheia): troca
                self.slots[f] = Some(b);
                self.slots[t] = Some(a);
                moved = n;
            }
            _ => return 0,
        }
        self.changed(f, t, ev);
        moved
    }

    /// Mandar rápido (toque duplo): da barra para a mochila ou o contrário. Junta nas pilhas iguais do outro lado e
    /// depois usa o primeiro vazio. Devolve quantas foram.
    pub fn quick_move(&mut self, from: i64, ev: &mut Events) -> u32 {
        if !self.valid(from) {
            return 0;
        }
        let f = from as usize;
        let Some(mut a) = self.slots[f] else { return 0 };
        let (lo, hi) = if f < hotbar() { (hotbar(), self.slots.len()) } else { (0, hotbar()) };
        let max = a.item.stack();
        let start = a.n;
        for i in lo..hi {
            if a.n == 0 {
                break;
            }
            let Some(b) = &mut self.slots[i] else { continue };
            if b.item != a.item || b.n >= max {
                continue;
            }
            let k = (max - b.n).min(a.n);
            b.n += k;
            a.n -= k;
        }
        for i in lo..hi {
            if a.n == 0 {
                break;
            }
            if self.slots[i].is_none() {
                self.slots[i] = Some(Stack { item: a.item, n: a.n });
                a.n = 0;
            }
        }
        self.slots[f] = (a.n > 0).then_some(a);
        let moved = start - a.n;
        if moved > 0 {
            self.changed(f, f, ev);
        }
        moved
    }

    /// Organizar: junta as pilhas iguais da mochila e põe na ordem de referência dos itens. A barra não muda.
    pub fn sort_bag(&mut self, ev: &mut Events) {
        let mut totals = Counts::new();
        for i in hotbar()..self.slots.len() {
            if let Some(s) = self.slots[i].take() {
                totals.add(s.item, s.n);
            }
        }
        let mut k = hotbar();
        for item in ItemId::all() {
            let mut n = totals.get(item);
            while n > 0 && k < self.slots.len() {
                let q = item.stack().min(n);
                self.slots[k] = Some(Stack { item, n: q });
                k += 1;
                n -= q;
            }
        }
        ev.push(GameEvent::InventoryChanged { item: None });
    }

    fn changed(&self, a: usize, b: usize, ev: &mut Events) {
        ev.push(GameEvent::InventoryChanged { item: None });
        if a == self.selected || b == self.selected || a < hotbar() || b < hotbar() {
            ev.push(GameEvent::InventorySelected { index: self.selected, item: self.selected_item() });
        }
    }

    pub fn selected(&self) -> usize {
        self.selected
    }

    /// item no espaço selecionado
    pub fn selected_item(&self) -> Option<ItemId> {
        self.slots[self.selected].map(|s| s.item)
    }

    /// item selecionado, se ele constrói um bloco
    pub fn selected_block_item(&self) -> Option<ItemId> {
        self.selected_item().filter(|i| i.data().block.is_some())
    }

    pub fn select(&mut self, index: i64, ev: &mut Events) {
        if index < 0 || index as usize >= hotbar() || index as usize == self.selected {
            return;
        }
        self.selected = index as usize;
        ev.push(GameEvent::InventorySelected { index: self.selected, item: self.selected_item() });
    }

    /// total de cada item, na ordem dos espaços
    pub fn totals(&self) -> Counts {
        let mut out = Counts::new();
        for s in self.slots.iter().flatten() {
            out.add(s.item, s.n);
        }
        out
    }

    pub fn serialize(&self) -> InventorySave {
        InventorySave { slots: self.slots.clone(), selected: self.selected }
    }
}
