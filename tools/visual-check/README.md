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

- `qualidade`: `baixo`, `medio` ou `alto`.
- `mobile`: ativa toque e tela de celular (mostra joystick e botões).
- Saída: `<prefixo>1-inicio.png` e `<prefixo>2-jogo.png`, além dos erros e avisos do console.
