# Estado atual: porte para Rust nativo (branch `snapshot`)

> **Para quem abre uma sessão nova:** leia este arquivo, depois o [CLAUDE.md](../CLAUDE.md) (regras, comandos, mapa do código) e o
> [plano do porte](design/PORTE_RUST.md). Retrato de **2026-11-16**; atualize quando uma etapa grande terminar.
> O estado do **site** (jogo web) está na branch `web`, no arquivo `docs/ESTADO_ATUAL.md` de lá.

## O projeto em uma frase

Spacing: jogo de exploração espacial em mundo de blocos (astronauta numa Lua, depois Marte; minera, constrói, fabrica,
sobrevive). O dono decidiu (2026-11-14) **portar para Rust nativo** (Android primeiro, Windows depois), pelo produto e pela pilha,
não só pelo desempenho ([ADR 0023](adr/0023-porte-para-rust-nativo.md)). O jogo web (Three.js) continua como **referência** e
fica na branch `web`.

## Branches e APKs

| Branch     | Conteúdo                              | APK (GitHub Actions, artefato)                        |
| ---------- | ------------------------------------- | ----------------------------------------------------- |
| `snapshot` | só o Rust (`native/`, protótipo, docs) | **Spacing nativo (Rust)**, `native-apk.yml` → `spacing-nativo` |
| `web`      | só o site                             | `android-apk.yml` → `spacing-apk`                    |
| `main`     | versões testadas pelo dono (v0.3.0)   | sem APK                                              |

Trabalhe só na `snapshot` para o Rust. Push nela já autorizado; PR, release e apagar branch pedem confirmação. Ficaram
no GitHub branches antigas que o ambiente não consegue apagar (`beta-0.4`, `desenvolvimento`, `ccr-b3471d6f-0kqfdm`,
`codespace-glowing-eureka-...`): o dono apaga na página de branches.

## Quem é o dono e como trabalhar com ele

- Fala **português do Brasil**; linguagem simples. Quer projeto **profissional, planejado e documentado**.
- Joga **só no celular**. Corrige o rumo no meio da conversa: **confirme o entendimento antes de tarefa grande de interface**.
- Quer, ao fim de cada tarefa: o que mudou em português simples e **o que conferir no celular**.

## Onde o porte está

| Etapa | O quê | Estado |
| ----- | ----- | ------ |
| M0 | workspace, CI, vetores dourados | feito |
| M1 | núcleo (mundo, malha, luz, física, regras, salvamento) com paridade provada contra o TS | feito |
| M2 | andar na Lua: render, threads, toque, astronauta, HUD | feito (150 a 250 FPS sem limite, testado pelo dono) |
| M3 | visual: sombra, bloom, pedras, poeira, Marte vivo, meteoros | feito (40 a 60 FPS com tudo ligado; MSAA 4x) |
| M4 | regras, mineração/construção, base, estações, energia, estufa, missões, mapa, salvar/carregar (v12), roteiro jogado | feito |
| M5 | interface | **parcial**: título, configurações, pausa, controles, carregamento feitos |
| M6 | som, teste de desempenho nativo, Windows, ícone, versão, docs finais | **em andamento**: o **som está feito** (2026-11-16, falta o dono ouvir no celular); a **vibração está feita** (2026-11-16, falta o dono sentir no celular); desempenho, Windows, ícone e versão faltam |

**Falta no M5:** mochila e estações redesenhadas (`items_screen.rs` está em WIP), medidores, objetivo no mundo, ícones flutuantes e
a arte de pixel própria dos ícones (grade, paleta e formato **ainda por decidir**). **Falta no M6:** teste de desempenho, Windows,
ícone do app, versão. **Som (feito):** caixa `spacing-audio` com tudo do `Sfx.ts` do jogo web, ligada ao jogo (passos, golpes,
coleta, alarmes do traje, meteoro, Marte, base, tablet…); a configuração **Som** liga e desliga; pausa e app no fundo congelam.
Detalhes e diferenças do WebAudio em [design/AUDIO_NATIVO.md](design/AUDIO_NATIVO.md).

## Direção de interface (importante)

Telas **minimalistas, em paisagem**, pixel art só em detalhes (fonte Pixelify Sans, aprovada). Referência de estilo:
Garbage Country. Em 2026-11-15 o dono disse que **não gosta de menus** e quer **interface diegética**: HUD dentro do mundo, o
**tablet** como único lugar de opções, medidores no traje, pino de objetivo, o primeiro jogo como pouso. **É só ideia: planejar
em [design/INTERFACE_NATIVA.md](design/INTERFACE_NATIVA.md) antes de codar e só quando ele mandar.**

**Trocar de planeta é só para teste** (a viagem entre planetas é da história). O "Planeta ‹ Lua ›" do título e a tecla M devem
virar um modo de teste (`--teste`); ainda não foi feito.

## O que o dono ainda não viu

- O **som**: nenhum humano ouviu ainda (foi medido por teste e por `.wav`). **Peça para ele conferir no celular, de preferência com fone:** direção (esquerda/direita batem com a tela?), volume, o zumbido do módulo, estalos ou atraso, e se o botão **Som** nas configurações liga e desliga.
- O **APK nativo com as telas novas** (título, configurações, pausa, controles, carregamento): a última build é do commit
  `a9411c1` (15/11); ele ainda não deu retorno. Peça.
- O fluxo completo no celular (título → carregar → jogar → pausa → salvar → sair).

## Como validar sem celular

`spacing --telas <pasta>`, `--captura`, `--roteiro` (65 de 65 etapas passam), `--som <pasta>` (grava os `.wav` do som) e os testes; veja o [CLAUDE.md](../CLAUDE.md).
O SwiftShader do Chromium do Playwright serve de Vulkan por software.

## Próximo passo sugerido (o dono ainda não escolheu)

O som está feito. A vibração também está feita (falta sentir no celular). Faltam: mochila e estações ou o caminho diegético (M5), e do M6 o teste de desempenho, o Windows, o ícone e a versão. **Pergunte antes de começar.**

## Onde ler mais

[README](../README.md) · [native/README.md](../native/README.md) · [PORTE_RUST](design/PORTE_RUST.md) ·
[INTERFACE_NATIVA](design/INTERFACE_NATIVA.md) · [NATIVO](design/NATIVO.md) · [ADRs](adr) · [design/](design)
(os `design/` dos sistemas do jogo descrevem as regras que o Rust porta).
