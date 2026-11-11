# Física dos pedaços soltos

Na Lua não há ar e a gravidade é fraca. Tudo o que sai de um bloco quebrado se comporta assim
(`src/data/physics.ts`, `MICROGRAVITY`):

- **Microgravidade:** 0,45 blocos/s² (antes, 16; a da Lua é 1,6). Um pedaço lançado para cima a 1,5 blocos/s
  sobe mais de 2 blocos e leva uns 7 segundos para voltar.
- **Sem ar:** nada freia o pedaço no alto. A velocidade horizontal se mantém e o giro também; só o chão os para.
- **Chão:** os pedaços ainda quicam (agora até em velocidades baixas), escorregam um pouco, se empilham e dormem
  quando param. O som de batida só toca em batidas de verdade.
- **Lançamento mais suave:** como a gravidade é pequena, a velocidade de saída caiu junto, para os pedaços não
  sumirem para cima. A explosão do meteoro continua a mais forte.

Onde vale: `entities/Debris.ts` (pedaços), lascas da broca e poeira (`render/particles.ts`), itens que saem do bloco
antes de voar ao astronauta (`entities/ItemDrops.ts`) e destroços do meteoro (`entities/Meteors.ts`).

O **astronauta** não muda: a gravidade dele (`entities/Player.ts`) é pensada para o pulo e para a sensação de
controle, não para a física realista. Os itens da morte (`LootPiles`) já flutuavam.

Teste: `tests/debris.test.ts` (um pedaço no alto continua no alto, desce devagar, não perde velocidade sem ar e por
fim para no chão) e `tools/visual-check/drill.mjs` (no navegador, os pedaços de um bloco quebrado seguem no ar
1,5 s depois).
