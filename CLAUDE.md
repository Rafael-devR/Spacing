# Spacing: instruções para o Claude

Jogo web de exploração espacial em mundo de blocos (Three.js). **Sessão nova? Comece por
[docs/ESTADO_ATUAL.md](docs/ESTADO_ATUAL.md)** (onde o projeto está, branches, o que o dono já viu, armadilhas). Leia também o
[README](README.md), a [arquitetura](docs/ARCHITECTURE.md) e o [design](docs/GAME_DESIGN.md) antes de mudar algo grande.

## Dono do projeto

- Fala português do Brasil. Responda e escreva documentação e textos de interface em português.
- Joga e testa pelo celular. O desenvolvimento acontece em um **GitHub Codespace** (4 CPUs, 15 GB de RAM,
  sem GPU). Antes rodava no Termux (Ubuntu em PRoot), mas isso mudou.
- Neste ambiente o `apt` não alcança os repositórios do Ubuntu. Instale ferramentas por npm ou pip.
- Quer um projeto **profissional, estruturado e planejado**, não uma pilha de recursos soltos. Pense e
  documente antes de implementar coisas grandes.

## Regras

- **Não publique o jogo como artifact nem em site nenhum.** O jogo fica local. Para o dono testar, suba o
  servidor (`npm run dev`) e diga o endereço. No Codespace a porta 5173 é encaminhada, em endereço privado
  `https://<nome-do-codespace>-5173.app.github.dev` (o nome vem de `$CODESPACE_NAME`).
- Antes de commitar: `npm run lint && npm run typecheck && npm test && npm run build`.
- Siga o fluxo de [CONTRIBUTING.md](CONTRIBUTING.md): branches, Conventional Commits, PR.
- Trabalhe numa **branch só** (hoje `perf/bloom-e-efeitos`); o dono não quer commits espalhados por várias branches.
- Ações visíveis fora da máquina (criar repositório, abrir PR, push, release) só quando o dono pedir.
- Mudou decisão técnica, design, história ou arte? Atualize o documento ou escreva um ADR na mesma mudança.
- Não reorganize a estrutura do código sem o dono pedir. Ela está descrita em
  [ARCHITECTURE.md](docs/ARCHITECTURE.md).
- O Three.js está fixado em `0.160.0`: o material dos blocos depende dos nomes internos dos shaders.
- Depois de mudança visual, **olhe o jogo**: `tools/visual-check` tira capturas num Chromium headless
  (veja o README da pasta). O WebGL roda por software, então o FPS dali não vale para o celular. Estética e
  desempenho em celular real continuam sendo do dono: descreva o que viu e peça para conferir.

## Comandos

| Comando             | O que faz                       |
| ------------------- | ------------------------------- |
| `npm run dev`       | Servidor em `localhost:5173`    |
| `npm run build`     | Tipos e build de produção       |
| `npm test`          | Testes (Vitest)                 |
| `npm run lint`      | ESLint                          |
| `npm run typecheck` | TypeScript                      |

## Mapa rápido

- Código do jogo: `src/`, em TypeScript, organizado por pastas (ver `docs/ARCHITECTURE.md`). Entrada em
  `src/main.ts`; laço, estados e ligação dos sistemas em `src/app/Game.ts`; eventos em `src/app/events.ts`.
- Testes: `tests/`. Capturas de tela, teste jogado, de interface e de áudio: `tools/visual-check/` (`shot.mjs`, `play.mjs`,
  `ui.mjs`, `audio.mjs`;
  ferramenta à parte, com `package.json` próprio). Rode o `play.mjs` depois de mudar jogabilidade, o `ui.mjs`
  depois de mudar o HUD ([design/INTERFACE.md](docs/design/INTERFACE.md)) e o `audio.mjs` depois de mudar o áudio
  ([design/AUDIO.md](docs/design/AUDIO.md)).
- Depuração em `npm run dev`: `window.spacing` é o objeto do jogo; `?eventos` no endereço mostra os eventos.
- Decisões: `docs/adr/`. Referências de arte: `docs/art/reference/`.
- Fabricação (ADR 0009): itens com propósito e calor/peso/raridade em `src/data/items.ts`, estações em `stations.ts`, receitas e
  fórmula do tempo em `recipes.ts`, regras em `src/systems/Crafting.ts`, tela em `src/ui/station/StationScreen.ts`, máquinas em
  `src/render/stationModels.ts` ([design/CRAFTING.md](docs/design/CRAFTING.md), panorama em [design/ITENS.md](docs/design/ITENS.md)).
  Todo item novo precisa de `about` e de uso; o teste `tests/crafting.test.ts` confere. Estações têm vagas e lotes.
