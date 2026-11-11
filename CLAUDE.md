# Spacing: instruções para o Claude

Jogo web de exploração espacial em mundo de blocos (Three.js). Leia o [README](README.md), a
[arquitetura](docs/ARCHITECTURE.md) e o [design](docs/GAME_DESIGN.md) antes de mudar algo grande.

## Dono do projeto

- Fala português do Brasil. Responda e escreva documentação e textos de interface em português.
- Trabalha só pelo celular. Você roda no Termux (Ubuntu em PRoot) no mesmo aparelho.
- Quer um projeto **profissional, estruturado e planejado**, não uma pilha de recursos soltos. Pense e
  documente antes de implementar coisas grandes.

## Regras

- **Não publique o jogo como artifact nem em site nenhum.** O jogo fica local. Para o dono testar, suba o
  servidor (`npm run dev`) e diga o endereço.
- Antes de commitar: `npm run lint && npm run typecheck && npm test && npm run build`.
- Siga o fluxo de [CONTRIBUTING.md](CONTRIBUTING.md): branches, Conventional Commits, PR.
- Ações visíveis fora da máquina (criar repositório, abrir PR, push, release) só quando o dono pedir.
- Mudou decisão técnica, design, história ou arte? Atualize o documento ou escreva um ADR na mesma mudança.
- Não migre nem reorganize o código do jogo sem o dono pedir. A estrutura alvo está em
  [ARCHITECTURE.md](docs/ARCHITECTURE.md).
- O Three.js está fixado em `0.160.0`: o material dos blocos depende dos nomes internos dos shaders.
- Não consigo ver a tela do jogo neste ambiente. Não afirme que algo visual "ficou bonito": diga o que
  foi feito e peça ao dono para conferir.

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
- Testes: `tests/`.
- Decisões: `docs/adr/`. Referências de arte: `docs/art/reference/`.
- Salvamento: `localStorage`, chaves `spacing.save.v1` e `spacing.prefs.v1`.
- Semente do mundo: `20261111` em `src/main.js`. Mudar o gerador em `src/terrain.js` invalida saves.
