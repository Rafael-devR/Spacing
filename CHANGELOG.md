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
- **Sobrevivência I (v0.3):** oxigênio, bateria e integridade do traje, com medidores no HUD.
  - A área pressurizada do módulo de pouso recarrega tudo.
  - A IA do traje avisa com 30% e 15% de oxigênio e quando ele acaba (asfixia).
  - Sem bateria, a furadeira fica três vezes mais lenta.
  - Dano por meteoro, queda forte e falta de ar, com número de dano e traje piscando.
  - Morte: todos os itens caem no chão flutuando, o astronauta renasce no módulo e um marcador laranja
    mostra "Seus itens". Passar por cima recolhe.
  - Game juice: câmera lenta e som abafado na morte, feixe ao renascer, respiração e batimento em ciclo,
    pausa de impacto e bloco que encolhe ao quebrar, bloco que estica ao ser colocado, astronauta que
    achata ao pousar e tom de coleta subindo em sequência.
- **Áudio posicional** ([design/AUDIO.md](docs/design/AUDIO.md)): os sons do mundo (passos, mineração,
  blocos, destroços, meteoros) vêm da posição deles, com direção que acompanha o giro da câmera, volume e
  agudos que caem com a distância e eco da cratera. O meteoro leva o som junto enquanto cai. O módulo de
  pouso zumbe e ajuda a achar o caminho de volta. Sons do capacete (IA, alarmes, respiração) continuam no
  centro. Teste `tools/visual-check/audio.mjs` mede os canais esquerdo e direito.
- Menu de pausa (Esc, P ou botão Pausa) com configurações de gráficos, som, tremor de tela e vibração.
- Vibração no celular ao quebrar blocos, em impactos de meteoro e ao concluir objetivos.
- O jogo salva e pausa sozinho ao trocar de aplicativo ou esconder a aba.
- Teste jogado automático no navegador (`tools/visual-check/play.mjs`) e testes de eventos, salvamento,
  passo fixo, inventário, consistência dos dados e sobrevivência e áudio posicional (51 testes no total).

### Corrigido

- O painel de controles aparecia aberto por cima do jogo ao iniciar, porque o `index.html` standalone não
  aplicava a regra `[hidden]`.

### Alterado

- `GAME_DESIGN.md`, `ROADMAP.md`, `STORY.md` e `ART_DIRECTION.md` atualizados com as decisões de
  sobrevivência, tom científico e game juice. O roadmap ganhou as etapas Sobrevivência I (v0.3) e II (v0.4).
- `CLAUDE.md` descreve o ambiente atual (GitHub Codespace) e o uso do `visual-check`.
- **Fundação (v0.2):** todo o código migrou para TypeScript estrito, organizado em `app/`, `core/`, `data/`,
  `world/`, `entities/`, `systems/`, `render/`, `ui/`, `audio/` e `i18n/`.
- Sistemas conversam por um barramento de eventos tipado; som, tremor, vibração e HUD reagem a eventos.
- Blocos, itens, objetos e missões viraram dados em `src/data/`.
- Física em passo fixo de 1/60 s, com a animação do astronauta interpolada.
- Salvamento com versão (chave `spacing.save`, formato 3 com traje e itens caídos); os salvamentos
  anteriores são migrados automaticamente.
- O astronauta começa e renasce dentro da área pressurizada do módulo.
- Os botões de gráficos, som e controles do topo foram para o menu de pausa.
- Estilos em `src/ui/styles.css` e textos da interface em `src/i18n/`.

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
