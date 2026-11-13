# Crafting: cadeia de itens e fabricação lenta

- **Status:** aprovado pelo dono em 2026-11-12 e implementado (fase 1: Lua). Decisão técnica em
  [ADR 0009](../adr/0009-fabricacao-em-estacoes-com-tempo.md).
- O panorama de tudo o que existe está em [ITENS.md](ITENS.md).

## O que o dono pediu

1. **Todo item tem um propósito.** Cada item existe *para fazer outro item*. Pode haver poucos itens sem uso de
   fabricação (só de construir), mas a maioria entra numa receita.
2. **Realista, cientificamente.** As transformações seguem o que agências espaciais estudam de verdade para viver
   "da terra" na Lua e em Marte (ISRU, *in-situ resource utilization*). A ficção fica no cristal lunar.
3. **Fabricação longa.** A estação trabalha sozinha (a bancada, cerca de 1 a 2 minutos). O jogador sai, volta depois
   e pega o item. A estação mostra a peça sendo feita.
4. **Tempo que depende do material**, nunca o mesmo para tudo, e com **um pouco de sorte** a cada vez.
5. **Tela técnica e visual**, onde dá para ver os minérios entrando e o produto saindo.

## Decisões do dono (2026-11-12)

| Pergunta | Decisão |
| --- | --- |
| O relógio da estação corre longe dela? | **Sim, com o jogo aberto, em qualquer lugar do mundo.** Pausado ou fechado, para |
| Fila de receitas? | **Uma receita por vez** em cada estação. As estações trabalham ao mesmo tempo |
| O Mapa (primeira coisa) agora pede placa de circuito | **O módulo de pouso dá uma placa** no começo (e a quem vem de save antigo sem o Mapa) |
| O que fazer agora | **Fase 1:** forno solar, eletrolisador, itens novos, receitas refeitas. Domo, painéis e Marte depois |
| Tijolo vira bloco? | **Material.** Alguns fabricados podem virar bloco no futuro, mas a maioria é material |
| Tempo | **Dinâmico:** calor, peso e raridade de cada ingrediente, mais **±12% de sorte** por fabricação |

### Segunda rodada (2026-11-12, depois de testar no celular)

| Pedido | O que mudou |
| --- | --- |
| A tela das bancadas estava poluída, com número demais | **Tela cheia em Canvas** (não mais painel em HTML), na resolução do aparelho, mais visual e com poucos números |
| Cada animação tem que significar algo | Cada pontinho é um minério entrando, um produto saindo ou um pacote de energia |
| Esperar demais para pouco item | **Lote:** põe todos os minérios de uma vez ("Tudo"); demora mais, mas o preparo conta uma vez só |
| Fazer coisas diferentes ao mesmo tempo | **Vagas:** forno 3, eletrolisador 2, bancada 1. A energia da estação é **dividida** entre as que trabalham |
| De onde vem a energia? | **Nada vem do nada** ([ENERGIA.md](ENERGIA.md)): painéis solares, bateria da base, espelhos do forno |

### Terceira rodada (2026-11-12, depois de testar de novo)

| Pedido | O que mudou |
| --- | --- |
| Lista de receitas na esquerda fica embaixo do dedo | **Receitas à direita** (perto do polegar); no retrato, faixa embaixo |
| Demorava demais (15 min para uns minérios). "No Minecraft é quase instantâneo" | Tempos **~10× menores**: uma barra de ferro em ~4 s, vidro ~3 s, a broca de cristal ~13 s |
| Tinha que esperar o lote inteiro para pegar | **Cada unidade pronta já pode ser pega** ("Pegar 2" na vaga, ou "Pegar tudo") |
| Não dava para cancelar nem pausar | **Pausar/Retomar** (pausado não gasta energia; os outros aceleram) e **Cancelar** com confirmação (devolve os materiais do que não ficou pronto, e o pronto vai para a mochila) |
| Ficou limpo demais, sem sensação de fabricar | **Painel técnico** no estilo do jogo Idle CPU: módulos rotulados (espelhos/rede, temperatura/corrente/laser), barramento de energia com pacotes correndo, cada vaga como uma grade de células (uma por unidade) que acendem |

## Princípio: o minério não vira ferramenta direto

Como no Minecraft (ferro bruto → fornalha → barra → ferramenta), com química de verdade:

```
recurso bruto  →  (estação) refinado  →  (bancada) peça / equipamento / máquina
 minério de ferro      barra de ferro         broca de ferro
```

## Estações

