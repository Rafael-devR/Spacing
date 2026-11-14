//! Mundo em chunks (porte da parte sem gráficos de `src/world/World.ts`): carrega e descarrega em volta do jogador, guarda
//! edições, faz a luz do céu e a malha (em threads, como os workers do TS, ADR 0012), raio por voxels e salvamento.
//!
//! O renderizador não mora aqui: ele recolhe `take_meshes()` (malhas prontas) e `take_unloaded()` (chunks que saíram) a
//! cada quadro.
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};

use crate::blocks::{BlockId, AIR, BEDROCK};
use crate::chunk_mesher::{ChunkMesher, ChunkSource, SKY_MAX};
use crate::mesher::Vertex;
use crate::planet::PlanetId;
use crate::terrain::{idx, GeneratedChunk, PropSpawn, TerrainGen, CH, CHUNK_LEN, CS};

pub type Key = (i32, i32);

pub struct Chunk {
    pub cx: i32,
    pub cz: i32,
    /// blocos (compartilhados com as threads enquanto uma malha é feita; editar copia se preciso)
    pub data: Arc<Vec<u8>>,
    pub props: Vec<PropSpawn>,
    pub max_y: usize,
    /// luz do céu de cada bloco, da última malha
    pub light: Option<Vec<u8>>,
    /// contador de edições na última edição deste chunk
    pub edited_at: u64,
    /// já tem malha no renderizador
    pub meshed: bool,
    pub dirty: bool,
}

/// malha pronta para o renderizador (posições locais ao chunk)
pub struct MeshUpdate {
    pub cx: i32,
    pub cz: i32,
    pub verts: Vec<Vertex>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoxelHit {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub id: BlockId,
    pub normal: [i32; 3],
    pub t: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WorldEvent {
    BlockChanged { x: i32, y: i32, z: i32, id: BlockId },
}

/// `update` com orçamento a partir disto faz tudo na hora (carregamento inicial, teletransporte)
pub const SYNC_BUDGET: usize = 100;
const MAX_GEN: usize = 8;
const MAX_MESH_PER_WORKER: usize = 2;
/// malhas prontas entregues por quadro (subir para a GPU custa)
const APPLY_PER_FRAME: usize = 3;

enum Job {
    Gen { cx: i32, cz: i32 },
    Mesh { cx: i32, cz: i32, nb: Vec<(Arc<Vec<u8>>, usize)>, stamp: u64 },
}

enum Done {
    Gen { cx: i32, cz: i32, g: GeneratedChunk },
    Mesh { cx: i32, cz: i32, verts: Vec<Vertex>, light: Vec<u8>, stamp: u64 },
}

/// Threads de geração e malha. Cada uma tem o seu gerador e a sua memória de malha.
struct Pool {
    jobs: Sender<Job>,
    done: Receiver<Done>,
    threads: usize,
}

impl Pool {
    fn new(planet: PlanetId, seed: u32, threads: usize) -> Self {
        let (jtx, jrx) = channel::<Job>();
        let (dtx, drx) = channel::<Done>();
        let jrx = Arc::new(Mutex::new(jrx));
        for i in 0..threads {
            let jrx = jrx.clone();
            let dtx = dtx.clone();
            thread::Builder::new()
                .name(format!("chunks-{i}"))
                .spawn(move || {
                    let mut gen = planet.terrain(seed);
                    let mut mesher = ChunkMesher::new();
                    loop {
                        let job = match jrx.lock() {
                            Ok(rx) => match rx.recv() {
                                Ok(j) => j,
                                Err(_) => return,
                            },
                            Err(_) => return,
                        };
                        let res = match job {
                            Job::Gen { cx, cz } => Done::Gen { cx, cz, g: gen.generate(cx, cz) },
                            Job::Mesh { cx, cz, nb, stamp } => {
                                let src: [ChunkSource; 9] = std::array::from_fn(|i| ChunkSource { data: &nb[i].0, max_y: nb[i].1 });
                                let mut light = vec![0u8; CHUNK_LEN];
                                let mut verts = Vec::new();
                                mesher.build(&src, cx * CS as i32, cz * CS as i32, &mut light, &mut verts);
                                Done::Mesh { cx, cz, verts, light, stamp }
                            }
                        };
                        if dtx.send(res).is_err() {
                            return;
                        }
                    }
                })
                .expect("thread dos chunks");
        }
        Self { jobs: jtx, done: drx, threads }
    }
}

/// Salvamento do mundo, no mesmo formato JSON do TS (`WorldSave` em `src/core/save.ts`).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorldSave {
    /// "cx,cz" → [[índice, id], ...]
    pub edits: BTreeMap<String, Vec<(usize, u8)>>,
    pub removed_props: Vec<String>,
    #[serde(default)]
    pub extra_props: Vec<serde_json::Value>,
}

pub struct World {
    pub planet: PlanetId,
    pub terrain: Box<dyn TerrainGen>,
    pub chunks: HashMap<Key, Chunk>,
    edits: HashMap<Key, BTreeMap<usize, BlockId>>,
    removed_props: HashSet<String>,
    extra_props: Vec<serde_json::Value>,
    mesher: ChunkMesher,
    pool: Option<Pool>,
    edit_stamp: u64,
    pending_gen: HashSet<Key>,
    pending_mesh: HashMap<Key, u64>,
    arrived: Vec<Done>,
    last_p: Key,
    /// raio de chunks carregados em volta do jogador
    pub radius: i32,
    meshes_out: Vec<MeshUpdate>,
    unloaded_out: Vec<Key>,
    pub events: Vec<WorldEvent>,
    scratch: Vec<Vertex>,
}

impl World {
    pub fn new(planet: PlanetId, seed: u32) -> Self {
        Self {
            planet,
            terrain: planet.terrain(seed),
            chunks: HashMap::new(),
            edits: HashMap::new(),
            removed_props: HashSet::new(),
            extra_props: Vec::new(),
            mesher: ChunkMesher::new(),
            pool: None,
            edit_stamp: 0,
            pending_gen: HashSet::new(),
            pending_mesh: HashMap::new(),
            arrived: Vec::new(),
            last_p: (0, 0),
            radius: 3,
            meshes_out: Vec::new(),
            unloaded_out: Vec::new(),
            events: Vec::new(),
            scratch: Vec::new(),
        }
    }

