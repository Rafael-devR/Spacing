//! Spacing nativo no computador: `cargo run -p spacing-app --release -- [lua|marte] [semente]`.
fn main() {
    #[cfg(not(target_os = "android"))]
    spacing::run_desktop();
}
