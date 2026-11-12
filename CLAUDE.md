# Spacing: instruções para o Claude

Jogo web de exploração espacial em mundo de blocos (Three.js). Leia o [README](README.md), a
[arquitetura](docs/ARCHITECTURE.md) e o [design](docs/GAME_DESIGN.md) antes de mudar algo grande.

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
- Semente do mundo: por planeta, em `src/data/planets.ts`. Mudar o gerador em `src/world/terrain.ts` (Lua) ou `marsTerrain.ts`
  invalida os saves daquele planeta.
