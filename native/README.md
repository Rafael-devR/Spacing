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

**Antes de enviar, compile também para o Android** (`cargo ndk -t arm64-v8a -P 26 build --release -p spacing-app --lib`): partes do app
só existem fora do Android (a captura, `#[cfg(not(target_os = "android"))]`), e um módulo posto no lugar errado compila no computador e
quebra o APK. Foi o que derrubou as execuções 14 e 15 do Actions.

### Olhar o jogo sem placa de vídeo (Codespace, servidor)

```bash
export VK_ICD_FILENAMES=$(ls /opt/pw-browsers/chromium-*/chrome-linux64/vk_swiftshader_icd.json | head -1)
./target/release/spacing --captura /tmp/capturas lua 12345
```

Joga um roteiro curto (parado, andando, pulando, um meteoro, girando, afastando; em Marte, um redemoinho e a tempestade) e salva os PNGs; no fim troca de planeta e roda o teste de efeitos. Usa o Vulkan por software que vem
com o Chromium do Playwright; o tempo do quadro dali não vale para o celular.

### Telas de menu (título, configurações, pausa, controles, carregamento)

```bash
./target/release/spacing --telas /tmp/telas
```

Grava uma captura de cada tela de menu no tamanho de um celular deitado (844×390 pontos, densidade 2): `titulo.png`,
`titulo-sem-salvo.png`, `config.png`, `pausa.png`, `controles.png`, `carregando.png`. O desenho fica em `spacing-app/src/telas.rs`
(segue o canvas aprovado pelo dono, `docs/design/INTERFACE_NATIVA.md`); as configurações, em `spacing-app/src/prefs.rs`.

### Roteiro jogado (o `play.mjs` do nativo)

```bash
./target/release/spacing --roteiro /tmp/roteiro
```

Começa um jogo novo e confere, etapa por etapa (OK ou FALHOU), o que um jogador faria: minerar com a mira, cumprir as missões da Lua
(o meteorito da missão cai de verdade e é minerado), salvar no arquivo, abrir o menu e o mapa, morrer sem oxigênio, renascer,
recolher os itens, carregar de novo e abrir um salvamento antigo (v5) do jogo web. Sai com erro se alguma etapa falhou; as capturas
ficam na pasta. Rode depois de mudar jogabilidade ou salvamento.

### Salvamento

Um arquivo JSON por planeta (`save-lua.json`, `save-marte.json`), no mesmo formato do jogo web (versão 12, `spacing-core/src/save.rs`).
No Android fica na pasta interna do app (some ao desinstalar); no computador, em `$SPACING_SAVES` ou `~/.local/share/spacing-nativo`.
O jogo grava sozinho a cada 5 s, ao ir para o fundo e ao fechar; a pausa (`||`, Esc ou P) tem "Salvar" e "Sair para o título".
O jogo abre no título: "Continuar missão" (só com salvamento do planeta escolhido), "Novo jogo" (com salvamento, pede um segundo
toque: apaga o progresso daquele planeta), o planeta e as configurações. Um jogo novo tem semente sorteada; no computador,
`spacing lua 12345` escolhe o planeta do título e a semente de um jogo novo. As configurações ficam em `prefs.json`, na mesma pasta.

Os vetores dourados (`golden/`, `assets/rules.json`, `assets/props.bin`) vêm do jogo web e **já estão commitados**. Mudou o
gerador, a malha, a animação ou as regras no TS (branch `web`)? Refaça lá com `npm run golden` e copie para cá (passo a passo no
`CLAUDE.md`); o Rust precisa passar de novo. Os modelos `.glb` (`assets/models/`) são gerados no Blender na branch `web`.

O APK de teste sai do GitHub Actions (`.github/workflows/native-apk.yml`), artefato `spacing-nativo`.

## Controles

- **Celular:** joystick na metade esquerda (aparece onde o dedo toca), PULAR embaixo à direita, `<` `>` giram a câmera,
  `+` `-` (segurar) aproximam e afastam, `i` liga e desliga o medidor, `M` troca Lua e Marte, `V` liga e desliga o vsync (por padrão o FPS é **sem limite**, para ver quanto o aparelho aguenta; o medidor mostra o modo), `*` solta um meteoro, `B` mede o custo de cada efeito (fique parado; aperte de novo para fechar o resultado), `||` abre o menu (salvar, novo jogo), `MAPA` abre o mapa do tablet (precisa do Mapa, fabricado na bancada).
- **Minerar e construir (celular):** segure o dedo na metade direita da tela: a mira fica acima do dedo e o anel mostra o
  progresso. Longe demais, o astronauta anda até o alvo. `CONSTR.` liga o modo construir: um toque rápido coloca o item
  selecionado na face mirada. A barra de itens fica embaixo; toque num espaço para escolher.
- **Computador:** WASD ou setas, espaço pula, Q e E giram, roda do mouse dá zoom, Tab ou F3 liga o medidor, M troca o planeta, V liga/desliga o vsync, T solta um meteoro, B mede os efeitos, Esc ou P abre o menu (Esc também fecha a tela aberta), N abre o mapa. Mouse: segurar o botão esquerdo minera, o direito constrói, 1 a 8 escolhem o espaço da barra, C liga o modo construir.

## Comparar com o jogo web

As capturas usam a semente **12345** (no computador, `spacing lua 12345` começa um jogo novo nela). Abra o jogo web com `?semente=12345` (e `&planeta=marte` para Marte) e compare o FPS
no mesmo lugar, com a mesma câmera. O medidor mostra FPS, tempo do quadro, chamadas de desenho, triângulos e chunks.
