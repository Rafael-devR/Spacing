# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versões seguindo
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Corrigido

- **Teste de desempenho completo medindo com sobras da etapa anterior:** o cenário "pior caso" deixava mais de mil itens e
  pilhas no chão, e a matriz de efeitos, a curva de resolução e o aquecimento rodavam depois, com cada quadro ~4× mais lento
  (os custos por efeito saíam até negativos). Agora cada etapa começa sem itens soltos nem pilhas (`ItemDrops.clear()` e
  `LootPiles.clear()`, usados só pelo teste).

### Alterado

- **Pós-processamento mais leve** (qualidade Alta e Média; `src/render/post.ts`): o bloom já começava na metade da resolução
  do desenho (e cai pela metade a cada faixa), então isso ficou como estava. O que mudou: o bloom não é mais somado por cima da
  imagem numa passada própria, e o mapeamento de tons e a conversão para sRGB (antes numa passada separada) foram para dentro
  da passada final, junto com a correção de cor, a vinheta, o ruído e a aberração. Eram 3 passadas de tela cheia sobre o alvo
  com MSAA depois do mundo; agora é 1. Nenhum efeito foi removido nem a resolução mudou. A imagem fica igual, com diferença
  mínima só nas bordas dos objetos (a aberração agora filtra a luz antes do mapeamento de tons). Sem medição de FPS: falta
  rodar o teste de desempenho no celular.

### Adicionado

- **Teste de desempenho completo** ([design/BENCHMARK.md](docs/design/BENCHMARK.md), [ADR 0007](docs/adr/0007-teste-de-desempenho-completo.md)):
  o botão **Teste de desempenho** do menu de pausa abre a escolha entre **rápido** (cerca de 2 min) e **completo** (cerca de
  16 min, com 10 min de aquecimento). Mede tudo o que afeta a fluidez no celular de 120 Hz (alvo principal; 60 Hz é o
  secundário): detecta a taxa da tela e lê o aparelho (GPU, WebGL, núcleos, bateria; "não disponível" onde o navegador não
  informa); fluidez com média, mediana, 95%, 99%, 99,9%, desvio, jitter, quadros perdidos, maior sequência ruim, histograma e
  **ritmo** (separa um 60 FPS fluido de um irregular); CPU por subsistema, passos fixos por quadro, tarefas longas, quadros
  longos e criações por segundo; GPU (`renderer.info`, timer query onde existir); memória, energia e latência do toque. Roda 15
  cenários (os 5 de antes mais parado, girar a câmera, zoom, círculo, broca de cristal, explosão, mapa, base, itens voando e
  pior caso sustentado). O modo completo ainda mede o **custo de cada efeito** (ligado e desligado, só na memória), a **curva
  de resolução** (0,5× a 2×, com a maior escala que sustenta 120 e 60 FPS) e o **aquecimento**. O resultado traz o veredito
  de 120 e 60 Hz, o gráfico do tempo dos quadros, tabelas, conclusões (inclusive a investigação do limite de 60 FPS) e a
  comparação com o resultado anterior; guarda os **últimos 10** no aparelho (chave própria, o save não muda), exporta em
  **JSON** e copia um resumo. O teste só observa: não muda aparência, jogabilidade, salvamento nem preferências.
- Código novo em `src/bench/` (estatísticas puras com testes, sondas nulas fora do teste, efeitos ligados e desligados só na
  memória, condutor, resultado, histórico, gráfico em canvas 2D e telas) e cenários como dados em `src/data/bench.ts`.
- Teste `tools/visual-check/bench.mjs` (roda o teste encurtado no Chromium headless; os números dali não valem para o celular).