    /// Liga as threads de geração e malha (o equivalente aos workers do TS).
    pub fn enable_threads(&mut self, threads: usize) {
        if threads > 0 {
            self.pool = Some(Pool::new(self.planet, self.terrain.seed(), threads));
        }
    }

    pub fn uses_threads(&self) -> bool {
        self.pool.is_some()
    }

    pub fn chunk_key(x: i32, z: i32) -> Key {
        (x.div_euclid(CS as i32), z.div_euclid(CS as i32))
    }

    /// o chunk (gera na hora se não existir)
    pub fn chunk(&mut self, cx: i32, cz: i32) -> &mut Chunk {
        if !self.chunks.contains_key(&(cx, cz)) {
            let g = self.terrain.generate(cx, cz);
            self.install(cx, cz, g);
        }
        self.chunks.get_mut(&(cx, cz)).unwrap()
    }

    fn install(&mut self, cx: i32, cz: i32, mut g: GeneratedChunk) {
        let mut data = g.data;
        let mut max_y = g.max_y;
        if let Some(ed) = self.edits.get(&(cx, cz)) {
            for (&i, &id) in ed {
                data[i] = id;
                let y = i / (CS * CS);
                if id != 0 && y > max_y {
                    max_y = y;
                }
            }
        }
        // objetos criados durante o jogo que caem neste chunk (World.install do TS)
        for e in &self.extra_props {
            let (Some(wx), Some(wz)) = (e["wx"].as_i64(), e["wz"].as_i64()) else { continue };
            let (wx, wz) = (wx as i32, wz as i32);
            if Self::chunk_key(wx, wz) != (cx, cz) {
                continue;
            }
            let Some(kind) = e["type"].as_str().and_then(crate::terrain::prop_type) else { continue };
            g.props.push(PropSpawn {
                wx,
                wz,
                y: 0,
                kind,
                variant: e["variant"].as_u64().unwrap_or(0) as u32,
                rot: e["rot"].as_f64().unwrap_or(0.0),
                scale: e["scale"].as_f64().unwrap_or(1.0),
                key: e["key"].as_str().map(|k| k.to_string()),
            });
        }
        // os objetos ficam no chão que sobrou de verdade (World.spawnProp do TS usa o topo real da coluna, depois das cavernas)
        let mut props = g.props;
        props.retain(|p| !self.removed_props.contains(&p.key.clone().unwrap_or_else(|| format!("{},{}", p.wx, p.wz))));
        for p in props.iter_mut() {
            let (lx, lz) = ((p.wx - cx * CS as i32) as usize, (p.wz - cz * CS as i32) as usize);
            let top = (0..CH).rev().find(|&y| data[idx(lx, y, lz)] != 0).unwrap_or(0);
            p.y = top as i32 + 1;
        }
        let c = Chunk { cx, cz, data: Arc::new(data), props, max_y, light: None, edited_at: 0, meshed: false, dirty: true };
        self.chunks.insert((cx, cz), c);
    }

    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    pub fn get_block(&mut self, x: i32, y: i32, z: i32) -> BlockId {
        if y < 0 {
            return BEDROCK;
        }
        if y >= CH as i32 {
            return AIR;
        }
        let (cx, cz) = Self::chunk_key(x, z);
        let c = self.chunk(cx, cz);
        c.data[idx((x - cx * CS as i32) as usize, y as usize, (z - cz * CS as i32) as usize)]
    }

