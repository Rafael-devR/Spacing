# ADR 0012: Chunks em Web Worker e resolução dinâmica

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

O teste de desempenho do dono (Alta, Adreno 710, tela de 120 Hz mas o navegador entregou 60) mostrou, depois do mundo novo
([ADR 0011](0011-semente-por-jogo-cavernas-e-luz-do-ceu.md)):

- ~40 FPS efetivos; mediana 16,7 ms, mas 1.171 quadros de 33 ms e 242 de 50 ms ou mais;
- **andando**, 14 quadros de 50 a 100 ms: o custo de "chunks" tem média de 3,5 ms e p95 de 23 ms. Gerar um chunk leva
  ~3,4 ms, malhar ~5 ms e refazer a malha ~6 ms, tudo na thread principal;
- **sem chunks novos** (minerando, meteoros), ~47 FPS com a CPU em ~9 a 14 ms por quadro: o limite é de pixels (GPU), como
  já se sabia.

O dono perguntou se valia portar para nativo. Entre as opções pesquisadas (app embrulhado, Unity, WebGPU), nenhuma atacava
o que o teste mostrou, e o embrulho em WebView tem relatos de ser **mais lento** que o Chrome. Decidimos atacar as duas
causas medidas dentro da web.

## Decisão

### 1. Gerar e malhar chunks novos em Web Workers

- `src/world/chunkJobs.ts` (`ChunkJobs`): pedido → resposta, sem Worker nem DOM. Atende `gen` (terreno do chunk) e `mesh`
  (luz do céu e malha, de um chunk e dos 8 vizinhos). `chunk.worker.ts` é só a casca de mensagens.
- O refinamento da malha e da luz saiu do `World` para `chunkMesher.ts`, que roda igual na thread principal e no worker.
- `World.enableWorkers` liga o modo assíncrono. Daí em diante `update` pede ao worker (do mais perto para o mais longe) a
  geração do chunk e dos vizinhos e, quando os 9 chegaram, a malha. O que volta é aplicado **no máximo 2 malhas por quadro**
  (criar geometria e objetos custa na thread principal). Há 1 ou 2 workers (`workerCount`: núcleos − 3, de 1 a 2).
- **Continua síncrono:** o carregamento inicial e o teletransporte (`update` com orçamento ≥ 100), qualquer `getBlock` que
  precise de um chunk ainda não chegado (gera na hora, o resultado do worker é descartado) e **editar um bloco** (a malha é
  refeita na hora, com o mesmo código). Assim nada do jogo precisou virar assíncrono.
- **Malha velha é descartada:** cada chunk guarda o contador da última edição; se algum dos 9 chunks do pedido foi editado
  depois dele, a resposta é jogada fora e o `update` pede de novo.
- **Falha:** se o worker não carrega ou cai (`onFailure`), o mundo volta a trabalhar sozinho. `?semWorker` no endereço força
  isso, para comparar.
- O que vai ao worker é só o terreno e a malha: o worker não importa Three.js, planeta ou interface.
- No teste de desempenho os tempos de "gerar" e "malhar" passam a ser os do **worker**; o custo na thread principal (aplicar
  o resultado) aparece em "chunks".

### 2. Resolução dinâmica

`src/render/scaler.ts` (`ResolutionScaler`, puro): a cada 90 quadros, se 10% ou mais foram **lentos por causa da GPU**
(período > 1,5 quadro **e** a CPU gastou menos de 70% dele), baixa um degrau (1 → 0,85 → 0,72 → 0,6 da resolução escolhida).
Quadro lento com a CPU ocupada (gerar chunk, por exemplo) não conta: menos pixels não ajudariam. Depois de 5 janelas sem
nenhum quadro lento, sobe um degrau; se cair logo depois de subir, espera o dobro da vez seguinte. `Post.setScale` só
redimensiona os alvos de desenho (não refaz os passes). Não age com a resolução escolhida à mão (menu de gráficos), nem
durante o teste de desempenho, e zera quando a qualidade muda.

## Opções descartadas

- **Reescrever em outra engine ou embrulhar em WebView:** custo alto ou ganho incerto para o que foi medido; a única coisa
  que só o nativo daria (taxa da tela acima de 60 Hz) fica para depois, se o resto não bastar.
- **Malhar tudo no worker, inclusive depois de editar:** a latência de ida e volta apareceria ao minerar e ao construir.
- **Menos chamadas de desenho:** medido em Alta (832×384): 313 chamadas por quadro, mas só ~58 são do terreno; o resto é a
  sombra (137), pós-processamento e objetos. Juntar chunks não mudaria nada.

## Resultado no celular (teste rápido na Alta, 2026-11-12)

| | Antes (versão 2) | Depois (versão 3, 100% da resolução) | Depois (85%, 1414×652) |
| --- | --- | --- | --- |
| FPS efetivo (geral) | 39,9 | **55,8** | 55,0 (inclui a 1ª travada do teste) |
| p95 / p99 do quadro | 50 / 83 ms | **33 / 33 ms** | 33 / 67 ms |
| Caminhada: FPS | 39,2 | **56,5** | 59,3 |
| Caminhada: quadros ≥ 50 ms | 14 (até 102 ms) | **0** (máx. 33,5 ms) | 0 |
| Chunks na thread principal (p95 / máx.) | 23 / 36 ms | **2,0 / 4,4 ms** | 1,7 / 3,4 ms |
| Quadros no ritmo de 60 Hz: caminhada / tudo junto | 53,8% / 51,8% | 93,8% / 86,3% | 98,9% / 97,4% |

- O worker eliminou os quadros longos ao andar, como esperado. O que sobra a 100% (6% a 14% dos quadros em 33 ms em
  "caminhada" e "tudo junto") é da GPU: a CPU gasta ~6 ms em quadros de 33 ms. A 85% da resolução esses cenários chegam a
  97% a 99% no ritmo de 60 Hz. Por isso o limite da resolução dinâmica caiu de 20% para **10%** dos quadros lentos.
- O teste das 10:53 rodou a 85% porque a resolução dinâmica já tinha baixado durante o jogo; o teste agora mede sempre na
  resolução escolhida (`Post.benchSet` zera a escala). Nessa rodada a CPU também estava mais lenta (a malha refeita na
  thread principal levou 6,6 ms contra 2,2 ms na outra), então a comparação entre as duas colunas não é exata.
- Os "quadros longos" de 125 a 490 ms no começo de cada cenário vêm de o teste carregar a área de partida na hora; não
  entram nas estatísticas de quadros (só na lista de quadros longos).

## Consequências

- Andar deixa de gerar quadros longos pela geração e pela malha dos chunks novos; resta o custo de aplicar (≤ 2 por quadro).
- Um chunk que chega atrasado aparece um pouco depois (o chão pode surgir ao longe); o raio de carga cobre isso com folga.
- Em Alta o jogo pode rodar abaixo da resolução escolhida quando a GPU aperta; o menu de gráficos mostra o tamanho real.
- A sombra ainda é mais da metade dos triângulos (104 mil de 188 mil): se a GPU continuar apertada, o próximo passo é uma
  geometria só para a sombra (sem o que fica debaixo do teto das cavernas).
- `BENCH_VERSION` 3: os resultados de antes não se comparam (mundo novo e chunks em worker).
