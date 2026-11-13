# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versões seguindo
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- **Tela do forno refeita em PixiJS** ([design/FORNO.md](docs/design/FORNO.md), [ADR 0018](docs/adr/0018-forno-em-pixijs.md)). Em vez do painel
  em Canvas, o forno mostra a máquina trabalhando: **espelhos** mandando feixes de luz (a energia do sol), **câmara** que esquenta e brilha
  com a temperatura, **três cadinhos** com o conteúdo derretendo, a etapa de agora e as unidades, **ventoinha** que gira mais rápido com o
  calor e continua girando enquanto o forno esfria, **termômetro** com ponteiro, fagulhas, bolhas, fumaça da chaminé, ar azul da ventoinha,
  minério caindo no cadinho e barra saindo para a **bandeja**. Receitas em cartões que rolam com o dedo. Direção de arte do Spacing
  (registro sério de interface de nave: fundo escuro, fios finos, cantos chanfrados, Chakra Petch e JetBrains Mono). `pixi.js` 8.22.0, carregado só quando o forno abre pela primeira vez; se o WebGL
  falhar, o forno usa a tela antiga. Bancada e eletrolisador não mudaram. Teste: `tools/visual-check/furnace.mjs`.
- **Astronauta novo, do Blender, com animações** ([design/PERSONAGEM.md](docs/design/PERSONAGEM.md),
  [ADR 0017](docs/adr/0017-personagem-do-blender-com-animacao-procedural.md)). Voxel chibi a partir das imagens do dono (capacete
  grande, visor escuro, fones laranja, faixas escuras). Animação procedural: parado, à toa, andar, correr, curva, pulo, queda, pouso,
  minerar, item na mão, pôr bloco, comer, dor e morte. O item selecionado na barra aparece na mão; a broca vai para o cinto quando não
  está em uso. Teste: `tools/visual-check/astronaut.mjs`.
- **Estufa: câmera de segurança por dentro.** Dentro da estufa pronta, a câmera fica presa a um canto alto da cúpula, com lente aberta, e mostra o piso e os canteiros inteiros; girar troca de canto; fora dela, a câmera normal volta.
- **Estufa, primeira parte** ([design/ESTUFA.md](docs/design/ESTUFA.md), [ADR 0016](docs/adr/0016-estufa-como-estrutura-com-holograma-e-qualidade-por-peca.md)).
  Um **baú** na base (as caixas da parede sul) entrega o projeto e o material; lá fora, o projeto no modo construir mostra um
  **holograma** da cápsula de vidro (verde assenta, vermelho não); a obra **nivela o terreno**, o botão de ação entrega o material
  **peça por peça** (baixa qualidade) e **finaliza** (alta qualidade); a cápsula é sólida e tem porta. Salvamento v11. Sem plantio nem
  fome ainda. Teste: `tools/visual-check/greenhouse.mjs` e a seção Estufa do modo de teste.
- **Cultivo de batata e fome** ([design/ESTUFA.md](docs/design/ESTUFA.md)). Na estufa pronta: **canteiros** (modo construir), **solo
  fértil**, **plantar batata**, **regar com gelo**, a planta cresce em 5 estágios (3 min, só com o jogo aberto; murcha sem água) e dá
  **3 batatas** na colheita. Tudo pelo botão de ação, sem telas. **A fome está ligada**: medidor de energia no HUD, avisos, dano lento
  sem energia e **Comer batata** pelo botão. Receitas novas na bancada: canteiro e solo fértil (Lua e Marte). Salvamento v12.
- **Estufa e cultivo com modelos do Blender** (`greenhouse.glb`, `farm.glb`): cada peça da cápsula em baixa e alta qualidade, o
  canteiro com luz de estado e os estágios da batata.

### Corrigido

- **Poeira dos pés:** tinha a mesma cor em qualquer chão e aparecia até dentro da base. Agora tem a cor do chão, só sai de chão solto,
  nunca dentro da base ou da estufa, e tem mais detalhe (nuvem macia para trás, pedrinhas em arco, anel no pouso).
