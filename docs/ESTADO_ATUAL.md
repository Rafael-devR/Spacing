# Estado atual do projeto

> **Para quem abre uma sessão nova:** leia este arquivo, depois o [CLAUDE.md](../CLAUDE.md) (regras e mapa do código), o
> [README](../README.md) e o que o assunto da vez pedir em [`docs/design/`](design). Este arquivo é um retrato de
> **2026-11-12**; atualize-o quando uma etapa grande terminar.

## O jogo em uma frase

Spacing: jogo web (Three.js 0.160.0 fixado, TypeScript, Vite) de exploração espacial num mundo de blocos. Você é um
astronauta num módulo de pouso: minera, constrói, sobrevive (oxigênio, bateria, integridade do traje), fabrica coisas na
base e, no futuro, deixa a Lua rumo a um planeta com vida. Visual cartoon low poly com shaders próprios. O dono joga e
testa **no celular** (Android, tela adaptativa 60/120 Hz, GPU Adreno 710, densidade 2,81).

## Quem é o dono e como trabalhar com ele

- Fala **português do Brasil**. Responda, escreva documentação e textos de interface em português, em linguagem simples.
- Quer um projeto **profissional, planejado e documentado**, não uma pilha de recursos soltos. Coisa grande: escreva o
  design em `docs/design/` (e um ADR em `docs/adr/` se mudar uma decisão técnica) **antes** de implementar.
- **Faça tudo numa branch só** (ele pediu explicitamente: várias branches "bagunçam"). Hoje é `perf/bloom-e-efeitos`.
- **Nada de push, PR ou release** sem ele pedir. Nada de publicar o jogo como artifact ou site.
- Antes de cada commit: `npm run lint && npm run typecheck && npm test && npm run build`. Commits convencionais, uma coisa
  por commit, com os trailers de atribuição que o ambiente pedir.
- **Meça antes de otimizar.** Ele roda o teste de desempenho no celular e manda o JSON; você analisa.
- Depois de mudança visual, **olhe o jogo** com `tools/visual-check` (Chromium headless; o FPS dali **não vale** para o
  celular). Estética e desempenho no celular são do dono: descreva o que viu e peça para conferir.
- Ele gosta de receber, ao fim de cada tarefa: o que mudou em português simples e **o que conferir no celular**.

## Como subir o jogo para ele testar

```bash
npm run dev            # servidor em 5173 (já deve estar de pé: confira com `ss -ltn | grep 5173`)
```

Endereço no celular: `https://glowing-eureka-q7r7jgxqxrq9c4r5p-5173.app.github.dev` (`$CODESPACE_NAME`). Se o celular
mostrar **404** (já aconteceu): o registro da porta no túnel do GitHub se perdeu. Soluções que funcionaram: ele parar e
reiniciar o Codespace em github.com/codespaces; ou subir o Vite em outra porta (`npx vite --host --port 5174`, depois
`gh codespace ports visibility 5174:private`) e dar o endereço da 5174. O `vite.config.ts` já libera `.app.github.dev`.
O harness bloqueou `gh codespace stop` (não contorne; peça a ele).

## Git: onde está tudo

