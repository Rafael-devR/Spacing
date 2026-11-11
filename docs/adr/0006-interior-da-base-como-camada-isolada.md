# ADR 0006: O interior da base é um ambiente isolado, desenhado numa camada própria

- **Status:** aceita
- **Data:** 2026-11-11

## Contexto

Na primeira versão da base, ao entrar, a câmera só abaixava as paredes da frente e escurecia o chão em volta
com uma máscara. O terreno, as pedras, o módulo de pouso e o céu continuavam visíveis, e o jogador ainda
conseguia minerar e construir no mundo de fora com a mira. O dono pediu que a base seja um espaço separado:
lá dentro não se vê o terreno nem se mexe no mundo, e a ambientação deixa claro que se está numa base.

## Opções

1. **Sala em outro lugar** (como interiores de Pokémon ou Stardew Valley): o interior fica numa área ou
   cena separada e o astronauta é teletransportado para lá. Isolamento total, mas duplica colisão, física,
   salvamento e posição; a câmara de pressurização e a bancada deixam de estar onde a base está, e a base
   que cresce em módulos precisaria de dois modelos (fora e dentro).
2. **Esconder objeto por objeto** (`visible = false` no terreno, pedras, módulo, marcadores...). Frágil:
   cada sistema novo que põe algo na cena teria de lembrar de se esconder.
3. **Mesmo lugar, camada própria** (`THREE.Layers`). A base continua no mundo, com a mesma colisão e o
   mesmo modelo, mas, com o astronauta dentro, a câmera passa a ver **só a camada do interior**.

## Decisão

Opção 3 (`src/render/indoors.ts`):

- Entram na camada do interior: o modelo da base (menos as partes de fora: pernas, degrau, círculo da porta
  e telhado, marcadas com `exteriorOnly`), o astronauta, as partículas (faíscas do laser) e todas as luzes
  (para o número de luzes não mudar e os shaders não recompilarem). O resto fica só na camada do mundo e
  some sozinho, inclusive o que for criado no futuro.
- `IndoorView.set(true)`: câmera na camada 1, fundo escuro da base no lugar do céu, luz de dentro. A neblina
  não é desligada (recompilaria os shaders), só fica longe.
- `Interaction.lockWorld(true)`: sem minerar, construir, mirar nem andar por toque; colocar e quebrar
  recusam mesmo se chamados. O botão de construir some.
- Meteoros param de nascer (`holdSpawns`); o impacto de um que já estava no ar chega como tremor grave.
- Áudio: o fundo da cratera quase some, o eco fica curto e entra a ventilação da base.
- A troca é decidida pelo `BaseDirector` (`indoorView`) e aplicada pelo `Game` atrás das portas da câmara de
  pressurização, então nunca aparece pela metade. Carregar o jogo dentro da base ou renascer no beliche
  também troca.

## Consequências

- Isolamento visual e de interação sem mexer em colisão, física ou salvamento (sem nova versão de save).
- A máscara escura do chão saiu do modelo.
- O mundo continua simulando por trás (chunks carregados, destroços), o que é barato e mantém a volta
  instantânea.
- Objetos novos que precisem aparecer dentro da base devem passar por `showIndoors`.
- Se um dia a base virar um lugar grande (vários módulos com corredores), a opção 1 pode voltar à mesa.
