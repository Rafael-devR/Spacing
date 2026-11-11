# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versões seguindo
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- Estrutura do projeto: Vite, TypeScript, Vitest, ESLint, Prettier e CI no GitHub Actions.
- Documentação: design, história, arte, arquitetura, roadmap e registros de decisão (ADRs).
- Testes do gerador de terreno, do mundo e do mesher.
- Imagens de referência de arte em `docs/art/reference/`.

### Alterado

- O Three.js passou a vir do npm (versão `0.160.0` fixada) em vez de uma CDN.
- `index.html` virou um documento completo para o Vite.

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
