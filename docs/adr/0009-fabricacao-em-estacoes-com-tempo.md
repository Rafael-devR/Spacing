# ADR 0009: Fabricação em estações que trabalham sozinhas, com tempo calculado dos ingredientes

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

Até aqui a bancada fazia três equipamentos em 3 a 5 segundos, direto do minério, com o jogador parado na frente dela.
O dono pediu ([design/CRAFTING.md](../design/CRAFTING.md)): itens com propósito e química de verdade (minério → refinado
→ peça), mais estações, fabricação **longa** (a bancada trabalhando por ~1 min 30 s enquanto ele sai) e tempo **dinâmico**
pelo material (calor, peso, raridade), com variação a cada vez. Também uma tela técnica que mostre o processo.

## Opções

1. **Tempo fixo por receita**, escrito à mão. Simples, mas cada receita nova exige inventar um número, e nada liga o
   tempo ao material, que era o pedido.
2. **Tempo calculado** a partir do que entra: cada item tem calor, peso e raridade (0 a 3); a estação tem um preparo e
   um custo por ponto; receitas químicas lentas têm um multiplicador de esforço; cada fabricação sorteia ±12%.
3. **Tempo real do relógio do aparelho** (continua com o jogo fechado). Dá para burlar mudando a hora e complica testes.

## Decisão

Opção 2, com o relógio do **jogo** (o dono escolheu: corre com o jogo aberto, em qualquer lugar do mundo; pausado ou
fechado, para).

- `src/data/stations.ts`: estações (bancada já vem pronta; forno solar e eletrolisador são fabricados na bancada).
- `src/data/items.ts`: `traits` (calor, peso, raridade), `about` (para que serve) e `tint` em todo item.
- `src/data/recipes.ts`: `outputs` (lista: itens, equipamento ou estação), `process` (reação, etapas, nota científica,
  medidores), `effort`, e as funções `recipeSeconds` e `rollSeconds`.
- `src/systems/Crafting.ts`: **um trabalho por estação**, estados *trabalhando → pronto → pego*. O resultado fica na
  estação até o jogador pegar; o que não cabe no inventário continua lá. O sistema recebe o sorteio (`rand`) por
  dependência, para os testes serem exatos.
- Salvamento **v7**: `crafting` com as estações construídas e os trabalhos (receita, tempo passado, duração sorteada e,
  se pronto, o que falta entregar). Quem vem de antes e não tem o Mapa ganha a placa de circuito que o Mapa agora pede.

## Revisão (2026-11-12)

O dono achou longo demais e pediu tempos bem menores, pegar cada unidade pronta, pausar e cancelar. O trabalho passou a
ter **preparo** e **tempo por unidade** (`prep`, `unit`, ambos com a variação), o que já foi pego (`taken`), pausa e
sobras de cancelamento; salvamento **v9** (v7 e v8 migram como "tudo por unidade, sem preparo"). Os números das estações
caíram ~10×.

## Consequências

- Receita nova = uma entrada de dados; o tempo sai sozinho e é coerente com as outras. Ajustar o ritmo do jogo é mexer
  em dois números por estação.
- O laço do jogo chama `Crafting.update` em qualquer lugar (antes, na prática, só importava dentro da base); a experiência
  (avisos, peça voando, máquina aparecendo) fica no `BaseDirector`, a tela em `ui/CraftPanel.ts` e o selo do HUD em
  `ui/JobsChip.ts`.
- O tempo sorteado é guardado no salvamento: recarregar não sorteia de novo.
- Fechar o jogo pausa as estações. Se um dia o dono quiser "continua com o jogo fechado", basta guardar a hora ao salvar
  e avançar os trabalhos ao carregar (com limite, para não premiar mexer no relógio).
