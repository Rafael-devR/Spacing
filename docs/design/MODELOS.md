# Modelos 3D feitos no Blender

- **Status:** pedido pelo dono em 2026-11-12; prontos o módulo de pouso (piloto), a base por fora e por dentro, os móveis e
  as três estações (bancada, forno solar e eletrolisador) com animação feita no Blender. Decisão técnica em
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
- **Peças que brilham** têm nome começando por `glow` (vidro escuro com brilho fraco, janelas do módulo) ou `lit` (acesas de
  verdade, com cor acima de 1 para o bloom pegar: janelas da base com a luz de dentro).
- **Referência, não molde** (pedido do dono): o modelo antigo dá o tamanho, o lugar e a identidade (casco branco, faixa
  laranja, luz azul-gelo), mas o modelo novo deve trazer coisas que o antigo não tinha.
- 1 unidade = 1 bloco; Z para cima no Blender (sai Y para cima no `.glb`); o chão do modelo é z = 0.

## Orçamento (celular)

O terreno já desenha de 66 mil a 280 mil triângulos por quadro, e a sombra desenha boa parte de novo. Cada modelo tem um
teto, conferido por `tests/models.test.ts`:

| Modelo | Teto | Hoje | Peças no jogo |
| --- | --- | --- | --- |
| Módulo de pouso | 3.000 | 2.060 | corpo (1 malha) + janelas (1) + 3 luzes + feixe |
| Casco da base (Habitat 01) | 4.000 | 2.640 | corpo (1) + janelas acesas (1) + 2 folhas da porta + pernas + 6 luzes + placa |
| Interior da base | 4.500 | 2.760 | piso + 8 peças de parede (e acesas/vidros) + 2 folhas |
| Móveis (8 tipos) | 4.000 | 2.390 | corpo + peça acesa por tipo |
| Bancada | 1.500 | 560 | corpo + carro + ventilador |
| Forno solar | 1.500 | 1.000 | corpo + gaiola + tubo de luz + janela + anel + ventilador + fole |
| Eletrolisador | 1.200 | 690 | corpo + vidro + água + faísca + bomba + 2 ponteiros + 9 bolhas |

Juntar tudo numa malha só importa tanto quanto os triângulos: o módulo antigo era ~25 peças (≈50 chamadas de desenho com a
sombra); o novo é 2.

## Módulo de pouso (piloto)

Mesmo tamanho e lugar do antigo (pés num raio de 1,7, altura ~4,1). Estágio de descida octogonal com folha dourada amassada
e convés de metal; quatro pernas com amortecedor, dois apoios e pé; escada e plataforma na perna voltada para onde o
astronauta nasce; motor embaixo; cabine facetada com escotilha e duas janelas triangulares (como as do módulo lunar da
Apollo), caixa de equipamentos atrás, quatro blocos de propulsores, túnel de acoplamento e antena com prato; a bandeira ao
lado. Se o arquivo não carregar, o jogo usa o modelo antigo em código.

## Luzes de sinalização

Luzes que piscam ou mudam de cor (status do módulo, porta e antena da base, balizas) são `SignalLamp`
(`src/render/lamps.ts`): um núcleo pequeno muito claro, que o bloom faz brilhar, e dois halos aditivos virados para a
câmera. Parecem acesas e espalham luz em volta, **sem `PointLight`**: luz de verdade entra na conta de luzes de todos os
shaders do mundo (cada pixel paga, e mudar o número recompila). Elas não iluminam o chão; se um dia uma luz precisar
iluminar de verdade, que seja uma só, fixa, medida no celular.

## Casco da base (Habitat 01)

Lado de fora (`tools/models/habitat.py`). Feito para as medidas do `HAB_MODULE` (11×9, 3 de altura, porta no meio da
parede sul), que ficam em `lib.HAB` para todos os scripts da base; `shellFits()` confere, e um módulo de outras medidas é
montado em código como antes.

- Colunas facetadas nos cantos, nervuras e faixa laranja; três janelas com moldura em cada lado (leste e oeste), acesas em
  azul-gelo como a luz de dentro; dois radiadores de aletas na parede norte.
- Câmara de entrada com batentes, faixas de atenção, marquise laranja, soleira e degrau; as duas folhas da porta são peças
  à parte (`door_l`, `door_r`) que o código abre.
