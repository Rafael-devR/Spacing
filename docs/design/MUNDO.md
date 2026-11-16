# Mundo: semente por jogo, relevo maior e cavernas

- **Status:** pedido pelo dono em 2026-11-12 e implementado na Lua. Decisão técnica em
  [ADR 0011](../adr/0011-semente-por-jogo-cavernas-e-luz-do-ceu.md).
- Relacionado: [ADR 0003](../adr/0003-mundo-em-voxels-por-chunks.md) (chunks), [ITENS.md](ITENS.md) (blocos e itens),
  [MARTE.md](MARTE.md).

## O pedido

> "Toda vez que inicia um novo jogo, gera uma seed. Quero cavernas na Lua, buracos fundos, cavernas complexas no estilo do
> Minecraft, com várias conexões. Aumentar a escala para cima e para baixo. Novos blocos. E uma transição boa da câmera
> quando o personagem entra na caverna."

O que ficou para depois, a pedido dele: o que há **dentro** das cavernas além de minérios.

## Semente

- **Jogo novo = mundo novo.** A semente é sorteada (1 a 2³¹−1) quando não há salvamento, e fica guardada nele. "Novo jogo"
  apaga o salvamento e sorteia outra.
- `?semente=123` no endereço escolhe a semente de um jogo novo (testes, ou para repetir um mundo). Com salvamento, vale a
  do salvamento.
- Vale para a Lua e para Marte. Em Marte o vulcão e o cânion continuam no mesmo lugar; muda o relevo em volta.
- O jogo guarda também a **versão do gerador** (`WORLD_GEN` em `src/world/terrain.ts`). Se o gerador mudou desde o
  salvamento, o **progresso fica** (itens, equipamentos, estações, missões, traje, bateria) e o **mundo é refeito** com
  semente nova: somem as edições de blocos, o mapa descoberto e os itens caídos; painéis solares colocados voltam para o
  inventário; o astronauta recomeça no pouso. Um aviso aparece ao começar.

### O que toda semente garante

Sementes diferentes dão mundos diferentes, mas o começo é sempre jogável:

| Garantia | Como |
| --- | --- |
| Pouso numa planície | O relevo é amansado até ~48 blocos do pouso; o planalto do módulo é plano |
| Chão firme sob a base | Nenhuma caverna a menos de 22 blocos do pouso |
| Gelo por perto | Uma cratera de 22 blocos de raio, a ~66 blocos, sempre funda o bastante para ter gelo |
| Caverna por perto | Um tubo de lava passa sempre a ~46 blocos, do lado oposto à cratera, com rampa e claraboia |

## Escala

O mundo passou de **48 para 96 blocos de altura**. O nível médio do chão foi de 17 para **44**: há ~40 blocos para baixo
e ~50 para cima.

| Faixa | O que há |
| --- | --- |
| 58 a 85 | **Terras altas**: maciços com cristas, de **anortosito** (a rocha clara das montanhas da Lua) |
| ~44 | Planícies de regolito e **mares** de basalto (mais baixos) |
| até 37 | Fundo das crateras grandes: sombra eterna, **gelo** |
| 3 a 6 abaixo do chão | **Brecha** (pedaços de rocha soldados por impactos) |
| dali até ~21 | **Rocha lunar** (anortosito sob as terras altas) |
| abaixo de ~21 | **Norito**, a rocha dura do fundo da crosta |
| 0 | Rocha-mãe |

Há três tamanhos de cratera; o maior (raio 34 a 62) é novo.

## Blocos novos

| Bloco | Onde | Broca | Solta |
| --- | --- | --- | --- |
| Anortosito | Picos e interior das terras altas | qualquer | **Anortosito** (item novo: 2 no forno → 1 vidro) |
| Brecha | Logo abaixo do regolito | qualquer | Rocha lunar |
| Norito | Fundo | ferro | Rocha lunar |
| Basalto vítreo | Parede dos tubos de lava | ferro | Basalto |
| Ilmenita (bloco) | No basalto e no norito | ferro | Ilmenita |
| Ouro (bloco) | No norito, no coração dos bolsões de cristal | cristal | Ouro |

**Minérios por profundidade:** minério de ferro nas rochas claras; nas escuras (basalto, norito) o ferro vem como
**ilmenita**, como na Lua de verdade. Cristais em bolsões, mais comuns no fundo; ouro só no fundo. Todos saem de um único
ruído (ferro e ilmenita na ponta de cima, cristal e ouro na de baixo): um cálculo por bloco.

## Cavernas

A Lua tem cavernas de verdade: **tubos de lava** (túneis por onde a lava correu), com **claraboias** onde o teto desabou.
A do Mar da Tranquilidade foi confirmada por radar em 2024.

| Parte | Como é | Como é feita |
| --- | --- | --- |
| **Tubo de lava** | Corredor comprido e sinuoso, ~9 de largura, chão plano, teto em arco, parede de basalto vítreo. Fica ~16 abaixo do chão | A linha onde um ruído 2D passa por zero |
| **Túneis** | Estreitos (~4 a 5), sobem, descem e se cruzam: ligam tudo, como no Minecraft | Onde dois ruídos 3D passam por zero ao mesmo tempo |
| **Salões** | Câmaras largas e baixas no meio da rocha | Onde um ruído 3D lento fica alto |
| **Rampa de desabamento** | Sai do tubo e sobe até a superfície (1 bloco a cada 2): dá para **descer e subir andando** | Uma por célula de uma grade de 104 blocos (75% de chance), encostada no tubo mais próximo |
| **Claraboia** | Poço reto sobre o tubo, com funil em cima: o "buraco fundo". Cair dói | Em 60% das entradas |
| **Bocas naturais** | Túneis que chegam à superfície | Só onde um ruído de "entradas" deixa; no resto, o teto tem 6 blocos |

