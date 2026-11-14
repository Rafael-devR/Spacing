# Spacing nativo (Rust)

Porte do jogo para Rust nativo, Android primeiro e computador depois. O plano está em
[docs/design/PORTE_RUST.md](../docs/design/PORTE_RUST.md) e a decisão no [ADR 0023](../docs/adr/0023-porte-para-rust-nativo.md).
O jogo em TypeScript (`src/`) continua sendo a referência de comportamento.

## Pastas

| Pasta            | O que tem                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `spacing-core/`  | Regras sem gráficos: ruído, blocos, gerador da Lua e de Marte, cavernas, malha e luz do céu, mundo em chunks com threads, física e animação do astronauta, câmera. Cada arquivo diz de qual arquivo TS é porte. |
| `spacing-render/`| Desenho com wgpu: sombra do sol, cena em HDR com MSAA (blocos com um buffer por chunk e descarte pela câmera, pedras instanciadas, modelos do Blender, sprites), bloom e passada final (post.rs), egui por cima. Shaders em `src/shaders/`. |
| `spacing-app/`   | O jogo: laço com passo fixo, controles de toque e teclado, HUD com medidor; entrada do Android (`android_main`) e do computador. |
| `android/`       | Projeto Gradle mínimo (NativeActivity, sem Java) que empacota `libspacing.so`.                 |
| `golden/`        | Vetores dourados: resultados do código TS que o Rust precisa reproduzir.                        |
| `assets/`        | Malhas que o TS gera em código, exportadas para o Rust (pedras soltas: `props.bin`).             |

## Comandos

```bash
cd native
cargo test -p spacing-core --release   # inclui a paridade com o TS (tests/golden.rs)
cargo run -p spacing-app --release -- lua 12345   # no computador (planeta e semente opcionais)
./build-android.sh                     # APK (precisa de Android SDK, NDK, cargo-ndk e Java 21)
```

### Olhar o jogo sem placa de vídeo (Codespace, servidor)

```bash
export VK_ICD_FILENAMES=$(ls /opt/pw-browsers/chromium-*/chrome-linux64/vk_swiftshader_icd.json | head -1)
./target/release/spacing --captura /tmp/capturas lua 12345
```

Joga um roteiro curto (parado, andando, pulando, um meteoro, girando, afastando; em Marte, um redemoinho e a tempestade) e salva os PNGs; no fim troca de planeta e roda o teste de efeitos. Usa o Vulkan por software que vem
com o Chromium do Playwright; o tempo do quadro dali não vale para o celular.

Na raiz do projeto, `npm run golden` refaz os vetores dourados a partir do TS. Mudou o gerador, a malha ou a animação no TS?
Rode de novo e faça o Rust passar.

O APK de teste sai do GitHub Actions (`.github/workflows/native-apk.yml`), artefato `spacing-nativo`.

## Controles

- **Celular:** joystick na metade esquerda (aparece onde o dedo toca), PULAR embaixo à direita, `<` `>` giram a câmera,
  `+` `-` (segurar) aproximam e afastam, `i` liga e desliga o medidor, `M` troca Lua e Marte, `V` liga e desliga o vsync (por padrão o FPS é **sem limite**, para ver quanto o aparelho aguenta; o medidor mostra o modo), `*` solta um meteoro, `B` mede o custo de cada efeito (fique parado; aperte de novo para fechar o resultado).
- **Computador:** WASD ou setas, espaço pula, Q e E giram, roda do mouse dá zoom, Tab ou F3 liga o medidor, M troca o planeta, V liga/desliga o vsync, T solta um meteoro, B mede os efeitos.

## Comparar com o jogo web

O nativo começa na semente **12345**. Abra o jogo web com `?semente=12345` (e `&planeta=marte` para Marte) e compare o FPS
no mesmo lugar, com a mesma câmera. O medidor mostra FPS, tempo do quadro, chamadas de desenho, triângulos e chunks.
