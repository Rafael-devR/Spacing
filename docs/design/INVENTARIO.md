# Inventário

Inventário em **espaços livres**, como no Minecraft. Nenhum espaço é preso a um tipo de item nem mostra
ícone do que aceita: um espaço vazio é só um quadrado vazio.

## Regras

- **32 espaços:** os 8 primeiros são a **barra de itens** (sempre na tela) e os outros 24 são a **mochila**.
- **Pilhas de até 64** unidades por espaço (`STACK_SIZE`; um item pode ter outro limite com `stack` em
  `src/data/items.ts`).
- **Ordem de coleta:** o item coletado completa primeiro uma pilha do mesmo item que ainda tenha espaço e,
  se não houver, ocupa o **primeiro espaço vazio**, da barra para a mochila.
- **Mochila cheia:** o que não cabe volta para o chão, flutuando como os itens da morte, e a IA do traje
  avisa. Ao abrir espaço, basta passar por cima.
- **Construir** usa o item do espaço selecionado na barra. Espaço vazio ou recurso (minério, cristal) não
  constrói.
- **Entregas da missão** tiram os itens de qualquer espaço, começando pelos últimos, para preservar a barra.
- **Morte:** todos os espaços esvaziam, barra e mochila, e os itens caem no chão (como antes).
- Esvaziar um espaço deixa um buraco; o próximo item **novo** vai para ele.

## Tela do inventário (desde 2026-11-13, [ADR 0019](../adr/0019-inventario-e-estacoes-em-html.md))

Uma tela só para tudo que mexe em itens: a **mochila** e as **estações** ([ESTACOES.md](ESTACOES.md)). O inventário fica sempre à
direita (em pé, embaixo): **3 fileiras da mochila** e, separada por um fio, **a barra de itens** (8 espaços, a mesma do HUD). O lado
esquerdo muda: na mochila mostra o **traje** (equipamentos) e o **item escolhido** (nome, para que serve, quantos tem).

- Abre pelo botão de mochila ao lado da barra, ou pelas teclas **I** e **Tab**. Fecha no **‹** de cima, tocando fora, ou com **Esc**.
- O jogo não pausa com a tela aberta: o oxigênio continua gastando.

### Gestos (a "mão", como no Minecraft)

| Gesto | Celular | Computador | O que faz |
| --- | --- | --- | --- |
| Arrastar | segurar e mover o dedo | arrastar com o mouse | o item segue o dedo; ao soltar: espaço vazio recebe, mesmo item junta, outro item troca |
| Tocar e tocar | toque no item, toque no destino | clique, clique | igual a arrastar, sem segurar |
| Metade | **toque longo** (a pilha "pula") e arraste ou toque no destino | botão direito | leva metade da pilha |
| Mandar rápido | **toque duplo** | Shift + clique | mochila ↔ barra; numa estação, manda para a entrada da máquina |
| Organizar | botão **Organizar** | | junta pilhas iguais e ordena a mochila (a barra não muda) |

- Soltar fora do inventário (ou tocar de novo no mesmo item) **cancela**: nada muda.
- Enquanto arrasta, o espaço de origem fica apagado com o que sobra, e o destino sob o dedo acende (verde = aceita,
  vermelho = não aceita).
- A mão **não guarda itens**: eles só mudam de lugar ao soltar. Fechar a tela no meio de um arrasto não perde nada.

### Visual

Minimalista e espacial, igual nas estações: fundo quase preto translúcido sobre o jogo, **fios de 1 px**, espaços quadrados com
o número da pilha em letra técnica (JetBrains Mono) no canto, títulos em Chakra Petch maiúsculo. Um só destaque frio (ciano); o
espaço escolhido da barra tem **cantoneiras** em vez de borda grossa. Sem sombras, sem brilho de botão.

### Barra de itens (HUD)

Mesma linguagem: espaços escuros com fio fino, número em letra técnica, o selecionado com cantoneiras ciano e o nome do item em
cima, em maiúsculas pequenas. Tocar seleciona (como antes); arrastar na barra do HUD não existe (o dedo ali é do jogo).

## Salvamento

O formato passou para a **versão 4**: `inventory` virou `{ slots, selected }`, com um espaço por posição
(`null` = vazio). Salvamentos antigos (só quantidades) viram espaços na ordem de referência dos itens.

## Código e testes

- Regras: `src/systems/Inventory.ts` (`moveN`, `quickMove`, `sortBag`). Barra: `src/ui/Hud.ts`. Tela: `src/ui/inventory/` (`screen.ts` a
  tela, `grid.ts` os espaços, `hand.ts` os gestos), mochila em `src/ui/Bag.ts`.
- Testes: `tests/core.test.ts` (regras), `tests/inventoryOps.test.ts` (mover parte, mandar rápido, organizar), `tests/save.test.ts` (migração v3 → v4), `tests/survival.test.ts`
  (mochila cheia deixa o item no chão), `tools/visual-check/ui.mjs` (coleta no primeiro espaço e mover
  pela mochila no navegador).

## Em aberto

- Jogar item fora (soltar no mundo).
- Arrastar espalhando por vários espaços (dividir igual).
- Tamanho da mochila ligado ao traje ou a equipamentos (Sobrevivência II).