- **Brocas** ([design/BROCAS.md](docs/design/BROCAS.md)): a ferramenta de mineração evolui. A broca do traje
  ganha duas irmãs fabricadas na bancada, a **Broca de ferro** (1,7× mais rápida) e a **Broca de cristal**
  (2,6×). Cada uma tem velocidade, nível e gasto de bateria; blocos e minérios pedem um nível mínimo (basalto,
  cristal e ilmenita pedem a de ferro; ouro pede a de cristal). Com a broca fraca o alvo não quebra e a IA do
  traje avisa qual broca fabricar. A ponta no astronauta muda com a broca. Tudo em `data/drills.ts`.
- Teste `tools/visual-check/drill.mjs`.
- **Mapa no tablet** ([design/MAPA.md](docs/design/MAPA.md)): com o Mapa equipado, o botão do tablet (ou M) traz
  o tablet do pulso até a câmera até a tela dele ocupar a tela. Nela, o terreno em blocos, na mesma perspectiva da
  câmera do jogo e na resolução da tela, com a forma real do relevo mas sem minérios, pedras soltas nem cavernas.
  Mostra você, a sonda, a base, o objetivo, seus itens, meteoritos e minérios vistos. Arrastar move, pinçar dá
  zoom, os botões giram como a câmera do jogo.
- **Mapa descoberto aos poucos**: só aparece onde o astronauta já andou (raio de 22 blocos, em ladrilhos de 4×4).
  Salvamento versão 6, com migração.
- Teste `tools/visual-check/tablet.mjs`.

### Corrigido

- **Mapa do tablet em áreas fundas:** o fundo com grade era um plano opaco acima do fundo das crateras e escondia o
  chão delas (buraco preto com borda recortada, camadas se cruzando). Agora é só um pano de fundo, nunca cobre
  terreno, e o chão e as paredes das crateras aparecem inteiros. Sombra, profundidade e contorno ajustados para o
  terreno não piscar, e os trechos são montados por tempo, sem aparecer tarde.
- **Tablet do mapa coberto pelo telhado da base:** o tablet agora é desenhado numa passada própria, por cima de tudo,
  na animação de abrir e fechar e com o mapa aberto.

### Alterado

- Teste de desempenho: o astronauta não morre durante o teste (medidores sempre cheios, dano ignorado, morte desfeita sem
  reiniciar); a taxa da tela é medida o teste inteiro, com o tempo em cada taxa, aviso de veredito de 120 Hz não confiável e
  movimento de dedo simulado para manter a tela adaptativa em 120 Hz.
- O teste de desempenho antigo (51 s, resultado em `spacing.bench.v1`) foi substituído pelo novo; o resultado antigo não é
  mais lido.
- **Tremor da câmera ao minerar** mais leve e sem acumular: com a broca rápida, ele crescia sem parar. A pausa de
  impacto só vale no primeiro bloco de uma sequência.
- **Ícone do tablet** (Mapa): agora um tablet de verdade, com moldura, aro laranja, câmera frontal e a tela com o
  mapa.
- **Microgravidade nos pedaços de bloco** ([design/FISICA.md](docs/design/FISICA.md)): pedaços, lascas e itens
  que saem de um bloco quebrado agora flutuam e descem devagar (gravidade 0,45 em vez de 16, sem ar para
  freá-los). O astronauta não muda.

## [0.3.0] - 2026-11-11

Reúne a Fundação (v0.2) e a Sobrevivência I (v0.3), mais áudio posicional, interface do celular, inventário
em espaços e a base lunar inicial.

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
- **Base lunar inicial** ([design/BASE.md](docs/design/BASE.md), [ADR 0005](docs/adr/0005-base-como-estrutura-sobre-os-voxels.md)):
  - Habitat no platô ao lado do módulo de pouso, montado a partir de dados para crescer em módulos.
  - Entrada pela câmara de pressurização: botão "Entrar na base", porta que corre, portas de bloqueio com
    leitura de 0 a 100% e troca para a vista em corte (telhado some, paredes da frente abaixam, lado de fora
    escurece). Saída pelo caminho inverso.
  - Dentro: anda-se livremente, o traje recarrega e meteoros não alcançam.
  - Beliche: descansar enche o traje e passa a ser o ponto de renascimento.
  - Bancada de fabricação com receitas e impressão a laser (holograma, camada que sobe, dois lasers com
    faíscas e som).
  - Primeira receita: **Mapa**, um equipamento que fica no traje (fora do inventário) e é equipado ao ficar
    pronto. O uso vem na próxima etapa.
  - Estrutura para comida, fome e energia, ainda desligada.
  - Salvamento versão 5 (equipamento e estado da base), com migração.
  - Teste `tools/visual-check/base.mjs`.
