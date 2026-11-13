# visual-check

Abre o jogo em um Chromium headless e salva capturas de tela, para conferir o visual sem um navegador
instalado. O WebGL roda por software (SwiftShader), então o FPS medido aqui **não representa o celular**:
serve para achar erros e olhar o resultado, não para medir desempenho.

O Chromium vem do pacote `@sparticuz/chromium`, que traz as bibliotecas dentro. Isso funciona em ambientes sem
`apt` e sem GPU, como o Codespace.

## Uso

```bash
# 1. na raiz do projeto: sobe o jogo
npm run dev

# 2. nesta pasta, uma vez: instala as dependências
cd tools/visual-check && npm install

# 3. captura (início e jogo)
node shot.mjs <url> <pasta-de-saída> [largura] [altura] [qualidade] [mobile] [prefixo]

# exemplos
node shot.mjs http://localhost:5173/ /tmp/shots 960 540 alto
node shot.mjs http://localhost:5173/ /tmp/shots 390 844 medio mobile retrato-
```

## Teste do modo de teste (o mais rápido)

```bash
node testmode.mjs http://localhost:5173/ /tmp/shots
```

Abre `?teste` e roda **todas** as ações do painel de depuração pela mesma porta que o celular usa, conferindo o efeito de cada
uma (item, meteoro, teleporte, tempo, morte, salvamento separado…). Menos de 1 minuto. Para testar uma mudança, o caminho
rápido é provocar a situação por `window.spacing.testMode.run('meteor.instant')` em vez de jogar até ela
([design/TESTE.md](../../docs/design/TESTE.md)). `lib.mjs` é o arranque comum (`boot({ test: true })`) dos scripts novos.

## Teste do astronauta

```bash
node astronaut.mjs http://localhost:5173/ /tmp/shots
```

Câmera de perto e capturas em cada animação (parado, correndo, pulo, queda, pouso, item na mão, comer, dano, minerar, à toa,
morte); confere o esqueleto do Blender, a poeira na corrida e que dentro da base não sobe poeira
([design/PERSONAGEM.md](../../docs/design/PERSONAGEM.md)).

## Teste da tela de itens (inventário e estações)

```bash
node inventory.mjs http://localhost:5173/ /tmp/shots
```

Mexe nos itens com o mouse como se fosse o dedo: arrastar, segurar para pegar metade, tocar e tocar, toque duplo, botão direito,
Organizar. No forno: solta ferro na entrada (escolhe a receita e o lote), fabrica, usa as vagas (pausar, cancelar), pega arrastando a
saída para o inventário; abre a energia. Capturas deitado e em pé ([design/INVENTARIO.md](../../docs/design/INVENTARIO.md),
[design/ESTACOES.md](../../docs/design/ESTACOES.md)).

## Teste dos meteoros

```bash
node meteors.mjs http://localhost:5173/ /tmp/shots
```

Lança um meteoro, congela o jogo em momentos-chave (aviso, voo, impacto e o depois) e tira capturas, conferindo por dentro as
ondas de choque, as baforadas e os destroços ([design/METEOROS.md](../../docs/design/METEOROS.md)).

## Teste jogado

```bash
node play.mjs http://localhost:5173/ /tmp/shots
```

Começa um jogo novo, minera o bloco ao lado do astronauta, espera o item chegar ao inventário, pausa com Esc,
confere o salvamento e volta ao jogo. Imprime cada verificação com OK ou FALHOU e sai com erro se alguma
falhar. Precisa do servidor de desenvolvimento (`npm run dev`), porque usa o acesso `window.spacing`.

## Teste da interface

```bash
node ui.mjs http://localhost:5173/ /tmp/shots
```

Abre o jogo como celular deitado (844×390) e em pé (390×844), salva capturas da tela inicial, do jogo, da
mira deslocada e da pausa, e confere que o HUD fica dentro da tela, sem blocos sobrepostos, e que segurar o
dedo minera o bloco sob a mira. Rode depois de mexer no HUD, no `index.html` ou nos controles.

## Teste da base

```bash
node base.mjs http://localhost:5173/ /tmp/shots
```

Leva o astronauta até a porta, entra pela câmara de pressurização, anda por dentro, olha o lugar do forno (holograma e
tela trancada), fabrica e instala o forno solar, faz vidro e barra de ferro no forno, o mapa na bancada, o eletrolisador e
a eletrólise do gelo (o relógio das estações é adiantado pelo teste), descansa, confere o salvamento (v7) e sai com o forno
trabalhando (selo no HUD), com uma captura de cada passo (`base-*.png`). Rode depois de mexer em fabricação
([design/CRAFTING.md](../../docs/design/CRAFTING.md)). Como o WebGL
roda por software, o jogo fica bem lento aqui: as esperas são longas de propósito.

## Telas das estações e da energia

```bash
node stations.mjs http://localhost:5173/ /tmp/shots
```

Abre as telas das estações (bancada, forno com 3 vagas e lote, ciência no "i", eletrolisador sem energia, energia
da base e retrato) e toca nos botões de verdade (os elementos com `data-hit`, em `hits`). Capturas
`st-*.png` com densidade 2. Rode depois de mexer em `src/ui/station/`, `src/ui/inventory/` ou `PowerPanel.ts`.

