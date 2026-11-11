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

## Opções do `shot.mjs`

- `qualidade`: `baixo`, `medio` ou `alto`.
- `mobile`: ativa toque e tela de celular (mostra joystick e botões).
- Saída: `<prefixo>1-inicio.png` e `<prefixo>2-jogo.png`, além dos erros e avisos do console.
