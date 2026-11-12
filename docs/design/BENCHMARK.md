# Teste de desempenho

Um teste dentro do próprio jogo para **medir antes de otimizar**: roda sozinho, reproduz o que mais pesa, mede tudo o
que afeta a fluidez no celular e guarda os resultados para comparar antes e depois de cada otimização. **Ele só
observa e mede**: não muda a aparência, a jogabilidade, o salvamento nem as preferências do jogador.

A tela do aparelho do dono é de **120 Hz**, então 120 Hz é o alvo principal e 60 Hz o secundário: todo resultado traz
as duas leituras. A decisão de projeto está no [ADR 0007](../adr/0007-teste-de-desempenho-completo.md).

> **Os números do Chromium headless (`tools/visual-check/bench.mjs`) não valem para o celular.** Lá o WebGL roda por
> software. Aquele teste só confere que o teste _funciona_ (botão, painel, JSON, histórico).

## Como usar

1. Pause o jogo (Esc ou o botão de pausa) e toque no botão **Teste de desempenho**, logo abaixo de **Continuar**.
2. Escolha o modo:
   - **Rápido** (cerca de 2 minutos): os 15 cenários. Serve para comparar a cada otimização.
   - **Completo** (cerca de 16 minutos): os 15 cenários, mais o custo de cada efeito, a curva de resolução e **10
     minutos de aquecimento** para ver se o aparelho esquenta e segura o desempenho.
3. O jogo mede a taxa de atualização da tela por 2 segundos (parado) e o teste começa sozinho. Aparece um cartão no alto
   com o cenário, a etapa, o tempo que falta, o FPS do momento e o botão **Cancelar**. Se quiser medir a latência do
   toque, toque na tela algumas vezes durante o teste (opcional; os toques não fazem nada no jogo).
4. No fim aparece o **resultado**. **Voltar ao jogo** recarrega o jogo no progresso de antes.
5. Depois de otimizar, rode o mesmo modo de novo: o resultado novo vem comparado com o anterior.
   **Resultados guardados** (na escolha do modo) reabre os últimos 10 sem rodar nada.

Para o resultado valer: aparelho carregado, sem economia de energia, sem outro app pesado, mesmo brilho de tela, a mesma
qualidade em **Gráficos**, a mesma orientação e o jogo à frente (se a aba for para segundo plano, o teste é cancelado,
porque o navegador segura os quadros). Para o **aquecimento**, rode o completo com o aparelho na temperatura de
costume, não logo depois de outro teste pesado.

## O que o teste faz

Sempre o mesmo roteiro, em **tempo real**, a partir de regiões fixas e virgens, longe da base e da sonda, uma para cada
cenário (`src/data/bench.ts`; o código em `src/bench/` só interpreta esses dados). Cada cenário descarta os **2
primeiros segundos** (aquecimento: compila shaders, carrega chunks) e mede o resto. O sorteio dos blocos quebrados tem
semente fixa.

| Cenário                      | Rápido | Completo | O que acontece                                                                  |
| ---------------------------- | ------ | -------- | ------------------------------------------------------------------------------- |
| Preparar a região            | 4 s    | 6 s      | carrega os chunks do ponto de partida (não descarta o começo: é o que mede)     |
| Quebrar blocos               | 6 s    | 10 s     | 30 blocos por segundo: destroços, partículas, itens, tremor, malhas refeitas    |
| Meteoros                     | 6 s    | 10 s     | um meteoro a cada 0,9 s mais 6 blocos por segundo                               |
| Andar rápido                 | 6 s    | 12 s     | 26 blocos por segundo (o normal é 4,6): chunks novos o tempo todo               |
| Tudo ao mesmo tempo          | 6 s    | 10 s     | andando, 20 blocos por segundo e meteoros                                       |
| Parado olhando               | 4 s    | 8 s      | nada acontece: mostra o piso do jogo                                            |
| Girar a câmera 360°          | 5 s    | 10 s     | uma volta completa a cada 5 s                                                   |
| Zoom para dentro e para fora | 6 s    | 12 s     | a distância da câmera oscila entre 16 e 46                                      |
| Andar em círculo             | 6 s    | 10 s     | raio de 14 blocos, 9 blocos por segundo                                         |
| Broca de cristal sem parar   | 6 s    | 30 s     | o ritmo de blocos por segundo da broca de cristal (≈ 7,4 no regolito)           |
| Explosão de meteoro          | 6 s    | 10 s     | três meteoros a cada 2,5 s: explosão, crateras e destroços                      |
| Abrir e fechar o mapa        | 6 s    | 10 s     | abre e fecha o tablet a cada 3 s (mesmo sem o Mapa equipado)                    |
| Entrar e sair da base        | 12 s   | 16 s     | repete a cena da câmara de pressurização                                        |
| Todos os itens voando        | 5 s    | 10 s     | 60 itens a cada 1,2 s voando até o astronauta                                   |
| Pior caso sustentado         | 12 s   | 60 s     | andando, 30 blocos por segundo, 2 meteoros a cada 0,7 s e 40 itens a cada 2 s   |

