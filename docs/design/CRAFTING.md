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

## Princípio: o minério não vira ferramenta direto

Como no Minecraft (ferro bruto → fornalha → barra → ferramenta), com química de verdade:

```
recurso bruto  →  (estação) refinado  →  (bancada) peça / equipamento / máquina
 minério de ferro      barra de ferro         broca de ferro
```

## Estações

| Estação | Faz o quê (ciência real) | Tempos | Como se obtém |
| --- | --- | --- | --- |
| **Bancada** | Monta peças refinadas em equipamentos, chips e máquinas, com dois lasers | 61 a 125 s | Já vem na base |
| **Forno solar** | Espelhos no telhado concentram o sol do polo sul: funde, sinteriza, reduz (fornos solares de regolito são testados pela ESA) | 29 a 45 s | Bancada: 6 rocha lunar + 3 minério de ferro |
| **Eletrolisador** | Corrente separa água em H₂ e O₂ e tira metal e silício de óxidos | 36 a 51 s | Bancada: 4 barras de ferro + 2 vidros + 2 tijolos |
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

```
segundos = preparo da estação + por ponto × esforço × Σ (quantidade × pontos do ingrediente)
pontos de um item = 1 + 0,6 × calor + 0,4 × peso + 0,8 × raridade
```

| Estação | Preparo | Por ponto |
| --- | --- | --- |
| Bancada | 40 s | 2,4 s |
| Forno solar | 14 s | 3,2 s |
| Eletrolisador | 18 s | 4 s |

`esforço` (padrão 1) é dos processos químicos lentos: redução da ilmenita ×1,4, titânio ×1,6, silício ×1,3. Cada
fabricação sorteia **±12%** em cima desse valor (`JITTER`), então o mesmo item nunca demora exatamente o mesmo. A tela
mostra o estimado e a margem antes, e o tempo sorteado (que falta) durante. Números em `src/data/stations.ts` e
`src/data/recipes.ts`.

## Como funciona no jogo

1. "Usar" a estação abre a **tela técnica** dela. Escolhe a receita; "Fabricar" gasta os materiais **na hora**.
2. A estação **trabalha sozinha** com o jogo aberto, em qualquer lugar (o jogador pode sair da base). Uma receita por
   estação; as três trabalham juntas.
3. A máquina mostra o trabalho: a bancada imprime a peça de baixo para cima com os lasers (o progresso é o do trabalho,
   então quem volta na metade vê a peça pela metade); o forno brilha na janela, o tubo de luz acende e solta brasas; o
   eletrolisador borbulha (mais bolhas de H₂ que de O₂) com a faísca da corrente. Luz de estado: azul livre, âmbar
   trabalhando, verde piscando pronto.
4. Pronto: som, aviso ("Forno solar: Vidro pronto", ou a IA do traje se o jogador está fora) e o resultado **fica na
   estação**. Na tela, "**Pegar**": itens vão para o inventário (o que não couber espera lá), equipamento é equipado,
   máquina é instalada.
5. **Selo no HUD** (no alto, abaixo da bússola): uma pastilha por estação com o ícone do produto e o tempo que falta, ou
   "Pronto". Assim, lá fora, dá para saber quando voltar.

## Tela técnica

- **Cabeçalho:** luz e nome da estação, o que ela faz e o estado (Livre, Trabalhando, Pronto, Não instalada). A cor de
  destaque é a da estação (ciano, laranja, azul).
- **Lista de receitas** (esquerda): ícone, nome, tipo, tempo estimado e um ponto de cor (verde dá, vermelho falta, âmbar
  trabalhando, verde piscando pronto).
- **Diagrama ao vivo** (canvas): os ingredientes à esquerda **esvaziam** com o progresso enquanto partículas da cor de cada
  um correm pelos canos até a câmara; os produtos à direita **enchem**. A câmara muda com a estação: **calor** (brilho que
  vai do vermelho ao amarelo, ondas de calor, banho fundido subindo, brasas, temperatura), **célula** (líquido, eletrodos
  − e +, faísca de corrente, bolhas da cor de cada gás) ou **laser** (a peça impressa de baixo para cima, camada atual e
  os dois lasers com faíscas). A fórmula química fica em cima.
- **Etapas** (ex.: Aquecer → Fundir a 1540 °C → Separar escória → Moldar barra) com barra de progresso.
- **Medidores:** dois por estação (temperatura e sol concentrado; corrente e tensão; laser e bico), que sobem quando
  trabalha e oscilam, mais o tempo (estimado ou que falta).
- **Ingredientes:** quanto tem/precisa, calor/peso/raridade em barrinhas e quantos segundos cada um soma.
- **Tempo:** preparo + ingredientes, esforço, estimado e margem. **Nota científica** da receita.
- **Botão:** Fabricar, Faltam itens, Trabalhando…, Ocupada, Pegar, Equipado/Instalada, Fabrique na bancada.

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
| Tela técnica | `src/ui/CraftPanel.ts` (+ `#craft` no `index.html`, `.st-*` em `styles.css`) |
| Selo no HUD | `src/ui/JobsChip.ts` (`#jobs`) |
| Salvamento (v7: estações e trabalhos) | `src/core/save.ts` |
| Testes | `tests/crafting.test.ts`, `tests/base.test.ts`, `tests/save.test.ts`, `tools/visual-check/base.mjs` |

Nova receita = uma entrada em `recipes.ts`. Novo item = uma entrada em `items.ts` (com `about`, `traits`, `tint` e
aparência). Nova estação = `stations.ts` + um móvel em `base.ts` + um modelo em `stationModels.ts` + receitas.

## Em aberto

- Equipamentos e máquinas ao morrer: hoje ficam (a regra "perde tudo" só vale para o inventário).
- Fase 2 (v0.4): painel solar (silício + vidro + ferro + ouro), Gerador de Domo (núcleo de cristal), kit de reparo e traje
  (fibra de basalto), lanterna. Fase Marte: tabela acima.
- Ajustar os tempos depois de jogar no celular (é só mexer em preparo e por ponto, ou no calor/peso/raridade de um item).