- Modelos 3D (ADR 0013, [design/MODELOS.md](docs/design/MODELOS.md)): scripts do Blender em `tools/models/` (`build.sh`, `lib.py`,
  um `.py` por modelo) geram `src/assets/models/*.glb`; `src/render/gltfModels.ts` carrega e troca os materiais pelos do jogo. O
  Blender roda sem janela em `/tmp/blender` (ver `tools/models/README.md`). Teto de triângulos em `tests/models.test.ts`. Luzes que piscam são `SignalLamp` (`src/render/lamps.ts`, núcleo + halo, sem `PointLight`). Base: casco (`habitat.py`) só na camada
  de fora, interior (`habitat_interior.py`) só na de dentro (`interiorOnly`, `src/render/indoors.ts`); medidas em `lib.HAB`. Móveis:
  `furniture.py` (um nó por tipo). Estações: `workbench/furnace/electrolyzer.py`, com animação em laço feita no Blender
  (`lib.keys`, `export(anim=True)`), tocada por `AnimationMixer`.
- Personagem ([design/PERSONAGEM.md](docs/design/PERSONAGEM.md), ADR 0017): modelo `tools/models/astronaut.py` (voxel chibi, um nó por
  junta), esqueleto e item na mão em `src/render/astronaut.ts`, animação procedural pura em `src/render/astronautAnim.ts` (testada em
  `tests/astronautAnim.test.ts`), poeira dos pés em `src/render/dustFx.ts`; teste `tools/visual-check/astronaut.mjs`.
- Tela de itens (ADR 0019, [design/INVENTARIO.md](docs/design/INVENTARIO.md), [design/ESTACOES.md](docs/design/ESTACOES.md)): **mochila e estações
  são a mesma tela em HTML** (`src/ui/inventory/screen.ts`, `#inv`), com o inventário à direita e um painel à esquerda (`src/ui/Bag.ts` ou
  `src/ui/station/StationScreen.ts`). Gestos (arrastar, segurar = metade, toque duplo = mandar rápido) em `src/ui/inventory/hand.ts`; regras
  em `Inventory.moveN/quickMove/sortBag` (`tests/inventoryOps.test.ts`). Câmara animada da estação em `src/ui/station/core.ts`, calor do forno
  em `thermal.ts` (`tests/furnaceModel.test.ts`). Botões têm `data-hit`; `craftPanel.hits` devolve onde estão. Teste `tools/visual-check/inventory.mjs`.
  Não há mais PixiJS nem telas em Canvas.
- Título e carregamento (ADR 0020, [design/TITULO.md](docs/design/TITULO.md)): `src/main.ts` mostra a tela de título (`src/ui/title/`:
  `TitleScreen.ts`, fundo `titleScene.ts`, `LoadingScreen.ts`) e **só importa o jogo depois de "Jogar"**, carregando em etapas
  (`Game.boot(report)`). O título **não pode importar `core/planet.ts`** (usa `core/planetChoice.ts` e `core/keys.ts`). Planetas voxel do
  fundo: `tools/models/planet_moon.py`, `planet_mars.py` (`lib.voxel_planet`). `window.spacing` só existe depois de "Jogar"; teste
  `tools/visual-check/title.mjs`.
- **Modo de teste** ([design/TESTE.md](docs/design/TESTE.md), ADR 0015): `?teste` liga um painel de depuração (dar itens, soltar meteoros,
  teleportar, parar o tempo…) com **salvamento próprio**. Catálogo em `src/data/testmode.ts`, executor em `src/app/TestMode.ts`, painel em
  `src/ui/TestPanel.ts`. **Para testar uma mudança, provoque a situação com `window.spacing.testMode.run('…')` em vez de jogar até ela**; o
  `tools/visual-check/testmode.mjs` roda todas as ações em menos de 1 min, e `lib.mjs` é o arranque comum dos testes novos. Ação nova no jogo?
  Acrescente ao catálogo, quando fizer sentido testá-la na hora.
- Estufa ([design/ESTUFA.md](docs/design/ESTUFA.md), ADR 0016): dados em `src/data/greenhouse.ts`, regras em `src/systems/Greenhouse.ts`, colisão em
  `src/world/greenhouseLayout.ts` (uma `Structure`), desenho em `src/render/greenhouseModel.ts`, experiência em `src/app/GreenhouseDirector.ts`
  (o botão de ação vem do `BaseDirector`); canteiros em `src/render/farmModel.ts`; modelos `tools/models/greenhouse.py` e `farm.py`;
  teste `tools/visual-check/greenhouse.mjs`. A fome está ligada (`NEEDS.energy` em `src/data/survival.ts`).
- Meteoros ([design/METEOROS.md](docs/design/METEOROS.md), ADR 0014): números em `src/data/meteors.ts`; lógica em `src/entities/Meteors.ts`;
  visual em `src/render/meteorFx.ts` e `puffs.ts`; **onda de choque que entorta a imagem** em `src/render/shockwave.ts` + `FX_SHOCK` na passada
  final de `post.ts`; som, câmera, pausa e clarão em `src/app/MeteorDirector.ts`; teste `tools/visual-check/meteors.mjs`.