- **Z-fighting nos modelos** (base, estufa, móveis, máquinas): faces coplanares sobrepostas piscavam. Ao carregar, a face de cima sobe 6 mm (`src/render/coplanar.ts`); ferramenta `tools/visual-check/zfight.mjs` e teste.
- **Escada da base flutuando e sem colisão.** O gerador agora nivela uma plataforma plana sob a base (Lua e Marte, `world/basePad.ts`) e
  constrói o degrau da porta com blocos de verdade: uma sacada de metal 3×2, sólida e rente ao piso. Vale em toda semente. `WORLD_GEN`
  subiu (mundos salvos são refeitos; o progresso fica).
- **Recorte que escondia blocos na sua frente.** Desligado (`CUT_SWITCH` em `render/cutaway.ts`): o bloco continua no lugar e
  bloqueia o caminho, sem sumir. O modo caverna (aproximar a câmera) só liga debaixo da terra (o terreno em volta fica acima dos
  pés), e não na superfície perto de borda ou de teto.
- **Limite de FPS estável.** O limite passou a andar numa grade de tempo fixa (`core/framecap.ts`): antes acumulava desvio e podia
  alternar entre 25 e 30 (ou entregar 45 FPS com limite de 60 numa tela de 90 Hz).

### Alterado

- **Medidor de desempenho no estilo RTSS** (antes "Mostrar FPS"): FPS, tempo do quadro, **1% low**, pior quadro, CPU, resolução e gráfico
  dos tempos de quadro.

### Adicionado

- **Modo de teste** ([design/TESTE.md](docs/design/TESTE.md), [ADR 0015](docs/adr/0015-modo-de-teste-com-salvamento-proprio.md)). `?teste`
  (ou o botão **Modo de teste** na tela inicial) liga um painel de depuração com **salvamento próprio**: dar qualquer item, soltar
  meteoros (inclusive o impacto na hora), objetos e destroços, instalar estações, concluir fabricações, teleportar, entrar e sair da
  base já, parar ou acelerar o tempo, tremor e câmera lenta, morrer, pular a missão e tocar cada som. `testmode.mjs` roda todas as ações
  no navegador em menos de 1 minuto.

### Alterado

- **Meteoros cinematográficos** ([design/METEOROS.md](docs/design/METEOROS.md), [ADR 0014](docs/adr/0014-onda-de-choque-na-passada-final.md)).
  Rocha feita no Blender com brasas, rastro de chamas e fumaça no céu, o ar tremendo em volta; entra de lado e cruza a tela. No
  impacto: clarão, **onda de choque que entorta a imagem atrás** (distorção na passada final, com opção no menu Gráficos), bola de
  fogo, anel de poeira, bolha da onda, blocos que saem em brasa, soltam fumaça e quebram em pedaços, coluna de fumaça e brasa na
  cratera, soco de zoom, câmera lenta curta e som em camadas. Os meteoros sorteados caem mais perto e dentro da tela
  (9,5 a 13 blocos, antes 12 a 22). `BENCH_VERSION` subiu para 4.

- **Interior da base é uma cena à parte** (ADR 0006): lá dentro a câmera desenha a cena de dentro, com luz e sombra
  próprias; o mundo de fora não é desenhado. Só a base, o astronauta e as partículas mudam de cena.
- **Corte da base:** ao entrar, as paredes da frente somem por inteiro, em vez de abaixar pela metade.

### Adicionado

- **Modelos 3D feitos no Blender** ([design/MODELOS.md](docs/design/MODELOS.md),
  [ADR 0013](docs/adr/0013-modelos-do-blender-por-script.md)). Scripts em `tools/models/` geram `.glb` com chanfros, cor por
  face e oclusão assada; o jogo carrega e usa os seus próprios materiais. Piloto: **módulo de pouso novo** (folha dourada
  amassada, escada, cabine com escotilha e janelas triangulares, propulsores, antena), de ~25 peças para 2 malhas.
  **Casco novo da base** por fora (colunas, janelas acesas, radiadores, câmara de entrada com marquise, abóbada, painéis
  solares, antena); o interior continua o mesmo, numa camada só de dentro. **Luzes de sinalização com halo** (módulo, porta,
  antena e balizas da base): parecem acesas sem usar luz de verdade.
  **Interior novo da base, maior** (9×7 por dentro, era 7×5): piso, paredes, porta e janelas do Blender; beliche, armário,
  console e móveis novos de enfeite (estante, horta hidropônica, mesa, tanque de água, caixas). **Bancada, forno solar e
  eletrolisador refeitos no Blender, com animação feita lá** (carro do laser, ventiladores, fole, bomba, ponteiros,
  bolhas). Painel solar que ficou embaixo da base maior volta para o inventário.

