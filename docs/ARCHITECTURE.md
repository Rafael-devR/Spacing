# Arquitetura

## Stack

| Camada            | Escolha                          | Motivo (ver [ADRs](adr))                                  |
| ----------------- | -------------------------------- | --------------------------------------------------------- |
| Renderização      | Three.js `0.160.0` (fixado)      | Controle total de shader, roda em celular, sem instalar   |
| Linguagem         | TypeScript (migração gradual)    | Projeto grande precisa de tipos                           |
| Build e servidor  | Vite                             | Recarga rápida, build simples, sem configuração pesada    |
| Testes            | Vitest                           | Mesma configuração do Vite, roda em Node                  |
| Qualidade         | ESLint + Prettier                | Padrão único de código                                    |
| Persistência      | `localStorage` hoje              | Simples; migrar para IndexedDB (ver "Dívidas")            |
| Distribuição      | Web; PWA e Capacitor depois      | Navegador agora, app instalável quando fizer sentido      |

O Three.js está fixado numa versão exata porque o material dos blocos injeta código GLSL nos blocos internos
do `MeshLambertMaterial`. Atualizar exige revisar `src/graphics.js`.

## Visão geral em tempo de execução

```
 input ─────┐
            ▼
        interaction ──► world (chunks, blocos, objetos) ──► mesher ──► render
            │                ▲                                  ▲
            ▼                │                                  │
  player / debris / meteors ─┘      missions ─► ui (HUD)        │
            │                                                   │
            └───────────────► particles, footprints, audio ─────┘
```

Laço principal (`main.js`, uma vez por quadro): entrada → jogador → destroços, pegadas, meteoros e missões →
câmera → carregar e descarregar chunks → interação → partículas → sombra → HUD → pós-processamento.

## Estado atual do código

Tudo em `src/`, ainda em JavaScript e sem subpastas.

| Arquivo          | Responsabilidade                                                                       |
| ---------------- | -------------------------------------------------------------------------------------- |
| `main.js`        | Inicialização, ligação dos módulos, laço principal, salvar e carregar, qualidade       |
| `world.js`       | Gerência de chunks, blocos, raycast por voxel, objetos soltos, edições salvas          |
| `terrain.js`     | Geração procedural determinística por semente (relevo, crateras, minérios, objetos)    |
| `noise.js`       | Gerador pseudoaleatório, hashes, ruído simplex 2D/3D, fbm                              |
| `mesher.js`      | Malha do chunk: só faces visíveis, oclusão por vértice, pepitas de minério             |
| `blocks.js`      | Definições de blocos, itens e objetos (dados dentro do código)                         |
| `models.js`      | Modelos low poly procedurais: pedras, cristais, astronauta, módulo, marcador           |
| `player.js`      | Física, colisão, subida de degraus, animação do astronauta                             |
| `rig.js`         | Câmera isométrica: giro de 90°, zoom, tremor                                           |
| `graphics.js`    | Shaders, céu, luzes, pós-processamento, partículas, ícones, qualidade                  |
| `input.js`       | Teclado, mouse, toque, joystick e pinça                                                |
| `interaction.js` | Mira, mineração, construção, itens soltos, andar até um ponto                          |
| `debris.js`      | Física de destroços instanciados (quique, empilhar, chute)                             |
| `meteors.js`     | Meteoros: aviso, queda, cratera, meteorito                                             |
| `footprints.js`  | Pegadas desenhadas por shader                                                          |
| `missions.js`    | Objetivos da missão 01 (lista fixa no código)                                          |
| `ui.js`          | HUD em DOM: barra de itens, avisos, missão, bússola, seta de objetivo                  |
| `audio.js`       | Sons sintetizados com WebAudio                                                         |

## Estrutura alvo

Ela é aplicada junto com a migração para TypeScript, módulo por módulo, sem parar o jogo.

```
src/
  main.ts            ponto de entrada, só liga as peças
  app/               Game (laço e estados: menu, jogando, pausa), configuração
  core/              eventos (barramento), ruído e aleatoriedade, tempo, salvar, assets
  world/             terreno, chunks, mesher, raycast, registro de blocos
  entities/          jogador, objetos soltos, itens no chão, destroços, meteoros, veículos
  systems/           mineração, construção, crafting, missões, ambientação
  render/            renderer, pós-processamento, materiais e shaders, luzes, partículas, modelos
  ui/                HUD, menus, inventário, tela de crafting, diálogos, estilos
  audio/             sintetizador e música
  data/              conteúdo como dados: blocos, itens, receitas, missões, falas
  i18n/              textos (pt-BR primeiro, outros idiomas depois)
tests/               testes automatizados
public/              arquivos estáticos (modelos glTF, áudio, ícones, manifest)
docs/                documentação e referências de arte
```

