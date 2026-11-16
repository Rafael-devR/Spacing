# Game Design

Documento vivo. Tudo marcado como **proposta** ainda precisa ser validado com o dono do projeto. Os detalhes
de cada sistema ficam em [`docs/design/`](design).

## Visão

Um jogo de exploração e sobrevivência em mundo de blocos. O jogador começa sozinho na Lua, com um módulo
de pouso avariado e um traje com oxigênio e bateria limitados, e evolui da furadeira ao foguete. O objetivo
final é sair do planeta e chegar a um mundo melhor, com vida. O tom é cartoon: colorido, simpático e
legível, mesmo no espaço. A base é ciência real, com uma camada de ficção científica.

## Pilares

1. **Toda ação tem resposta (game juice).** Som, partículas, destroços com física, tremor, vibração e itens
   voando. É o que faz o jogo ser jogo, e nunca fica para depois ([GAME_JUICE](design/GAME_JUICE.md)).
2. **Sobreviver é o motor da exploração.** Oxigênio e bateria puxam o jogador de volta à base e o fazem
   planejar cada saída ([SOBREVIVENCIA](design/SOBREVIVENCIA.md)).
3. **Progressão visível.** Cada recurso novo abre uma coisa nova que o jogador consegue ver: um domo, um
   traje melhor, um rover, um foguete montado peça por peça.
4. **Mobile primeiro.** Todo controle e todo menu precisam funcionar com um dedo. O jogo nunca pode depender
   de teclado.
5. **Bonito com poucos polígonos.** Cor, luz e shader fazem o trabalho, não a quantidade de geometria.
6. **Ciência de verdade, ficção onde encanta.** O que existe na Lua real entra como é; a ficção aparece em
   poucos elementos marcantes.
7. **Nada vem do nada.** Toda matéria vem de um minério e toda energia vem de uma fonte (o sol, por painéis e espelhos,
   guardado na bateria). Antes de criar algo no jogo, dizer de onde vem ([design/ENERGIA.md](design/ENERGIA.md)).

## Loop de jogo

```
preparar (O₂, bateria) → sair → explorar e minerar → voltar antes do oxigênio acabar → craftar e construir
     ↑                                                                                    │
     └────────────── base maior, domo, trajes melhores, saídas mais longas ◄──────────────┘
                                                        └→ foguete → novo planeta
```

Loop curto (segundos): mirar, minerar, coletar. Loop médio (minutos): uma saída da base, de ida e volta,
limitada pelo oxigênio. Loop longo (horas): cumprir a cadeia de missões até o foguete.

## Recursos

| Recurso       | Onde aparece                         | Uso                                                     |
| ------------- | ------------------------------------ | ------------------------------------------------------- |
| Regolito      | Superfície                           | Construção; tijolo, vidro e silício                     |
| Rocha lunar   | Subsolo                              | Construção, reparos                                     |
| Basalto       | Mares escuros e camadas profundas    | Construção; fibra de basalto                            |
| Gelo          | Fundo de crateras escuras            | Água, oxigênio e hidrogênio (combustível) por eletrólise |
| Ferro         | Veios no subsolo                     | Ferramentas, estruturas, veículos                       |
| Ilmenita      | Pedras escuras soltas                | Com H₂ no forno: ferro, óxido de titânio e água; titânio |
| Ouro          | Pedras com pepitas                   | Contatos da placa de circuito (e painéis, depois)       |
| Cristal lunar | Subsolo e aglomerados na superfície  | Núcleo do Gerador de Domo e tecnologia avançada         |

## Sistemas

| Sistema                                   | Estado                                    |
| ----------------------------------------- | ----------------------------------------- |
| Movimento, pulo em gravidade baixa        | Pronto                                    |
| Câmera isométrica com giro e zoom         | Pronto                                    |
| Mundo em chunks com geração procedural    | Pronto                                    |
| Mineração e destroços com física          | Pronto                                    |
| Construção com blocos                     | Pronto (básico)                           |
| Inventário em espaços livres, com mochila | Pronto                                    |
| Meteoros com cratera                      | Pronto                                    |
| Missões                                   | Protótipo linear (a refazer na v0.6)      |
| Salvar no navegador                       | Pronto (básico)                           |
| Menu de pausa e configurações             | v0.2                                      |
| Oxigênio, bateria e integridade           | v0.3                                      |
| Morte com itens no chão                   | v0.3                                      |
| Crafting em estações (bancada, forno, eletrolisador) | Pronto na Lua ([CRAFTING](design/CRAFTING.md)) |
| Gerador de Domo                           | v0.4                                      |
| Painéis solares e eletrolisador           | v0.4                                      |
| Trajes e equipamentos                     | v0.4                                      |
| Escuridão e frio nas crateras             | v0.4                                      |
| Veículos: rover                           | v0.5                                      |
| História, diálogos e IA do traje          | v0.6                                      |
| Automação de mineração e refinaria        | v0.8 **(proposta)**                       |
| Foguete e viagem ao novo planeta          | v1.0                                      |
| Trilha sonora                             | Planejado                                 |

## Progressão

| Fase | Tema                    | O jogador ganha                                         |
| ---- | ----------------------- | ------------------------------------------------------- |
| 0    | Pouso                   | Traje básico, furadeira, primeiros recursos             |
| 1    | Base                    | Gerador de Domo, painéis solares, eletrolisador, oficina |
| 2    | Exploração              | Trajes melhores, rover, regiões distantes, novos minérios |
| 3    | Indústria               | Refinaria, mineração automática, materiais avançados **(proposta)** |
| 4    | Foguete                 | Combustível (H₂ do gelo), estrutura, navegação, lançamento |
| 5    | Novo mundo              | Chegada ao planeta com vida, final da primeira campanha |

## Controles e UX

- Jogável com um dedo: joystick à esquerda, ações à direita, mira por toque no mundo. Ao segurar, a mira fica
  acima do dedo para o bloco não ficar escondido. Detalhes e layout do HUD em
  [design/INTERFACE.md](design/INTERFACE.md).
- Feito para o celular deitado, em tela cheia (entra ao tocar); em pé também funciona.
- Em computador, tudo tem atalho de teclado e mouse.
- Textos com bom contraste e tamanho mínimo legível em tela pequena de celular.
- Os medidores do traje ficam sempre visíveis e falam por cor e movimento, não só por número.
- O jogo escolhe a qualidade gráfica sozinho e o jogador pode mudar.

## Decisões tomadas

| Data       | Decisão                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| 2026-11-11 | O jogo tem sobrevivência: oxigênio, bateria e integridade                                 |
| 2026-11-11 | Base científica realista; ficção no domo, cristal lunar, meteoritos e IA do traje         |
| 2026-11-11 | Morrer custa todos os itens, que ficam no chão para serem recolhidos                      |
| 2026-11-11 | Game juice é pilar do jogo                                                                |

## Perguntas em aberto

- O mundo será uma Lua só ou haverá outros corpos celestes antes do destino final?
- Inimigos ou perigos além de meteoros, frio, radiação e falta de ar?
- A campanha termina na chegada ao novo planeta, ou o novo planeta é jogável?
- Multiplayer está fora do escopo? **(proposta: sim, por enquanto)**
