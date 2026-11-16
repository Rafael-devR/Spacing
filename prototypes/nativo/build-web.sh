#!/usr/bin/env bash
# Compila o protótipo para o navegador (WebAssembly) em web/pkg/ (docs/design/NATIVO.md). Precisa do alvo
# wasm32-unknown-unknown e do wasm-bindgen-cli na mesma versão do wasm-bindgen do Cargo.toml (0.2.130).
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript --out-dir web/pkg target/wasm32-unknown-unknown/release/spacing_bench.wasm
ls -la web/pkg
