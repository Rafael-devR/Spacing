# Protótipo nativo: navegador × Rust × Android

> Desde 2026-11-14. Ainda não é decisão: é a medição que vai decidir se vale reescrever o jogo nativo.

## Por quê

O dono sente o jogo pesado no celular (que é potente), e o APK do Capacitor ([APK.md](APK.md)) roda igual ao navegador, porque **é o
navegador** (WebView). Ele quer o jogo nativo no celular, por desempenho e porque acha melhor para 3D, e perguntou sobre Rust e sobre
Rust no navegador. Reescrever ~28 mil linhas de TypeScript (e trocar o Three.js por um motor próprio) é trabalho de meses; antes disso,
este protótipo responde com número **quanto o nativo ganha no aparelho dele**.

## O que é

Uma cena de cubos em pedaços (como os chunks do jogo), com a mesma câmera, a mesma luz e a mesma rampa de carga, feita de três jeitos:

| Versão | Onde | Como desenha |
| --- | --- | --- |
| 1. Three.js | navegador | como o jogo hoje (WebGL2, um `Mesh` por pedaço) |
| 2. Rust no navegador | navegador | Rust + wgpu compilado para WebAssembly, desenhando em WebGL2 |
| 3. Rust nativo | APK | o mesmo Rust + wgpu, direto no Vulkan do celular (sem navegador) |

A 2 e a 3 são o **mesmo código** (`prototypes/nativo/src/`); a 1 repete as contas em TypeScript (`web/three.ts`). Comparando:

- **1 × 2:** quanto custa o Three.js/JavaScript (mesmo WebGL2 por baixo);
- **2 × 3:** quanto custa o navegador (mesmo código, só muda WebGL2 → Vulkan);
- **1 × 3:** o ganho total de reescrever nativo.

## A rampa (igual nas três) — versão 2

Para cada um de **quatro números** (chamadas de desenho e triângulos, cada um em 60 e em 120 quadros por segundo) o teste procura a
**maior carga que ainda cabe**: sobe 60% por passo até falhar e depois divide ao meio entre o último que coube e o primeiro que falhou
(precisão de uns 3%). Cada passo espera 0,4 s e mede 1 s. A média do quadro tem de ficar em 17,5 ms (60 FPS) ou 8,8 ms (120 FPS).

1. **Taxa da tela** no começo de cada rodada (cena vazia).
2. **Chamadas de desenho:** pedaços de 32 cubos (384 triângulos), de 16 até 16 384 pedaços.
3. **Triângulos:** 16 pedaços cada vez maiores, de 512 até 131 072 cubos cada.
4. **3 rodadas**; a tela mostra a **mediana e o intervalo** (menor-maior).

Sem descarte (tudo na tela), sem sombra, sem pós-processamento: mede desenhar, não efeitos. Os números do jogo de verdade são menores
(o jogo faz muito mais por quadro); o que vale é a **proporção** entre as três versões.

**Tela adaptativa (o celular do dono):** a tela só vai a 120 Hz com toque. Se a taxa medida for menor que 100 Hz, os testes de 120 FPS
da rodada são **pulados** (não adianta medir 120 numa tela a 60) e a tela pede "MEXA O DEDO NA TELA". Durante o teste, **mexa o dedo na
tela o tempo todo** (um toque parado não mantém a taxa).

**Mesma imagem nas três:** as páginas do navegador só começam depois de um toque em "Começar", que entra em **tela cheia** (como o app
nativo, que já é). A tela mostra o tamanho do desenho (largura × altura e megapixels) para conferir que são iguais.

## Resultado da primeira rodada de testes (versão 1, celular do dono, 2026-11-14)

Versão 1 da rampa (degraus de 25%, uma rodada). O navegador não estava em tela cheia (imagem 2247×838 no Three.js, 2248×996 no Rust,
contra 2340×1080 no APK) e a tela ficou em 58–59 Hz no navegador contra 118 Hz no APK. Maior degrau que coube em 60 FPS; o real fica
entre ele e o próximo (25% maior):

| Versão | Chamadas de desenho | Triângulos | 120 FPS |
| --- | --- | --- | --- |
| Three.js no navegador | 3 550 | 3,5 MI | não medido (tela a 59 Hz) |
| Rust no navegador | 5 548 | 2,8 MI | não medido (tela a 58 Hz) |
| Rust nativo (APK) | 5 548 | 2,8 MI | 1 817 chamadas, 1,1 MI |

Leitura: o Rust no navegador desenhou entre 25% e 95% mais chamadas que o Three.js (parte do custo é do Three.js/JavaScript); o nativo
**não** passou do Rust no navegador a 60 FPS; nos triângulos o Three.js ficou na frente (inesperado, talvez a diferença de pixels e os
degraus grandes). **Não conclusivo:** o 120 FPS do nativo não é comparável (o navegador nem chegou a 120 Hz) e as imagens tinham
tamanhos diferentes. Daí a versão 2.

## Como rodar

- **Navegador (1 e 2):** no Codespace, `npm run proto:web` e abra no celular o endereço da porta **5174**
  (`https://<codespace>-5174.app.github.dev`): a página tem os dois testes.
- **Nativo (3):** GitHub → Actions → "Teste nativo (protótipo)" → artefato `spacing-teste-nativo` (APK, instala ao lado do jogo; ícone
  igual, nome "Spacing teste nativo").
- Deitado, brilho normal, sem outros apps abertos; espere aparecer **RESULTADO** (uns 4 minutos por teste). Toque para repetir.
- Mande uma foto das três telas de resultado. Se aparecer "MEXA O DEDO NA TELA", a tela estava a menos de 100 Hz: repita mexendo o dedo.

## Como decidir com o resultado

- **Nativo bem acima** (mais que o dobro nas chamadas de desenho) → o navegador é o gargalo; reescrever nativo tem motivo. Próximo
  passo seria planejar a reescrita em partes (núcleo em Rust, desenho em wgpu), num ADR.
- **Rust no navegador perto do nativo, os dois bem acima do Three.js** → o custo é do Three.js/JavaScript, não do navegador; dá para
  ganhar sem sair do navegador (núcleo em Rust/WASM, ou desenho próprio).
- **As três parecidas** → o gargalo é a placa de vídeo; o caminho é desenhar menos (menos pedaços, resolução, efeitos), em qualquer
  linguagem.

## Código

`prototypes/nativo/`: `src/bench.rs` (rampa, testada), `src/scene.rs` (cubos, grade, câmera), `src/gfx.rs` (wgpu), `src/font.rs`
(números na tela), `src/lib.rs` (laço com winit; entrada `android_main` e `start` para o navegador), `android/` (APK só com a biblioteca,
NativeActivity), `web/` (páginas; `web/pkg/` é o WebAssembly já compilado, para o Codespace não precisar de Rust),
`build-android.sh`, `build-web.sh`. Testes: `cargo test --lib`. Fluxo do GitHub: `.github/workflows/prototype-apk.yml`. Captura das
páginas: `tools/visual-check/prototipo.mjs`.

O protótipo não importa nada do jogo e o jogo não importa nada dele.

## Em aberto

- Nunca rodou num celular (aqui só compila e roda no navegador com placa de vídeo simulada).
- Medir também com o jogo de verdade (o teste de desempenho do menu de pausa) para comparar com estes números.