Medido em 5 sementes: as cavernas ocupam ~7,5% do subsolo e **88% a 97%** do volume delas se liga à superfície por algum
caminho. O teste `tests/caves.test.ts` confere, em 5 sementes, que a rampa garantida é andável do começo ao fim.

Os ruídos 3D são calculados numa grade de 4×2×4 e interpolados (como o Minecraft faz), para o chunk não ficar caro.

## Escuro e lanterna

- **Luz do céu por bloco** (0 a 12): quem tem céu aberto em cima vale 12; dali a luz entra pelas aberturas perdendo 1 por
  bloco. É calculada junto com a malha do chunk (com 12 blocos de margem dos vizinhos) e vai para cada vértice.
- O sol e a luz ambiente são multiplicados por essa luz: a 12 blocos de uma abertura sobra 5%. Cristais continuam
  brilhando no escuro.
- **Lanterna do capacete:** acende sozinha no escuro, alcança ~13 blocos. Por enquanto é parte do traje e não gasta
  bateria (para seguir "nada vem do nada", deve passar a gastar: próxima etapa).
- Minerar muda a luz: furar o teto de uma caverna ilumina o chão. O mundo só refaz os chunks vizinhos quando a edição
  realmente muda a luz (abrir ou tampar um caminho para o céu).

## Câmera dentro da caverna

O problema: a câmera fica do lado de fora, olhando de cima; debaixo de um teto, o astronauta some.

1. **O jogo mede o teto:** 9 pontos em volta do astronauta (um raio de 4 blocos); com mais de ~1/3 deles cobertos, começa o
   modo caverna; com ~2/3, está completo. **Só conta debaixo da terra:** é preciso que pelo menos 10 de 16 colunas num anel de
   8 blocos tenham o terreno acima dos pés (2026-11-13). Na superfície, perto de borda ou de teto, o modo não liga.
2. **A câmera aproxima** em ~1 s: de 30 para 15 blocos (metade do zoom do jogador, entre 12 e 20). O ângulo e o giro de
   90° não mudam; o zoom continua funcionando.
3. **O corte está DESLIGADO** (`CUT_SWITCH` em `render/cutaway.ts`, 2026-11-13): o dono pediu só a câmera de caverna. O recorte
   removia blocos que bloqueiam o caminho (o bloco sumia, mas a colisão continuava). Texto original, para voltar se quiser:
   o corte abre junto some a rocha que está **entre a câmera e o astronauta**: o que cobriria o corpo
   dele e tudo o que está acima da cabeça (o teto e o morro por cima). Ficam o chão, a parte de baixo das paredes e tudo o
   que está atrás dele. O miolo da rocha cortada aparece escuro.
4. **A mira ignora o que foi cortado:** tocar "através" do teto invisível acerta o que se vê.

Para minerar a parede que ficou do lado da câmera, gire a câmera.

## Onde está no código

| Parte | Arquivo |
| --- | --- |
| Semente | `src/core/seed.ts`; `Game.ts` (escolha), `src/core/save.ts` (`worldGen`, `renewWorld`, v10) |
| Relevo, camadas, minérios | `src/world/terrain.ts` (`CH`, `SEA`, `ICE_LEVEL`, `WORLD_GEN`, `HOME_CRATER`) |
| Cavernas | `src/world/caves.ts` (números em `CAVES`) |
| Blocos e item novos | `src/data/blocks.ts`, `items.ts`, `recipes.ts` (`glass_anorthosite`), cores do mapa em `src/render/blockMap.ts` |
| Luz do céu | `src/world/World.ts` (`skyLight`, `skyAt`, `roofed`, `lightReach`), `src/world/mesher.ts` (atributo `aSky`) |
| Escuro, lanterna | `src/render/materials.ts` (`USE_SKY`, `uDark`, `uLamp`), `Game.updateCover` |
| Câmera e corte | `src/render/IsoRig.ts` (`cave`, `eye`), `src/render/cutaway.ts`, material `terrainCut` |
| Testes | `tests/caves.test.ts`, `tests/terrain.test.ts`, `tests/save.test.ts`, `tools/visual-check/caves.mjs` |

## Ainda falta (próximas etapas)

- O que há **dentro** das cavernas (o dono vai dizer).
- Objetos soltos dentro das cavernas (hoje só na superfície).
- Lanterna gastando bateria; o frio e o escuro pesando na sobrevivência.
- Cavernas em Marte (o gerador de Marte não mudou, só ganhou a semente por jogo e a altura do mundo).
- O teste de desempenho roda no mundo da sessão: com sementes diferentes, os resultados variam um pouco entre mundos.
- Gerar um chunk ficou ~2,5× mais caro (mais blocos e as cavernas). Se engasgar ao andar, o próximo passo é o Web Worker
  do roadmap.
