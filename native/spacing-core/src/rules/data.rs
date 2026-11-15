//! Dados das regras, lidos de `native/assets/rules.json` (exportado do TS por `npm run golden`, tools/golden/rules.test.ts).
//! Itens, estações, receitas e equipamentos viram índices pequenos (`ItemId`, `StationId`...), que se escrevem no
//! salvamento com o nome do TS ("regolith", "furnace").
use std::sync::OnceLock;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

static RAW: OnceLock<serde_json::Value> = OnceLock::new();
static NAMES: OnceLock<Names> = OnceLock::new();
static RULES: OnceLock<Rules> = OnceLock::new();

fn raw() -> &'static serde_json::Value {
    RAW.get_or_init(|| serde_json::from_str(include_str!("../../../assets/rules.json")).expect("assets/rules.json inválido"))
}

/// Os nomes de cada lista, prontos antes das regras: ler as regras precisa transformar nomes em índices (uma receita
/// cita itens), e procurar o nome dentro de `rules()` enquanto ela é montada trava o `OnceLock`.
struct Names {
    items: Vec<String>,
    stations: Vec<String>,
    equipment: Vec<String>,
    recipes: Vec<String>,
    drills: Vec<String>,
}

fn names() -> &'static Names {
    NAMES.get_or_init(|| {
        let ids = |k: &str| raw()[k].as_array().expect(k).iter().map(|d| d["id"].as_str().expect("id").to_string()).collect();
        Names { items: ids("items"), stations: ids("stations"), equipment: ids("equipment"), recipes: ids("recipes"), drills: ids("drills") }
    })
}

/// Os dados das regras (lidos uma vez).
pub fn rules() -> &'static Rules {
    RULES.get_or_init(|| Rules::deserialize(raw()).expect("assets/rules.json inválido"))
}

macro_rules! id_type {
    ($name:ident, $t:ty, $list:ident, $what:literal) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(pub $t);

        impl $name {
            /// pelo nome do TS ("regolith")
            pub fn parse(s: &str) -> Option<Self> {
                names().$list.iter().position(|d| d == s).map(|i| Self(i as $t))
            }

            /// pelo nome do TS; nome desconhecido é erro de programa (os dados vêm do mesmo lugar)
            pub fn of(s: &str) -> Self {
                Self::parse(s).unwrap_or_else(|| panic!(concat!($what, " desconhecido: {}"), s))
            }

            /// o nome do TS
            pub fn key(self) -> &'static str {
                &names().$list[self.0 as usize]
            }

            pub fn all() -> impl Iterator<Item = Self> {
                (0..names().$list.len()).map(|i| Self(i as $t))
            }
        }

        impl std::fmt::Debug for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.key())
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(self.key())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let s = String::deserialize(d)?;
                Self::parse(&s).ok_or_else(|| serde::de::Error::custom(format!(concat!($what, " desconhecido: {}"), s)))
            }
        }
    };
}

id_type!(ItemId, u16, items, "item");
id_type!(StationId, u8, stations, "estação");
id_type!(EquipId, u8, equipment, "equipamento");
id_type!(RecipeId, u16, recipes, "receita");
id_type!(DrillId, u8, drills, "broca");

impl ItemId {
    pub fn data(self) -> &'static ItemData {
        &rules().items[self.0 as usize]
    }

    pub fn stack(self) -> u32 {
        self.data().stack
    }
}

impl StationId {
    pub fn data(self) -> &'static StationData {
        &rules().stations[self.0 as usize]
    }
}

impl EquipId {
    pub fn data(self) -> &'static EquipData {
        &rules().equipment[self.0 as usize]
    }
}

impl RecipeId {
    pub fn data(self) -> &'static Recipe {
        &rules().recipes[self.0 as usize]
    }
}

impl DrillId {
    pub fn data(self) -> &'static DrillData {
        &rules().drills[self.0 as usize]
    }
}

