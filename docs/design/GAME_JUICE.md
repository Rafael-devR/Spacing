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
| Golpe de mineração    | Faísca, lasca, anel de progresso                    | Tremor leve             | Clique                   | Curta    | feito |
| Bloco quebrado        | 15+ destroços com física, poeira, bloco "encolhe"   | Tremor + pausa de 45 ms | Estalo grave             | Curta    | feito |
| Item coletado         | Item voa, ícone pula, "+1"                          |                         | Pop com tom subindo em sequência | |  feito |
| Bloco colocado        | Bloco surge esticando e assenta, poeira             | Tremor mínimo           | Batida                   |          | feito |
| Passo / pulo / pouso  | Poeira, pegadas, astronauta achata ao pousar        | Tremor no pouso forte   | Passo, pulo, pouso       |          | feito |
| Detrito chutado       | Destroço voa e gira                                 |                         | Tilintar                 |          | feito |
| Meteoro               | Aviso no chão, rastro, clarão, cratera              | Tremor forte            | Assobio + explosão       | Longa    | feito (vibração na v0.2) |
| Oxigênio baixo        | Medidor pisca, borda vermelha pulsa, aviso da IA    |                         | Bip, alarme, respiração rápida | Curta | feito |
| Dano                  | Borda vermelha, número de dano, traje pisca vermelho | Tremor proporcional    | Impacto + alarme do traje | Média   | feito |
| Asfixia               | Tela perde cor, borda vermelha, som abafado         |                         | Batimento cardíaco       | Pulsada  | feito |
| Morte                 | Itens explodem para fora e flutuam, astronauta cai de costas, tela escurece | Câmera lenta + zoom | Som abafa | Longa | feito |
| Renascer              | Feixe de luz, astronauta pisca invulnerável         | Afasta suave            | Sistema ligando          | Curta    | feito |
| Recarga no módulo     | Medidores com brilho correndo, partículas do módulo ao traje |                 | Carga com tom subindo    |          | feito |
| Objetivo concluído    | Banner, painel da missão pisca                      |                         | Acorde                   | Curta    | feito (vibração na v0.2) |
| Domo ligando          | Esfera cresce do gerador com ondulação              | Tremor leve             | Zumbido de campo         | Média    | v0.4 |

## Configurações

Ficam no menu de pausa (feito na v0.2):

- Tremor de tela: desligado, baixo, normal. Com `prefers-reduced-motion`, começa em baixo.
- Vibração: ligada ou desligada (só aparece em aparelhos que vibram).
- Gráficos (automática, baixa, média, alta) e som.
