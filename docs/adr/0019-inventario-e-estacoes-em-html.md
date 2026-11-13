# ADR 0019: Inventário e estações numa tela só, em HTML, com mão de arrastar

- **Status:** aceita
- **Data:** 2026-11-13
- **Substitui:** [ADR 0018](0018-forno-em-pixijs.md) (forno em PixiJS) e a parte de estações das telas em Canvas (ADR 0010)

## Contexto

O dono pediu para refazer de uma vez **inventário, barra de itens, mochila e todas as estações**, com liberdade de design. Ele
quer:

- **ergonomia de Minecraft:** pegar um item e **arrastar** com o dedo, dividir pilha, tudo livre;
- a estação e o inventário **juntos** na mesma tela: de um lado a máquina (onde entra o item, onde sai), do outro o inventário;
- visual **minimalista, espacial, simples**, menos cartoon.

Hoje há três tecnologias para a mesma família de telas: mochila em HTML (toque e toque), bancada e eletrolisador em Canvas 2D
(`CraftPanel`, botões desenhados à mão a cada quadro), forno em PixiJS (WebGL próprio, ~500 KB). Arrastar um item **de uma para
outra** (da mochila para a máquina) é muito difícil com três motores de desenho diferentes.

## Opções

1. **Tudo em PixiJS.** Uma cena só, arrastar dentro dela. Mas texto, rolagem, acessibilidade e tamanho de letra no celular
   ficam todos à mão, o carregamento cresce, e a barra do HUD continuaria em HTML.
2. **Tudo em Canvas 2D.** Sem dependência, mas a mesma dor do `CraftPanel`: cada botão, rolagem e toque escrito à mão.
3. **HTML + CSS com Pointer Events** (escolhida). O navegador já resolve texto nítido, rolagem com o dedo, layout que se adapta
   (deitado e em pé), toque e mouse. Arrastar é um "fantasma" que segue o dedo (`pointermove`) e `elementFromPoint` diz onde
   soltou. A parte que mexe (a câmara da máquina) é **um canvas pequeno** dentro da tela, só ele animado.

## Decisão

- Uma tela (`#inv`) com dois lados: o **painel da esquerda** muda (traje e equipamentos na mochila; a máquina numa estação) e o
  **inventário à direita** é sempre o mesmo componente. Em pé, um em cima do outro.
- Uma **mão** (`ui/inventory/hand.ts`) trata todos os gestos: arrastar, tocar e tocar, toque longo (metade), toque duplo
  (mandar rápido). As regras ficam no sistema (`Inventory.moveN`, `quickMove`, `sortBag`), puras e testadas.
- As estações **não mudam de regra**: soltar um item na entrada escolhe a receita que usa aquele item e o tamanho do lote; o
  material só sai do inventário ao tocar em **Fabricar** (como antes). A saída é tocada ou arrastada para o inventário (pegar).
- A câmara de cada estação é um canvas 2D pequeno com uma animação simples e própria (calor no forno, laser na bancada, bolhas
  no eletrolisador). O modelo de calor do forno (`ThermalModel`, testado) continua.
- **Sai o PixiJS** (`pixi.js` deixa de ser dependência) e saem `CraftPanel`, `FurnacePanel`, `StationPanel` e `ui/furnace/`.
  A tela de energia (console) também vira HTML no mesmo estilo; `canvasScreen.ts` deixa de ser usado.
- Visual em [design/INVENTARIO.md](../design/INVENTARIO.md) e [design/ESTACOES.md](../design/ESTACOES.md).

## Consequências

- Uma linguagem visual e um jeito de mexer em todas as telas de itens; arrastar entre inventário e máquina "de graça".
- Carregamento menor (sem Pixi) e uma tecnologia a menos para manter.
- Perde-se a cena rica do forno em Pixi (espelhos, ventoinha). Foi escolha consciente pelo pedido de "minimalista e simples";
  a câmara animada pequena guarda o essencial (calor, fagulhas, trabalho acontecendo).
- Os testes no navegador continuam tocando nos mesmos nomes (`r:<receita>`, `make`, `take`, `back`, `slot:N`…), agora lidos dos
  elementos HTML (`hits`).
