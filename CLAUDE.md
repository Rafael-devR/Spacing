# Spacing: instruções para o Claude

Jogo web de exploração espacial em mundo de blocos (Three.js). Leia o [README](README.md), a
[arquitetura](docs/ARCHITECTURE.md) e o [design](docs/GAME_DESIGN.md) antes de mudar algo grande.

## Dono do projeto

- Fala português do Brasil. Responda e escreva documentação e textos de interface em português.
- Joga e testa pelo celular. O desenvolvimento acontece em um **GitHub Codespace** (4 CPUs, 15 GB de RAM,
  sem GPU). Antes rodava no Termux (Ubuntu em PRoot), mas isso mudou.
- Neste ambiente o `apt` não alcança os repositórios do Ubuntu. Instale ferramentas por npm ou pip.
- Quer um projeto **profissional, estruturado e planejado**, não uma pilha de recursos soltos. Pense e
  documente antes de implementar coisas grandes.

## Regras

- **Não publique o jogo como artifact nem em site nenhum.** O jogo fica local. Para o dono testar, suba o
  servidor (`npm run dev`) e diga o endereço. No Codespace a porta 5173 é encaminhada, em endereço privado
  `https://<nome-do-codespace>-5173.app.github.dev` (o nome vem de `$CODESPACE_NAME`).
- Antes de commitar: `npm run lint && npm run typecheck && npm test && npm run build`.
- Siga o fluxo de [CONTRIBUTING.md](CONTRIBUTING.md): branches, Conventional Commits, PR.
- Ações visíveis fora da máquina (criar repositório, abrir PR, push, release) só quando o dono pedir.
- Mudou decisão técnica, design, história ou arte? Atualize o documento ou escreva um ADR na mesma mudança.
- Não migre nem reorganize o código do jogo sem o dono pedir. A estrutura alvo está em
  [ARCHITECTURE.md](docs/ARCHITECTURE.md).
- O Three.js está fixado em `0.160.0`: o material dos blocos depende dos nomes internos dos shaders.
- Depois de mudança visual, **olhe o jogo**: `tools/visual-check` tira capturas num Chromium headless
  (veja o README da pasta). O WebGL roda por software, então o FPS dali não vale para o celular. Estética e
  desempenho em celular real continuam sendo do dono: descreva o que viu e peça para conferir.

## Comandos

| Comando             | O que faz                       |
| ------------------- | ------------------------------- |
| `npm run dev`       | Servidor em `localhost:5173`    |
| `npm run build`     | Tipos e build de produção       |
| `npm test`          | Testes (Vitest)                 |
| `npm run lint`      | ESLint                          |
| `npm run typecheck` | TypeScript                      |

## Mapa rápido

- Código do jogo: `src/` (hoje plano, em JavaScript; estrutura alvo em `docs/ARCHITECTURE.md`).
- Testes: `tests/`. Capturas de tela: `tools/visual-check/` (ferramenta à parte, com `package.json` próprio).
- Decisões: `docs/adr/`. Referências de arte: `docs/art/reference/`.
- Salvamento: `localStorage`, chaves `spacing.save.v1` e `spacing.prefs.v1`.
- Semente do mundo: `20261111` em `src/main.js`. Mudar o gerador em `src/terrain.js` invalida saves.