## Teste das cavernas

```bash
node caves.mjs http://localhost:5173/ /tmp/shots [semente] [largura] [altura]
```

Começa um jogo novo com a semente pedida (`?semente=`), leva o astronauta à entrada de caverna garantida perto do pouso,
desce a rampa até o tubo de lava e anda por ele. Confere que a câmera aproxima, que ele não fica preso na rocha, que o
fundo fica escuro e tira capturas de cada ponto ([design/MUNDO.md](../../docs/design/MUNDO.md)).

## Teste dos chunks em worker

```bash
node worker.mjs http://localhost:5173/ /tmp/shots [semente]
```

Anda 150 blocos pelo mundo e confere que os chunks novos vêm do worker, que todos os chunks em volta têm malha, mede as
chamadas de desenho e os triângulos por quadro e que quebrar um bloco ainda refaz a malha na hora
([ADR 0012](../../docs/adr/0012-chunks-em-worker-e-resolucao-dinamica.md)).

## Teste do áudio

```bash
node audio.mjs http://localhost:5173/
```

Toca explosões à direita e à esquerda do astronauta e mede o volume de cada canal; confere também que longe
soa mais baixo, que o zumbido do módulo some de longe e que o meteoro toca sem erro. Rode depois de mexer em
`src/audio/`.

## Opções do `shot.mjs`

- `qualidade`: `baixo`, `medio` ou `alto`.
- `mobile`: ativa toque e tela de celular (mostra joystick e botões).
- Saída: `<prefixo>1-inicio.png` e `<prefixo>2-jogo.png`, além dos erros e avisos do console.

## Teste de Marte

```bash
node mars.mjs http://localhost:5173/ /tmp/shots
```

Abre o jogo em Marte (`?planeta=marte`) e confere a tela inicial, o chão de poeira, as camadas e a gipsita do cânion, a lava
na caldeira, a lava queimando o traje, a tempestade (visão menor e vento empurrando), o redemoinho devolvendo bateria, o
pulo mais baixo e que o salvamento de Marte é separado do da Lua. Captura cada lugar (`mars-*.png`).

## Teste dos gráficos avançados

```bash
node gfx.mjs http://localhost:5173/ /tmp/shots
```

Abre o menu pela pausa, muda cada ajuste (resolução, MSAA, sombra, bloom, efeitos, limite e contador de FPS), confere o
que foi salvo, o texto do menu, o contador de FPS, o Esc/Voltar, que as trocas sobrevivem a recarregar e que "Voltar ao
padrão" apaga tudo. Rode depois de mexer em `src/render/graphics.ts`, `post.ts` ou `src/ui/GraphicsMenu.ts`.

## Teste das brocas

```bash
node drill.mjs http://localhost:5173/ /tmp/shots
```

Põe um bloco de basalto ao lado do astronauta: a broca do traje não o quebra e a IA avisa; equipa a broca de
ferro e ele quebra; confere que os pedaços seguem flutuando 1,5 s depois (microgravidade); abre a mochila e a
bancada e fabrica a broca de cristal (`drill-*.png`).

## Teste do tablet

```bash
node tablet.mjs http://localhost:5173/ /tmp/shots
```

Equipa o Mapa, abre pelo botão (captura do tablet subindo e do mapa), confere que o mapa é de blocos, só com o que
foi descoberto, na perspectiva e no tamanho da tela do jogo, os nomes, que o astronauta não anda, que arrastar move
o mapa e que fechar devolve o mundo. Leva o astronauta 70 blocos adiante e confere que o mapa descobre o trecho
novo (captura do mapa afastado e girado). Depois minera blocos em sequência com a broca de cristal e confere que o
tremor não passa do nível de um golpe (`tablet-*.png`).

## Teste do teste de desempenho

```bash
node bench.mjs http://localhost:5173/ /tmp/shots
```

Abre o menu de pausa, escolhe o modo **rápido** (a 10% do tempo, com `?benchEscala=0.1`, só para este teste) e depois o
**completo** (a 2%), e confere que o teste **funciona**: o botão e a escolha do modo, a detecção da taxa da tela, a medição
dos 15 cenários, dos 13 subsistemas, dos efeitos, da resolução e do aquecimento, o painel (veredictos de 120 e 60 Hz, gráfico
desenhado no canvas, "não disponível" onde falta), a **exportação do JSON**, o histórico, que **o salvamento e as preferências
não mudam** (nem ao terminar nem ao cancelar) e que voltar ao jogo recarrega no progresso de antes (`bench-*.png`).

**Os números dali NÃO valem para o celular:** o Chromium daqui roda o WebGL por software e é um navegador automatizado (o
painel avisa). A medição de verdade é no celular de 120 Hz, pelo menu de pausa. O `npm run dev` precisa estar rodando.

- `greenhouse.mjs <url> <pasta>`: a estufa ([design/ESTUFA.md](../../docs/design/ESTUFA.md)): baú, holograma e assentamento, entrega pelo botão, colisão, finalização, entrar, salvamento e as ações do modo de teste; tira 5 capturas.