    /// como `get_block`, mas não gera chunks (ar se não carregado)
    pub fn peek_block(&self, x: i32, y: i32, z: i32) -> BlockId {
        if y < 0 || y >= CH as i32 {
            return AIR;
        }
        let (cx, cz) = Self::chunk_key(x, z);
        match self.chunks.get(&(cx, cz)) {
            Some(c) => c.data[idx((x - cx * CS as i32) as usize, y as usize, (z - cz * CS as i32) as usize)],
            None => AIR,
        }
    }

    pub fn is_solid(&mut self, x: i32, y: i32, z: i32) -> bool {
        self.get_block(x, y, z) != AIR
    }

    pub fn top_y(&mut self, x: i32, z: i32) -> i32 {
        for y in (0..CH as i32).rev() {
            if self.get_block(x, y, z) != AIR {
                return y;
            }
        }
        0
    }

    /// há rocha acima deste ponto, na mesma coluna?
    pub fn roofed(&self, x: f64, y: f64, z: f64) -> bool {
        let (bx, bz) = (x.floor() as i32, z.floor() as i32);
        let (cx, cz) = Self::chunk_key(bx, bz);
        let Some(c) = self.chunks.get(&(cx, cz)) else { return false };
        let i = idx((bx - cx * CS as i32) as usize, 0, (bz - cz * CS as i32) as usize);
        let from = (y.floor() as i32 + 1).max(1) as usize;
        (from..=c.max_y).any(|yy| c.data[i + yy * CS * CS] != 0)
    }

    pub fn set_block(&mut self, x: i32, y: i32, z: i32, id: BlockId) -> bool {
        self.set_blocks(&[(x, y, z, id)]) > 0
    }