| Estação | Faz o quê (ciência real) | Vagas | Energia | Tempo (1 vez, sozinha) | Como se obtém |
| --- | --- | --- | --- | --- | --- |
| **Bancada** | Monta peças refinadas em equipamentos, chips e máquinas, com dois lasers | 1 | eletricidade, 1,2 kW | 5 a 13 s | Já vem na base |
| **Forno solar** | Espelhos no telhado concentram o sol: funde, sinteriza, reduz (fornos solares de regolito são testados pela ESA) | 3 cadinhos | sol dos espelhos | 3 a 5 s | Bancada: 6 rocha lunar + 3 minério de ferro |
| **Eletrolisador** | Corrente separa água em H₂ e O₂ e tira metal e silício de óxidos | 2 células | eletricidade, 2,4 kW | 4 a 7 s | Bancada: 4 barras de ferro + 2 vidros + 2 tijolos |
| *(depois)* **Reator de CO₂** | Marte: CO₂ do ar vira O₂ (como o MOXIE do Perseverance) e metano (Sabatier) | — | Só em Marte |

As três ficam no Habitat 01: a bancada na parede norte, o forno e o eletrolisador lado a lado na parede leste. Antes de
fabricados, o lugar deles mostra um **holograma** da máquina; o botão diz "Lugar do Forno solar" e a tela explica que as
peças são feitas na bancada. Ao pegar a máquina pronta na bancada, a peça voa até o lugar e a máquina aparece com um
clarão.

## Catálogo: para que cada item serve

**Calor / Peso / Raridade** (0 a 3) decidem o tempo (ver "Tempo"). Os textos "para que serve" ficam em `about` em
`src/data/items.ts` e aparecem na tela das estações.

### Lua: itens brutos

| Item | C/P/R | Para que serve (o fato real por trás) | Entra em |
| --- | --- | --- | --- |
| Regolito | 1/0/0 | Óxidos de silício, ferro, alumínio, cálcio: sinteriza, funde em vidro, rende silício e oxigênio | Tijolo, Vidro, Silício |
| Rocha lunar | 1/1/0 | Pedra de construção; corpo do forno | Forno solar |
| Basalto | 2/2/1 | Fundido e estirado vira fibra de basalto (tecnologia terrestre real) | Fibra de basalto |
| Gelo | 0/1/1 | Água do polo sul; eletrólise dá H₂ e O₂ | Eletrólise da água |
| Minério de ferro | 2/2/1 | Fundido vira barra de ferro | Barra de ferro, Forno solar |
| Ilmenita (FeTiO₃) | 3/2/2 | Com hidrogênio dá ferro, óxido de titânio e água: o caminho que a NASA estuda para oxigênio lunar | Redução da ilmenita |
| Ouro | 1/2/3 | Não oxida: contatos dos conectores espaciais | Placa de circuito |
| Cristal lunar | 1/1/3 | **Ficção:** ressoa com energia | Broca de cristal (e o domo, depois) |

### Lua: itens fabricados

| Item | C/P/R | Feito em | Receita | Para que serve |
| --- | --- | --- | --- | --- |
| Barra de ferro | 2/2/1 | Forno | 2 minério de ferro | Brocas, Mapa, eletrolisador |
| Tijolo de regolito | 3/2/0 | Forno | 4 regolito → **2** tijolos | Broca de ferro, eletrolisador |
| Vidro | 1/0/1 | Forno | 3 regolito | Tela do Mapa, eletrolisador (e painéis, depois) |
| Fibra de basalto | 2/1/1 | Forno | 2 basalto | Broca de cristal (e traje, depois) |
| Óxido de titânio | 3/1/2 | Forno | 1 ilmenita + 1 H₂ → 1 TiO₂ + 1 barra de ferro + 1 gelo | Lingote de titânio |
| Cilindro de H₂ | 0/0/1 | Eletrolisador | 2 gelo → **2 H₂ + 1 O₂** | Reduzir ilmenita (e o foguete, depois) |
| Cilindro de O₂ | 0/0/1 | Eletrolisador | (sai da água, do titânio e do silício) | **Reserva do traje:** conecta sozinho a 15% de ar longe da base (+50) |
| Lingote de titânio | 3/1/3 | Eletrolisador | 1 TiO₂ → 1 titânio + 1 O₂ | Broca de cristal (e o foguete, depois) |
| Silício | 2/0/2 | Eletrolisador | 4 regolito → 1 silício + 1 O₂ | Placa de circuito |
| Placa de circuito | 0/0/3 | Bancada | 1 silício + 1 ouro | Mapa (e máquinas, depois) |

A conta química fecha: 2 H₂O dão 2 H₂ + 1 O₂; reduzir ilmenita devolve a água (o hidrogênio "volta"); tirar metal de
óxido solta oxigênio. **O oxigênio é subproduto de quase tudo**, e isso tem uso: a reserva do traje.

