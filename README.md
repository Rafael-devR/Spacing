# Spacing (branch `snapshot`: jogo nativo em Rust)

Jogo de exploração espacial em mundo de blocos, visual low poly cartoon. Você é um astronauta que cai na Lua, minera,
constrói, fabrica e sobrevive, rumo a um planeta com vida.

Esta branch tem **só o porte para Rust nativo** (Android e computador). O jogo do navegador está na branch **`web`**; a `main`
guarda só as versões já testadas. Estado e decisões: [docs/ESTADO_ATUAL.md](docs/ESTADO_ATUAL.md). Plano:
[docs/design/PORTE_RUST.md](docs/design/PORTE_RUST.md).

## O que tem aqui

- `native/`: o jogo (núcleo, desenho com wgpu, app com egui) e o projeto Android. Veja o [native/README.md](native/README.md).
- `prototypes/nativo/`: o protótipo que mediu o desempenho (Rust × WASM × Three.js).
- `docs/`: design, ADRs, arte, história.

## Rodar

```bash
cd native
cargo test -p spacing-core --release      # núcleo + paridade com o jogo web
cargo run --release -p spacing-app        # roda no computador
```

O APK de teste para o celular sai do GitHub Actions: fluxo **Spacing nativo (Rust)** (`.github/workflows/native-apk.yml`),
artefato `spacing-nativo`.
