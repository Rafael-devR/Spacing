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

Leva o astronauta até a porta, entra pela câmara de pressurização, anda por dentro, fabrica o mapa na
bancada, descansa, confere o salvamento e sai, com uma captura de cada passo (`base-*.png`). Como o WebGL
roda por software, o jogo fica bem lento aqui: as esperas são longas de propósito.

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

## Teste das brocas

```bash
node drill.mjs http://localhost:5173/ /tmp/shots
```

Põe um bloco de basalto ao lado do astronauta: a broca do traje não o quebra e a IA avisa; equipa a broca de
ferro e ele quebra; confere que os pedaços seguem flutuando 1,5 s depois (microgravidade); abre a mochila e a
bancada e fabrica a broca de cristal (`drill-*.png`).