### Equipamentos e máquinas (bancada)

| Receita | Ingredientes | Tempo | Por que faz sentido |
| --- | --- | --- | --- |
| Forno solar | 6 rocha lunar + 3 minério de ferro | ~1:36 | câmara de pedra, espelhos e suporte de ferro; só usa coisa bruta (como a fornalha de pedra do Minecraft) |
| Eletrolisador | 4 barras de ferro + 2 vidros + 2 tijolos | ~1:45 | eletrodos de ferro, cuba de vidro, base de tijolo |
| Mapa | 1 placa de circuito + 1 vidro + 1 barra de ferro | ~1:03 | circuito, tela e carcaça |
| Placa de circuito | 1 silício + 1 ouro | ~1:01 | pastilha de silício com contatos de ouro |
| Painel solar | 2 silício + 1 vidro + 1 barra de ferro | ~1:21 | células de silício, cobertura de vidro, moldura; vai para o chão ([ENERGIA.md](ENERGIA.md)) |
| Broca de ferro | 4 barras de ferro + 2 tijolos | ~1:34 | ponta de ferro temperado, corpo mineral |
| Broca de cristal | 4 cristais + 2 lingotes de titânio + 2 fibras de basalto | ~2:05 | ponta de cristal em eixo de titânio, reforço que aguenta calor |

### Cadeia da Lua

```
rocha + minério de ferro ─[Bancada]─► Forno solar
minério de ferro ─[Forno]─► barra de ferro ─┐
regolito ─[Forno]─► tijolo, vidro ──────────┼─[Bancada]─► Eletrolisador, Mapa, Broca de ferro
                                            │
gelo ─[Eletrolisador]─► 2 H₂ + O₂           │        (O₂ = reserva do traje)
ilmenita + H₂ ─[Forno]─► barra de ferro + óxido de titânio + gelo
óxido de titânio ─[Eletrolisador]─► titânio + O₂ ─┐
basalto ─[Forno]─► fibra de basalto ──────────────┼─[Bancada]─► Broca de cristal ─► ouro
regolito ─[Eletrolisador]─► silício + O₂ ─► + ouro ─[Bancada]─► placa de circuito
```

Cada passo abre o próximo: broca de ferro → basalto, cristal e ilmenita → titânio → broca de cristal → ouro → circuitos.
Um teste (`tests/crafting.test.ts`) confere que toda receita é alcançável a partir do que se minera na Lua e que todo item
da Lua, menos o O₂, entra em alguma receita.

### Marte (fase seguinte, ainda não implementada)

Os itens de Marte já dizem para que vão servir (`about`), mas ainda não têm receita: **Marte ainda não tem
fabricação** (o forno pede rocha lunar e minério de ferro, que lá não existem). Planejado:

| Item | Uso planejado (fato real) |
| --- | --- |
| Hematita (Fe₂O₃) | 1 hematita + 3 H₂ → **2** barras de ferro + 3 gelo |
| Gipsita (CaSO₄·2H₂O) | ~21% de água presa no cristal: aquecida solta água e vira gesso (aglomerante) |
| Olivina | aguenta calor (areia de molde de fundição): forno refratário de Marte |
| Poeira marciana | tijolo marciano (poeira + gesso) |
| Areia escura | vidro escuro (areia basáltica fundida) |
| Basalto vulcânico | fibra de basalto, como na Lua |
| Rocha marciana, rocha sedimentar | só construção |
| Metano (novo) | CO₂ do ar + H₂ (Sabatier): combustível do foguete de volta |

## Tempo

Rápido de propósito (o dono comparou com o Minecraft e não quer o jogador esperando):

```
segundos = preparo da estação + lote × tempo de uma unidade
tempo de uma unidade = por ponto × esforço × Σ (quantidade × pontos do ingrediente)
pontos de um item = 1 + 0,6 × calor + 0,4 × peso + 0,8 × raridade
```

| Estação | Preparo | Por ponto | Exemplos (uma unidade) |
| --- | --- | --- | --- |
| Bancada | 2 s | 0,3 s | Mapa ~5 s, broca de cristal ~13 s, forno solar ~9 s |
| Forno solar | 1 s | 0,45 s | Vidro ~3 s, barra de ferro ~4 s, redução da ilmenita ~5 s |
| Eletrolisador | 1,5 s | 0,6 s | Água ~4 s, titânio ~6 s, silício ~6,5 s |