A "broca de cristal" **simula o ritmo** de quebra dessa broca; o equipamento do jogador não é trocado (isso mudaria o
save).

### Só no modo completo

- **Efeitos:** o astronauta fica parado, com 200 partículas por segundo, e cada efeito é medido **ligado e desligado,
  um de cada vez**: bloom, antisserrilhado (MSAA), sombras, aberração cromática, vinheta, granulado do filme, névoa,
  brilho dos cristais e partículas. Cada passo tem 1 s de aquecimento e 2 s medidos.
- **Resolução:** o cenário "tudo ao mesmo tempo", 4 s por escala, com o desenho em 0,5×, 0,75×, 1×, 1,25×, 1,5× e 2×
  da resolução atual. Mostra FPS e 99% de cada uma e a **maior escala que sustenta 120 e 60 FPS**. Escalas que passam
  da textura máxima do aparelho aparecem como "não suportado".
- **Aquecimento:** 10 minutos seguidos de uma carga pesada e constante (círculo, mineração e meteoros), com o FPS, o
  tempo do quadro, a CPU e a bateria de cada minuto. Se o FPS do último minuto cair 10% ou mais em relação ao primeiro,
  o aparelho é marcado como "piorou com o calor".

## Como o teste mede sem mudar o jogo

- **Custo zero fora do teste.** O jogo guarda uma sonda (`Game.probe`) que é **nula** fora do teste: cada ponto de
  medição é `probe?.begin(i)` / `probe?.end(i)`, uma checagem de nulo. Dentro do teste nada aloca por quadro (vetores
  tipados pré-alocados). Os observadores do navegador só ligam durante o teste.
- **Efeitos só na memória.** Nenhum efeito é removido do jogo e nenhum shader é editado. Dentro do teste:

  | Efeito                  | Como é ligado e desligado (só durante o teste)                                          |
  | ----------------------- | --------------------------------------------------------------------------------------- |
  | Bloom, MSAA             | `Post.benchSet(...)` refaz o pós-processamento com o preset trocado                     |
  | Sombras                 | `castShadow` das luzes; o three.js recompila os shaders sem o trecho de sombra          |
  | Névoa                   | `scene.fog = null` (a neblina baixa dos blocos também some: ela depende da névoa)       |
  | Brilho dos cristais     | remove e recoloca o `#define USE_GLOW` dos materiais dos blocos e dos objetos           |
  | Aberração, vinheta, grão| troca trechos do texto do shader de correção de cor **na cópia em memória**            |
  | Partículas              | `mesh.visible`                                                                          |

  Os trechos trocados no shader são verificados por um teste automático (`tests/bench-effects.test.ts`): se o shader
  mudar e um trecho sumir, o teste falha em vez de medir às cegas. Ao fim (ou ao cancelar), tudo volta ao que era e o
  jogo recarrega.
- **Salvamento e preferências.** O jogo grava o progresso **uma vez**, no começo, e trava o salvamento durante o teste (o
  teste altera o mundo na memória); ao fechar o resultado o jogo recarrega e volta ao progresso de antes. As preferências
  nunca são tocadas. O vibrador é desligado durante o teste.
- **O astronauta não morre.** Durante o teste, oxigênio, bateria e integridade ficam sempre em 100% (só na memória; o save
  está travado) e o dano é ignorado. Se mesmo assim uma morte chegar, o teste a desfaz e continua de onde parou.
