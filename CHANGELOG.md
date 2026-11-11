# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versões seguindo
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- `tools/visual-check`: captura telas do jogo em um Chromium headless (WebGL por software), em tamanhos de
  computador e de celular, e mostra os erros do console.
- Design da sobrevivência (`docs/design/SOBREVIVENCIA.md`): oxigênio, bateria, integridade, morte com
  perda de todos os itens e Gerador de Domo.
- Catálogo de game juice (`docs/design/GAME_JUICE.md`).

### Corrigido

- O painel de controles aparecia aberto por cima do jogo ao iniciar, porque o `index.html` standalone não
  aplicava a regra `[hidden]`.

### Alterado

- `GAME_DESIGN.md`, `ROADMAP.md`, `STORY.md` e `ART_DIRECTION.md` atualizados com as decisões de
  sobrevivência, tom científico e game juice. O roadmap ganhou as etapas Sobrevivência I (v0.3) e II (v0.4).
- `CLAUDE.md` descreve o ambiente atual (GitHub Codespace) e o uso do `visual-check`.

## [0.1.0] - 2026-11-11

Primeiro protótipo jogável.

### Adicionado

- Astronauta na Lua com gravidade baixa, subida automática de degraus e animações.
- Mundo em blocos gerado por chunks: relevo, crateras, mares de basalto, gelo, ferro e cristais.
- Câmera isométrica com giro de 90° e zoom.
- Mineração com anel de progresso, itens que voam até o jogador e construção com blocos.
- Destroços com física: quicam, empilham, ficam no chão e são chutados pelo jogador.
- Meteoros com aviso, rastro, cratera, tremor de câmera e meteorito minerável.
- Pegadas, névoa nas crateras, brilho no regolito e cristais pulsando.
- Shaders próprios: bordas, granulado, oclusão ambiente, névoa e céu, sombra, bloom e correção de cor.
- Controles para teclado e mouse e para toque (joystick, pinça, toque para andar).
- Cadeia de seis missões provisórias terminando no reparo do módulo de pouso.
- Qualidade gráfica em três níveis, com ajuste automático por desempenho.
- Sons sintetizados e salvamento no navegador.
- Estrutura do projeto: Vite, TypeScript, Vitest, ESLint, Prettier e CI no GitHub Actions.
- O Three.js vem do npm, na versão `0.160.0` fixada.
- Testes do gerador de terreno, do mundo e do mesher.
- Documentação: design, história, arte, arquitetura, roadmap e registros de decisão (ADRs), com as
  imagens de referência de arte em `docs/art/reference/`.
