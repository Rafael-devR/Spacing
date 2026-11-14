//! Blocos do mundo (porte de `src/data/blocks.ts` e `src/world/registry.ts`). Cores em sRGB (hex), convertidas para linear.

pub type BlockId = u8;

pub const AIR: BlockId = 0;
pub const BEDROCK: BlockId = 1;
pub const REGOLITH: BlockId = 2;
pub const ROCK: BlockId = 3;
pub const BASALT: BlockId = 4;
pub const ICE: BlockId = 5;
pub const IRON: BlockId = 6;
pub const CRYSTAL: BlockId = 7;
/// casco da base: só em estruturas e na sacada da porta
pub const HULL: BlockId = 8;
pub const MARS_DUST: BlockId = 9;
pub const MARS_ROCK: BlockId = 10;
pub const DARK_SAND: BlockId = 11;
pub const SEDIMENT: BlockId = 12;
pub const VOLCANIC: BlockId = 13;
pub const HEMATITE: BlockId = 14;
pub const OLIVINE: BlockId = 15;
pub const GYPSUM: BlockId = 16;
pub const LAVA: BlockId = 17;
pub const ANORTHOSITE: BlockId = 18;
pub const BRECCIA: BlockId = 19;
pub const NORITE: BlockId = 20;
pub const GLASSY_BASALT: BlockId = 21;
pub const ILMENITE_ORE: BlockId = 22;
pub const GOLD_ORE: BlockId = 23;
pub const BLOCK_COUNT: usize = 24;

pub type Rgb = [f64; 3];

/// Dados de um bloco (os mesmos campos do TS).
pub struct BlockData {
    pub name: &'static str,
    pub color: &'static str,
    pub top: Option<&'static str>,
    pub bottom: Option<&'static str>,
    pub ore: Option<&'static str>,
    pub ore_mul: f64,
    pub glow: f64,
    /// segundos para quebrar com a broca inicial (infinito = não quebra)
    pub hardness: f64,
    pub tier: u8,
    pub drop: Option<&'static str>,
}

const fn b(name: &'static str, color: &'static str, hardness: f64, drop: Option<&'static str>) -> BlockData {
    BlockData { name, color, top: None, bottom: None, ore: None, ore_mul: 1.0, glow: 1.0, hardness, tier: 0, drop }
}

const INF: f64 = f64::INFINITY;