    /// Altera vários blocos e refaz cada chunk afetado uma vez só.
    pub fn set_blocks(&mut self, list: &[(i32, i32, i32, BlockId)]) -> usize {
        let mut dirty: Vec<Key> = Vec::new();
        let mut applied = Vec::new();
        for &(x, y, z, id) in list {
            if y <= 0 || y >= CH as i32 {
                continue;
            }
            let (cx, cz) = Self::chunk_key(x, z);
            let reach = self.light_reach(x, y, z, id).max(1);
            self.edit_stamp += 1;
            let stamp = self.edit_stamp;
            let c = self.chunk(cx, cz);
            let (lx, lz) = (x - cx * CS as i32, z - cz * CS as i32);
            let i = idx(lx as usize, y as usize, lz as usize);
            Arc::make_mut(&mut c.data)[i] = id;
            c.edited_at = stamp;
            if id != 0 && y as usize > c.max_y {
                c.max_y = y as usize;
            }
            self.edits.entry((cx, cz)).or_default().insert(i, id);
            if !dirty.contains(&(cx, cz)) {
                dirty.push((cx, cz));
            }
            let cs = CS as i32;
            for dz in -1..=1 {
                if (dz < 0 && lz >= reach) || (dz > 0 && lz < cs - reach) {
                    continue;
                }
                for dx in -1..=1 {
                    if (dx < 0 && lx >= reach) || (dx > 0 && lx < cs - reach) {
                        continue;
                    }
                    let k = (cx + dx, cz + dz);
                    if (dx != 0 || dz != 0) && !dirty.contains(&k) {
                        dirty.push(k);
                    }
                }
            }
            applied.push((x, y, z, id));
        }
        for k in dirty {
            if self.chunks.get(&k).is_some_and(|c| c.meshed) {
                self.rebuild(k.0, k.1);
            }
        }
        for &(x, y, z, id) in &applied {
            if id == AIR {
                self.settle_prop(x, y, z);
            }
            self.events.push(WorldEvent::BlockChanged { x, y, z, id });
        }
        applied.len()
    }

    /// Refaz a malha de um chunk na hora (nesta thread).
    pub fn rebuild(&mut self, cx: i32, cz: i32) {
        let mut nb = Vec::with_capacity(9);
        for dz in -1..=1 {
            for dx in -1..=1 {
                let c = self.chunk(cx + dx, cz + dz);
                nb.push((c.data.clone(), c.max_y));
            }
        }
        let src: [ChunkSource; 9] = std::array::from_fn(|i| ChunkSource { data: &nb[i].0, max_y: nb[i].1 });
        let mut light = self.chunks.get_mut(&(cx, cz)).and_then(|c| c.light.take()).unwrap_or_else(|| vec![0u8; CHUNK_LEN]);
        let mut verts = std::mem::take(&mut self.scratch);
        self.mesher.build(&src, cx * CS as i32, cz * CS as i32, &mut light, &mut verts);
        let out = verts.clone();
        self.scratch = verts;
        let c = self.chunks.get_mut(&(cx, cz)).unwrap();
        c.light = Some(light);
        self.apply_mesh(cx, cz, out);
    }

    fn apply_mesh(&mut self, cx: i32, cz: i32, verts: Vec<Vertex>) {
        if let Some(c) = self.chunks.get_mut(&(cx, cz)) {
            c.meshed = true;
            c.dirty = false;
        }
        self.meshes_out.retain(|m| (m.cx, m.cz) != (cx, cz));
        self.meshes_out.push(MeshUpdate { cx, cz, verts });
    }

    /// O renderizador foi recriado (o Android derruba a superfície ao sair do app): todas as malhas precisam ser refeitas.
    pub fn remesh_all(&mut self) {
        for c in self.chunks.values_mut() {
            c.meshed = false;
            c.dirty = true;
        }
        self.pending_mesh.clear();
        self.meshes_out.clear();
        self.arrived.retain(|d| !matches!(d, Done::Mesh { .. }));
    }

    /// malhas prontas desde a última chamada (o renderizador sobe para a GPU)
    pub fn take_meshes(&mut self) -> Vec<MeshUpdate> {
        std::mem::take(&mut self.meshes_out)
    }

    /// chunks descarregados desde a última chamada
    pub fn take_unloaded(&mut self) -> Vec<Key> {
        std::mem::take(&mut self.unloaded_out)
    }

