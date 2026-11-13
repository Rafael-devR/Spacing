# Modo de teste

Um jeito de **testar o jogo rápido e a sério**: um menu de depuração dentro do próprio jogo, onde um toque já dá o item, solta o
meteoro, teleporta, para o tempo ou mata o astronauta, sem esperar nem jogar até lá. Serve ao dono (no celular) e ao Claude
(no navegador de teste) pela **mesma porta**.

## Como abrir

- **Na tela inicial**, toque em **Modo de teste**. A página recarrega com `?teste` no endereço.
- Ou abra o endereço do jogo com `?teste` no fim (ex.: `https://…app.github.dev/?teste`). Pode juntar com `?planeta=marte` e
  `?semente=123` (o mundo de teste fica igual a cada vez).
- Toque em **Começar** como sempre. No alto à direita aparece o botão **Teste** (frasco, em laranja). No computador, **F2**.
- Para sair: **Voltar ao jogo normal**, no fim do painel, ou **Sair do modo de teste** na tela inicial.

O modo de teste tem **salvamento próprio** (`spacing.save.teste`): o seu progresso de verdade nunca é tocado, e dá para
recomeçar o mundo de teste quando quiser (**Recomeçar o mundo de teste**).

## O painel

Uma gaveta na direita da tela, com seções que abrem e fecham. O jogo continua rodando por trás, então se vê o efeito na hora.
Fecha no ✕. Cada toque mostra uma frase com o resultado, no alto do painel.

| Seção | O que dá para fazer |
| --- | --- |
| **Meteoros** | meteoro agora, **impacto já** (sem esperar o voo), grande, pequeno, chuva de 5, perto (dá dano), ligar e desligar o sorteio |
| **Itens** | a quantidade (1, 10, 64) e um botão para **cada item**; um de cada; esvaziar a mochila |
| **Equipamento e estações** | mapa, brocas, **instalar as estações**, **concluir fabricações** sem esperar, bateria da base cheia |
| **Estufa** | abrir o baú da base, dar o projeto e o material, **assentar a obra** perto, entregar a próxima peça (de graça), **construir tudo**, desmontar a obra, ir até a estufa ([ESTUFA.md](ESTUFA.md)) |
| **Astronauta** | encher o traje, imortal, dano, **morrer**, ir ao módulo, à porta, **entrar e sair da base já**, 30 blocos à frente, subir 25 (queda) |
| **Mundo** | soltar cada objeto (pedra, ouro, cristal, meteorito, painel solar…), explosão de destroços, pilha de itens, itens saltando, revelar o mapa, limpar destroços |
| **Tempo, câmera e efeitos** | velocidade do jogo (parado, 0,25×, 1×, 2×, 4×), tremor, soco de zoom, pausa de impacto, câmera lenta, avisos |
| **Missão** | pular a missão de agora |
| **Sons** | um botão para cada som do jogo |

Objetos e destroços saem na frente da câmera; se ali fica a base, o painel procura outro lado.

## Para quem desenvolve

- Tudo é **dado**: o painel desenha `src/data/testmode.ts` e o executor `src/app/TestMode.ts` faz cada ação nos sistemas do
  jogo. **Ação nova** = uma linha no catálogo + um caso em `TestMode.run`. O teste `tests/testmode.test.ts` confere que toda
  ação do catálogo tem executor, que os ids são únicos e que os sons e itens aparecem.
- No navegador (`npm run dev`): `window.spacing.testMode.run('meteor.instant')` devolve `{ ok, msg }`. É o que o teste automatizado usa.
- `tools/visual-check/testmode.mjs` roda **todas** as ações e confere o efeito de cada uma (item entrou, meteoro caiu e soltou
  destroços, o tempo parou, a tela de morte apareceu, o salvamento é separado…). Leva menos de 1 minuto, contra vários minutos
  esperando o jogo acontecer. `tools/visual-check/lib.mjs` é o arranque comum dos testes novos.
- Mexeu em algo do jogo? Abra `?teste`, provoque a situação com o painel (ou `testMode.run`) e confira, em vez de jogar até ela.

## Limites

- Só faz o que está no catálogo. Falta, por exemplo, mexer nos eventos de Marte (tempestade, vulcão) e voar livre.
- O botão de teste e o painel existem só no modo de teste; no jogo normal não aparecem.
- A velocidade parada (0) para a simulação inteira; para ver um efeito em câmera lenta use 0,25×.
