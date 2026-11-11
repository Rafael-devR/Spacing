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

## Mochila

- Abre pelo botão de mochila ao lado da barra, ou pelas teclas **I** e **Tab**. Fecha pelo X, tocando fora,
  ou com **Esc**.
- **Mover:** toque num item (ele fica destacado em laranja) e depois toque no espaço de destino. Se o destino
  estiver vazio, o item vai para lá; se tiver o mesmo item, as pilhas se juntam até 64; se tiver outro item,
  os dois trocam de lugar.
- O jogo não pausa com a mochila aberta: o oxigênio continua gastando.

## Salvamento

O formato passou para a **versão 4**: `inventory` virou `{ slots, selected }`, com um espaço por posição
(`null` = vazio). Salvamentos antigos (só quantidades) viram espaços na ordem de referência dos itens.

## Código e testes

- Regras: `src/systems/Inventory.ts`. Barra: `src/ui/Hud.ts`. Mochila: `src/ui/Bag.ts`.
- Testes: `tests/core.test.ts` (regras), `tests/save.test.ts` (migração v3 → v4), `tests/survival.test.ts`
  (mochila cheia deixa o item no chão), `tools/visual-check/ui.mjs` (coleta no primeiro espaço e mover
  pela mochila no navegador).

## Em aberto

- Arrastar itens com o dedo (hoje é toque e toque).
- Dividir pilha (pegar metade) e jogar item fora.
- Tamanho da mochila ligado ao traje ou a equipamentos (Sobrevivência II).
- Atalho para mandar um item direto da mochila para a barra.
