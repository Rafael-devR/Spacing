# Teste de desempenho

Um teste dentro do próprio jogo para **medir antes de otimizar**: roda sozinho, reproduz o que mais pesa e guarda o
resultado para comparar antes e depois de cada otimização. Ele só mede; não muda nada no jogo.

## Como usar

1. Pause o jogo (Esc ou o botão de pausa). Logo abaixo de **Continuar** está o bloco **Teste de desempenho**.
2. Toque em **Iniciar teste**. Ele roda sozinho por cerca de **51 segundos**, sem você jogar. No alto da tela aparece o
   cartão de acompanhamento (etapa, barra de progresso, FPS do momento) e o botão **Cancelar**.
3. No fim aparece a **tela de resultado**. **Voltar ao jogo** recarrega o jogo no progresso de antes.
4. Depois de otimizar, rode de novo: a tela mostra o resultado novo ao lado do anterior, com a diferença.
   **Último resultado** (no mesmo bloco do menu) reabre o resultado guardado sem rodar o teste.

Dicas para o resultado valer: deixe o aparelho parado alguns segundos antes (sem outro app pesado), com a bateria
carregada e sem o modo de economia de energia; mantenha a mesma qualidade (Gráficos), o mesmo som e a mesma orientação
da tela entre as rodadas.

## O que o teste faz

Sempre o mesmo roteiro, em **tempo real**, numa região fixa longe da base (`src/data/benchmark.ts`). Um jogo mais rápido
faz o mesmo trabalho por segundo com menos tempo por quadro.

| Etapa                       | Tempo | O que acontece                                                                                  |
| --------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| Preparando a região         | 3 s   | carrega os chunks do ponto de partida, compila shaders, estabiliza                               |
| Quebrando blocos            | 12 s  | 30 blocos por segundo: destroços, partículas, itens voando até o astronauta, som, tremor, malhas refeitas |
| Meteoros                    | 10 s  | um meteoro a cada 0,9 s (rastro, luz, cratera, explosão) mais 6 blocos por segundo                |
| Andando rápido pelo mundo   | 14 s  | 26 blocos por segundo (o astronauta normal anda a 4,6): chunks novos o tempo todo                |
| Tudo ao mesmo tempo         | 12 s  | andando, 20 blocos por segundo e meteoros                                                        |

Os blocos quebrados saem de um sorteio com semente fixa; os efeitos são os do jogo de verdade (os mesmos eventos de
quando o jogador minera), com áudio se o som estiver ligado.

## O que é medido

- **FPS médio** (quadros ÷ tempo), **FPS mínimo** (o pior quadro vira FPS), **FPS dos 1% piores** (as travadinhas que a
  média esconde) e os **cinco piores quadros**, com a etapa e o instante. Também o tempo do quadro (média, 95% e 99%),
  quantos quadros passaram de 33, 50 e 100 ms e o **tempo de CPU do JavaScript por quadro** (sem esperar GPU nem vsync).
  Tudo isso geral e por etapa.
- **Chunks:** quantos foram gerados e quanto custou cada um; quantas malhas novas e quanto custou; quantas malhas foram
  **refeitas ao quebrar bloco** (o custo de cada bloco quebrado) e quanto custou; quantos chunks carregados.
- **Na tela:** chamadas de desenho e triângulos por quadro (somando sombra, mundo e pós-processamento), objetos visíveis na
  cena e quantos destroços, partículas, itens voando, itens no chão e meteoros havia (média e máximo).
- **Tela e qualidade:** qualidade escolhida (e se veio do modo automático), resolução desenhada e densidade de pixels,
  sombras, antisserrilhado, bloom, som, aparelho (GPU, núcleos, memória), versão do jogo e do cenário, memória do
  JavaScript no início e no fim (onde o navegador informa).

Os dois primeiros quadros são descartados (pagam a compilação de shaders). A qualidade automática **não muda sozinha**
durante o teste.

## Resultado e comparação

- Guardado no navegador do aparelho (`localStorage`, chave `spacing.bench.v1`), **fora do salvamento do jogo**: apagar o
  progresso não apaga o resultado. Ficam os **dois últimos** (o último e o anterior).
- A comparação mostra a diferença em verde (melhor) ou vermelho (pior); variações até 2% contam como "≈ igual", porque
  uma medição tem ruído. FPS maior é melhor; milissegundos menores são melhores.
- Se a qualidade, a resolução, o som ou o cenário mudaram desde o resultado anterior, a tela avisa que a comparação não
  é direta.
- **Copiar resultado** põe um resumo em texto na área de transferência, para colar numa anotação.

## Seu progresso fica intacto

O teste quebra blocos e solta meteoros, ou seja, altera o mundo. Por isso:

1. Ao iniciar, o jogo **grava o progresso como está** e **trava o salvamento**: nada é salvo enquanto o teste roda (nem
   ao esconder a aba nem ao sair).
2. O astronauta vai para a região fixa de teste; o que acontece lá fica só na memória.
3. No fim (ou ao cancelar), o jogo **recarrega** e volta exatamente ao que estava salvo. O resultado do teste já foi
   guardado antes.

Se a aba ficar escondida durante o teste, ele é **cancelado** (o navegador segura os quadros de uma aba escondida e a
medição não valeria).

## Custo do próprio teste

Fora do teste o custo é desprezível: o mundo checa uma variável nula por chunk. Durante o teste, medir usa
`performance.now()` por chunk e por quadro, e o cartão de acompanhamento atualiza duas vezes por segundo. A contagem de
objetos percorre a cena duas vezes por segundo.

## Código

- `src/data/benchmark.ts`: o roteiro (etapas, velocidades, região, semente). Mudou algo? Suba `BENCH_SCENARIO`: resultados
  de cenários diferentes não se comparam.
- `src/app/Benchmark.ts`: conduz o roteiro e coleta as medições; não conhece o DOM.
- `src/core/benchStats.ts` (estatísticas e comparação, puro) e `src/core/benchStore.ts` (guardar o último e o anterior).
- `src/ui/BenchmarkUi.ts`: cartão de acompanhamento e tela de resultado.
- Ganchos mínimos em sistemas existentes: `World.perf` (tempo de gerar e malhar chunks), `Interaction.breakBlockAt`,
  `BaseDirector.leaveInstant` e contadores (`World.chunkCount`, `Particles.active`, `ItemDrops.count`). Estado novo do
  jogo: `benchmark` (o HUD some e os comandos são ignorados).
- Testes: `tests/benchmark.test.ts` e, no navegador, `tools/visual-check/bench.mjs`.

## Em aberto

- Tempo de GPU por quadro (`EXT_disjoint_timer_query`), onde o navegador permitir.
- Rodar o teste em outras regiões (neve, gelo) e com a câmera mais aberta.
- Exportar o histórico inteiro, não só os dois últimos.
