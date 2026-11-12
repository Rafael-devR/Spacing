# ADR 0007: O teste de desempenho é um benchmark dentro do jogo, em módulo próprio e sem custo fora dele

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

O dono joga e testa num celular de **120 Hz** e quer medir o desempenho **antes** de otimizar qualquer coisa, e comparar
antes e depois de cada otimização. A primeira versão do teste (um roteiro de 51 s com FPS médio, mínimo e dos 1% piores)
mostrava o FPS, mas não distinguia os problemas que importam numa tela de 120 Hz: um 60 FPS fluido e um 60 FPS irregular
têm a mesma média; não dizia onde o tempo da CPU ia, o que custava cada efeito, nem se o aparelho esquenta e perde
desempenho. O teste também não podia mudar a aparência, a jogabilidade, o salvamento nem as preferências.

## Opções

1. **Ferramentas do navegador** (DevTools, `chrome://tracing`, Lighthouse): completas, mas no celular exigem cabo e
   computador, não reproduzem o roteiro do jogo e não guardam um histórico que o jogo compare sozinho.
2. **Biblioteca de estatísticas de desempenho** (Stats.js, spector.js): mostram FPS e chamadas de desenho ao vivo, sem
   roteiro fixo, sem ritmo em relação ao vsync, sem comparação nem exportação, e acrescentariam código ao jogo.
3. **Benchmark próprio dentro do jogo**, com roteiro em dados, medição por subsistema e análise pura testada, no menu de
   pausa.

## Decisão

Opção 3, em `src/bench/` (`docs/design/BENCHMARK.md`):

- **Dois modos** no mesmo botão do menu de pausa: rápido (≈ 2 min, 15 cenários) para comparar a cada otimização e completo
  (≈ 16 min) com o custo de cada efeito, a curva de resolução e 10 minutos de aquecimento.
- **120 Hz é o alvo principal e 60 Hz o secundário.** A taxa da tela é **medida** (mediana dos intervalos do
  `requestAnimationFrame` por 2 s, arredondada para 60/90/120/144) e toda a fluidez é lida contra os dois alvos. O
  **ritmo (pacing)** separa um 60 FPS fluido de um irregular numa tela de 120 Hz, o que a média esconde.
- **Roteiro como dados** (`src/data/bench.ts`), interpretado por um condutor em tempo real. Estatísticas, ritmo,
  histograma, comparação e histórico são **funções puras** com testes (`tests/bench*.test.ts`).
- **Custo zero fora do teste.** O jogo guarda uma sonda que é **nula** fora do teste: os pontos de medição são
  `probe?.begin(i)`. Observadores do navegador (tarefas longas, quadros longos, Event Timing) e o timer query só ligam
  durante o teste. Os tempos de cada passada do pós-processamento e da sombra vêm de envolver, só durante o teste, os
  métodos `render` das passadas.
- **O teste só observa.** Os efeitos são ligados e desligados **só na memória**, um de cada vez (bloom e MSAA refazendo o
  pós-processamento com o preset trocado; sombra, névoa e brilho dos cristais pelas propriedades do three.js; aberração,
  vinheta e granulado trocando trechos do texto do shader de correção de cor **na cópia em memória**). Nenhum efeito é
  removido do jogo, nenhum arquivo de shader é alterado e a versão do Three.js continua `0.160.0`. Um teste automático
  confere que os trechos trocados existem no shader. O salvamento é gravado uma vez no começo e travado; o jogo recarrega
  ao fim; as preferências nunca são tocadas.
- **Tempo de GPU honesto.** Com `EXT_disjoint_timer_query_webgl2` onde existir; onde não existir, aparece "não disponível" e
  o custo vem da comparação com efeitos ligados e desligados, com o desenho esperando a GPU (leitura de 1 pixel), só nas
  etapas de comparação. Nunca se inventa um número.
- **Histórico** dos últimos 10 resultados no `localStorage`, numa **chave própria** (`spacing.bench.history.v2`), sem mexer
  na versão do save e sem migração; se não grava, o teste segue sem guardar. O resultado é exportável em JSON.
- **Gráfico em canvas 2D**, sem biblioteca nova.

## Consequências

- Medir não é de graça no modo completo: a espera da GPU e as trocas de efeito recompilam shaders; por isso cada passo tem
  aquecimento descartado, e esses passos nunca estão nos cenários.
- Resultados de versões diferentes dos cenários (`BENCH_VERSION`) não se comparam direto, e a tela avisa. Mudar um
  cenário sobe a versão.
- Os números do Chromium headless não valem para o celular; o `bench.mjs` só confere que o teste funciona.
- O teste do jogo antigo (`app/Benchmark.ts`, chave `spacing.bench.v1`) foi substituído: o resultado antigo guardado não
  é lido (era de um cenário que não se compara).

**Revisão:** quando o jogo ganhar Web Worker para chunks, medir o worker também; quando o desempenho for otimizado,
reavaliar os cenários e as metas de 120 e 60 FPS com os números do celular.
