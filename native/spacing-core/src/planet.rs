//! Planetas como dados (porte de `src/data/planets.ts`).

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum PlanetId {
    #[default]
    Lua,
    Marte,
}

#[derive(Clone, Copy, Debug)]
pub struct Physics {
    /// gravidade do astronauta (blocos/s²) e impulso do pulo
    pub gravity: f64,
    pub jump: f64,
    pub fall_safe_speed: f64,
    pub debris_gravity: f64,
    pub debris_drag: f64,
    pub loot_gravity: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Sky {
    pub top: &'static str,
    pub bottom: &'static str,
    pub stars: bool,
    pub moons: bool,
    pub mist: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub struct Light {
    pub sky: &'static str,
    pub ground: &'static str,
    pub hemi: f64,
    pub sun: &'static str,
    pub sun_power: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct PlanetDef {
    pub id: PlanetId,
    pub key: &'static str,
    pub name: &'static str,
    /// semente dos salvamentos antigos (jogo novo sorteia)
    pub seed: u32,
    pub region: &'static str,
    pub sky: Sky,
    pub light: Light,
    pub physics: Physics,
    pub solar: f64,
    pub air: bool,
    pub footprint_life: f64,
    pub footprint_color: [f64; 3],
}

pub const LUA: PlanetDef = PlanetDef {
    id: PlanetId::Lua,
    key: "lua",
    name: "Lua",
    seed: 20261111,
    region: "Missão 01 · Cratera Shackleton",
    sky: Sky { top: "#1a1636", bottom: "#5d4f86", stars: true, moons: false, mist: "#8b8fd8" },
    light: Light { sky: "#a39ae6", ground: "#5b4a44", hemi: 1.55, sun: "#fff0dc", sun_power: 3.3 },
    physics: Physics { gravity: 15.0, jump: 7.4, fall_safe_speed: 14.0, debris_gravity: 0.45, debris_drag: 0.0, loot_gravity: 9.0 },
    solar: 1.0,
    air: false,
    footprint_life: 45.0,
    footprint_color: [0.1, 0.085, 0.14],
};

pub const MARTE: PlanetDef = PlanetDef {
    id: PlanetId::Marte,
    key: "marte",
    name: "Marte",
    seed: 20261112,
    region: "Expedição Marte · Elysium Planitia",
    sky: Sky { top: "#a8674a", bottom: "#e2b48a", stars: false, moons: true, mist: "#d39a72" },
    light: Light { sky: "#e2bca2", ground: "#5c3426", hemi: 1.45, sun: "#fff0e2", sun_power: 2.9 },
    physics: Physics { gravity: 30.0, jump: 9.2, fall_safe_speed: 16.0, debris_gravity: 3.5, debris_drag: 0.6, loot_gravity: 13.0 },
    solar: 0.43,
    air: true,
    footprint_life: 240.0,
    footprint_color: [0.16, 0.05, 0.03],
};

pub fn planet(id: PlanetId) -> &'static PlanetDef {
    match id {
        PlanetId::Lua => &LUA,
        PlanetId::Marte => &MARTE,
    }
}

impl PlanetId {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "lua" => Some(Self::Lua),
            "marte" => Some(Self::Marte),
            _ => None,
        }
    }
    /// um gerador novo para este planeta (cada thread cria o seu)
    pub fn terrain(self, seed: u32) -> Box<dyn crate::terrain::TerrainGen> {
        match self {
            Self::Lua => Box::new(crate::terrain::Terrain::new(seed)),
            Self::Marte => Box::new(crate::mars::MarsTerrain::new(seed)),
        }
    }
}
