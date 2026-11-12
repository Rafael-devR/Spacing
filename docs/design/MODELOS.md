# Modelos 3D feitos no Blender

- **Status:** pedido pelo dono em 2026-11-12; piloto pronto (módulo de pouso). Decisão técnica em
  [ADR 0013](../adr/0013-modelos-do-blender-por-script.md).

## O pedido

Os modelos eram montados em código (`src/render/models.ts`, `stationModels.ts`, `craftedModels.ts`): caixas, cilindros e
cones posicionados um a um, com uma cor lisa por peça. O dono quer mais qualidade e controle, e pediu que **eu (o Claude)
faça os modelos**. Ele já usou o Blender; o MagicaVoxel não roda aqui (só Windows e Mac, e precisa de janela).

## Como os modelos são feitos

1. Cada modelo é um **script Python do Blender** em `tools/models/<modelo>.py`, rodado sem janela. Os ajudantes comuns estão
   em `tools/models/lib.py` (peças, chanfros, cores por face, amassado, oclusão assada, prévia, exportação).
2. `tools/models/build.sh [modelo]` gera `src/assets/models/<modelo>.glb`. Com `PREVIEW=<pasta>`, também uma imagem de prévia
   renderizada no Blender (Cycles na CPU), para olhar antes de levar ao jogo.
3. O jogo carrega os `.glb` antes de montar a cena (`src/render/gltfModels.ts`) e **troca os materiais pelos nossos**, para o
   modelo ficar com a mesma luz, sombra, névoa e brilho que o resto do mundo.
4. Depois de gerar, conferir no jogo com o `tools/visual-check` (capturas) e no celular.

O que se mexe ou muda no jogo (luzes de status, feixe, animação) continua no código. O modelo marca onde essas coisas
ficam com **vazios** do Blender (`lamp_0`, `beam`...), e o código procura por nome.

## Estilo

- **Low poly cartoon**, como o resto do jogo: faces planas (o material usa sombreamento plano), uma cor por face, cores
  sRGB em hex nos scripts.
- **Detalhe na forma, não em textura:** chanfros nas quinas, peças pequenas (rebites, bocais, escada), folha metálica
  "amassada" (vértices deslocados ao acaso e brilho variando por face).
- **Oclusão ambiente assada nas cores:** cantos e encaixes mais escuros. Dá profundidade sem custo no celular.
- **Sem texturas e sem materiais no arquivo:** o `.glb` leva só geometria, normais, cor por vértice e os vazios.
- **Peças que brilham** têm nome começando por `glow` (janelas): o jogo dá a elas um material com brilho próprio.
- 1 unidade = 1 bloco; Z para cima no Blender (sai Y para cima no `.glb`); o chão do modelo é z = 0.

## Orçamento (celular)

O terreno já desenha de 66 mil a 280 mil triângulos por quadro, e a sombra desenha boa parte de novo. Cada modelo tem um
teto, conferido por `tests/models.test.ts`:

| Modelo | Teto | Hoje | Peças no jogo |
| --- | --- | --- | --- |
| Módulo de pouso | 3.000 | 2.060 | corpo (1 malha) + janelas (1) + 3 luzes + feixe |

Juntar tudo numa malha só importa tanto quanto os triângulos: o módulo antigo era ~25 peças (≈50 chamadas de desenho com a
sombra); o novo é 2.

## Módulo de pouso (piloto)

Mesmo tamanho e lugar do antigo (pés num raio de 1,7, altura ~4,1). Estágio de descida octogonal com folha dourada amassada
e convés de metal; quatro pernas com amortecedor, dois apoios e pé; escada e plataforma na perna voltada para onde o
astronauta nasce; motor embaixo; cabine facetada com escotilha e duas janelas triangulares (como as do módulo lunar da
Apollo), caixa de equipamentos atrás, quatro blocos de propulsores, túnel de acoplamento e antena com prato; a bandeira ao
lado. Se o arquivo não carregar, o jogo usa o modelo antigo em código.

## Próximos candidatos

Astronauta (peças separadas, que o código continua animando), base (Habitat), forno solar e eletrolisador, bancada,
painel solar, pedras e minérios soltos (variações por semente), meteorito. Cada um com o seu teto no teste.

## Montar o Blender no Codespace

Ver `tools/models/README.md`. O Blender 4.5 LTS fica em `/tmp/blender` (pode sumir quando o Codespace reinicia).
