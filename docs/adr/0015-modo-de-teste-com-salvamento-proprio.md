# ADR 0015: Modo de teste com salvamento próprio e ações como dados

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

Testar o jogo exigia jogar até a situação (esperar meteoro, minerar para ter itens, andar até a base) ou escrever scripts que
mexem nos sistemas por dentro. O dono testa no celular e queria soltar objetos, pegar itens e provocar eventos na hora. O Claude
testava com capturas de tela, devagar (o WebGL por software roda a poucos quadros por segundo).

## Opções

1. **Só scripts de navegador** que mexem em `window.spacing`: servem ao Claude, não ao dono no celular, e cada um repete o mesmo
   arranque.
2. **Um menu de depuração sempre presente no jogo:** polui o jogo normal e arrisca o progresso do dono.
3. **Modo de teste ligado por `?teste`, com salvamento próprio e um painel** (escolhida).

## Decisão

- `?teste` no endereço liga o modo (fixo na sessão, como `?planeta`). O salvamento é `spacing.save.teste` (e `.marte.teste`):
  o progresso de verdade não é tocado.
- As ações são **dados** (`data/testmode.ts`) e um executor (`app/TestMode.ts`) as faz nos sistemas do jogo. O painel do celular
  (`ui/TestPanel.ts`) e o teste automatizado (`window.spacing.testMode.run`) usam a mesma porta.
- Os ganchos nos sistemas são pequenos e explícitos (`Crafting.unlock`, `Missions.skip`, `Meteors.autoSpawn`, `Debris.clear`,
  escala do tempo no laço do `Game`).
- O teste `tools/visual-check/testmode.mjs` roda todas as ações e confere o efeito de cada uma; `lib.mjs` é o arranque comum.

## Consequências

- Testar uma mudança vira "provocar a situação e olhar", em segundos, para o dono e para o Claude.
- O modo existe no pacote de produção (o botão só aparece com `?teste`); não há segredo nele, só atalhos.
- Ação nova exige uma linha de dado e um caso no executor; o teste de unidade avisa se faltar um.