    fn light_at(&self, x: i32, y: i32, z: i32) -> i32 {
        if y >= CH as i32 {
            return SKY_MAX as i32;
        }
        if y < 0 {
            return 0;
        }
        let (cx, cz) = Self::chunk_key(x, z);
        match self.chunks.get(&(cx, cz)).and_then(|c| c.light.as_ref()) {
            Some(l) => l[idx((x - cx * CS as i32) as usize, y as usize, (z - cz * CS as i32) as usize)] as i32,
            None => -1,
        }
    }

    /// 0 (escuro) a 1 (céu aberto); 1 se ainda não se sabe
    pub fn sky_at(&self, x: f64, y: f64, z: f64) -> f64 {
        let v = self.light_at(x.floor() as i32, y.floor() as i32, z.floor() as i32);
        if v < 0 {
            1.0
        } else {
            v as f64 / SKY_MAX as f64
        }
    }

    fn light_reach(&self, x: i32, y: i32, z: i32, id: BlockId) -> i32 {
        let here = self.light_at(x, y, z);
        let max = SKY_MAX as i32;
        if here < 0 {
            return max;
        }
        let around = [(x + 1, y, z), (x - 1, y, z), (x, y + 1, z), (x, y - 1, z), (x, y, z + 1), (x, y, z - 1)];
        let open = |p: (i32, i32, i32)| p.1 >= CH as i32 || (p.1 > 0 && self.peek_block(p.0, p.1, p.2) == AIR);
        if id == AIR {
            let mut v = 0;
            if open(around[2]) && self.light_at(x, y + 1, z) == max {
                v = max;
            } else {
                for &p in &around {
                    if open(p) {
                        v = v.max(self.light_at(p.0, p.1, p.2) - 1);
                    }
                }
            }
            for &p in &around {
                if open(p) && self.light_at(p.0, p.1, p.2) < v - 1 {
                    return v;
                }
            }
            return 0;
        }
        if here <= 1 {
            return 0;
        }
        if here == max && open(around[3]) {
            return max;
        }
        for &p in &around {
            if open(p) && self.light_at(p.0, p.1, p.2) == here - 1 {
                return here;
            }
        }
        0
    }

    fn settle_prop(&mut self, x: i32, y: i32, z: i32) {
        let (cx, cz) = Self::chunk_key(x, z);
        let has = self.chunks.get(&(cx, cz)).is_some_and(|c| c.props.iter().any(|p| p.wx == x && p.wz == z && p.y > y));
        if has {
            let top = self.top_y(x, z) + 1;
            if let Some(c) = self.chunks.get_mut(&(cx, cz)) {
                for p in c.props.iter_mut().filter(|p| p.wx == x && p.wz == z) {
                    p.y = top;
                }
            }
        }
    }

    /// Tira os objetos soltos perto de um ponto (cratera de meteoro). Devolve o tipo e a posição de cada um.
    pub fn remove_props_near(&mut self, c: [f64; 3], r: f64) -> Vec<(&'static str, [f64; 3])> {
        let mut out = Vec::new();
        let (cx0, cz0) = Self::chunk_key((c[0] - r) as i32 - 1, (c[2] - r) as i32 - 1);
        let (cx1, cz1) = Self::chunk_key((c[0] + r) as i32 + 1, (c[2] + r) as i32 + 1);
        for cx in cx0..=cx1 {
            for cz in cz0..=cz1 {
                let Some(ch) = self.chunks.get_mut(&(cx, cz)) else { continue };
                let mut keep = Vec::new();
                for p in ch.props.drain(..) {
                    let pos = [p.wx as f64 + 0.5, p.y as f64, p.wz as f64 + 0.5];
                    let d = crate::js::hypot3(pos[0] - c[0], pos[1] - c[1], pos[2] - c[2]);
                    if d < r {
                        self.removed_props.insert(p.key.clone().unwrap_or_else(|| format!("{},{}", p.wx, p.wz)));
                        out.push((p.kind, pos));
                    } else {
                        keep.push(p);
                    }
                }
                ch.props = keep;
            }
        }
        out
    }