- **Three.js e shaders.** A versão do Three.js continua `0.160.0` e nenhum arquivo de shader é alterado.

## O que é medido

### Ambiente

Medido no começo, com o jogo parado: os intervalos do `requestAnimationFrame` por 2 s, a **mediana**, arredondada para
60, 90, 120 ou 144 Hz (a taxa medida sem arredondar também fica no resultado). Mostra a taxa detectada e o orçamento por
quadro (8,3 ms em 120 Hz). Também: navegador, núcleos de CPU, memória do aparelho (`deviceMemory`), renderizador e
fabricante da GPU, versão do WebGL, extensões úteis (inclusive `EXT_disjoint_timer_query`), textura máxima, densidade de
pixels, tamanho da tela e da área do jogo, orientação e bateria (nível e se está carregando). **O que o navegador não
informa aparece como "não disponível"** (e `null` no JSON); nada é inventado.

### Taxa da tela durante o teste (telas adaptativas)

Telas adaptativas ficam em 60 Hz sem toque e sobem para 120 Hz com o dedo em movimento. Por isso a taxa é medida **o teste
inteiro**, a cada 1 s, pelos quadros mais rápidos da janela, e o resultado mostra **quanto tempo a tela ficou em cada
taxa**. A análise usa a maior taxa vista. Se a tela não ficou em 90 Hz ou mais em pelo menos 90% do tempo, o resultado avisa
e o veredito de 120 Hz é marcado como **não confiável**. A página não distingue uma tela em 60 Hz de um jogo que não passa
de 60 FPS. Durante o teste o jogo envia movimento de dedo simulado, mas o sistema pode ignorar eventos criados por
JavaScript: **mantenha um dedo se movendo na tela** (o cartão pede isso). Os toques não afetam o jogo.

### Fluidez (a parte mais importante)

Calculada dos intervalos entre quadros (o tempo entre dois `requestAnimationFrame`), por cenário e para o conjunto:

- **Tempo do quadro:** média, mediana, 95%, 99%, 99,9%, desvio-padrão e **jitter** (média da diferença entre quadros
  consecutivos: mede a irregularidade).
- **Quadros perdidos** contra cada alvo: um quadro é perdido se o intervalo passa de **1,5× o período** do alvo (12,5 ms
  em 120 Hz, 25 ms em 60 Hz). Também a **maior sequência** de quadros fora do alvo e a porcentagem dentro do alvo.
- **Sustenta o alvo?** Sim quando o 99% fica em até 1,5× o período, no máximo 1% dos quadros é perdido e o FPS efetivo é
  pelo menos 95% do alvo.
- **Histograma** do tempo dos quadros em faixas de ms.
- **Ritmo (pacing):** um 60 FPS **fluido** numa tela de 120 Hz tem todos os quadros em 16,7 ms; um 60 FPS **irregular**
  mistura 8,3, 16,7 e 25 ms e tem a mesma média, mas é percebido como travado. O teste mede quantos intervalos são
  múltiplos inteiros do vsync (**alinhados**), qual múltiplo é o mais comum e **quantos quadros estão nele** (ritmo
  _regular_ quando pelo menos 90%). É isso que separa os dois casos.
- **FPS efetivo** (quadros ÷ tempo) e **FPS apresentado** (conta quantos vsyncs cada quadro ocupou; nunca passa da taxa
  da tela), cada um comparado com 120 e 60.

### CPU

`performance.now()` em volta de cada parte do laço, por quadro (média, 95% e máximo): **entrada**, **simulação em passo
fixo** (com o número de passos por quadro), **física dos destroços**, **interação**, **itens, meteoros, base e efeitos**,
**chunks**, **partículas**, **HUD**, **mapa**, **sombra**, **desenho do mundo** e **pós-processamento**, mais o roteiro do
próprio teste. Também: quantos quadros bateram no **limite de passos fixos** (o jogo desacelera nesses quadros), o tempo
de gerar, malhar e refazer a malha de chunks, **tarefas longas** (`longtask`) e **quadros longos**
(`long-animation-frame`, com a origem provável), e **quantas geometrias, materiais, texturas e objetos são criados por
segundo** (alocação por quadro causa travadinhas de coleta de lixo). O desenho do mundo (CPU) é o tempo gasto no
JavaScript para mandar desenhar, não o tempo da GPU.