- **Desempenho no celular: chunks em worker e resolução dinâmica** ([ADR 0012](docs/adr/0012-chunks-em-worker-e-resolucao-dinamica.md)).
  O teste do dono mostrou quadros de 50 a 100 ms ao andar (gerar e malhar chunks na thread principal) e o limite de pixels
  da GPU. Agora o terreno e a malha dos chunks novos são feitos em **Web Workers** (1 ou 2), e a **resolução cai sozinha**
  um degrau quando a GPU não acompanha (e sobe de volta quando sobra folga). Editar um bloco continua refazendo a malha na
  hora. `?semWorker` no endereço volta ao modo antigo, para comparar. `BENCH_VERSION` 3.

- **Mundo novo a cada jogo, maior e com cavernas** ([design/MUNDO.md](docs/design/MUNDO.md),
  [ADR 0011](docs/adr/0011-semente-por-jogo-cavernas-e-luz-do-ceu.md)). A **semente é sorteada** em cada jogo novo
  (`?semente=` escolhe). O mundo foi de 48 para **96 blocos de altura**, com terras altas de anortosito e crateras
  gigantes. **Cavernas na Lua**: tubos de lava, túneis que se cruzam, salões, rampas para descer andando e claraboias.
  Seis **blocos novos** (anortosito, brecha, norito, basalto vítreo, ilmenita e ouro em bloco) e minérios por
  profundidade. **Escuro de verdade** (luz do céu por bloco) e **lanterna do capacete**. Dentro da caverna a **câmera
  aproxima e a rocha na frente do astronauta é cortada**. Salvamento v10: quem tinha um mundo antigo mantém os itens e
  ganha um mundo novo.

- **Fabricação mais rápida e mais controle** (terceira rodada do dono): tempos ~10× menores (barra de ferro ~4 s, vidro
  ~3 s, broca de cristal ~13 s), cada unidade de um lote pronta já pode ser pega, e cada vaga pode ser **pausada** ou
  **cancelada** (devolve os materiais do que não ficou pronto). Tela das estações em estilo de **painel técnico**
  (módulos rotulados, barramento de energia, vagas como grade de células, uma por unidade) e **receitas à direita**,
  perto do polegar. Salvamento v9.

- **Energia da base: nada vem do nada** ([design/ENERGIA.md](docs/design/ENERGIA.md),
  [ADR 0010](docs/adr/0010-energia-da-base.md)). Painéis do telhado e **painéis solares** fabricados na bancada e
  **colocados livres no chão** (cabo alcança 24 blocos; na sombra, na Lua, não geram), **bateria da base**, consumo do
  habitat, da bancada, do eletrolisador e da recarga do traje. O forno esquenta com o sol dos espelhos. Sem energia, as
  máquinas desaceleram na proporção. **Tela de energia** no console do habitat: sol → painéis → bateria → máquinas, com o
  fluxo em pontinhos. Em Marte o sol é 43% e a tempestade tira mais.
- **Vagas e lotes nas estações:** o forno faz 3 coisas ao mesmo tempo e o eletrolisador 2, dividindo a energia; dá para
  pôr todos os minérios de uma vez ("Tudo"), com o preparo contado uma vez só.
- **Telas das estações em Canvas, tela cheia,** na resolução do aparelho, mais limpas e com movimento que significa algo:
  cada minério sai do funil e entra na vaga, cada produto sai para a bandeja, cada pontinho de energia desce da fonte.
  A ciência da receita ficou atrás do "?". Ícones em 256 px. Salvamento v8.

- **Fabricação em estações, com química de verdade** ([design/CRAFTING.md](docs/design/CRAFTING.md),
  [ADR 0009](docs/adr/0009-fabricacao-em-estacoes-com-tempo.md)). O minério não vira ferramenta direto: passa por uma
  estação e vira material refinado. Duas estações novas, fabricadas na bancada e instaladas na parede leste da base: o
  **forno solar** (barra de ferro, tijolo de regolito, vidro, fibra de basalto, redução da ilmenita) e o **eletrolisador**
  (gelo → 2 H₂ + O₂, titânio, silício). Dez itens novos com modelo próprio; todo item da Lua agora entra em alguma
  receita. As estações **trabalham sozinhas** (uma receita por vez cada, as três juntas), com o jogo aberto e o jogador em
  qualquer lugar, e guardam o resultado até ele usar **"Pegar"**. O **tempo vem dos ingredientes** (calor, peso e
  raridade) e varia ±12% a cada vez: forno ~30 a 45 s, eletrolisador ~35 a 50 s, bancada ~1 a 2 min. **Tela técnica**
  nova: diagrama ao vivo com os materiais correndo pelos canos e esvaziando, a câmara trabalhando (calor, bolhas,
  laser), o produto enchendo, fórmula química, etapas, medidores, porquê do tempo e nota científica. **Selo no HUD** com o
  que cada estação faz e quanto falta. **Cilindro de O₂** conecta sozinho a 15% de ar longe da base (+50). Salvamento v7.

