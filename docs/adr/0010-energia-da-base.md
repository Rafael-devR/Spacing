# ADR 0010: Energia da base como um sistema próprio, com painéis livres no mundo

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

O dono testou a fabricação (ADR 0009) e notou que as máquinas não tinham de onde tirar energia. Pediu uma regra para o
jogo inteiro: **nada vem do nada**. Escolheu aplicar agora à energia das máquinas (o oxigênio fica para depois), com
**painéis solares colocados livres no mundo**, e pediu que várias receitas trabalhem ao mesmo tempo na mesma estação,
**dividindo** o calor e a energia.

## Opções

1. Painéis em vagas fixas ao lado da base (mais simples).
2. **Painéis livres no mundo** (escolha do dono), ligados à base por alcance de cabo, e com sombra calculada.
3. Cabos de verdade, colocados bloco a bloco. Muito trabalho no celular, sem ganho claro agora.

## Decisão

Opção 2.

- `systems/Power.ts` é puro e testável: soma a geração (telhado + painéis ligados, vezes o sol do planeta e da
  tempestade), soma o consumo (habitat, estações trabalhando, recarga do traje), carrega ou descarrega a bateria e
  calcula `satisfaction` (0..1). Quem usa a rede anda nessa velocidade; o forno anda na velocidade do sol (`sun`).
- O painel é um **objeto do mundo** (`PropType` `solarPanel`), salvo como os objetos criados no jogo (`extraProps`):
  colocar e desmontar reaproveitam o que já existe para meteoritos e pedras. A sombra é um raio de voxels do painel
  para o sol (`World.sunExposure`), refeito a cada segundo, e só quando o chunk está carregado.
- A direção do sol saiu de `render/lights.ts` para `data/power.ts` (`SUN_DIRECTION`), para os sistemas não dependerem
  da renderização.
- `Crafting` recebe `speed(station)` por dependência; a energia de cada estação é dividida igualmente entre as vagas que
  trabalham.
- Salvamento **v8**: trabalhos com vaga, lote e trabalho feito (`slot`, `batch`, `work`, `done`) e `power.battery`. A v7
  migra (um trabalho por estação vira a vaga 0, lote 1).

## Consequências

- O jogador tem um motivo novo para explorar e construir: lugares altos e ensolarados perto da base.
- Mais consumo que geração deixa as máquinas lentas, nunca travadas: nada de jogo preso.
- As telas das estações e a de energia passaram a ser **Canvas em tela cheia** (`ui/canvasScreen.ts`), porque o dono
  achou o painel em HTML poluído e pediu uma interface mais visual, com cada pontinho representando algo real.
- Falta aplicar a regra ao oxigênio, à bateria do módulo de pouso e ao reparo do traje (registrado em ENERGIA.md).