### GPU

- `renderer.info` por quadro: chamadas de desenho, triângulos, linhas, pontos, e na memória geometrias, texturas e
  programas de shader. Tamanho do canvas e **pixels por quadro**.
- **Tempo de GPU por quadro** com `EXT_disjoint_timer_query_webgl2` **quando o aparelho oferece**. Muitos navegadores de
  celular não oferecem; aí aparece "não disponível" e o custo vem da comparação do modo completo: cada efeito ligado e
  desligado com o desenho **esperando a GPU terminar** (uma leitura de 1 pixel), que mostra o custo real sem o vsync
  mascarar. Essa espera só acontece nas etapas de efeitos e de resolução, nunca nos cenários.

### Memória, energia e toque

- Memória do JavaScript no início e no fim (`performance.memory`, só no Chrome), tamanho do salvamento em bytes e dos
  recursos carregados.
- Bateria no começo e no fim e o consumo por minuto (o nível do navegador tem passos de 1%, então só vale em testes
  longos como o completo).
- **Latência do toque** até o primeiro quadro (Event Timing API). Sem Event Timing, o teste estima por `pointerdown` até
  o próximo quadro. Só há amostras se você tocar na tela durante o teste.

## Chunks em worker (a partir da versão 3)

Desde o [ADR 0012](../adr/0012-chunks-em-worker-e-resolucao-dinamica.md) os chunks novos são gerados e malhados em Web
Workers. Os tempos "gerar" e "malhar" do resultado são **os do worker** (não travam o jogo); o que pesa na thread principal
(aplicar a malha pronta, no máximo 2 por quadro) aparece no subsistema **chunks**. A malha refeita depois de editar um bloco
continua na thread principal. A resolução dinâmica fica desligada durante o teste.

## Como ler o resultado

1. **Veredictos de 120 e de 60 Hz** no alto: "Sustenta" ou "Não sustenta", com o FPS efetivo, o FPS apresentado, o 99% e
   os quadros perdidos. Se 60 Hz sustenta e 120 Hz não, o jogo é fluido em 60 mas não aproveita a tela.
2. **Gráfico do tempo dos quadros:** a linha cheia é a média de cada 250 ms; a fina, o pior quadro. As linhas tracejadas
   são o limite de 120 e de 60 FPS; picos acima delas são travadinhas. As faixas separam os cenários.
3. **Ritmo:** com "irregular" e o jitter alto, o jogo mistura quadros curtos e longos (parece travado mesmo com FPS médio
   bom). Com "regular em 2 vsyncs", o jogo está estável em 60 numa tela de 120.
4. **Por cenário** e **detalhe de um cenário:** onde o tempo vai. Compare a CPU do cenário com o orçamento do quadro: CPU
   perto do orçamento = gargalo no JavaScript; CPU baixa com FPS ruim = gargalo na GPU (veja os efeitos e a resolução).
5. **Efeitos:** o custo de cada um em ms por quadro. A coluna "No jogo agora" diz se o efeito já está ligado na
   qualidade em uso (bloom e MSAA podem não estar: o teste mede o que custariam).
6. **Resolução:** a maior escala que sustenta 120 e 60 mostra a folga da GPU.
7. **Aquecimento:** queda de FPS ao longo dos minutos indica que o celular esquenta e segura o desempenho.
8. **Conclusões:** o que os números pedem (veja abaixo).

**Comparação:** o resultado novo vem contra o anterior (o próximo na lista dos 10), com ▲/▼ e a variação. Diferenças
até 2% contam como "≈ igual", porque uma medição tem ruído. Se o modo, a taxa da tela, a qualidade, a densidade de
pixels, o tamanho do desenho, o aparelho ou a versão dos cenários mudaram, a tela avisa que a comparação não é direta.

## Resultados, exportação e histórico

- Os **últimos 10** resultados ficam no `localStorage` do aparelho, na chave **`spacing.bench.history.v2`**, separada do
  salvamento (`spacing.save`) e das preferências (`spacing.prefs.v1`): a versão do save não mudou e não há migração.
  Apagar o progresso não apaga o histórico. Se o navegador não deixa gravar (bloqueado ou cheio), o teste segue sem
  guardar; se faltar espaço, primeiro saem os gráficos dos resultados antigos, depois os resultados mais antigos.
