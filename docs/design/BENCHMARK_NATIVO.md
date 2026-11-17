# Teste de desempenho nativo (M6)

O teste do jogo web ([BENCHMARK.md](BENCHMARK.md), 3,2 mil linhas) foi **refeito menor** no nativo, como o plano do porte
([PORTE_RUST.md](PORTE_RUST.md)) já dizia. A ideia é a mesma: **medir antes de otimizar**, sempre do mesmo jeito, para
comparar antes e depois de cada mudança. Ele só observa: não muda o jogo, o salvamento nem as preferências.

## Como usar

1. No celular, saia da base e abra a **Pausa → Teste de desempenho**.
2. O jogo grava o progresso uma vez, **silencia o som e a vibração** e roda sozinho os 7 cenários (cerca de 50 s) e depois
   o **custo dos efeitos** (o `effects.rs` de antes, mais 30 s). Um aviso no alto mostra o cenário e o tempo que falta.
   Abrir a Pausa **cancela** o teste.
3. No fim o jogo **recarrega o progresso de antes** (o teste cava blocos e solta meteoros) e o resultado fica na tela até você
   tocar no botão de estatísticas. O resultado também vai para um arquivo (veja abaixo).

Para o número valer: aparelho carregado, sem economia de energia, mesmo brilho, mesma opção de **Gráficos**. Compare sempre
com o mesmo vsync (`V`): desligado mostra quanto o aparelho **aguenta**; ligado mostra o que a tela **entrega**.

## Os cenários

O mesmo roteiro, em tempo real, no ponto onde o astronauta está (fora da base). Cada cenário descarta o **primeiro 1,5 s**
(aquece: carrega pedaços do mundo) e mede o resto. O sorteio dos blocos tem semente fixa.

| Cenário                 | Duração | O que acontece                                                                   |
| ----------------------- | ------: | -------------------------------------------------------------------------------- |
| Parado olhando          | 5 s     | nada: mostra o piso do jogo                                                      |
| Andar em círculo        | 7 s     | anda pelo joystick simulado, a câmera segue (pedaços novos do mundo)             |
| Girar a câmera          | 6 s     | uma volta completa a cada 5 s                                                    |
| Zoom dentro e fora      | 6 s     | a distância da câmera oscila                                                     |
| Quebrar blocos          | 8 s     | 20 blocos por segundo ao redor: destroços, partículas, itens, malhas refeitas    |
| Meteoros                | 8 s     | um meteoro a cada 0,9 s: aviso, queda, cratera, onda de choque                   |
| Tudo ao mesmo tempo     | 8 s     | andando, 15 blocos por segundo e um meteoro a cada 1,2 s                         |

Durante o teste o astronauta **não morre** (oxigênio, bateria e integridade ficam em 100%, só na memória; o salvamento está
travado). Os blocos quebrados usam o mesmo caminho do jogo (`Interaction::break_target`), não um atalho.

## O que é medido (por cenário)

Do tempo entre quadros: **FPS** (1 / média), **média**, **mediana**, **95%**, **99%**, **máximo**, **jitter** (média da diferença
entre quadros vizinhos: a irregularidade), **% de quadros perdidos** (mais de 1,5× o período: 25 ms para 60 FPS, 12,5 ms para
120 FPS) e o **tempo de CPU** do quadro (o que sobra é GPU ou espera: ajuda a saber qual dos dois limita).
**Sustenta 60 / 120 FPS** quando o 99% fica dentro de 1,5× o período, no máximo 1% dos quadros é perdido e o FPS é pelo menos 95%
do alvo (a mesma regra do jogo web).

Mais o **ambiente**: placa de vídeo e API, tamanho da tela e da cena 3D, MSAA, modo de apresentação (vsync), planeta, versão.

## Resultado em arquivo

`<pasta de salvamentos>/desempenho/AAAA-MM-DD_HHMMSS.json` (guarda os 10 últimos). O resultado novo vem **comparado com o
anterior** (FPS e 99% de cada cenário) no próprio painel. No Android a pasta fica dentro dos dados do app.

## Onde fica no código

`spacing-app/src/desempenho.rs`: `Teste` (o roteiro dos cenários: injeta a entrada por quadro e guarda os tempos), `Medida`
(as contas), `Teste::linhas` (o painel) e `Teste::json`. O `lib.rs` liga à Pausa e encadeia o `effects.rs`. O roteiro jogado
(`spacing --roteiro`) roda o teste com o relógio acelerado para provar que os cenários funcionam (os números do computador
sem placa de vídeo **não valem**: só o celular mede).

## Fora do escopo (de propósito)

Curva de resolução, aquecimento de 10 minutos, histograma, bateria e temperatura do aparelho: ficam para uma segunda versão
se o dono quiser. O medidor de GPU por carimbo de tempo continua de fora (nem todo Android tem); a diferença de tempo do quadro
(`effects.rs`) responde à mesma pergunta.
