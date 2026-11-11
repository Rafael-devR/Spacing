# Game juice

Game juice é o retorno exagerado e gostoso que o jogo dá a cada ação. É o que faz um protótipo virar jogo.
Aqui ele é prioridade, não acabamento ([GAME_DESIGN](../GAME_DESIGN.md), pilar 1).

## Princípios

1. **Toda ação responde na hora.** Em menos de 100 ms aparece algo: som, partícula, movimento ou número.
2. **Três canais, sempre que der:** imagem (partícula, cor, escala), câmera (tremor, zoom, pausa curta) e som.
   No celular, um quarto canal: vibração.
3. **Antecipação, impacto, continuação.** A ação prepara (o braço puxa), acerta (pausa curta, faísca) e
   continua (detrito rolando, item voando).
4. **Proporção.** A intensidade acompanha a importância: um passo é sutil, quebrar um bloco é firme, um
   meteoro sacode a tela, a morte para o tempo.
5. **Nada atrapalha a leitura.** Juice nunca esconde o alvo, o HUD ou o perigo.
6. **O jogador controla.** Configurações para intensidade do tremor e para desligar a vibração, e o
   `prefers-reduced-motion` do sistema é respeitado.

## Catálogo

Legenda: **feito** já está no jogo; **v0.2**, **v0.3** e **v0.4** indicam em que versão entra.

| Evento                | Imagem                                             | Câmera                  | Som                      | Vibração | Estado |
| --------------------- | -------------------------------------------------- | ----------------------- | ------------------------ | -------- | ------ |
| Golpe de mineração    | Faísca, lasca, anel de progresso                    | Tremor leve             | Clique                   | Curta    | feito; vibração v0.3 |
| Bloco quebrado        | 15+ destroços com física, poeira, bloco "encolhe"   | Tremor + pausa de 40 ms | Estalo grave             | Média    | feito; pausa e encolher v0.3 |
| Item coletado         | Item voa, ícone pula, "+1"                          |                         | Pop com tom subindo em sequência | |  feito; tom em sequência v0.3 |
| Bloco colocado        | Bloco surge esticando e assenta, poeira             | Tremor mínimo           | Batida                   | Curta    | poeira feito; animação v0.3 |
| Passo / pulo / pouso  | Poeira, pegadas, astronauta achata ao pousar        | Tremor no pouso forte   | Passo, pulo, pouso       |          | feito; achatar v0.3 |
| Detrito chutado       | Destroço voa e gira                                 |                         | Tilintar                 |          | feito |
| Meteoro               | Aviso no chão, rastro, clarão, cratera              | Tremor forte            | Assobio + explosão       | Longa    | feito; vibração v0.3 |
| Oxigênio baixo        | Medidor pisca, vinheta pulsa                        |                         | Bip, respiração rápida   | Curta    | v0.3 |
| Dano                  | Tela pisca vermelho, número de dano, astronauta pisca | Tremor proporcional   | Impacto + alarme do traje | Média   | v0.3 |
| Asfixia               | Tela perde cor, vinheta fecha                       | Zoom lento              | Batimento cardíaco       | Pulsada  | v0.3 |
| Morte                 | Itens explodem para fora e flutuam, tela escurece   | Câmera lenta + zoom     | Som abafa e some         | Longa    | v0.3 |
| Renascer              | Feixe de luz no módulo, medidores enchem com animação | Afasta suave           | Sistema ligando          | Curta    | v0.3 |
| Recarga no módulo     | Medidores sobem com brilho, partículas entre módulo e traje |                  | Zumbido de carga         |          | v0.3 |
| Objetivo concluído    | Banner, painel da missão pisca                      |                         | Acorde                   | Curta    | feito; vibração v0.3 |
| Domo ligando          | Esfera cresce do gerador com ondulação              | Tremor leve             | Zumbido de campo         | Média    | v0.4 |

## Configurações

Ficam no menu de pausa (v0.2):

- Tremor de tela: desligado, baixo, normal.
- Vibração: ligada ou desligada (só aparece em aparelhos que vibram).
- Gráficos e som (já existem hoje nos botões do topo).
