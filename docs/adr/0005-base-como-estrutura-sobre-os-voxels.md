# ADR 0005: A base é uma estrutura por cima dos voxels, com modelo próprio

- **Status:** aceita; aplicada na base inicial
- **Data:** 2026-11-11

## Contexto

A base precisa de colisão (paredes, piso, porta, móveis), de um visual mais detalhado que blocos (painéis,
faixas, porta que corre, janelas) e de um corte que mostra o interior quando o astronauta entra. Ela também
vai crescer: novos módulos, corredores e máquinas.

## Decisão

1. **Estrutura sobreposta ao mundo** (`src/world/Structure.ts`): cada módulo ocupa uma caixa de células.
   Dentro dela, `World.getBlock` pergunta à estrutura antes de olhar o terreno. Paredes, piso, telhado, porta
   e móveis viram o bloco `HULL` (não minerável). Colisão do jogador, dos destroços e o raio de mira passam a
   respeitar a base sem código especial.
2. **Fora dos chunks:** a base não é gravada nos chunks nem no salvamento do mundo. Ela é montada a cada
   carga a partir dos dados (`src/data/base.ts`), na altura do terreno **gerado** (não depende de edições).
   O mundo recusa editar blocos dentro dela e não põe pedras soltas embaixo.
3. **Modelo próprio** (`src/render/baseModel.ts`) feito do mesmo layout que a colisão (`world/baseLayout.ts`).
4. **Corte:** com o astronauta dentro, `peekBlock` (usado pela mira) trata telhado e paredes altas como ar,
   enquanto `getBlock` (colisão) continua sólido. O modelo esconde o telhado e tira de cena as paredes viradas para
   a câmera.

## Alternativas consideradas

| Opção                                            | Por que não                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Construir a base com blocos comuns nos chunks    | Visual preso ao cubo; o corte do telhado exigiria refazer a malha do chunk; o jogador poderia minerar a base |
| Interior em outra cena (teleporte para uma sala) | Quebra a sensação de lugar real no mapa; dificulta ver a base crescer por fora                               |
| Colisão com caixas soltas (AABB) fora dos voxels | Duplicaria a física do jogador, dos destroços e do raio                                                      |

## Consequências

- Crescer a base = acrescentar módulos e móveis em `src/data/base.ts`.
- Mudar o tamanho ou a posição de um módulo não invalida salvamentos (a base não está no salvamento do
  mundo), mas um módulo novo em cima de construções do jogador as esconderia: escolher lugares livres.
- `World.getBlock` ganhou uma checagem por estrutura; com poucas estruturas o custo é desprezível.