    /// Objeto criado no jogo (meteorito, painel). Fica no chão de agora da coluna e vai para o salvamento.
    pub fn add_extra_prop(&mut self, wx: i32, wz: i32, kind: &'static str, rot: f64, scale: f64) {
        let key = format!("x{wx},{wz},{kind}");
        self.removed_props.remove(&key);
        let y = self.top_y(wx, wz) + 1;
        self.extra_props.retain(|e| e.get("key").and_then(|k| k.as_str()) != Some(key.as_str()));
        self.extra_props.push(serde_json::json!({ "wx": wx, "wz": wz, "type": kind, "variant": 0, "rot": rot, "scale": scale, "key": key }));
        let (cx, cz) = Self::chunk_key(wx, wz);
        if let Some(c) = self.chunks.get_mut(&(cx, cz)) {
            c.props.push(PropSpawn { wx, wz, y, kind, variant: 0, rot, scale, key: Some(key) });
        }
    }

    pub fn prop_removed(&self, p: &PropSpawn) -> bool {
        let k = p.key.clone().unwrap_or_else(|| format!("{},{}", p.wx, p.wz));
        self.removed_props.contains(&k)
    }

    fn unload(&mut self, k: Key) {
        if self.chunks.remove(&k).is_some_and(|c| c.meshed) {
            self.unloaded_out.push(k);
        }
        self.meshes_out.retain(|m| (m.cx, m.cz) != k);
    }

    /// Carrega e malha chunks perto de (px, pz), descarrega os distantes. Devolve quantos faltam.
    pub fn update(&mut self, px: f64, pz: f64, budget: usize) -> usize {
        let pcx = (px / CS as f64).floor() as i32;
        let pcz = (pz / CS as f64).floor() as i32;
        self.last_p = (pcx, pcz);
        let r = self.radius;
        let mut todo: Vec<(i32, i32, i32)> = Vec::new();
        for dz in -r..=r {
            for dx in -r..=r {
                if dx * dx + dz * dz > r * r + r {
                    continue;
                }
                let k = (pcx + dx, pcz + dz);
                match self.chunks.get(&k) {
                    Some(c) if c.meshed && !c.dirty => {}
                    _ => todo.push((dx * dx + dz * dz, k.0, k.1)),
                }
            }
        }
        todo.sort_by_key(|t| t.0);
        if self.pool.is_some() && budget < SYNC_BUDGET {
            self.serve(&todo);
        } else {
            for t in todo.iter().take(budget) {
                self.rebuild(t.1, t.2);
            }
        }
        let far = (r + 2) * (r + 2) + r;
        let gone: Vec<Key> = self
            .chunks
            .keys()
            .filter(|(cx, cz)| {
                let (dx, dz) = (cx - pcx, cz - pcz);
                dx * dx + dz * dz > far
            })
            .copied()
            .collect();
        for k in gone {
            self.unload(k);
        }
        todo.len()
    }

    fn serve(&mut self, todo: &[(i32, i32, i32)]) {
        let pool = self.pool.as_ref().unwrap();
        let max_mesh = pool.threads * MAX_MESH_PER_WORKER;
        let mut gens = self.pending_gen.len();
        let mut sends: Vec<Job> = Vec::new();
        for &(_, cx, cz) in todo {
            let mut ready = true;
            for dz in -1..=1 {
                for dx in -1..=1 {
                    let k = (cx + dx, cz + dz);
                    if self.chunks.contains_key(&k) {
                        continue;
                    }
                    ready = false;
                    if gens < MAX_GEN && !self.pending_gen.contains(&k) {
                        self.pending_gen.insert(k);
                        sends.push(Job::Gen { cx: k.0, cz: k.1 });
                        gens += 1;
                    }
                }
            }
            let k = (cx, cz);
            let Some(c) = self.chunks.get(&k) else { continue };
            if !ready || c.meshed || self.pending_mesh.len() >= max_mesh || self.pending_mesh.contains_key(&k) {
                continue;
            }
            let mut nb = Vec::with_capacity(9);
            for dz in -1..=1 {
                for dx in -1..=1 {
                    let n = &self.chunks[&(cx + dx, cz + dz)];
                    nb.push((n.data.clone(), n.max_y));
                }
            }
            self.pending_mesh.insert(k, self.edit_stamp);
            sends.push(Job::Mesh { cx, cz, nb, stamp: self.edit_stamp });
        }
        for j in sends {
            let _ = pool.jobs.send(j);
        }
        self.drain();
    }

