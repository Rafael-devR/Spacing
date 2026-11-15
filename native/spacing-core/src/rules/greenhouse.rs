//! A estufa (porte de `src/systems/Greenhouse.ts`, docs/design/ESTUFA.md): o baú da base em lotes, a obra assentada no
//! terreno e entregue peça por peça, e o cultivo nos canteiros (solo, batata, água, colheita).
use serde::{Deserialize, Serialize};

use super::inventory::Inventory;
use super::{rules, Counts, Events, ItemId};
use crate::blocks::{BlockId, LAVA};
use crate::js;
use crate::terrain::{CH, LANDER};

/// o que a regra precisa saber do chão (o `World` serve)
pub trait GroundView {
    fn top_y(&self, x: i32, z: i32) -> i32;
    fn block(&self, x: i32, y: i32, z: i32) -> BlockId;
}

/// caixa de blocos (inclusiva), como a `Box` de world/Structure.ts
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockBox {
    pub x0: i32,
    pub y0: i32,
    pub z0: i32,
    pub x1: i32,
    pub y1: i32,
    pub z1: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Crop {
    /// 0..1 (1 = madura)
    pub growth: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bed {
    pub x: i32,
    pub z: i32,
    pub soil: bool,
    /// água, 0..1
    pub water: f64,
    pub crop: Option<Crop>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    /// canto mínimo e altura do piso
    pub x: i32,
    pub z: i32,
    pub floor_y: i32,
    /// peças entregues, na ordem
    pub parts: Vec<String>,
    /// finalizada
    pub done: bool,
    pub beds: Vec<Bed>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GreenhouseSave {
    /// lotes do baú já pegos
    pub chest: Vec<String>,
    pub site: Option<Site>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpotReason {
    Exists,
    Uneven,
    Base,
    Lander,
    Lava,
    Door,
    High,
    Player,
}

impl SpotReason {
    pub fn key(self) -> &'static str {
        match self {
            SpotReason::Exists => "exists",
            SpotReason::Uneven => "uneven",
            SpotReason::Base => "base",
            SpotReason::Lander => "lander",
            SpotReason::Lava => "lava",
            SpotReason::Door => "door",
            SpotReason::High => "high",
            SpotReason::Player => "player",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpotCheck {
    pub ok: bool,
    pub reason: Option<SpotReason>,
    /// altura do piso: a do ponto mais alto sob a estufa
    pub floor_y: i32,
    pub x: i32,
    pub z: i32,
}

/// o que o botão de ação faz num canteiro
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BedAction {
    Soil,
    Plant,
    Water,
    Harvest,
    NeedSoil,
    NeedSeed,
    NeedWater,
    Growing,
}

impl BedAction {
    pub fn key(self) -> &'static str {
        match self {
            BedAction::Soil => "soil",
            BedAction::Plant => "plant",
            BedAction::Water => "water",
            BedAction::Harvest => "harvest",
            BedAction::NeedSoil => "needSoil",
            BedAction::NeedSeed => "needSeed",
            BedAction::NeedWater => "needWater",
            BedAction::Growing => "growing",
        }
    }
}

/// canto mínimo da estufa quando o jogador mira o bloco (tx, tz): ela fica centrada nele
pub fn anchor_at(tx: i32, tz: i32) -> (i32, i32) {
    let h = rules().greenhouse.size / 2;
    (tx - h, tz - h)
}

/// as colunas de fora da porta (a faixa rente ao piso)
pub fn door_apron(x: i32, z: i32) -> Vec<(i32, i32)> {
    let g = &rules().greenhouse;
    let mut out = Vec::new();
    for dz in 0..2 {
        for dx in -1..=1 {
            out.push((x + g.door_at + dx, z + g.size + dz));
        }
    }
    out
}

/// estágio visível (0 = semente ... 4 = madura)
pub fn growth_stage(growth: f64) -> u32 {
    let st = rules().greenhouse.farm.stages;
    if growth >= 1.0 {
        st - 1
    } else {
        (st - 2).min((growth * (st - 1) as f64).floor() as u32)
    }
}

fn missing_of(inv: &Inventory, cost: &[(ItemId, u32)]) -> Counts {
    let mut out = Counts::new();
    for &(k, n) in cost {
        out.add(k, n.saturating_sub(inv.count(k)));
    }
    out
}

fn part_cost(id: &str) -> &'static [(ItemId, u32)] {
    &rules().greenhouse.parts.iter().find(|p| p.id == id).expect("peça").cost
}

#[derive(Clone, Debug, Default)]
pub struct Greenhouse {
    pub chest: Vec<String>,
    pub site: Option<Site>,
}

impl Greenhouse {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_save(s: &GreenhouseSave) -> Self {
        Self { chest: s.chest.clone(), site: s.site.clone() }
    }

    /// o baú ainda tem um lote não pego
    pub fn chest_full(&self) -> bool {
        rules().greenhouse.chest.iter().any(|l| !self.chest.contains(&l.id))
    }

    /// Abre o baú: os lotes que faltam vão para a mochila. Não tira nada se não couber tudo.
    /// Err("opened") = já pegou tudo; Err("full") = não cabe.
    pub fn open_chest(&mut self, inv: &mut Inventory, ev: &mut Events) -> Result<Vec<String>, &'static str> {
        let lots: Vec<_> = rules().greenhouse.chest.iter().filter(|l| !self.chest.contains(&l.id)).collect();
        if lots.is_empty() {
            return Err("opened");
        }
        let mut need = Counts::new();
        for l in &lots {
            for c in &l.items {
                need.add(c.item, c.n);
            }
        }
        if need.iter().any(|(k, n)| !inv.can_add(k, n)) {
            return Err("full");
        }
        for l in &lots {
            for c in &l.items {
                inv.add(c.item, c.n, false, ev);
            }
        }
        let ids: Vec<String> = lots.iter().map(|l| l.id.clone()).collect();
        self.chest.extend(ids.iter().cloned());
        Ok(ids)
    }

    /// A estufa com o canto mínimo em (x, z) cabe aqui? `base` é a caixa da base; `player` onde o astronauta está.
    pub fn check(&self, ground: &dyn GroundView, base: Option<BlockBox>, x: i32, z: i32, player: Option<(f64, f64)>) -> SpotCheck {
        let g = &rules().greenhouse;
        let n = g.size;
        let (mut lo, mut hi) = (i32::MAX, i32::MIN);
        let mut lava = false;
        for dz in 0..n {
            for dx in 0..n {
                let top = ground.top_y(x + dx, z + dz);
                lo = lo.min(top);
                hi = hi.max(top);
                if ground.block(x + dx, top, z + dz) == LAVA {
                    lava = true;
                }
            }
        }
        let bad = |reason| SpotCheck { ok: false, reason: Some(reason), floor_y: hi, x, z };
        if self.site.is_some() {
            return bad(SpotReason::Exists);
        }
        if lava {
            return bad(SpotReason::Lava);
        }
        if hi - lo > g.tolerance {
            return bad(SpotReason::Uneven);
        }
        if hi + g.wall_height + 8 >= CH as i32 {
            return bad(SpotReason::High);
        }
        if let Some(b) = base {
            let gap = g.base_gap;
            if x + n > b.x0 - gap && x <= b.x1 + gap && z + n > b.z0 - gap && z <= b.z1 + gap {
                return bad(SpotReason::Base);
            }
        }
        let (fx, fz, fn_) = (x as f64, z as f64, n as f64);
        let lx = (fx - LANDER.0).max(0.0).max(LANDER.0 - (fx + fn_));
        let lz = (fz - LANDER.1).max(0.0).max(LANDER.1 - (fz + fn_));
        if js::hypot(lx, lz) < g.lander_gap {
            return bad(SpotReason::Lander);
        }
        for (ax, az) in door_apron(x, z) {
            let t = ground.top_y(ax, az);
            if (t - hi).abs() > 2 || ground.block(ax, t, az) == LAVA {
                return bad(SpotReason::Door);
            }
        }
        if let Some((px, pz)) = player {
            if px >= fx - 0.4 && px <= fx + fn_ + 0.4 && pz >= fz - 0.4 && pz <= fz + fn_ + 0.4 {
                return bad(SpotReason::Player);
            }
        }
        SpotCheck { ok: true, reason: None, floor_y: hi, x, z }
    }

    /// assenta a obra (o jogo já ajustou o terreno)
    pub fn place_site(&mut self, x: i32, z: i32, floor_y: i32) {
        self.site = Some(Site { x, z, floor_y, parts: Vec::new(), done: false, beds: Vec::new() });
    }

    /// a próxima peça a entregar (índice em `rules().greenhouse.parts`)
    pub fn next_part(&self) -> Option<usize> {
        let s = self.site.as_ref()?;
        rules().greenhouse.parts.iter().position(|p| !s.parts.contains(&p.id))
    }

    pub fn has(&self, id: &str) -> bool {
        self.site.as_ref().is_some_and(|s| s.parts.iter().any(|p| p == id))
    }

    pub fn delivered(&self) -> usize {
        self.site.as_ref().map_or(0, |s| s.parts.len())
    }

    pub fn complete(&self) -> bool {
        self.site.as_ref().is_some_and(|s| s.parts.len() == rules().greenhouse.parts.len())
    }

    pub fn done(&self) -> bool {
        self.site.as_ref().is_some_and(|s| s.done)
    }

    /// o que falta para a próxima peça
    pub fn missing(&self, inv: &Inventory) -> Counts {
        self.next_part().map_or_else(Counts::new, |i| missing_of(inv, &rules().greenhouse.parts[i].cost))
    }

    /// Entrega a próxima peça (o material sai da mochila). Ok(id da peça) ou Err(o que falta).
    pub fn deliver(&mut self, inv: &mut Inventory, ev: &mut Events) -> Result<&'static str, Counts> {
        let Some(i) = self.next_part() else { return Err(Counts::new()) };
        let p = &rules().greenhouse.parts[i];
        let lack = missing_of(inv, &p.cost);
        if !lack.is_empty() {
            return Err(lack);
        }
        inv.remove_all(&p.cost, ev);
        self.site.as_mut().expect("obra").parts.push(p.id.clone());
        Ok(&p.id)
    }

    /// finaliza: com todas as peças, tudo passa para a alta qualidade
    pub fn finish(&mut self) -> bool {
        if !self.complete() || self.done() {
            return false;
        }
        self.site.as_mut().expect("obra").done = true;
        true
    }

    /// a célula fica por dentro das paredes e fora do caminho da porta?
    pub fn inside_cell(&self, x: i32, z: i32) -> bool {
        let g = &rules().greenhouse;
        let Some(s) = &self.site else { return false };
        let (lx, lz) = (x - s.x, z - s.z);
        if lx < 1 || lx > g.size - 2 || lz < 1 || lz > g.size - 2 {
            return false;
        }
        !(lx == g.door_at && lz >= g.size - 3)
    }

    pub fn bed_at(&self, x: i32, z: i32) -> Option<usize> {
        self.site.as_ref()?.beds.iter().position(|b| b.x == x && b.z == z)
    }

    /// pode pôr um canteiro na célula? None = pode
    pub fn bed_spot(&self, x: i32, z: i32) -> Option<&'static str> {
        if !self.done() {
            return Some("notDone");
        }
        if !self.inside_cell(x, z) {
            return Some("outside");
        }
        if self.bed_at(x, z).is_some() {
            return Some("taken");
        }
        None
    }

    pub fn place_bed(&mut self, x: i32, z: i32) -> bool {
        if self.bed_spot(x, z).is_some() {
            return false;
        }
        self.site.as_mut().expect("obra").beds.push(Bed { x, z, soil: false, water: 0.0, crop: None });
        true
    }

    /// o canteiro mais perto do ponto, dentro do alcance
    pub fn bed_near(&self, px: f64, pz: f64) -> Option<usize> {
        let mut best = None;
        let mut bd = rules().greenhouse.farm.reach;
        for (i, b) in self.site.as_ref()?.beds.iter().enumerate() {
            let dx = ((px - (b.x as f64 + 0.5)).abs() - 0.5).max(0.0);
            let dz = ((pz - (b.z as f64 + 0.5)).abs() - 0.5).max(0.0);
            let d = js::hypot(dx, dz);
            if d <= bd {
                bd = d;
                best = Some(i);
            }
        }
        best
    }

    pub fn bed(&self, i: usize) -> &Bed {
        &self.site.as_ref().expect("obra").beds[i]
    }

    /// o que o botão faz no canteiro, com o que há na mochila
    pub fn bed_action(&self, i: usize, inv: &Inventory) -> BedAction {
        let b = self.bed(i);
        let has = |k: &str| inv.has(ItemId::of(k), 1);
        if !b.soil {
            return if has("soil") { BedAction::Soil } else { BedAction::NeedSoil };
        }
        let Some(crop) = b.crop else {
            return if has("potato") { BedAction::Plant } else { BedAction::NeedSeed };
        };
        if crop.growth >= 1.0 {
            return BedAction::Harvest;
        }
        if b.water < rules().greenhouse.farm.thirsty {
            return if has("ice") { BedAction::Water } else { BedAction::NeedWater };
        }
        if b.water < 0.98 && has("ice") {
            BedAction::Water
        } else {
            BedAction::Growing
        }
    }

    /// Faz a ação do canteiro; None se nada mudou. Colher devolve quantas batatas entraram.
    pub fn use_bed(&mut self, i: usize, inv: &mut Inventory, ev: &mut Events) -> Option<(BedAction, Option<u32>)> {
        let a = self.bed_action(i, inv);
        let farm = &rules().greenhouse.farm;
        let b = &mut self.site.as_mut().expect("obra").beds[i];
        match a {
            BedAction::Soil => {
                inv.remove(ItemId::of("soil"), 1, ev);
                b.soil = true;
                // o solo vem úmido
                b.water = b.water.max(0.5);
                Some((a, None))
            }
            BedAction::Plant => {
                inv.remove(ItemId::of("potato"), 1, ev);
                b.crop = Some(Crop { growth: 0.0 });
                Some((a, None))
            }
            BedAction::Water => {
                inv.remove(ItemId::of("ice"), 1, ev);
                b.water = 1.0;
                Some((a, None))
            }
            BedAction::Harvest => {
                let left = inv.add(ItemId::of("potato"), farm.harvest, true, ev);
                b.crop = None;
                Some((a, Some(farm.harvest - left)))
            }
            _ => None,
        }
    }

    /// O tempo passa nos canteiros: com água a planta cresce e a água baixa. `light` = luz do planeta. Devolve os
    /// canteiros que mudaram de estágio.
    pub fn step(&mut self, dt: f64, light: f64) -> Vec<usize> {
        let mut changed = Vec::new();
        if !self.done() {
            return changed;
        }
        let farm = &rules().greenhouse.farm;
        for (i, b) in self.site.as_mut().expect("obra").beds.iter_mut().enumerate() {
            let Some(crop) = &mut b.crop else { continue };
            if crop.growth >= 1.0 || b.water <= 0.0 {
                continue;
            }
            let before = growth_stage(crop.growth);
            crop.growth = (crop.growth + (dt / farm.grow_seconds) * light).min(1.0);
            b.water = (b.water - dt / farm.water_seconds).max(0.0);
            if growth_stage(crop.growth) != before {
                changed.push(i);
            }
        }
        changed
    }

    /// o que o jogador gastou na obra (para devolver se o mundo for refeito)
    pub fn spent(&self) -> Counts {
        let mut out = Counts::new();
        for id in self.site.iter().flat_map(|s| s.parts.iter()) {
            for &(k, n) in part_cost(id) {
                out.add(k, n);
            }
        }
        out
    }

    pub fn serialize(&self) -> GreenhouseSave {
        GreenhouseSave { chest: self.chest.clone(), site: self.site.clone() }
    }
}

/// O `World` serve de chão para a regra (só lê o que já foi gerado).
impl GroundView for crate::world::World {
    fn top_y(&self, x: i32, z: i32) -> i32 {
        (0..CH as i32).rev().find(|&y| self.peek_block(x, y, z) != crate::blocks::AIR).unwrap_or(0)
    }
    fn block(&self, x: i32, y: i32, z: i32) -> BlockId {
        self.peek_block(x, y, z)
    }
}

/// Colisão da estufa (porte de `src/world/greenhouseLayout.ts`): uma estrutura como a base. O chão nivelado é sólido desde o
/// início; cada peça entregue fecha as células dela; o vão da porta fica aberto; canteiros ocupam um bloco.
pub fn greenhouse_structure(site: &Site) -> crate::base::Structure {
    let g = &rules().greenhouse;
    let mut s = crate::base::Structure::new(
        "greenhouse",
        crate::base::CellBox { x0: site.x, y0: site.floor_y, z0: site.z, x1: site.x + g.size - 1, y1: site.floor_y + g.wall_height + 1, z1: site.z + g.size - 1 },
    );
    // teto e paredes altas são de vidro: a mira passa e acerta o piso e os canteiros
    s.cutaway = true;
    apply_parts(&mut s, site);
    s
}

/// refaz as células segundo as peças entregues
pub fn apply_parts(s: &mut crate::base::Structure, site: &Site) {
    use crate::base::Cell;
    let g = &rules().greenhouse;
    let b = s.bx;
    for y in b.y0..=b.y1 {
        for z in b.z0..=b.z1 {
            for x in b.x0..=b.x1 {
                s.set(x, y, z, Cell::Air);
            }
        }
    }
    let has = |id: &str| site.parts.iter().any(|p| p == id);
    let (x0, z0, fy) = (site.x, site.z, site.floor_y);
    let (x1, z1) = (x0 + g.size - 1, z0 + g.size - 1);
    for z in z0..=z1 {
        for x in x0..=x1 {
            s.set(x, fy, z, Cell::Floor);
        }
    }
    let wall = |s: &mut crate::base::Structure, x: i32, z: i32, door: bool| {
        for y in fy + 1..=fy + g.wall_height {
            if door && y <= fy + 2 {
                continue;
            }
            s.set(x, y, z, if y == fy + 1 { Cell::Wall } else { Cell::WallHigh });
        }
    };
    if has("wallS") {
        for x in x0..=x1 {
            wall(s, x, z1, x == x0 + g.door_at);
        }
    }
    if has("wallN") {
        for x in x0..=x1 {
            wall(s, x, z0, false);
        }
    }
    if has("wallW") {
        for z in z0 + 1..z1 {
            wall(s, x0, z, false);
        }
    }
    if has("wallE") {
        for z in z0 + 1..z1 {
            wall(s, x1, z, false);
        }
    }
    if has("frame") {
        for z in z0..=z1 {
            for x in x0..=x1 {
                s.set(x, fy + g.wall_height + 1, z, Cell::Roof);
            }
        }
    }
    for bed in &site.beds {
        s.set(bed.x, fy + 1, bed.z, Cell::Furniture);
    }
}