#[derive(Deserialize, Debug)]
pub struct Traits {
    pub heat: f64,
    pub mass: f64,
    pub rarity: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ItemData {
    pub id: String,
    pub name: String,
    /// para que serve, em uma frase
    pub about: String,
    pub traits: Traits,
    /// bloco que o item coloca ao construir
    pub block: Option<u8>,
    pub icon_block: Option<u8>,
    pub icon_prop: Option<String>,
    pub model: Option<String>,
    pub color: Option<String>,
    pub stack: u32,
    /// objeto que o item coloca no mundo (painel solar)
    pub place: Option<String>,
    /// projeto com holograma (estufa, canteiro)
    pub site: Option<String>,
    pub farm: Option<String>,
    /// comida: quanta energia devolve
    pub food: Option<f64>,
    pub tint: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StationData {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub accent: String,
    pub chamber: String,
    /// segundos fixos de preparo com energia cheia
    pub base: f64,
    /// segundos por ponto de trabalho dos ingredientes
    pub per_work: f64,
    pub slots: usize,
    /// "grid" (eletricidade) ou "sun" (espelhos)
    pub energy: String,
    pub kw: f64,
    pub energy_name: String,
    pub built_in: bool,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Output {
    Item { item: ItemId, n: u32 },
    Equip { equip: EquipId },
    Station { station: StationId },
}

#[derive(Deserialize, Debug)]
pub struct Process {
    pub reaction: String,
    pub steps: Vec<String>,
    pub note: String,
    pub temp: Option<f64>,
}

#[derive(Deserialize, Debug)]
pub struct Recipe {
    pub id: String,
    pub station: StationId,
    /// na ordem do TS (a ordem entra nas somas e no que sai primeiro)
    pub inputs: Vec<(ItemId, u32)>,
    pub outputs: Vec<Output>,
    pub process: Process,
    pub effort: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DrillData {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tier: u32,
    pub speed: f64,
    pub drain: f64,
    pub bit: String,
    pub glow: Option<String>,
    pub bit_scale: f64,
}

#[derive(Deserialize, Debug)]
pub struct EquipData {
    pub id: String,
    pub name: String,
    /// encaixe do traje: "drill" ou "map"
    pub slot: String,
    pub description: String,
    pub drill: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PowerData {
    pub roof_panels: f64,
    pub roof_panel_kw: f64,
    pub panel_kw: f64,
    pub cable_reach: f64,
    pub shade_lua: f64,
    pub shade_marte: f64,
    pub battery_kj: f64,
    pub battery_start: f64,
    pub life_support_kw: f64,
    pub suit_charge_kw: f64,
    pub storm_loss: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SuitData {
    pub id: String,
    pub name: String,
    pub o2_seconds: f64,
    pub o2_idle_mul: f64,
    pub o2_mine_mul: f64,
    pub drill_drain: f64,
}

#[derive(Deserialize, Debug)]
pub struct Refill {
    pub o2: f64,
    pub battery: f64,
    pub integrity: f64,
}

#[derive(Deserialize, Debug)]
pub struct Reserve {
    pub at: f64,
    pub amount: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SurvivalData {
    pub pressure_radius: f64,
    pub refill: Refill,
    pub asphyxia_dps: f64,
    pub no_battery_drill_rate: f64,
    pub fall_damage_per_speed: f64,
    pub meteor_max_damage: f64,
    pub meteor_radius: f64,
    pub o2_warn: [f64; 2],
    pub o2_reserve: Reserve,
    pub battery_warn: f64,
    pub respawn_invulnerable: f64,
    pub pickup_radius: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnergyNeed {
    pub enabled: bool,
    pub max: f64,
    pub hunger_per_minute: f64,
    pub warn: [f64; 2],
    pub starve_dps: f64,
    pub respawn: f64,
}

#[derive(Deserialize, Debug)]
pub struct Needs {
    pub energy: EnergyNeed,
}

#[derive(Deserialize, Debug)]
pub struct Part {
    pub id: String,
    pub name: String,
    pub cost: Vec<(ItemId, u32)>,
}

#[derive(Deserialize, Debug)]
pub struct ChestLot {
    pub id: String,
    pub items: Vec<ChestItem>,
}

#[derive(Deserialize, Debug)]
pub struct ChestItem {
    pub item: ItemId,
    pub n: u32,
}

#[derive(Deserialize, Debug)]
pub struct Farm {
    #[serde(rename = "growSeconds")]
    pub grow_seconds: f64,
    #[serde(rename = "waterSeconds")]
    pub water_seconds: f64,
    pub thirsty: f64,
    pub harvest: u32,
    pub reach: f64,
    pub stages: u32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GreenhouseData {
    pub cam_inset: f64,
    pub cam_height: f64,
    pub cam_fov: f64,
    pub cam_fov_tall: f64,
    pub size: i32,
    pub wall_height: i32,
    pub tolerance: i32,
    pub base_gap: i32,
    pub lander_gap: f64,
    pub reach: f64,
    pub door_at: i32,
    pub parts: Vec<Part>,
    pub chest: Vec<ChestLot>,
    pub farm: Farm,
}

/// Um passo da cadeia de missões (data/missions.ts).
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StepKind {
    Collect { item: ItemId, n: u32 },
    Reach { prop: String },
    Prop { prop: String },
    Deliver { needs: Vec<(ItemId, u32)> },
    End,
}

#[derive(Deserialize, Debug, Clone)]
pub struct MissionStep {
    pub id: String,
    pub title: String,
    pub text: String,
    pub hint: Option<String>,
    #[serde(flatten)]
    pub kind: StepKind,
}

#[derive(Deserialize, Debug)]
pub struct Missions {
    pub lua: Vec<MissionStep>,
    pub marte: Vec<MissionStep>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    pub hotbar: usize,
    pub bag: usize,
    pub stack: u32,
    pub items: Vec<ItemData>,
    pub stations: Vec<StationData>,
    pub recipes: Vec<Recipe>,
    pub jitter: f64,
    pub max_batch: u32,
    pub drills: Vec<DrillData>,
    pub equipment: Vec<EquipData>,
    pub equip_slots: Vec<String>,
    pub power: PowerData,
    pub sun_direction: [f64; 3],
    pub suits: Vec<SuitData>,
    pub survival: SurvivalData,
    pub needs: Needs,
    pub greenhouse: GreenhouseData,
    pub missions: Missions,
    pub props: Vec<PropData>,
}

/// objeto solto no chão (data/props.ts)
#[derive(Deserialize, Debug)]
pub struct PropData {
    pub id: String,
    pub name: String,
    /// segundos para minerar com a broca inicial
    pub hardness: f64,
    /// nível mínimo da broca
    pub tier: u32,
    pub drop: ItemId,
    pub amount: u32,
    pub bonus: Vec<(ItemId, u32)>,
    /// cores (lineares) dos pedaços
    pub debris: Vec<[f64; 3]>,
}

impl Rules {
    pub fn prop(&self, kind: &str) -> Option<&PropData> {
        self.props.iter().find(|p| p.id == kind)
    }

    pub fn slot_count(&self) -> usize {
        self.hotbar + self.bag
    }
}

// ---- contas das receitas (data/recipes.ts) ----

/// pontos de trabalho de uma unidade do item: 1 + calor, peso e raridade
pub fn item_work(item: ItemId) -> f64 {
    let t = &item.data().traits;
    1.0 + 0.6 * t.heat + 0.4 * t.mass + 0.8 * t.rarity
}

/// segundos de uma unidade, com energia cheia e a estação só com ela, sem o preparo
pub fn unit_seconds(r: &Recipe) -> f64 {
    let mut work = 0.0;
    for &(item, n) in &r.inputs {
        work += n as f64 * item_work(item);
    }
    r.station.data().per_work * work * r.effort
}

/// segundos esperados de `batch` vezes de uma vez (sem a variação), com uma casa
pub fn recipe_seconds(r: &Recipe, batch: u32) -> f64 {
    crate::js::round((r.station.data().base + unit_seconds(r) * batch as f64) * 10.0) / 10.0
}

/// preparo e tempo por unidade, com a variação; `u` de 0 a 1
pub fn roll_times(r: &Recipe, u: f64) -> (f64, f64) {
    let k = 1.0 + (u * 2.0 - 1.0) * rules().jitter;
    (r.station.data().base * k, unit_seconds(r) * k)
}

/// a receita pode ser feita em lote (só as que dão itens)
pub fn batchable(r: &Recipe) -> bool {
    r.outputs.iter().all(|o| matches!(o, Output::Item { .. }))
}

/// a broca mais fraca que quebra alvos desse nível
pub fn drill_for_tier(tier: u32) -> DrillId {
    DrillId::all().find(|d| d.data().tier >= tier).unwrap_or(DrillId(names().drills.len() as u8 - 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_os_dados() {
        let r = rules();
        assert_eq!(r.slot_count(), 32);
        assert_eq!(ItemId::of("regolith").0, 0);
        assert_eq!(ItemId::of("potato").data().food, Some(25.0));
        assert!(StationId::of("workbench").data().built_in);
        let glass = RecipeId::of("glass").data();
        assert_eq!(glass.inputs, vec![(ItemId::of("regolith"), 3)]);
        assert!(batchable(glass));
        assert!(!batchable(RecipeId::of("furnace").data()));
        assert_eq!(drill_for_tier(1).key(), "iron");
        assert!(matches!(r.missions.lua[5].kind, StepKind::Deliver { .. }));
    }
}