Repositório privado `Rafael-devR/Spacing`. **`main` = v0.3.0** (PR #6, sem tag). Todo o resto é **local, nunca enviado**,
empilhado em ordem: `main` → `feat/brocas` → `feat/benchmark` → `bench/desempenho-completo` → **`perf/bloom-e-efeitos`**
(branch de trabalho, contém tudo). `backup/antes-sombra-msaa-nevoa` é o ponto para voltar se a sombra e o MSAA da Alta
ficarem ruins no visual. As branches antigas são só marcadores do caminho (a de trabalho já as contém); podem ser apagadas
quando ele quiser. Quando ele pedir o PR, será de `perf/bloom-e-efeitos` para `main`, e o [CHANGELOG](../CHANGELOG.md)
(seção "Não lançado") já está em dia.

## O que existe (além do que a v0.3.0 já tinha)

Em ordem de execução, tudo com testes e documentação:

1. **Brocas evolutivas, microgravidade dos pedaços, mapa do tablet em blocos** (`feat/brocas`; o dono testou e gostou).
   [design/BROCAS.md](design/BROCAS.md), [design/MAPA.md](design/MAPA.md), [design/FISICA.md](design/FISICA.md).
2. **Teste de desempenho completo** no menu de pausa (`src/bench/`, `src/data/bench.ts`): rápido (~2 min) e completo
   (~16 min, com 10 min de aquecimento). Mede fluidez contra 120 e 60 Hz, CPU por subsistema, custo de cada efeito,
   curva de resolução, calor, taxa real da tela durante o teste; histórico dos últimos 10 e exportação JSON. O astronauta
   é imortal durante o teste; cada etapa começa sem itens soltos da anterior. [design/BENCHMARK.md](design/BENCHMARK.md),
   ADR 0007.
3. **Otimização da GPU** (a Alta foi de ~30 para ~60 FPS no celular): bloom somado na passada final e tons+cor numa só
   passada, sombra só nas faces voltadas para o sol, sombra do mapa refeita só quando muda, **MSAA 2×** na Média e na
   Alta. O celular é limitado por **pixels** (GPU), não por CPU nem por chamadas de desenho.
4. **Gráficos avançados** (menu de pausa → "Gráficos avançados…"): resolução (0,5× a 2× e nativa), MSAA, sombras, bloom,
   aberração, vinheta, ruído, brilho dos cristais, limite de FPS, contador de FPS. [design/GRAFICOS.md](design/GRAFICOS.md).
5. **Marte** (tela inicial → "Planeta (provisório)", ou `?planeta=marte`): terreno, gravidade, clima (tempestades de
   poeira), redemoinhos, lava que queima o traje, vulcão com erupções, minerais novos, duas luas, missões próprias, salvamento
   próprio. A **lava ativa é ficção que o dono pediu** (registrada no design). [design/MARTE.md](design/MARTE.md), ADR 0008.
6. **Fabricação em estações** (pedido do dono em 2026-11-12): forno solar e eletrolisador ao lado da bancada, 10 itens
   fabricados com química real (ISRU), estações que trabalham sozinhas e guardam o resultado, tempo pelo calor, peso e
   raridade (±12%), tela técnica com diagrama ao vivo, selo no HUD, cilindro de O₂ de reserva, salvamento v7.
   [design/CRAFTING.md](design/CRAFTING.md), [design/ITENS.md](design/ITENS.md), ADR 0009. **Marte ainda não fabrica**
   (próxima fase: hematita, gipsita, olivina).
7. **Energia e telas novas** (segunda rodada, depois de o dono testar): regra "nada vem do nada" (painéis solares livres
   no mundo, bateria da base, forno pelo sol), vagas e lotes nas estações, telas cheias em Canvas (estações e energia no
   console), salvamento v8. [design/ENERGIA.md](design/ENERGIA.md), ADR 0010. Falta aplicar a regra ao oxigênio.
8. **Terceira rodada da fabricação:** tempos ~10× menores, pegar por unidade, pausar e cancelar, receitas à direita,
   painel técnico no estilo do jogo Idle CPU (referência do dono). Salvamento v9.

9. **Mundo novo** (pedido do dono em 2026-11-12): semente sorteada por jogo, 96 blocos de altura, terras altas, seis
   blocos novos, **cavernas na Lua** (tubos de lava, túneis, salões, rampas, claraboias), escuro com lanterna do capacete,
   câmera que aproxima e corta a rocha dentro da caverna. Salvamento v10 (mundo antigo é refeito, progresso fica).
   [design/MUNDO.md](design/MUNDO.md), ADR 0011. **Marte ainda não tem cavernas.**

10. **Chunks em worker e resolução dinâmica** (ADR 0012), feitos a partir do teste de desempenho do dono depois do mundo novo
   (~40 FPS efetivos na Alta; quadros de 50 a 100 ms ao andar). Terreno e malha dos chunks novos em Web Workers; a resolução
   baixa um degrau sozinha quando a GPU não acompanha. A sombra ainda é mais da metade dos triângulos (próximo alvo).
   **Medido no celular do dono:** Alta de ~40 para ~56 FPS efetivos; caminhada sem nenhum quadro ≥ 50 ms; o que sobra (6% a 14%
   dos quadros em 33 ms) é da GPU, e a 85% da resolução chega a 97% a 99% no ritmo de 60 Hz (tabela no ADR 0012).

## O que o dono ainda **não viu** no celular

- **A resolução dinâmica no jogo de verdade:** o limite caiu para 10% dos quadros lentos; ver se o tamanho no menu de gráficos oscila demais.

- **O mundo novo**: cavernas, câmera com corte, escuro e lanterna, montanhas, e principalmente o **desempenho** (gerar
  chunk ficou ~2,5× mais caro; o material do corte desenha os dois lados das faces).

- As **telas cheias em Canvas** das estações e da energia (legibilidade, toque, rolagem da lista), vagas e lotes, o
  painel solar colocado no chão, e o ritmo com a energia (eletrolisador fica lento sem painéis).

- **Marte inteiro** (cores, gravidade, tempestade, vulcão, desempenho dos efeitos novos).
- O **menu de gráficos avançados** (tocar nos botões, a Nativa, o limite de FPS em 60 com o dedo na tela).
- A sombra só nas faces ao sol e o MSAA 2× na Alta (conferir bordas e sombras do mapa).
- O teste completo na Alta **com o dedo na tela** o tempo todo (só rodou o rápido).

## Fatos de desempenho (celular do dono)

- Alta hoje: ~60 FPS estáveis com a tela em 60 Hz; com o dedo (tela em 120 Hz) o jogo entrega ~60 FPS **irregulares**
  (quadros de 8, 16 e 25 ms). **Meta do dono: Alta em 60 FPS estável.** O limite de FPS = 60 resolve a irregularidade.
- Custo por efeito (GPU, ~): MSAA 4× 5 ms, sombra 4,6 ms, névoa 2,7 ms, bloom 2,6 ms (era ~20), brilho 1,4 ms, resto < 1 ms.
- **A tela só vai a 120 Hz enquanto o dedo mexe nela**; toque simulado por JavaScript é ignorado pelo Android. Por isso
  o teste mostra o tempo em cada taxa e avisa quando ficou em 60 Hz.
- Baixa: ~110 FPS em 120 Hz. Média: 60 fixos.
- Eu não consigo medir o FPS do celular: sempre peça o JSON do teste.

## Armadilhas conhecidas

- Editar arquivos em `src/` **enquanto** um script do `tools/visual-check` roda recarrega o Vite e derruba o script.
- Não use `pgrep -f` em Monitor (casa com ele mesmo); espere por PID.
- Cuidado ao encadear verificações com `| tail`: esconde a falha. Rode `lint`, `typecheck`, `test` e `build` em laço, sem pipe.
- Os testes do Vitest rodam sempre **na Lua** (`PLANET` é lido no carregamento); Marte é testado gerando `MarsTerrain`
  direto e no navegador com `mars.mjs`.
- Mudar o gerador de terreno de um planeta pede subir `WORLD_GEN` (o mundo dos salvamentos é refeito; o progresso fica).
  Testes e scripts não podem depender de uma semente: use `?semente=` ou confira em várias. Mudou um cenário do teste de desempenho? Suba
  `BENCH_VERSION`. Mudou o formato do salvamento? Nova versão, migração e teste.
- O Three.js 0.160.0 está fixado: o material dos blocos injeta GLSL nos nomes internos dos shaders.

## Testes que existem

`npm test` (Vitest, ~240 testes) e, em `tools/visual-check/` (precisa de `npm run dev`; veja o README da pasta):
`play.mjs` (jogabilidade), `ui.mjs` (HUD), `audio.mjs`, `base.mjs`, `drill.mjs`, `tablet.mjs` (mapa), `bench.mjs` (teste
de desempenho), `gfx.mjs` (gráficos avançados), `mars.mjs` (Marte), `stations.mjs` (estações e energia), `caves.mjs` (cavernas e câmera), `shot.mjs <url> <pasta> <largura> <altura> <qualidade>`
(capturas). Rode o que combina com a mudança; para mexer em shader/pós-processamento, compare capturas antes e depois.

## Próximos passos possíveis (o dono decide)

1. Ele jogar Marte e o menu de gráficos e dar o retorno (cores, gravidade, tempestade, desempenho).
2. Rodar o teste completo na Alta com o dedo na tela e mandar o JSON.
3. **v0.4 Sobrevivência II** ([ROADMAP](ROADMAP.md)): Gerador de Domo, painéis solares, eletrolisador, escuridão e frio nas
   crateras, trajes. Ainda **não começou**; precisa de design (receitas, máquinas, regras do domo) e de conversa com ele.
4. A **viagem Lua → Marte** de verdade (hoje a escolha é provisória). Ideias já anotadas em [design/MARTE.md](design/MARTE.md):
   percloratos tóxicos, gelo de CO₂, gêiseres, dia e noite de Marte.
5. Ajustar os números da sobrevivência (oxigênio, danos) depois de jogar.
6. Quando ele pedir: push, PR de `perf/bloom-e-efeitos` para `main`, versão nova e tag (a v0.3.0 está sem tag).

## Onde ler mais

[README](../README.md) · [Arquitetura](ARCHITECTURE.md) · [Game design](GAME_DESIGN.md) · [Roadmap](ROADMAP.md) ·
[História](STORY.md) · [Direção de arte](ART_DIRECTION.md) · [CHANGELOG](../CHANGELOG.md) · [ADRs](adr) ·
[design/](design) (cada sistema tem o seu documento).
