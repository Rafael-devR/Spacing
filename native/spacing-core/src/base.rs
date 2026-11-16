//! A base (portes de `src/data/base.ts`, `src/world/Structure.ts` e `src/world/baseLayout.ts`, docs/design/BASE.md). Um módulo
//! é uma caixa de células por cima do terreno: piso, paredes, telhado, porta e móveis. A estrutura manda no mundo dentro da
//! caixa (o `World` pergunta a ela antes de olhar o chunk), então colisão, mira e pedaços tratam a base como blocos sólidos
//! sem ela fazer parte da malha dos chunks (ela tem modelo próprio).
use serde::Deserialize;

use crate::blocks::{BlockId, AIR, HULL};
use crate::rules::rules;
use crate::terrain::TerrainGen;

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    North,
    South,
    West,
    East,
}

impl Side {
    /// para fora, visto de cima: norte = -z, sul = +z, oeste = -x, leste = +x
    pub fn normal(self) -> (i32, i32) {
        match self {
            Side::North => (0, -1),
            Side::South => (0, 1),
            Side::West => (-1, 0),
            Side::East => (1, 0),
        }
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct FurnitureDef {
    pub id: String,
    /// workbench, furnace, electrolyzer (estações), bed, locker, console, e enfeites
    pub kind: String,
    pub x: i32,
    pub z: i32,
    pub w: i32,
    pub d: i32,
    /// parede em que encosta (a frente fica do lado oposto)
    pub against: Side,
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct Xz {
    pub x: i32,
    pub z: i32,
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct Door {
    pub side: Side,
    pub at: i32,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDef {
    pub id: String,
    pub name: String,
    /// canto mínimo da caixa externa (mundo)
    pub origin: Xz,
    /// tamanho externo, paredes incluídas
    pub size: Xz,
    pub interior_height: i32,
    pub door: Door,
    pub furniture: Vec<FurnitureDef>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BaseData {
    /// segundos da câmara de pressurização
    pub airlock_seconds: f64,
    /// distância para aparecer o botão de usar
    pub use_radius: f64,
    /// zoom da câmera por dentro
    pub inside_zoom: f64,
    pub modules: Vec<ModuleDef>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Cell {
    Air = 0,
    Floor = 1,
    Wall = 2,
    /// parede acima da primeira fileira
    WallHigh = 3,
    Roof = 4,
    /// móvel: sólido
    Furniture = 5,
    /// porta: sólida quando fechada
    Door = 6,
}

/// caixa de células (inclusiva)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellBox {
    pub x0: i32,
    pub y0: i32,
    pub z0: i32,
    pub x1: i32,
    pub y1: i32,
    pub z1: i32,
}

#[derive(Clone, Debug)]
pub struct Structure {
    pub id: String,
    pub bx: CellBox,
    cells: Vec<Cell>,
    /// porta aberta (a célula da porta vira ar)
    pub door_open: bool,
    /// corte ativo: telhado e paredes altas não bloqueiam a mira (o jogador está dentro)
    pub cutaway: bool,
}

impl Structure {
    pub fn new(id: &str, bx: CellBox) -> Self {
        let n = ((bx.x1 - bx.x0 + 1) * (bx.y1 - bx.y0 + 1) * (bx.z1 - bx.z0 + 1)) as usize;
        Self { id: id.into(), bx, cells: vec![Cell::Air; n], door_open: false, cutaway: false }
    }

    pub fn contains(&self, x: i32, y: i32, z: i32) -> bool {
        let b = &self.bx;
        x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1
    }

    pub fn covers_column(&self, x: i32, z: i32) -> bool {
        let b = &self.bx;
        x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1
    }

    fn i(&self, x: i32, y: i32, z: i32) -> usize {
        let b = &self.bx;
        let (sx, sz) = (b.x1 - b.x0 + 1, b.z1 - b.z0 + 1);
        ((x - b.x0) + (z - b.z0) * sx + (y - b.y0) * sx * sz) as usize
    }

    pub fn set(&mut self, x: i32, y: i32, z: i32, c: Cell) {
        if self.contains(x, y, z) {
            let i = self.i(x, y, z);
            self.cells[i] = c;
        }
    }

    pub fn cell(&self, x: i32, y: i32, z: i32) -> Cell {
        if self.contains(x, y, z) {
            self.cells[self.i(x, y, z)]
        } else {
            Cell::Air
        }
    }

    /// Bloco nesta célula. `visible` = para a mira: com o corte, telhado e paredes altas deixam o raio passar.
    pub fn block(&self, x: i32, y: i32, z: i32, visible: bool) -> BlockId {
        match self.cell(x, y, z) {
            Cell::Air => AIR,
            Cell::Door if self.door_open => AIR,
            Cell::Roof | Cell::WallHigh if visible && self.cutaway => AIR,
            _ => HULL,
        }
    }
}

/// um ponto do mundo (pés do astronauta)
pub type Point = [f64; 3];

#[derive(Clone, Debug)]
pub struct FurniturePlaced {
    pub def: FurnitureDef,
    /// centro no piso
    pub center: Point,
    /// onde o astronauta fica para usar
    pub use_at: Point,
    /// para onde o móvel olha (como Player.facing)
    pub facing: f64,
}

#[derive(Clone, Debug)]
pub struct ModuleLayout {
    pub def: ModuleDef,
    pub structure: Structure,
    /// célula do piso (o astronauta pisa em floor_y + 1)
    pub floor_y: i32,
    pub door: (i32, i32, Side),
    /// em frente à porta, do lado de fora
    pub outside: Point,
    /// logo depois da porta, do lado de dentro
    pub inside: Point,
    pub center: Point,
    pub furniture: Vec<FurniturePlaced>,
}

pub fn layout_module(def: &ModuleDef, terrain: &dyn TerrainGen) -> ModuleLayout {
    let (o, s) = (def.origin, def.size);
    // piso uma célula acima do ponto mais alto do terreno gerado (não depende de edições do jogador)
    let mut top = 0;
    for x in o.x..o.x + s.x {
        for z in o.z..o.z + s.z {
            top = top.max(terrain.column(x as f64, z as f64).0 as i32);
        }
    }
    let floor_y = top + 1;
    let roof_y = floor_y + def.interior_height + 1;
    let (x0, z0, x1, z1) = (o.x, o.z, o.x + s.x - 1, o.z + s.z - 1);
    let mut st = Structure::new(&def.id, CellBox { x0, y0: floor_y, z0, x1, y1: roof_y, z1 });
    for x in x0..=x1 {
        for z in z0..=z1 {
            st.set(x, floor_y, z, Cell::Floor);
            st.set(x, roof_y, z, Cell::Roof);
            if x == x0 || x == x1 || z == z0 || z == z1 {
                for y in floor_y + 1..roof_y {
                    st.set(x, y, z, if y == floor_y + 1 { Cell::Wall } else { Cell::WallHigh });
                }
            }
        }
    }
    let side = def.door.side;
    let (nx, nz) = side.normal();
    let dx = match side {
        Side::West => x0,
        Side::East => x1,
        _ => x0 + def.door.at,
    };
    let dz = match side {
        Side::North => z0,
        Side::South => z1,
        _ => z0 + def.door.at,
    };
    st.set(dx, floor_y + 1, dz, Cell::Door);
    st.set(dx, floor_y + 2, dz, Cell::Door);
    let fy = (floor_y + 1) as f64;
    let furniture = def
        .furniture
        .iter()
        .map(|f| {
            for x in x0 + f.x..x0 + f.x + f.w {
                for z in z0 + f.z..z0 + f.z + f.d {
                    st.set(x, floor_y + 1, z, Cell::Furniture);
                    st.set(x, floor_y + 2, z, Cell::Furniture);
                }
            }
            let (ax, az) = f.against.normal();
            let cx = x0 as f64 + f.x as f64 + f.w as f64 / 2.0;
            let cz = z0 as f64 + f.z as f64 + f.d as f64 / 2.0;
            let (frx, frz) = (-ax as f64, -az as f64);
            let reach = (if frx != 0.0 { f.w } else { f.d }) as f64 / 2.0 + 0.6;
            FurniturePlaced { def: f.clone(), center: [cx, fy, cz], use_at: [cx + frx * reach, fy, cz + frz * reach], facing: frx.atan2(frz) }
        })
        .collect();
    let (ddx, ddz) = (dx as f64 + 0.5, dz as f64 + 0.5);
    ModuleLayout {
        def: def.clone(),
        structure: st,
        floor_y,
        door: (dx, dz, side),
        outside: [ddx + nx as f64 * 1.6, fy, ddz + nz as f64 * 1.6],
        inside: [ddx - nx as f64 * 1.3, fy, ddz - nz as f64 * 1.3],
        center: [(x0 + x1 + 1) as f64 / 2.0, fy, (z0 + z1 + 1) as f64 / 2.0],
        furniture,
    }
}

/// o ponto está dentro do interior (entre as paredes, acima do piso)
pub fn inside_module(l: &ModuleLayout, p: Point) -> bool {
    let b = &l.structure.bx;
    p[0] > (b.x0 + 1) as f64 && p[0] < b.x1 as f64 && p[2] > (b.z0 + 1) as f64 && p[2] < b.z1 as f64 && p[1] >= l.floor_y as f64 + 0.5 && p[1] < b.y1 as f64
}

/// o primeiro módulo (hoje só existe ele)
pub fn hab_layout(terrain: &dyn TerrainGen) -> ModuleLayout {
    layout_module(&rules().base.modules[0], terrain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planet::PlanetId;
    use crate::world::World;

    #[test]
    fn modulo_tem_porta_moveis_e_colisao() {
        let w = World::new(PlanetId::Lua, 12345);
        let l = hab_layout(w.terrain.as_ref());
        let b = l.structure.bx;
        assert_eq!((b.x1 - b.x0 + 1, b.z1 - b.z0 + 1), (11, 9));
        assert_eq!(b.y1 - b.y0, 4);
        let (dx, dz, side) = l.door;
        assert_eq!(side, Side::South);
        assert_eq!((dx, dz), (6 + 5, -14 + 8));
        assert_eq!(l.structure.block(dx, l.floor_y + 1, dz, false), HULL);
        let mut s = l.structure.clone();
        s.door_open = true;
        assert_eq!(s.block(dx, l.floor_y + 1, dz, false), AIR);
        assert_eq!(l.furniture.len(), 11);
        let bench = l.furniture.iter().find(|f| f.def.kind == "workbench").unwrap();
        // encostada no norte: a frente olha para +z e o ponto de uso fica ao sul dela
        assert!(bench.use_at[2] > bench.center[2]);
        assert!(inside_module(&l, l.inside));
        assert!(!inside_module(&l, l.outside));
    }
}
