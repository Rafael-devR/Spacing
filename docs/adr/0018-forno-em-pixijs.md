# ADR 0018: Tela do forno em PixiJS

- **Status:** aceita
- **Data:** 2026-11-13

## Contexto

As telas cheias das estações são desenhadas em Canvas 2D (`ui/canvasScreen.ts`): cada quadro limpa tudo e redesenha à mão,
botão por botão. Funciona para painéis simples, mas o dono quer que a tela do **forno** *mostre* o forno trabalhando, como o jogo
de referência dele (Idle CPU, feito em PixiJS 8): ventoinha girando e esfriando, calor, fagulhas, fumaça, espelhos que mandam
luz, minério caindo no cadinho e barra saindo. Isso pede muitos objetos animados com camadas, partículas e brilho aditivo, que em
Canvas 2D ficam caros e difíceis de manter. Ele também quer a tela **toda refeita**, não retocada, e só a do forno por enquanto.

## Opções

1. **Continuar em Canvas 2D** com mais efeitos à mão. Sem dependência nova, mas cada efeito custa CPU em todo quadro e a lógica de
   desenho e a de toque ficam misturadas.
2. **Three.js** (já está no jogo) com câmera ortográfica. Evita dependência, mas a base de Three.js não tem texto, botões e vetores
   2D; seria reescrever tudo isso.
3. **PixiJS 8** (escolhida): cena 2D com grafos, texto, eventos de toque, mistura aditiva e sprites em GPU. É o que o jogo de
   referência usa.

## Decisão

- Dependência nova: `pixi.js` fixado em **8.22.0** (a mesma versão do jogo de referência; fixada porque a versão muda a API).
- **Carregada sob demanda**: `StationPanel` importa o painel do forno com `import()` só na primeira vez que o forno abre, então o
  carregamento do jogo não muda. O Pixi tem o **canvas e o contexto WebGL próprios** (`#furnace`), com o relógio parado enquanto a
  tela está fechada.
- Só o **forno** muda. Bancada e eletrolisador seguem em Canvas até o dono pedir. Um `StationPanel` (fachada) escolhe a tela e
  mantém a mesma interface do `CraftPanel` (`show`, `close`, `open`, `onCraft`…), então `Game` e `BaseDirector` quase não mudam.
- **Se o Pixi não iniciar** (sem WebGL), o forno cai no `CraftPanel` antigo; nada deixa de funcionar.
- A lógica do forno (temperatura, ventoinha, esfriar) fica em `ui/furnace/furnaceModel.ts`, **sem Pixi**, e é testada em Node.
  As regras de fabricação continuam em `systems/Crafting.ts`: a tela só lê e pede.

## Consequências

- Mais um contexto WebGL aberto enquanto a tela do forno está aberta (o Three.js continua com o dele). Medir no celular.
- O pacote do Pixi (~150 KB comprimido) vem num pedaço à parte, carregado ao abrir o forno pela primeira vez.
- Estações futuras em Pixi reaproveitam `ui/furnace/pixiKit.ts` (botão, texto, partículas); quando houver mais de uma, o kit sobe
  para `ui/pixi/`.