pub fn block_data(id: BlockId) -> Option<BlockData> {
    let d = match id {
        BEDROCK => b("Rocha-mãe", "#3d3646", INF, None),
        REGOLITH => BlockData { top: Some("#ddd3c3"), bottom: Some("#9a8d7d"), ..b("Regolito", "#b5a796", 0.35, Some("regolith")) },
        ROCK => BlockData { top: Some("#a39a91"), ..b("Rocha lunar", "#8f867e", 0.8, Some("rock")) },
        BASALT => BlockData { top: Some("#7a7183"), tier: 1, ..b("Basalto", "#5d5567", 1.1, Some("basalt")) },
        ICE => BlockData { top: Some("#e4f6fb"), ..b("Gelo", "#a6d9ea", 0.6, Some("ice")) },
        IRON => BlockData { top: Some("#9c9187"), ore: Some("#e07a38"), ..b("Ferro", "#8a8077", 1.4, Some("iron")) },
        CRYSTAL => BlockData {
            top: Some("#77708a"),
            ore: Some("#8ff1ff"),
            ore_mul: 1.6,
            tier: 1,
            ..b("Cristal", "#665e78", 1.5, Some("crystal"))
        },
        HULL => b("Casco da base", "#d9dde6", INF, None),
        MARS_DUST => BlockData { top: Some("#a8644a"), bottom: Some("#764232"), ..b("Poeira marciana", "#8c4f3a", 0.35, Some("marsdust")) },
        MARS_ROCK => BlockData { top: Some("#7f4c3c"), ..b("Rocha marciana", "#6c3f32", 0.8, Some("marsrock")) },
        DARK_SAND => BlockData { top: Some("#4b3b3a"), ..b("Areia escura", "#3e3030", 0.3, Some("darksand")) },
        SEDIMENT => BlockData { top: Some("#c99a72"), ..b("Rocha sedimentar", "#b98a64", 0.7, Some("sediment")) },
        VOLCANIC => BlockData { top: Some("#5e4a46"), tier: 1, ..b("Basalto vulcânico", "#4c3c39", 1.1, Some("volcanic")) },
        HEMATITE => BlockData { top: Some("#8a4c39"), ore: Some("#5d6f8a"), ore_mul: 1.15, ..b("Hematita", "#7a4332", 1.3, Some("hematite")) },
        OLIVINE => BlockData {
            top: Some("#5e4a46"),
            ore: Some("#8fc34a"),
            ore_mul: 1.35,
            tier: 1,
            ..b("Olivina", "#4c3c39", 1.4, Some("olivine"))
        },
        GYPSUM => BlockData { top: Some("#b98a64"), ore: Some("#f4efe6"), ore_mul: 1.1, ..b("Gipsita", "#a87b58", 0.9, Some("gypsum")) },
        ANORTHOSITE => BlockData { top: Some("#e9e6df"), bottom: Some("#b4b0a8"), ..b("Anortosito", "#cfcbc3", 0.9, Some("anorthosite")) },
        BRECCIA => BlockData { top: Some("#9a8f8a"), ..b("Brecha", "#82776f", 0.6, Some("rock")) },
        NORITE => BlockData { top: Some("#6e6a74"), tier: 1, ..b("Norito", "#57535d", 1.3, Some("rock")) },
        GLASSY_BASALT => BlockData { top: Some("#4a4458"), tier: 1, ..b("Basalto vítreo", "#383344", 1.2, Some("basalt")) },
        ILMENITE_ORE => BlockData {
            top: Some("#6e6a74"),
            ore: Some("#2a2634"),
            ore_mul: 0.9,
            tier: 1,
            ..b("Ilmenita", "#57535d", 1.5, Some("ilmenite"))
        },
        GOLD_ORE => BlockData {
            top: Some("#6e6a74"),
            ore: Some("#ffb43a"),
            ore_mul: 1.35,
            tier: 2,
            ..b("Ouro", "#57535d", 1.7, Some("gold"))
        },
        LAVA => BlockData { top: Some("#ff5a14"), bottom: Some("#8a2a14"), glow: 1.7, ..b("Lava", "#d8401a", INF, None) },
        _ => return None,
    };
    Some(d)
}

/// blocos que queimam o traje
pub fn is_hot(id: BlockId) -> bool {
    id == LAVA
}

pub fn srgb_to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

pub fn hex_to_linear(hex: &str, mul: f64) -> Rgb {
    let n = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0);
    [
        srgb_to_linear(((n >> 16) & 255) as f64 / 255.0) * mul,
        srgb_to_linear(((n >> 8) & 255) as f64 / 255.0) * mul,
        srgb_to_linear((n & 255) as f64 / 255.0) * mul,
    ]
}

/// Bloco pronto para a malha: cores lineares por face (porte de `registry.ts`).
#[derive(Clone, Copy)]
pub struct BlockDef {
    pub top: Rgb,
    pub side: Rgb,
    pub bot: Rgb,
    pub ore: Option<Rgb>,
}

fn build(d: &BlockData) -> BlockDef {
    let g = d.glow;
    BlockDef {
        top: hex_to_linear(d.top.unwrap_or(d.color), g),
        side: hex_to_linear(d.color, g),
        bot: hex_to_linear(d.bottom.unwrap_or(d.color), if d.bottom.is_some() { 1.0 } else { 0.8 } * g),
        ore: d.ore.map(|o| hex_to_linear(o, d.ore_mul)),
    }
}

/// tabela indexada pelo id (o ar e ids desconhecidos ficam com cor zero)
pub fn registry() -> &'static [BlockDef; BLOCK_COUNT] {
    use std::sync::OnceLock;
    static R: OnceLock<[BlockDef; BLOCK_COUNT]> = OnceLock::new();
    R.get_or_init(|| {
        let zero = BlockDef { top: [0.0; 3], side: [0.0; 3], bot: [0.0; 3], ore: None };
        let mut r = [zero; BLOCK_COUNT];
        for (id, slot) in r.iter_mut().enumerate() {
            if let Some(d) = block_data(id as BlockId) {
                *slot = build(&d);
            }
        }
        r
    })
}
