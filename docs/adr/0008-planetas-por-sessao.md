# ADR 0008: Cada planeta é escolhido antes de o jogo montar o mundo, com dados e salvamento próprios

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

O dono pediu um segundo planeta, Marte, com ambientação, gravidade, minerais, clima e um vulcão próprios, escolhido por
enquanto num menu (a viagem de verdade vem depois). O `Game` monta tudo uma vez ao carregar: terreno, mundo, base, luzes,
céu, sons, missões. Vários módulos leem constantes no carregamento (gravidade do astronauta, dos pedaços, das pilhas).
O dono também decidiu, na Lua, que a ficção só entra em pontos escolhidos (gerador do domo, cristal lunar, meteoritos, IA
do traje).

## Opções

1. **Trocar de planeta com o jogo aberto**: desmontar e remontar mundo, base, luzes, materiais e áudio. Muito código de
   limpeza e muitos lugares onde algo velho fica para trás.
2. **Um planeta por sessão**: o planeta é escolhido antes de o `Game` existir (`?planeta=marte` ou a escolha guardada em
   `spacing.planet`); trocar recarrega a página. As diferenças ficam em dados (`src/data/planets.ts`) e cada módulo lê o
   planeta da sessão (`src/core/planet.ts`).

## Decisão

Opção 2.

- `PlanetDef` guarda nome, região, semente, **chave do salvamento** (`spacing.save` para a Lua, que não muda, e
  `spacing.save.marte`), cores do céu e da névoa, luz, física (gravidade e pulo do astronauta, queda segura, gravidade e
  arrasto dos pedaços, gravidade das pilhas), som com ar e pegadas.
- Terrenos implementam `TerrainGen` (`world/terrain.ts`); o `World` escolhe `Terrain` (Lua) ou `MarsTerrain`.
- O que só existe em Marte vive no `MarsDirector` (clima, redemoinhos, lava, vulcão), criado só lá.
- Blocos, itens e objetos de Marte entram nos mesmos registros (ids novos a partir de 9). A Lua nunca gera esses blocos.
- **Lava ativa em Marte é ficção pedida pelo dono.** Os vulcões de Marte estão extintos; o jogo a apoia na atividade mais
  recente conhecida (Cerberus Fossae) e registra isso em `docs/design/MARTE.md`.

## Consequências

- Jogar em Marte nunca mexe no progresso da Lua, e o salvamento da Lua continua na mesma chave (sem migração).
- Trocar de planeta recarrega a página (alguns segundos); aceitável enquanto a escolha é provisória. A viagem de verdade
  pode usar o mesmo caminho (guardar o destino e recarregar) ou, no futuro, remontar o mundo.
- Os testes em Node rodam sempre na Lua; Marte é testado gerando `MarsTerrain` direto e no navegador com `?planeta=marte`
  (`tools/visual-check/mars.mjs`).