- **Marte** ([design/MARTE.md](docs/design/MARTE.md), [ADR 0008](docs/adr/0008-planetas-por-sessao.md)), escolhido por
  enquanto na tela inicial e com salvamento próprio (o da Lua não muda). Elysium Planitia: poeira vermelha, céu cor de
  caramelo sem estrelas com **Fobos e Deimos** e o halo azul do sol, **gravidade de Marte** (pulo mais baixo, queda mais
  perigosa, pedaços que caem com arrasto do ar), **dunas de areia escura**, **cânion em camadas** com **veios de gipsita**,
  **gelo sob a poeira**, **esferas de hematita** soltas no chão, **olivina** no basalto e um **vulcão** com caldeira, lago e
  rios de **lava** (brilha, queima o traje, solta brasas e fumaça) e **erupções** com tremor e ronco. **Tempestades de
  poeira** (a IA avisa; a visão cai, a luz escurece, a poeira corre, o vento empurra e apaga as **pegadas**, que em Marte
  duram bem mais), **redemoinhos** que limpam os painéis do traje (+bateria), som abafado com **vento** e missões próprias.
  Teste `tools/visual-check/mars.mjs`.

- **Gráficos avançados** ([design/GRAFICOS.md](docs/design/GRAFICOS.md)): no menu de pausa, **Gráficos avançados…** deixa
  trocar por cima da qualidade a **resolução** (0,5× a 2× ou **nativa** da tela, com o tamanho do desenho em pixels), o
  **MSAA** (desligado, 2×, 4×), as **sombras** (sem sombra, 1024, 2048, 4096), o **bloom**, a aberração de cor, a vinheta,
  o ruído de filme, o brilho dos cristais, o **limite de FPS** (30, 60, 90, 120) e um **contador de FPS**. As trocas ficam
  nas preferências; "Voltar ao padrão da qualidade" apaga todas. Teste `tools/visual-check/gfx.mjs`.

### Corrigido

- **Teste de desempenho completo medindo com sobras da etapa anterior:** o cenário "pior caso" deixava mais de mil itens e
  pilhas no chão, e a matriz de efeitos, a curva de resolução e o aquecimento rodavam depois, com cada quadro ~4× mais lento
  (os custos por efeito saíam até negativos). Agora cada etapa começa sem itens soltos nem pilhas (`ItemDrops.clear()` e
  `LootPiles.clear()`, usados só pelo teste).

### Alterado

- **Receitas refeitas:** Mapa = placa de circuito + vidro + barra de ferro (o módulo de pouso dá a placa no começo, e a
  quem vem de um salvamento antigo sem o Mapa); broca de ferro = 4 barras de ferro + 2 tijolos; broca de cristal = 4
  cristais + 2 lingotes de titânio + 2 fibras de basalto.

- **Qualidade Média e Alta com MSAA 2× (era 4×):** no teste de desempenho o MSAA era o efeito mais caro (~5 ms por quadro). Com a
  resolução 2× as bordas continuam lisas; a diferença, se aparecer, é nas bordas finas. A Baixa não usa MSAA.
  O teste de desempenho liga o MSAA com o valor que o jogo usa.
- **Sombra mais barata, mesma imagem:** o terreno, os objetos e o mapa só leem a sombra do sol nas faces voltadas para
  ele (nas outras a luz direta já é zero, e cada leitura custava 16 consultas ao mapa de sombra por pixel). O mapa do
  tablet só refaz a própria sombra quando os blocos ou o sol dele mudam, e com o mapa em tela cheia a sombra do mundo
  (escondido atrás) para de ser refeita até ele fechar.
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
