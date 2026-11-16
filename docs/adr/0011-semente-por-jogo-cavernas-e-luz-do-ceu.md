# ADR 0011: Semente por jogo, mundo de 96 blocos, cavernas com luz do céu e corte de câmera

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

A semente era fixa por planeta e o mundo tinha 48 blocos de altura, sem vazios no subsolo. O dono pediu
([design/MUNDO.md](../design/MUNDO.md)): semente nova a cada jogo, mundo maior para cima e para baixo, blocos novos,
cavernas complexas e uma câmera que funcione dentro delas. Três decisões técnicas saíram daí.

## Decisão

### 1. A semente mora no salvamento; o gerador tem versão

A semente é sorteada no jogo novo e gravada. O salvamento (v10) ganha `worldGen`; se for diferente do `WORLD_GEN` do
planeta, `renewWorld` mantém o progresso e refaz o mundo. Assim "mudar o gerador invalida os salvamentos"
([ADR 0003](0003-mundo-em-voxels-por-chunks.md)) deixa de custar o progresso do jogador. Como a semente varia, o gerador
**garante** o que o começo precisa (planície, gelo, entrada de caverna) em vez de depender de uma semente escolhida a dedo.

### 2. Escuro por luz do céu por vértice, não por luzes

Opções: (a) nada, só a sombra do sol: a luz ambiente deixaria as cavernas cinzentas; (b) escurecer a luz ambiente
quando o astronauta está no subsolo: escurece a superfície junto e não mostra o buraco escuro visto de fora;
(c) **luz do céu por bloco, propagada por inundação e levada a cada vértice** (como o Minecraft). Escolhida a (c): é
calculada no mesmo passo da malha, com 12 blocos de margem dos chunks vizinhos, e o shader multiplica o sol e a luz
ambiente por ela. A lanterna é um termo no shader (posição e força em `uLamp`), não uma luz do Three.js: não muda o
número de luzes, então nada recompila.

### 3. Câmera: aproximar e cortar a rocha, não colidir

Opções: (a) câmera que encosta no astronauta ao bater na rocha (terceira pessoa): testada, nos túneis estreitos ela
ficava a 2 blocos e o astronauta ocupava a tela; (b) cortar o mundo num plano horizontal: decepa a paisagem inteira;
(c) **aproximar e não desenhar só a rocha entre a câmera e o astronauta** (`render/cutaway.ts`). Escolhida a (c). O
miolo da rocha cortada é desenhado pelo avesso das faces (material de dois lados, cor escura fixa), sem gerar malha
nova. O material com corte só entra nos chunks enquanto há teto sobre o astronauta, para o custo (dois lados e
`discard`) não pesar ao ar livre; ele é compilado no carregamento.

## Consequências

- Chunk: 16 × 16 × **96**. Gerar custa ~2,3 ms no computador de desenvolvimento (era ~0,9): mais blocos por coluna e as
  cavernas (ruídos 3D numa grade 4×2×4, interpolados; um só ruído para todos os minérios).
- Refazer a malha inclui a inundação da luz numa região de 40 × 40 colunas. Uma edição que abre ou fecha um caminho para
  o céu refaz também os chunks a até 12 blocos; as outras, só os de borda, como antes.
- Mais um material de terreno (`terrain-cut`) e quatro uniforms do corte; a mira (`Interaction`) recebe `aimSkip`.
- Os testes não dependem mais de uma semente: conferem as garantias em cinco.
- O gerador de Marte não mudou (`WORLD_GEN.marte = 1`): os salvamentos de Marte continuam valendo.
