# Áudio

Todo som do jogo é sintetizado com WebAudio, sem arquivos (`src/audio/Sfx.ts`). Este documento explica
como o som se espalha pelo mundo.

## Ideia: na Lua não há ar

O som não viaja pelo vácuo. No jogo, o traje capta a **vibração que chega pelo chão** e a reconstrói dentro
do capacete, indicando de onde ela veio. Essa é a mesma ficção leve da IA do traje
([STORY.md](../STORY.md)), e explica por que tudo soa um pouco abafado:

- **Perto:** som limpo, quase sem eco.
- **Longe:** mais baixo e mais grave, porque o chão leva bem os graves e perde os agudos. Também tem mais eco
  das paredes da cratera.
- **Longe demais:** não chega.

## Dois tipos de som

| Tipo            | Exemplos                                                                                                                   | Posição                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Do capacete** | IA do traje, alarmes, respiração, batimento, dano, morte, coleta, interface, recarga                                       | Nenhuma: sempre no centro, sem eco                  |
| **Do mundo**    | passos, pulo, pouso, golpes da furadeira, bloco quebrado ou colocado, destroços, meteoro caindo, explosão, módulo de pouso | Vem do ponto do mundo, com direção, distância e eco |

## Como funciona

- **Ouvinte:** fica um pouco atrás do astronauta, do lado da câmera, e olha para onde ela olha. Assim o lado
  esquerdo e o direito do som batem com os lados da tela, inclusive depois de girar a câmera, e um som no
  próprio astronauta fica no centro.
- **Distância:** é medida até o astronauta, não até a câmera, para o zoom não mudar o volume.
- **Direção:** cada som do mundo passa por um `PannerNode` (modelo `equalpower`, leve no celular). O volume
  pela distância é calculado pelo jogo, não pelo navegador: as contas ficam em `src/audio/spatial.ts`, com
  testes em `tests/spatial.test.ts`.
- **Eco da cratera:** um `ConvolverNode` com uma resposta gerada no início (ruído que decai em 2,4 s, com
  reflexos fortes no começo). Cada som do mundo manda uma parte para ele; quanto mais longe, mais eco.
- **Sons que se movem:** o meteoro em queda leva o som junto (`Voice.at`), então dá para ouvi-lo vindo do céu.

### Perfis de distância

| Perfil | Usado em                          | Volume cheio até | Some em    |
| ------ | --------------------------------- | ---------------- | ---------- |
| `NEAR` | passos, golpes, blocos, destroços | 3 blocos         | 28 blocos  |
| `FAR`  | meteoro e explosão                | 8 blocos         | 120 blocos |
| `HUM`  | módulo de pouso                   | 2,5 blocos       | 24 blocos  |

### Módulo de pouso

O módulo zumbe o tempo todo: bombas (um "tum" lento), ventilação (chiado leve) e um grave elétrico. Perto dele
o zumbido aparece e, de longe, some. Isso ajuda a achar o caminho de volta para recarregar o traje.

### Dentro da base

Ao passar para o interior, o fundo grave da cratera quase some, o eco fica curto (sala pequena) e entra a
ventilação da base: chiado de ar que "respira" devagar e um zumbido grave de máquinas, sem posição
(`Sfx.setIndoors`). Meteoros que já estavam caindo chegam mais graves e com menos tremor.

## Testar

- `tests/spatial.test.ts`: volume, filtro e eco pela distância, e lado do som com a câmera em vários giros.
- `tools/visual-check/audio.mjs`: no Chromium headless, toca explosões à direita e à esquerda e mede o
  volume de cada canal, confere que longe soa mais baixo, que o zumbido do módulo some de longe e que o
  meteoro toca sem erro.
- O que só dá para julgar no celular, de preferência com fone: se a direção está clara, se o eco está no
  ponto e se o zumbido do módulo incomoda.

## Em aberto

- **HRTF** (som em 3D de verdade, com frente, trás e altura) para quem joga de fone. Pesa mais no celular,
  então seria uma opção no menu.
- Som do domo (ar e vento por dentro), na Sobrevivência II.
- Outras fontes em laço: cristais, máquinas, rover.
- Trilha sonora.