- **Exportar JSON** baixa o resultado inteiro (inclusive as séries dos gráficos) num arquivo
  `spacing-desempenho-AAAAMMDD-HHMM-<hz>hz-<modo>.json`.
- **Copiar resumo** põe um resumo curto em texto na área de transferência, para colar numa conversa.

## Investigação: algum trecho trava o jogo em 60 FPS?

Resultado da leitura do código (nada foi alterado; o teste também confere em tempo de execução):

- **O laço principal** (`Game.frame`, `src/app/Game.ts`) roda em `requestAnimationFrame`. **Não há `setInterval`,
  `setTimeout` nem outro temporizador** limitando o desenho; os únicos temporizadores são o salvamento automático e a
  pausa da tela de carregamento. Nada no laço limita o jogo a 60 FPS.
- **A física roda em passo fixo de 60 Hz** (`FIXED_STEP = 1/60`, `src/app/config.ts`), e os **destroços**
  (`Debris.update`) rodam dentro desse passo sem interpolação: numa tela de 120 Hz eles se movem a 60 Hz, enquanto o
  astronauta é interpolado (`fixed.alpha`) e a câmera anda a 120. É a única parte da cena que "pisca" a 60 Hz.
- **O tempo do quadro é limitado a 50 ms** (`realDt = min(0.05, ...)`) e a simulação a 5 passos por quadro
  (`MAX_STEPS_PER_FRAME`): abaixo de 20 FPS o jogo desacelera. O teste conta os quadros que batem nesse limite.
- **A qualidade automática** só baixa se o FPS ficar abaixo de 32 (`perfTick`), então não interfere em 60 ou 120.
- **Em tempo de execução**, se a tela é de 90 Hz ou mais, o cenário "parado olhando" apresenta quadros todos de 2 vsyncs
  com a CPU folgada, o teste avisa que **algo está limitando a taxa** (economia de energia do aparelho ou do navegador,
  que o jogo não controla).

## O que fica de fora

- O **tempo de GPU** só existe onde há `EXT_disjoint_timer_query`; sem ela, só a comparação de efeitos e de resolução.
- A **latência do toque** só tem amostras se o jogador tocar durante o teste.
- A **temperatura** do aparelho não é lida (o navegador não expõe): o aquecimento é inferido da queda do FPS.
- A **bateria** só existe onde o navegador oferece `getBattery` (Chrome no Android sim; Safari e Firefox não).
- O **consumo de memória** nativa e da GPU não é visível para o JavaScript.
- O teste mede o jogo **na qualidade em uso**; para comparar qualidades, rode o teste em cada uma.

## Arquivos

| Arquivo                      | O que tem                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `src/data/bench.ts`          | cenários, efeitos, escalas e durações (dados)                                       |
| `src/bench/stats.ts`         | estatísticas puras: percentis, jitter, taxa de atualização, histograma, ritmo       |
| `src/bench/probe.ts`         | sonda de CPU por subsistema e vetores tipados de gravação                           |
| `src/bench/observers.ts`     | tarefas longas, quadros longos e latência de toque                                  |
| `src/bench/gpu.ts`           | timer query e espera da GPU                                                         |
| `src/bench/counters.ts`      | criações por segundo                                                                |
| `src/bench/env.ts`           | taxa da tela e dados do aparelho                                                    |
| `src/bench/effects.ts`       | liga e desliga efeitos só na memória                                                |
| `src/bench/actions.ts`       | o que o roteiro faz em cada cenário                                                 |
| `src/bench/runner.ts`        | conduz os passos e mede cada quadro                                                 |
| `src/bench/report.ts`        | resultado, resumos, conclusões, comparação                                          |
| `src/bench/store.ts`         | histórico dos últimos 10 resultados                                                 |
| `src/bench/text.ts`          | resumo em texto e arquivo JSON                                                      |
| `src/bench/chart.ts`         | gráfico em canvas 2D                                                                |
| `src/bench/ui.ts`            | escolha do modo, acompanhamento e resultado                                         |
| `tests/bench*.test.ts`       | testes das partes puras                                                             |
| `tools/visual-check/bench.mjs` | roda o teste (encurtado) no Chromium headless e confere botão, painel, JSON e save |
