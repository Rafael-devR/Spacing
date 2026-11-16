# Marte

Segundo planeta do jogo. **Provisório:** por enquanto se escolhe o planeta na tela inicial; a viagem de verdade (foguete,
história) vem depois. Marte tem o **próprio salvamento** (`spacing.save.marte`) e a própria semente: jogar em Marte não
mexe no progresso da Lua.

Região: **Elysium Planitia**, perto de **Cerberus Fossae** e com o **Elysium Mons** no horizonte. É onde a sonda
InSight pousou (2018) e onde está o vulcanismo mais jovem de Marte.

## O que é real e o que é ficção

A regra do projeto é base científica real, com ficção só onde o dono decidir. Em Marte:

| No jogo | Base real |
| ------- | --------- |
| Gravidade 0,38 g (2,3× a da Lua): pulos mais baixos, quedas mais perigosas, pedaços caem de verdade | 3,72 m/s² |
| Céu cor de caramelo durante o dia, sem estrelas; névoa de poeira alaranjada | poeira fina suspensa espalha a luz vermelha |
| Halo azulado em volta do sol | o pôr do sol em Marte é azul (a poeira espalha o azul para perto do sol) |
| Sol menor e mais fraco | Marte recebe ~43% da luz que a Terra recebe |
| Duas luas pequenas no céu: Fobos (rápida) e Deimos | Fobos dá a volta em 7 h 39 min e cruza o céu de oeste para leste |
| Poeira vermelha na superfície, rocha marrom-avermelhada embaixo | óxido de ferro (ferrugem) no regolito |
| **Dunas de areia escura** nas partes baixas | areia basáltica, comum em crateras marcianas |
| **Esferas de hematita** soltas no chão ("blueberries") | achadas pelo Opportunity em Meridiani (2004) |
| **Olivina** verde nas rochas vulcânicas | mineral comum no basalto marciano |
| **Veios brancos de gipsita** nas paredes do cânion | gipsita (sulfato de cálcio) achada pelo Opportunity e pelo Curiosity; prova de água antiga |
| **Gelo sob a poeira** | gelo raso visto pela Phoenix (2008) e em barrancos expostos |
| **Paredes do cânion em camadas** de cores alternadas | depósitos em camadas (Valles Marineris, Gale) |
| **Pegadas ficam marcadas** na poeira e o vento as apaga aos poucos | há atmosfera e vento: as marcas não duram para sempre como na Lua |
| **Redemoinhos de poeira** que andam pelo terreno; passar por um limpa os painéis do traje (+bateria) | dust devils limparam os painéis do Spirit e do Opportunity |
| **Tempestades de poeira**: o céu escurece, a visão cai, poeira corre na tela, o vento empurra de leve e apaga as pegadas | tempestades regionais e globais (a de 2018 encerrou o Opportunity). O ar é ralo: o vento empurra pouco |
| Som abafado e mais baixo, com vento ao fundo | o microfone do Perseverance gravou sons ~20 dB mais baixos, com os agudos abafados |
| Crateras de impacto, meteoros raros | Marte tem atmosfera fina: meteoros pequenos se queimam |
| **Vulcão com lava ativa**, brasas, fumaça e erupções | **Ficção pedida pelo dono.** Os vulcões de Marte estão extintos; a atividade mais nova conhecida é em Cerberus Fossae (~53 mil anos), onde a InSight registrou tremores. O jogo imagina que ainda há lava ali |

## Sistemas

- **Planeta** (`src/data/planets.ts`, escolha em `src/core/planet.ts`): nome, semente, chave do salvamento, cores do céu,
  luz, névoa, gravidade do astronauta e dos pedaços, som, pegadas, clima e missões. Fica fixo enquanto a página está
  aberta; trocar de planeta recarrega a página.
- **Terreno de Marte** (`src/world/marsTerrain.ts`): planície com crateras, dunas escuras, um cânion em camadas com veios
  de gipsita, gelo sob a poeira e o vulcão (cone, caldeira com lago de lava e três rios de lava descendo as encostas).
- **Lava** (bloco `LAVA`): brilha (bloom), não se minera, e queima o traje de quem pisa nela ou encosta (integridade cai
  rápido; a morte por lava tem texto próprio). Solta brasas e fumaça perto do astronauta.
- **Erupções** (`MarsDirector`): de tempos em tempos, se o astronauta está a menos de ~110 blocos do vulcão, o chão treme,
  sai um ronco grave e a caldeira joga um chafariz de lava.
- **Tempestade de poeira** (`src/systems/Weather.ts`, puro): calmo → chegando (a IA do traje avisa) → tempestade →
  passando. Muda a cor e a distância da névoa, escurece a luz, liga a poeira correndo, o vento e o empurrão, e apaga as
  pegadas mais rápido.
- **Redemoinhos** (`src/render/DustDevils.ts`): colunas de poeira girando que atravessam a planície; passar por dentro
  sacode a câmera, empurra e limpa os painéis (+bateria, uma vez por redemoinho).

## Gravidade

| | Lua | Marte |
| - | - | - |
| Gravidade do astronauta (blocos/s²) | 15 | 30 |
| Impulso do pulo | 7,4 | 9,2 (pulo de ~1,4 bloco, contra ~1,8) |
| Queda sem dano até | 14 m/s | 16 m/s |
| Pedaços de bloco | 0,45 (flutuam) | 3,5 (caem, com arrasto do ar) |

A gravidade do astronauta já é exagerada na Lua (o pulo foi ajustado para o jogo); Marte mantém a mesma proporção
aproximada (~2×), não o valor em m/s².

## Missões (provisórias)

1. Colete poeira marciana. 2. Ache esferas de hematita. 3. Veios brancos: colete gipsita no cânion. 4. Olivina das
rochas vulcânicas. 5. Leve amostras ao módulo. 6. Fim.

## Próximos passos (fora desta versão)

Percloratos tóxicos na poeira (descontaminar o traje), gelo de CO₂ nos polos, gêiseres de gelo seco, linhas que escorrem
nas encostas, ciclo de dia e noite (sol de 24 h 39 min, frio de −80 °C à noite), a viagem Lua → Marte de verdade.