    fn drain(&mut self) {
        if let Some(pool) = &self.pool {
            while let Ok(d) = pool.done.try_recv() {
                self.arrived.push(d);
            }
        }
        let (pcx, pcz) = self.last_p;
        let r = self.radius;
        let far = (r + 2) * (r + 2) + r;
        let mut meshes = 0;
        let mut i = 0;
        while i < self.arrived.len() {
            if matches!(self.arrived[i], Done::Mesh { .. }) && meshes >= APPLY_PER_FRAME {
                i += 1;
                continue;
            }
            match self.arrived.remove(i) {
                Done::Gen { cx, cz, g } => {
                    self.pending_gen.remove(&(cx, cz));
                    let (dx, dz) = (cx - pcx, cz - pcz);
                    if self.chunks.contains_key(&(cx, cz)) || dx * dx + dz * dz > far {
                        continue;
                    }
                    self.install(cx, cz, g);
                }
                Done::Mesh { cx, cz, verts, light, stamp } => {
                    self.pending_mesh.remove(&(cx, cz));
                    let ok = self.chunks.get(&(cx, cz)).is_some_and(|c| !c.meshed) && !self.stale(cx, cz, stamp);
                    if !ok {
                        continue;
                    }
                    self.chunks.get_mut(&(cx, cz)).unwrap().light = Some(light);
                    self.apply_mesh(cx, cz, verts);
                    meshes += 1;
                }
            }
        }
    }

    fn stale(&self, cx: i32, cz: i32, stamp: u64) -> bool {
        for dz in -1..=1 {
            for dx in -1..=1 {
                match self.chunks.get(&(cx + dx, cz + dz)) {
                    Some(n) if n.edited_at <= stamp => {}
                    _ => return true,
                }
            }
        }
        false
    }

    /// Raio por voxels (DDA): o bloco atingido e a normal da face.
    pub fn raycast(&self, o: [f64; 3], d: [f64; 3], max_dist: f64) -> Option<VoxelHit> {
        let (mut x, mut y, mut z) = (o[0].floor() as i32, o[1].floor() as i32, o[2].floor() as i32);
        let sgn = |v: f64| {
            if v > 0.0 {
                1
            } else if v < 0.0 {
                -1
            } else {
                0
            }
        };
        let (sx, sy, sz) = (sgn(d[0]), sgn(d[1]), sgn(d[2]));
        let inv = |v: f64| if v != 0.0 { (1.0 / v).abs() } else { f64::INFINITY };
        let (tdx, tdy, tdz) = (inv(d[0]), inv(d[1]), inv(d[2]));
        let first = |dv: f64, p: f64, c: i32, td: f64| {
            if dv > 0.0 {
                (c as f64 + 1.0 - p) * td
            } else if dv < 0.0 {
                (p - c as f64) * td
            } else {
                f64::INFINITY
            }
        };
        let mut tmx = first(d[0], o[0], x, tdx);
        let mut tmy = first(d[1], o[1], y, tdy);
        let mut tmz = first(d[2], o[2], z, tdz);
        let mut t = 0.0;
        let mut n = [0i32; 3];
        for _ in 0..600 {
            if t > max_dist {
                break;
            }
            if (0..CH as i32).contains(&y) {
                let id = self.peek_block(x, y, z);
                if id != AIR {
                    return Some(VoxelHit { x, y, z, id, normal: n, t });
                }
            } else if y < 0 {
                return None;
            }
            if tmx < tmy && tmx < tmz {
                x += sx;
                t = tmx;
                tmx += tdx;
                n = [-sx, 0, 0];
            } else if tmy < tmz {
                y += sy;
                t = tmy;
                tmy += tdy;
                n = [0, -sy, 0];
            } else {
                z += sz;
                t = tmz;
                tmz += tdz;
                n = [0, 0, -sz];
            }
        }
        None
    }

