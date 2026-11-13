# Interface e controles no celular

O jogo é pensado primeiro para o celular. Este documento registra como o HUD está organizado, como a mira
de toque funciona e como ficam a tela cheia e a orientação.

## Mira de toque: o dedo não pode cobrir o bloco

**Problema:** para minerar, o jogador segurava o dedo em cima do bloco, e o próprio dedo escondia o bloco
e o anel de progresso.

### Opções consideradas

| Opção                                                                                                                                          | A favor                                                                  | Contra                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **A. Mira deslocada** (escolhida): ao segurar, aparece uma mira acima do dedo; o alvo é o que está sob a mira, e dá para arrastar para ajustar | Um gesto só, como antes; mostra o bloco e o progresso; precisão de pixel | O primeiro toque não mira exatamente onde o dedo encosta (a linha tracejada ajuda a entender) |
| B. Alvo automático: o astronauta minera o bloco à frente dele, com um botão "Minerar"                                                          | Nada na tela fica coberto                                                | Perde a escolha do bloco (cavar para baixo, pegar um minério específico)                      |
| C. Tocar para marcar o bloco e segurar um botão para minerar                                                                                   | Bloco sempre visível                                                     | Dois passos para cada bloco; mais lento num jogo de mineração                                 |
| D. Lupa que mostra a área sob o dedo                                                                                                           | Familiar (seleção de texto)                                              | Ocupa espaço na tela e duplica a imagem do jogo                                               |

A opção A mantém o gesto que já funcionava e resolve a visibilidade. Detalhes:

- A mira fica **80 px acima do dedo** (`TOUCH_AIM_OFFSET` em `src/app/config.ts`) e nunca sai do topo da tela.
- Cores da mira: **branca** = ao alcance; **salmão** = longe (o astronauta anda até lá); **apagada** = nada
  para minerar.
- O anel de progresso da mineração fica em volta da mira.
- **Toque rápido** continua agindo onde o dedo tocou (andar até o ponto). No **modo construção**, a mira
  também fica no dedo, porque construir é por toque rápido e o bloco é visto antes de tocar.
- Quem preferir o jeito antigo escolhe **Mira ao segurar: No dedo** no menu de pausa.
- No computador nada muda: o mouse mira onde está.

## Organização do HUD

Regra geral: **os polegares ficam com os controles do dia a dia; informação fica no alto; o que se usa
pouco vai para os cantos de cima.**

```
┌────────────────────────────────────────────────────────────┐
│ O₂ ▬▬▬▬▬            ─ N ─ NE ─ L ─               [⛶] [❚❚] │
│ ⚡ ▬▬▬▬▬            mensagens da IA                [⟲] [⟳] │
│ ⛨ ▬▬▬▬▬                                           [+] [−] │
│ ┌ Objetivo ─────┐                                          │
│ │ título  0/8   │                                          │
│ └───────────────┘                                          │
│                                                            │
│  ( joystick )      [itens da barra]       [cubo]  ( PULAR ) │
└────────────────────────────────────────────────────────────┘
```

- **Canto superior esquerdo:** medidores do traje e objetivo. No celular, o objetivo fica compacto (título
  e progresso); ele abre o texto completo por 7 s ao começar e quando o objetivo muda. Um toque abre ou fecha.
  Abaixo do objetivo, um **selo por estação trabalhando** (ícone do produto e tempo que falta, ou "Pronto"), para o
  jogador saber lá fora quando voltar à base ([CRAFTING.md](CRAFTING.md)).
- **Topo, no centro:** bússola e mensagens (IA do traje, avisos). Saíram de cima do joystick.
- **Canto superior direito:** tela cheia, pausa e câmera (girar e zoom), que se usam pouco. O zoom também
  funciona com pinça.
- **Embaixo:** joystick no polegar esquerdo; pular (botão grande, no canto) e minerar/construir (ao lado,
  em arco) no polegar direito; barra de itens no centro.
- **Em pé (retrato):** a barra de itens fica na borda de baixo e os polegares logo acima dela.
- **Telas cheias em Canvas** (estações e energia da base): ocupam a tela inteira, desenhadas na resolução do aparelho
  (`src/ui/canvasScreen.ts`). Voltar no canto de cima à esquerda. Estações: receitas **à direita** (perto do polegar; no
  retrato, faixa embaixo), máquina com módulos, barramento e vagas em grade de células, e a receita ou a vaga escolhida
  embaixo ([CRAFTING.md](CRAFTING.md)). Estilo de painel técnico (referência: o jogo Idle CPU), letras JetBrains Mono.
  **O forno é a exceção:** tela em PixiJS ([FORNO.md](FORNO.md)). Energia: sol → painéis → bateria → consumidores ([ENERGIA.md](ENERGIA.md)). Regra: poucos números; cor, barra,
  palavra e movimento que significa algo de verdade. O HTML fica só para o HUD e os menus simples.
- Nome do lugar e coordenadas saíram do HUD e foram para o cabeçalho do menu de pausa.
- O HUD fica escondido no menu inicial e na pausa. Na tela de morte só ficam os medidores.
- **Menu de pausa, Teste de desempenho:** logo abaixo de **Continuar** está o botão **Teste de desempenho**. Ele abre a
  escolha entre **Rápido** e **Completo** e os **Resultados guardados** ([design/BENCHMARK.md](BENCHMARK.md)). Durante o
  teste um cartão no alto mostra o cenário, a etapa, o tempo que falta, o FPS e o botão **Cancelar**; o HUD do jogo fica
  escondido. O resultado ocupa a tela, rola, e tem **Exportar JSON**, **Copiar resumo** e **Voltar ao jogo**.

## Tela cheia e orientação

- **No celular, tocar na tela entra em tela cheia** (preferência "Tela cheia", ligada por padrão). O navegador
  só permite isso logo depois de um toque, então a tela cheia entra quando o dedo solta.
- **Botão de tela cheia** no canto superior direito, que liga e desliga. Desligar pelo botão também desliga
  a entrada automática.
- **Tela deitada:** em tela cheia o jogo trava a tela na horizontal (preferência "Tela em tela cheia:
  Deitada" ou "Livre").
- **iPhone:** o Safari do iPhone não tem tela cheia para páginas nem trava de orientação. Lá o botão some,
  o layout de retrato continua funcionando e a tela inicial sugere deitar o celular.
- Código em `src/core/fullscreen.ts`.

## Testar

- `tools/visual-check/ui.mjs`: capturas do celular deitado e em pé (tela inicial, jogo, mira, pausa). Confere
  que o HUD fica dentro da tela e sem blocos sobrepostos, que a mira aparece acima do dedo e que o bloco
  minerado é o que está sob a mira.
- Ficam para o celular de verdade: conforto dos polegares, distância da mira (80 px), tela cheia e trava de
  orientação (o navegador headless não as simula).

## Em aberto

- Joystick flutuante (aparece onde o polegar encosta, na metade esquerda da tela).
- Tamanho dos botões e distância da mira ajustáveis no menu.
- Menu de pausa com abas, se ganhar muitas configurações.
- PWA (adicionar à tela inicial), que daria tela cheia também no iPhone.