- **Interior da base como ambiente isolado** ([ADR 0006](docs/adr/0006-interior-da-base-como-camada-isolada.md)):
  dentro, a câmera só vê a sala (terreno, céu e módulo somem), com fundo escuro, luz de dentro, nervuras,
  luminárias e canos; o mundo de fora fica travado (sem minerar, construir ou mirar); aviso "Habitat 01 ·
  Pressurizado" no lugar da bússola; ventilação no som e meteoros suspensos. A máscara escura do chão saiu.
- Itens no chão com **contorno branco**.
- **Inventário em espaços livres** ([design/INVENTARIO.md](docs/design/INVENTARIO.md)): barra de 8
  espaços e mochila de 24, sem espaço preso a tipo de item. O item coletado completa uma pilha igual (até 64)
  ou vai para o primeiro espaço vazio. Mochila (botão ao lado da barra, I ou Tab) com mover, juntar e trocar
  por toque. Com a mochila cheia, o item fica no chão até ter espaço. Salvamento versão 4, com migração.
- **Interface do celular** ([design/INTERFACE.md](docs/design/INTERFACE.md)):
  - Mira deslocada: ao segurar o dedo, a mira aparece 80 px acima dele, então o bloco e o anel de progresso
    ficam visíveis. Dá para trocar para "No dedo" no menu de pausa.
  - Tela cheia ao tocar na tela (celular) e botão de tela cheia; em tela cheia a tela trava deitada (ou
    "Livre", no menu). A tela inicial sugere deitar o celular quando ele está em pé.
  - HUD reorganizado: traje e objetivo compacto no canto esquerdo, bússola e mensagens no topo, pausa, tela
    cheia e câmera no canto direito, joystick, itens e ações (pular e minerar/construir) embaixo. O HUD some
    no menu e na pausa; nome do lugar e coordenadas foram para o menu de pausa.
  - Tela inicial mais compacta com o celular deitado.
  - Teste `tools/visual-check/ui.mjs`: capturas do celular deitado e em pé, HUD dentro da tela e sem
    sobreposição, mira acima do dedo minerando o bloco certo.
- **Áudio posicional** ([design/AUDIO.md](docs/design/AUDIO.md)): os sons do mundo (passos, mineração,
  blocos, destroços, meteoros) vêm da posição deles, com direção que acompanha o giro da câmera, volume e
  agudos que caem com a distância e eco da cratera. O meteoro leva o som junto enquanto cai. O módulo de
  pouso zumbe e ajuda a achar o caminho de volta. Sons do capacete (IA, alarmes, respiração) continuam no
  centro. Teste `tools/visual-check/audio.mjs` mede os canais esquerdo e direito.
- Menu de pausa (Esc, P ou botão Pausa) com configurações de gráficos, som, tremor de tela e vibração.
- Vibração no celular ao quebrar blocos, em impactos de meteoro e ao concluir objetivos.
- O jogo salva e pausa sozinho ao trocar de aplicativo ou esconder a aba.
- Teste jogado automático no navegador (`tools/visual-check/play.mjs`) e testes de eventos, salvamento,
  passo fixo, inventário, consistência dos dados e sobrevivência, áudio posicional, preferências, inventário e base (78 testes no total).

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
- O CI usa `actions/checkout@v7` e `actions/setup-node@v7`, que rodam em Node 24 (as v4 estão sendo descontinuadas).

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
