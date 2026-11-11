# Arquitetura

## Stack

| Camada            | Escolha                          | Motivo (ver [ADRs](adr))                                  |
| ----------------- | -------------------------------- | --------------------------------------------------------- |
| Renderização      | Three.js `0.160.0` (fixado)      | Controle total de shader, roda em celular, sem instalar   |
| Linguagem         | TypeScript estrito               | Projeto grande precisa de tipos                           |
| Build e servidor  | Vite                             | Recarga rápida, build simples, sem configuração pesada    |
| Testes            | Vitest + teste jogado no navegador | Lógica em Node; jogo real em Chromium headless          |
| Qualidade         | ESLint + Prettier                | Padrão único de código                                    |
| Persistência      | `localStorage`, com versão       | Simples; migrar para IndexedDB (ver "Dívidas")            |
| Distribuição      | Web; PWA e Capacitor depois      | Navegador agora, app instalável quando fizer sentido      |

O Three.js está fixado numa versão exata porque o material dos blocos injeta código GLSL nos blocos internos
do `MeshLambertMaterial` (`src/render/materials.ts`). Atualizar exige revisar esse arquivo.

## Estrutura do código

```
src/
  main.ts            ponto de entrada: cria o renderizador e o Game
  app/               Game (laço, estados, ligação dos sistemas), SurvivalDirector (resposta à sobrevivência),
                     BaseDirector (entrada na base, bancada, descanso),
                     eventos do jogo, configuração, passo fixo
  core/              barramento de eventos, entrada, salvamento, preferências, tela cheia, ruído, cor, vibração
  data/              conteúdo como dados: blocos, itens, objetos, missões, base, receitas, equipamentos
  world/             terreno, chunks (World), mesher, registro de blocos, estruturas da base (ADR 0005)
  entities/          jogador, destroços, meteoros, itens soltos, itens caídos na morte (LootPiles)
  systems/           interação (minerar/construir), inventário, missões, sobrevivência, fabricação, equipamento
  render/            materiais e shaders, céu, luzes, pós-processamento, partículas, modelos, câmera, ícones,
                     modelo da base, bancada com laser (Fabricator) e camada do interior (indoors)
  ui/                HUD, menu de pausa, mochila, bancada, botão de ação e transições da base, estilos
  audio/             sons sintetizados e áudio posicional (design/AUDIO.md)
  i18n/              textos da interface (pt-BR)
tests/               testes automatizados (Vitest)
tools/visual-check/  capturas de tela e teste jogado em Chromium headless (package.json próprio)
public/              arquivos estáticos (modelos, áudio, ícones, quando houver)
docs/                documentação e referências de arte
```

Convenção de nomes: arquivo cuja exportação principal é uma classe usa PascalCase (`World.ts`, `Player.ts`);
os demais usam camelCase (`terrain.ts`, `materials.ts`).

## Como as peças conversam

```
             ┌──────────── barramento de eventos (app/events.ts) ────────────┐
             │                                                               │
 Input ─► Interaction ─► World / Debris / ItemDrops ─► Inventory     Missions
             │   publica: mine:hit, block:broken, prop:broken,        assina: item:collected,
             │            block:placed, action:denied, build:mode       prop:broken, inventory:changed
             │                                                       publica: mission:*
 Player ─────┤   publica: player:step, player:jump, player:land
 Meteors ────┤   publica: meteor:incoming, meteor:impact
 World ──────┘   publica: world:blockChanged
                                    │
                                    ▼
                  app/Game.ts assina e decide a resposta:
                  som (Sfx), tremor (IsoRig), vibração (Haptics), HUD, pegadas
```

Regra: **um sistema nunca chama outro sistema para avisar algo**. Ele publica um evento. Quem precisa reagir
assina. O catálogo completo, com o formato de cada evento, fica em `src/app/events.ts`. Para ver os eventos
no console, abra o jogo com `?eventos` no endereço.

## Laço principal e estados

Estados (`app/Game.ts`): `loading` → `menu` → `playing` ⇄ `paused`, e `playing` → `dead` → `playing` ao renascer.

A cada quadro, em `playing`:

1. Entrada.
2. **Simulação em passo fixo de 1/60 s** (`FixedStep`): caminhada automática, física do jogador, medidores do
   traje (`Survival`) e destroços. Pausa de impacto e câmera lenta escalam esse tempo (game juice).
   No máximo 5 passos por quadro; se o aparelho atrasar mais que isso, o jogo desacelera em vez de travar.
3. Animação do jogador, **interpolada** entre os dois últimos passos (sem tremor em telas de 90/120 Hz).
4. Itens soltos, pegadas, meteoros, missões.
5. Câmera, carregar e descarregar chunks, interação, partículas, sombra, neblina.
6. HUD e pós-processamento.