- Chunks em worker e resolução dinâmica (ADR 0012): `src/world/chunkJobs.ts` + `chunk.worker.ts` + `workerPool.ts`, malha e luz em
  `chunkMesher.ts`, modo assíncrono em `World.enableWorkers`; `src/render/scaler.ts` + `Post.setScale`; testes `tests/chunkjobs.test.ts`,
  `tests/scaler.test.ts`, `tools/visual-check/worker.mjs`. `?semWorker` desliga o worker. Mexeu em quem lê blocos de chunks que podem não ter chegado? `getBlock` gera na hora; não presuma carregado.
- Mundo (ADR 0011, [design/MUNDO.md](docs/design/MUNDO.md)): semente sorteada por jogo (`src/core/seed.ts`, `?semente=`), mundo de
  96 blocos, relevo e camadas em `src/world/terrain.ts`, cavernas em `src/world/caves.ts`, luz do céu em `World.skyLight` + `aSky`
  no mesher, corte da câmera em `src/render/cutaway.ts`; teste `tools/visual-check/caves.mjs`. Mudou o gerador? Suba `WORLD_GEN`.
- Energia (ADR 0010, regra do dono: **nada vem do nada**): números em `src/data/power.ts`, regras em `src/systems/Power.ts`,
  tela no console em `src/ui/PowerPanel.ts`; painel solar é um objeto colocado no mundo ([design/ENERGIA.md](docs/design/ENERGIA.md)).
  Tela no mesmo estilo das estações; teste `tools/visual-check/stations.mjs`.
- Base: dados em `src/data/base.ts` (módulos), `recipes.ts`, `equipment.ts`; experiência em
  `src/app/BaseDirector.ts`; teste no navegador `tools/visual-check/base.mjs` ([design/BASE.md](docs/design/BASE.md)).
- Brocas: `src/data/drills.ts` (velocidade, nível, bateria), `equipment.ts` e `recipes.ts`; microgravidade dos
  pedaços em `src/data/physics.ts` ([design/BROCAS.md](docs/design/BROCAS.md), [design/FISICA.md](docs/design/FISICA.md)).
- Mapa do tablet: `src/app/MapDirector.ts`, `src/render/blockMap.ts` e `src/systems/Exploration.ts` (o que foi descoberto) ([design/MAPA.md](docs/design/MAPA.md)).
- Teste de desempenho: `src/data/bench.ts` (cenários como dados) e `src/bench/` (condutor, estatísticas, sondas, efeitos só na
  memória, resultado e telas); botão no menu de pausa ([design/BENCHMARK.md](docs/design/BENCHMARK.md), ADR 0007). O alvo é
  120 Hz (principal) e 60 Hz. Meça antes de otimizar e compare com o resultado guardado. A sonda do jogo (`Game.probe`) é nula
  fora do teste: ao medir uma parte nova do laço, use `probe?.begin(SUB.x)` / `probe?.end(SUB.x)`. Mudou um cenário? Suba
  `BENCH_VERSION`.
- Planetas (ADR 0008): dados em `src/data/planets.ts`, planeta da sessão em `src/core/planet.ts` (`?planeta=marte`). Marte:
  terreno `src/world/marsTerrain.ts`, vida (clima, redemoinhos, lava, vulcão) em `src/app/MarsDirector.ts`, clima puro em
  `src/systems/Weather.ts`, efeitos em `src/render/marsFx.ts`; teste `tools/visual-check/mars.mjs` ([design/MARTE.md](docs/design/MARTE.md)).
  Cada planeta tem o próprio salvamento.
- Gráficos avançados: `src/render/graphics.ts` (trocas do jogador por cima da qualidade), `src/ui/GraphicsMenu.ts` e `FpsMeter.ts`;
  efeito novo de tela = `#ifdef` na passada final de `src/render/post.ts` + linha em `GraphicsMenu` ([design/GRAFICOS.md](docs/design/GRAFICOS.md)).
- Sobrevivência: números em `src/data/survival.ts`, regras em `src/systems/Survival.ts`, resposta
  (avisos, sons, efeitos, morte) em `src/app/SurvivalDirector.ts`.
- Salvamento: `localStorage`, chave `spacing.save` (com versão e migração em `src/core/save.ts`) e
  `spacing.prefs.v1`. Mudou o formato? Nova versão, migração e teste.
- Semente do mundo: sorteada em cada jogo novo e guardada no salvamento (a de `src/data/planets.ts` é só a dos salvamentos antigos).
  Mudar o gerador em `src/world/terrain.ts` (Lua) ou `marsTerrain.ts` pede subir `WORLD_GEN`: o mundo dos saves é refeito, o progresso fica.