Mapeamento do que existe para o alvo:

| Hoje                              | Alvo                                                    |
| --------------------------------- | ------------------------------------------------------- |
| `main.js`                         | `main.ts` + `app/Game.ts`                               |
| `noise.js`                        | `core/noise.ts`                                         |
| `world.js`, `terrain.js`, `mesher.js` | `world/`                                            |
| `blocks.js`                       | `data/blocks.ts`, `data/items.ts` + `world/registry.ts` |
| `player.js`, `debris.js`, `meteors.js` | `entities/`                                        |
| `interaction.js`, `missions.js`   | `systems/`                                              |
| `graphics.js`, `models.js`, `rig.js`, `footprints.js` | `render/`                           |
| `ui.js`, CSS do `index.html`      | `ui/`                                                   |
| `input.js`                        | `core/input.ts`                                         |
| `audio.js`                        | `audio/`                                                |

## Princípios

1. **Conteúdo é dado, comportamento é código.** Blocos, itens, receitas, missões e falas ficam em `data/`.
   Adicionar uma missão não deve exigir mexer em sistema nenhum.
2. **Sistemas conversam por eventos.** Em vez de `interaction` chamar `missions` direto, ele emite
   `block:broken`, `item:collected`, `prop:broken`, e quem se interessa escuta. Hoje essa ligação é feita
   por callbacks em `main.js` e é a primeira coisa a trocar.
3. **Simulação separada da renderização.** Lógica não conhece Three.js sempre que possível. Isso facilita
   testar e mantém a porta aberta para multiplayer ou servidor no futuro.
4. **Determinismo.** O mundo vem da semente; só as edições do jogador são salvas.
5. **Celular é o alvo de desempenho.** Todo recurso novo informa o custo e tem um modo barato.

## Mundo e chunks

- Chunk de **16 × 16** blocos de largura e **48** de altura; cada bloco ocupa 1 byte (até 255 tipos).
- Chunks são gerados em um anel ao redor do jogador. O raio (2 a 5) depende do zoom da câmera.
- A malha de cada chunk tem só as faces visíveis. Oclusão ambiente e variação de cor entram no vértice.
- Ao editar um bloco, o chunk e os vizinhos de borda são refeitos uma única vez (`setBlocks` em lote).
- Objetos soltos (pedras e minérios) não são blocos: são malhas separadas, posicionadas sobre o terreno.
- Decisão completa em [ADR 0003](adr/0003-mundo-em-voxels-por-chunks.md).

## Salvamento

Chave `spacing.save.v1` no `localStorage`, em JSON:

```
{ world: { edits: { "cx,cz": [[índice, bloco], ...] }, removedProps: [...], extraProps: [...] },
  inventory: { item: quantidade },
  player: { x, y, z },
  missions: { step, count } }
```

Salva a cada 5 segundos, ao esconder a aba e ao sair. Preferências (qualidade, som) ficam em
`spacing.prefs.v1`. O sufixo `v1` existe para permitir migração: toda mudança de formato precisa de uma
função de migração e de um teste.

## Dívidas técnicas conhecidas

| Dívida                                                     | Plano                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| Geração e malha de chunks na thread principal              | Web Worker; dá engasgo em celular fraco ao andar rápido     |
| Passo de física variável (limitado a 50 ms)                | Passo fixo para jogador e destroços                         |
| Missões e conteúdo dentro do código                        | `data/` + eventos (princípios 1 e 2)                        |
| Textos em português espalhados pelo código                 | `i18n/`                                                     |
| Salvamento em `localStorage` (limite de cerca de 5 MB)     | IndexedDB quando as edições crescerem                       |
| CSS inteiro dentro do `index.html`                         | Arquivos de estilo em `ui/`                                 |
| Tudo em JavaScript                                         | Migração para TypeScript, um módulo por vez                 |
| Poucos testes (mundo, terreno, mesher)                     | Testes para jogador, destroços, interação e missões         |
| Pacote de 580 kB (155 kB comprimido)                       | Dividir em partes e carregar efeitos opcionais sob demanda  |
| Não há menu inicial nem pausa de verdade                   | Máquina de estados em `app/`                                |