- Telhado com beiral e abóbada com nervuras; dois painéis solares num mastro, antena com luz vermelha, prato de
  comunicação e caixa de ventilação.
- Pontos marcados: `leg_0..5` (o código faz pernas telescópicas até o chão, que muda com o terreno), `door_lamp`,
  `antenna_lamp`, `beacon_0..3` (balizas azul-gelo nos cantos do telhado) e `sign` (a placa com o nome do módulo).
- **Fora e dentro em camadas separadas** (ADR 0006): o casco fica só na camada do mundo (`exteriorOnly`); as paredes, a
  porta e a base montadas em código ficam só na do interior (`interiorOnly`), como forro de dentro. De fora não se
  desenha mais o que é de dentro (nem a sombra dele), e de dentro o casco não aparece.

## Interior da base

`tools/models/habitat_interior.py`: piso de placas com passarela e faixa de atenção na porta; forro das paredes com
painéis, nervuras, rodapé aceso, linha laranja e luminária no alto; janelas leste e oeste (vidro escuro, lá fora é o
espaço), canos e moldura da janela da Terra na parede norte, grade de ventilação e quadro elétrico; batentes e folhas da
porta por dentro.

- Cada parede sai em duas peças, porque o corte (a câmera de dentro) abaixa só a parte de cima das paredes viradas para
  ela: `wall_<l>_lo` (fica de pé) e `wall_<l>_hi` (pivô em y = 2; o código achata em y). Peças acesas e vidros da
  mesma parede seguem o nome (`lit_wall_<l>_hi`, `glow_wall_<l>_hi`). O topo das paredes é escuro: aparece quando
  abaixam.
- O piso vai para as duas camadas (de fora, com a porta aberta, vê-se lá dentro); o resto só para a de dentro.
- Pontos: `earth` (a imagem da Terra, em código), `door_in_l/r` (folhas), `door_in_lamp` (luz com halo).

## Móveis

`tools/models/furniture.py`: um nó por tipo (`bed`, `locker`, `console`, `shelf`, `plants`, `table`, `tank`, `crates`), no
próprio espaço (chão em y = 0, centro do lugar que ocupa, costas na parede, frente para +z). O código clona o nó do tipo
(`modelPart`) e põe onde `data/base.ts` manda. Móvel novo = tipo nos dados + peça no script (o teste confere que todo
móvel dos dados tem o seu nó). O console tem o ponto `console_screen`, onde o código põe a tela desenhada.

## Estações com animação feita no Blender

`workbench.py`, `furnace.py`, `electrolyzer.py`. Cada uma tem **uma animação em laço** feita no Blender (quadros-chave em
objetos separados, exportada como uma animação só: `lib.export(out, anim=True)`). O jogo toca com um `AnimationMixer`
na velocidade do trabalho: rodando quando a máquina trabalha, parando devagar quando ela desliga.

| Estação | O que anima no Blender | O que continua no código |
| --- | --- | --- |
| Bancada | carro do pórtico indo e voltando, ventilador | lasers (saem de `emitter_0/1`, presos ao carro), grade do tampo, peça impressa, faíscas |
| Forno solar | ventilador, fole | calor da janela (`fx_window`), luz do tubo (`fx_core_tall`), anel, brasas (`vent`) |
| Eletrolisador | bolhas subindo (o dobro do lado do H₂), bomba, ponteiros | brilho da água (`fx_liquid`), faísca (`fx_arc`), mostrar as bolhas só trabalhando |

O que depende do jogo (a peça que está sendo impressa, para onde os lasers apontam, o calor) fica no código; o movimento
mecânico, que é sempre o mesmo, fica no Blender. Peças `fx*` recebem material do código; `glass*` são vidro transparente;
peças com `tall` no nome vão até o teto e saem do ícone. O holograma de "ainda não construída" sai das arestas do modelo.

## Próximos candidatos

Astronauta (peças separadas, que o código continua animando), painel solar, pedras e minérios soltos (variações por semente), meteorito. Cada um com o seu teto no teste.

## Montar o Blender no Codespace

Ver `tools/models/README.md`. O Blender 4.5 LTS fica em `/tmp/blender` (pode sumir quando o Codespace reinicia).