    pub fn serialize(&self) -> WorldSave {
        let mut edits = BTreeMap::new();
        for (k, m) in &self.edits {
            edits.insert(format!("{},{}", k.0, k.1), m.iter().map(|(&i, &id)| (i, id)).collect());
        }
        let mut removed: Vec<String> = self.removed_props.iter().cloned().collect();
        removed.sort();
        WorldSave { edits, removed_props: removed, extra_props: self.extra_props.clone() }
    }

    /// Precisa ser chamado antes de qualquer chunk ser gerado.
    pub fn load(&mut self, s: &WorldSave) {
        for (k, list) in &s.edits {
            let mut it = k.split(',').map(|v| v.trim().parse::<i32>());
            if let (Some(Ok(cx)), Some(Ok(cz))) = (it.next(), it.next()) {
                let m = self.edits.entry((cx, cz)).or_default();
                for &(i, id) in list {
                    if i < CHUNK_LEN {
                        m.insert(i, id);
                    }
                }
            }
        }
        self.removed_props.extend(s.removed_props.iter().cloned());
        self.extra_props = s.extra_props.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blocks::ROCK;

    fn sum(verts: &[Vertex]) -> f64 {
        verts.iter().map(|v| v.pos[0] as f64 + v.pos[1] as f64 * 3.0 + v.sky as f64 * 7.0 + v.color[1] as f64).sum()
    }

    #[test]
    fn threads_dao_a_mesma_malha() {
        let mut a = World::new(PlanetId::Lua, 99);
        a.radius = 2;
        a.update(0.0, 0.0, SYNC_BUDGET);
        let mut ma: HashMap<Key, f64> = a.take_meshes().into_iter().map(|m| ((m.cx, m.cz), sum(&m.verts))).collect();
        let mut b = World::new(PlanetId::Lua, 99);
        b.radius = 2;
        b.enable_threads(3);
        let mut mb: HashMap<Key, f64> = HashMap::new();
        for _ in 0..2000 {
            let left = b.update(0.0, 0.0, 2);
            for m in b.take_meshes() {
                mb.insert((m.cx, m.cz), sum(&m.verts));
            }
            if left == 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert_eq!(ma.len(), mb.len());
        for (k, v) in ma.drain() {
            assert_eq!(Some(&v), mb.get(&k), "chunk {k:?}");
        }
    }

    #[test]
    fn editar_refaz_a_malha_e_salva() {
        let mut w = World::new(PlanetId::Lua, 5);
        w.radius = 1;
        w.update(0.5, 0.5, SYNC_BUDGET);
        w.take_meshes();
        let top = w.top_y(30, 30);
        assert!(w.set_block(30, top + 1, 30, ROCK));
        let m = w.take_meshes();
        assert!(m.iter().any(|m| (m.cx, m.cz) == (1, 1)), "o chunk editado ganhou malha nova");
        let s = w.serialize();
        let json = serde_json::to_string(&s).unwrap();
        let mut w2 = World::new(PlanetId::Lua, 5);
        w2.load(&serde_json::from_str(&json).unwrap());
        assert_eq!(w2.get_block(30, top + 1, 30), ROCK);
    }

    #[test]
    fn raio_acerta_o_chao() {
        let mut w = World::new(PlanetId::Lua, 5);
        w.radius = 1;
        w.update(0.5, 0.5, SYNC_BUDGET);
        let top = w.top_y(0, 0);
        let hit = w.raycast([0.5, 80.0, 0.5], [0.0, -1.0, 0.0], 200.0).expect("acertou");
        assert_eq!((hit.x, hit.y, hit.z, hit.normal), (0, top, 0, [0, 1, 0]));
    }
}