- `esforço` (padrão 1) é dos processos químicos lentos: redução da ilmenita ×1,4, titânio ×1,6, silício ×1,3.
- **Lote:** o preparo conta uma vez e depois sai **uma unidade de cada vez** (10 barras de ferro ≈ 35 s). Cada unidade
  pronta já pode ser pega. Até 32 por vez (só receitas que dão itens).
- Cada fabricação sorteia **±12%** no preparo e no tempo da unidade (`JITTER`).
- Esse é o tempo com **energia cheia** e a estação só com esse trabalho. Com 3 trabalhos no forno, cada um recebe 1/3 do
  calor; quando um termina ou é pausado, os outros aceleram. Com a energia a 70%, tudo anda a 70%.

## Como funciona no jogo

1. "Usar" a estação abre a **tela cheia** dela. Escolhe a receita na lista à direita, a quantidade (− / + / Tudo) e
   "Fazer": os materiais saem **na hora** e entram numa **vaga** livre.
2. A estação **trabalha sozinha** com o jogo aberto, em qualquer lugar. Várias vagas trabalham juntas dividindo a
   energia; as três estações são independentes.
3. Cada unidade pronta fica na vaga (célula verde). **Pegar tudo** (no alto da máquina) recolhe o pronto de todas as
   vagas; tocar numa vaga mostra embaixo **Pegar N**, **Pausar/Retomar** e **Cancelar** (pede confirmação).
4. Cancelar: o que já ficou pronto vai para a mochila e os materiais do que não ficou (inclusive a unidade pela metade)
   voltam. O que não couber fica na vaga como sobra para pegar depois.
5. A máquina mostra o trabalho no mundo (lasers, brilho do forno, bolhas) e o **selo no HUD** diz o tempo que falta.

## Tela da estação

Desde 2026-11-13 a tela de todas as estações é a mesma, em HTML, com o inventário ao lado e arrastar e soltar
([ESTACOES.md](ESTACOES.md), [ADR 0019](../adr/0019-inventario-e-estacoes-em-html.md)). Ela substituiu a tela técnica em Canvas
(estilo Idle CPU) e a do forno em PixiJS. As regras acima não mudaram.

## Onde está no código

| Parte | Arquivo |
| --- | --- |
| Itens (propósito, calor/peso/raridade, aparência) | `src/data/items.ts` |
| Estações (preparo, tempo por ponto, medidores, cor) | `src/data/stations.ts` |
| Receitas (entradas, saídas, reação, etapas, nota), fórmula do tempo | `src/data/recipes.ts` |
| Lugar das estações na base | `src/data/base.ts` (`furnace`, `electrolyzer`, `STATION_FURNITURE`) |
| Regras: começar, relógio, pronto, pegar, salvar | `src/systems/Crafting.ts` |
| Reserva de O₂ do traje | `src/app/SurvivalDirector.ts`, número em `src/data/survival.ts` (`o2Reserve`) |
| Experiência na base (botões, avisos, peça voando, máquina aparecendo) | `src/app/BaseDirector.ts` |
| Modelos do forno e do eletrolisador | `src/render/stationModels.ts` |
| Modelos dos itens fabricados | `src/render/craftedModels.ts` |
| Tela da estação (com o inventário) | `src/ui/station/StationScreen.ts` (+ câmara `core.ts`, calor `thermal.ts`) sobre `src/ui/inventory/screen.ts` (`#inv` no `index.html`) |
| Energia das estações | `src/systems/Power.ts` ([ENERGIA.md](ENERGIA.md)) |
| Selo no HUD | `src/ui/JobsChip.ts` (`#jobs`) |
| Salvamento (v7: estações e trabalhos; v8: vagas, lotes, bateria) | `src/core/save.ts` |
| Testes | `tests/crafting.test.ts`, `tests/power.test.ts`, `tests/base.test.ts`, `tests/save.test.ts`, `tools/visual-check/base.mjs`, `tools/visual-check/stations.mjs`, `tools/visual-check/inventory.mjs` |

Nova receita = uma entrada em `recipes.ts`. Novo item = uma entrada em `items.ts` (com `about`, `traits`, `tint` e
aparência). Nova estação = `stations.ts` + um móvel em `base.ts` + um modelo em `stationModels.ts` + receitas.

## Em aberto

- Equipamentos e máquinas ao morrer: hoje ficam (a regra "perde tudo" só vale para o inventário).
- Fase 2 (v0.4): Gerador de Domo (núcleo de cristal), kit de reparo e traje (fibra de basalto), lanterna. Fase Marte:
  tabela acima. O painel solar já existe ([ENERGIA.md](ENERGIA.md)).
- Ajustar os tempos depois de jogar no celular (é só mexer em preparo e por ponto, ou no calor/peso/raridade de um item).
