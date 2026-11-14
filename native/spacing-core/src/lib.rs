//! Núcleo do Spacing em Rust (docs/design/PORTE_RUST.md): regras, dados, gerador de mundo, malha e física, sem gráficos e
//! sem janela. Cada módulo diz de qual arquivo TypeScript é porte; os testes em `tests/golden.rs` provam que dá igual.
pub mod anim;
pub mod base_pad;
pub mod blocks;
pub mod camera;
pub mod caves;
pub mod chunk_mesher;
pub mod fx;
pub mod js;
pub mod mars;
pub mod mars_life;
pub mod mesher;
pub mod meteors;
pub mod noise;
pub mod planet;
pub mod player;
pub mod terrain;
pub mod world;
