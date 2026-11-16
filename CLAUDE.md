# Spacing: instruções para o Claude (branch `snapshot`, o jogo nativo em Rust)

**Sessão nova? Comece por [docs/ESTADO_ATUAL.md](docs/ESTADO_ATUAL.md)** (onde o porte está, o que falta, decisões do dono).
Depois leia o [plano do porte](docs/design/PORTE_RUST.md), o [README do nativo](native/README.md) e, para a interface,
[design/INTERFACE_NATIVA.md](docs/design/INTERFACE_NATIVA.md).

## As branches (cada projeto na sua)

| Branch     | O que tem                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `snapshot` | **Só o Rust**: `native/` (o jogo nativo e o APK), `prototypes/nativo/` e `docs/`. Daqui sai o APK `spacing-nativo`. |
| `web`      | **Só o site**: o jogo em Three.js/TypeScript e o APK Capacitor (`spacing-apk`). Sem Rust.                |
| `main`     | Só versões **já testadas** pelo dono, cada uma como release. Só recebe PR da `snapshot` (e da `web`).       |

Não misture: arquivo do site não entra na `snapshot`, arquivo do Rust não entra na `web`. O jogo web é a **referência** do
porte: o código TS dele está na `web` (não aqui). `src/ui/...` e `src/systems/...` citados nos comentários do Rust são arquivos **da
branch `web`**.

## Dono do projeto

- Fala português do Brasil. Responda e escreva documentação e textos de interface em português, em linguagem simples.
- Joga e testa pelo **celular** (Android, tela adaptativa 60/120 Hz, Adreno 710). Não há tela aqui: o que depende de olhar no
  aparelho, descreva o que viu nas capturas e **peça para ele conferir**.
- Quer um projeto **profissional, estruturado e planejado**. Pense e documente antes de implementar coisa grande, e
  **confirme o entendimento antes de tarefa grande de interface** (ele corrige o rumo no meio).
- **Faça tudo na branch `snapshot`** (ele não quer commits espalhados). Push nela: já autorizado em definitivo. Criar
  repositório, abrir PR, release, apagar branch ou reescrever histórico: **peça antes**.
- **Não publique o jogo como artifact nem em site nenhum.** O APK de teste vem do GitHub Actions.
- Mudou decisão técnica, design ou arte? Atualize o documento ou escreva um ADR na mesma mudança.

## Comandos (em `native/`)

| Comando                                        | O que faz                                          |
| ---------------------------------------------- | -------------------------------------------------- |
| `cargo test -p spacing-core --release`         | Núcleo e **paridade com o TS** (vetores dourados)  |
| `cargo test -p spacing-render -p spacing-app --release` | Desenho e app                              |
| `cargo clippy --release`                       | Precisa passar limpo antes de commitar            |
| `cargo run --release -p spacing-app`           | Roda no computador (winit)                         |
| `spacing --telas <pasta>`                      | Capturas de cada tela de menu (1688×780)           |
| `spacing --captura <pasta> [lua\|marte] [semente]` | Captura do mundo sem janela                    |
| `spacing --roteiro <pasta>`                    | Jogo jogado por script (49 etapas)                 |

Sem GPU aqui: para capturar, aponte `VK_ICD_FILENAMES` para o SwiftShader do Chromium do Playwright
(`/opt/pw-browsers/chromium-*/chrome-linux64/vk_swiftshader_icd.json`). Antes de enviar, **compile para o Android**
(`cargo ndk`; o APK já quebrou por módulo de captura fora de `#[cfg(not(target_os = "android"))]`; ver `native/README.md`).

## Mapa rápido do nativo ([native/README.md](native/README.md))

- `spacing-core`: lógica pura (mundo, malha, luz, física, regras, salvamento v12), **igual ao TS**, provada por vetores
  dourados em `native/golden/` e `native/assets/` (`rules.json`, `props.bin`).
- `spacing-render`: wgpu 30 (HDR, MSAA 4x, sombra, bloom, render headless para PNG).
- `spacing-app`: jogo, controles, HUD e telas em egui 0.37 (`lib.rs`, `game.rs`, `hud.rs`, `telas.rs`, `controls.rs`,
  `prefs.rs`, `storage.rs`, `fontes.rs` com a Pixelify Sans).
- Modelos 3D (`.glb` do Blender) em `native/assets/models/`; fonte em `native/assets/fonts/`.
- Etapas: M0 a M4 feitas; do M5, título, configurações, pausa, controles e carregamento; M6 (som, desempenho, Windows,
  acabamento) não começou. Detalhe em `docs/design/PORTE_RUST.md`. Próximas etapas só com o dono mandando.

## Vetores dourados (o TS é a fonte)

Os vetores (`native/golden/*.json`, `native/assets/rules.json`, `props.bin`) saem do jogo web. **Eles já estão commitados:** o
Rust só os repete. Só refaça se o gerador, a malha ou as regras mudarem **na branch `web`**:

```bash
git worktree add ../spacing-web web && cd ../spacing-web && npm install
mkdir -p native && npm run golden        # grava native/assets e native/golden
cp -r native/assets native/golden <snapshot>/native/ ; cd <snapshot>/native && cargo test -p spacing-core --release
```

Os modelos `.glb` são gerados no Blender por `tools/models/` **na branch `web`**; para mudar um, gere lá e copie para
`native/assets/models/`.

## Salvamento

O nativo grava o **mesmo formato v12** do jogo web (`spacing-core/src/save.rs`; paridade do `migrate` nos vetores). Mudou o
`save.ts` na `web`? Mude os dois.

## Decisões e referências

ADRs em `docs/adr/` (porte: ADR 0023), design em `docs/design/`, arte em `docs/art/`. A régua de medição do protótipo está em
`docs/design/NATIVO.md` e `prototypes/nativo/` (a página Three.js dele só roda na branch `web`, que tem o `npm`).