Em `paused` nada é simulado nem desenhado (o canvas mantém o último quadro) e o áudio é suspenso. Ao esconder
a aba, o jogo salva e pausa sozinho.

## Princípios

1. **Conteúdo é dado, comportamento é código.** Blocos, itens, objetos e missões ficam em `data/`. Os
   sistemas só interpretam. Testes em `tests/data.test.ts` garantem que tudo que um dado referencia existe.
2. **Sistemas conversam por eventos** ([ADR 0004](adr/0004-conteudo-como-dados-e-eventos.md)).
3. **Simulação separada da renderização** sempre que possível: física em `step()`, aparência em `animate()`.
4. **Determinismo.** O mundo vem da semente; só as edições do jogador são salvas.
5. **Celular é o alvo de desempenho.** Todo recurso novo informa o custo e tem um modo barato.
6. **Textos da interface em `i18n/`.** Nomes de conteúdo ficam nos dados.

## Mundo e chunks

- Chunk de **16 × 16** blocos de largura e **48** de altura; cada bloco ocupa 1 byte (até 255 tipos).
- Chunks são gerados em um anel ao redor do jogador. O raio (2 a 5) depende do zoom da câmera.
- A malha de cada chunk tem só as faces visíveis. Oclusão ambiente e variação de cor entram no vértice.
- Ao editar blocos, cada chunk afetado é refeito uma única vez (`World.setBlocks` em lote).
- Objetos soltos (pedras, minérios, meteoritos) não são blocos: são malhas separadas, sobre o terreno.
- Decisão completa em [ADR 0003](adr/0003-mundo-em-voxels-por-chunks.md).

## Salvamento

Chave `spacing.save` no `localStorage`, em JSON, formato **versão 5** (`src/core/save.ts`):

```
{ version: 5, seed, savedAt,
  world: { edits: { "cx,cz": [[índice, bloco], ...] }, removedProps: [...], extraProps: [...] },
  inventory: { slots: [{ item, n } | null, ...32], selected },
  player: { x, y, z },
  missions: { step, count },
  suit: { suit, o2, battery, integrity },
  loot: [{ item, amount, x, y, z, pile }],
  equipment: { map: "map" },
  base: { inside, respawn: "lander" | "base", visited } }
```

- O salvamento da v0.1 (chave `spacing.save.v1`, sem versão) é migrado na primeira carga e apagado.
- Da versão 2 para a 3: o traje começa cheio e não há itens no chão.
- Da versão 4 para a 5: sem equipamento, fora da base, renasce no módulo de pouso.
- Da versão 3 para a 4: as quantidades viram espaços do inventário ([design/INVENTARIO.md](design/INVENTARIO.md)).
- Dados inválidos são limpos (itens desconhecidos, quantidades negativas); versões futuras são recusadas.
- Salva a cada 5 segundos jogando, ao pausar, ao esconder a aba e ao sair.
- Preferências (qualidade, som, tremor, vibração, mira de toque, tela cheia, orientação) ficam em
  `spacing.prefs.v1`. Campos novos entram com valor padrão quando faltam, sem mudar a versão.
- **Toda mudança de formato** ganha nova versão, função de migração e teste em `tests/save.test.ts`.

## Testes

| Onde                          | O que cobre                                                         |
| ----------------------------- | ------------------------------------------------------------------- |
| `tests/terrain.test.ts`       | Determinismo e regras do gerador                                    |
| `tests/world.test.ts`         | Quebrar blocos, raycast, edições salvas, mesher                     |
| `tests/core.test.ts`          | Eventos, passo fixo, inventário                                     |
| `tests/save.test.ts`          | Migração da v0.1, limpeza de dados, gravar e ler                    |
| `tests/data.test.ts`          | Consistência do conteúdo e dos textos                               |
| `tests/survival.test.ts`      | Gasto e recarga do traje, avisos, dano, morte, itens caídos         |
| `tools/visual-check/play.mjs` | Jogo real no navegador: começar, minerar, coletar, pausar, salvar, recarregar, morrer, renascer, recolher os itens |

## Dívidas técnicas conhecidas

| Dívida                                                     | Plano                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| Geração e malha de chunks na thread principal              | Web Worker (v0.7); engasga em celular fraco ao andar rápido |
| Salvamento em `localStorage` (limite de cerca de 5 MB)     | IndexedDB quando as edições crescerem                       |
| Textos estáticos do `index.html` fora do `i18n/`           | Gerar o HTML dos menus a partir do `i18n/`                  |
| Prettier ainda não aplicado a todo o código                | Formatar arquivo por arquivo ao mexer                       |
| Pacote de 596 kB (161 kB comprimido)                       | Dividir em partes e carregar efeitos opcionais sob demanda  |
| `app/Game.ts` concentra a resposta a todos os eventos      | Separar em "reações" (som, câmera, HUD) quando crescer      |
