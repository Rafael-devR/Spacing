# Game Design

Documento vivo. Tudo marcado como **proposta** ainda precisa ser validado com o dono do projeto.

## Visão

Um jogo de exploração e sobrevivência em mundo de blocos. O jogador começa sozinho na Lua, com um módulo
de pouso avariado, e evolui da picareta ao foguete. O objetivo final é sair do planeta e chegar a um mundo
melhor, com vida. O tom é cartoon: colorido, simpático e legível, mesmo no espaço.

## Pilares

1. **Cada bloco quebrado precisa ser gostoso.** Som, partículas, destroços com física, tremor e itens que
   voam até o jogador. É a base do loop e nunca pode ficar sem polimento.
2. **Progressão visível.** Cada recurso novo abre uma coisa nova que o jogador consegue ver: uma base, um
   rover, um foguete montado peça por peça.
3. **Mobile primeiro.** Todo controle e todo menu precisam funcionar com um dedo. O jogo nunca pode depender
   de teclado.
4. **Bonito com poucos polígonos.** Cor, luz e shader fazem o trabalho, não a quantidade de geometria.
5. **Missões com sentido.** Cada missão tem motivo na história, ensina um sistema e dá uma recompensa que
   o jogador sente.

## Loop de jogo

```
explorar → minerar → craftar → construir/evoluir → desbloquear nova região ou tecnologia → ...
                                                                    └→ foguete → novo planeta
```

Loop curto (segundos): mirar, minerar, coletar. Loop médio (minutos): juntar materiais para um item.
Loop longo (horas): cumprir a cadeia de missões até o foguete.

## Recursos

| Recurso       | Onde aparece                         | Uso planejado                                       |
| ------------- | ------------------------------------ | --------------------------------------------------- |
| Regolito      | Superfície                           | Construção, base de várias receitas                 |
| Rocha lunar   | Subsolo                              | Construção, reparos                                 |
| Basalto       | Mares escuros e camadas profundas    | Construção resistente                               |
| Gelo          | Fundo de crateras                    | Água, oxigênio e combustível **(proposta)**         |
| Ferro         | Veios no subsolo                     | Ferramentas, estruturas, veículos                   |
| Ilmenita      | Pedras escuras soltas                | Titânio e oxigênio **(proposta)**                   |
| Ouro          | Pedras com pepitas                   | Eletrônicos e painéis **(proposta)**                |
| Cristal lunar | Subsolo e aglomerados na superfície  | Energia e tecnologia avançada **(proposta)**        |

## Sistemas

| Sistema                                   | Estado                      |
| ----------------------------------------- | --------------------------- |
| Movimento, pulo em gravidade baixa        | Pronto                      |
| Câmera isométrica com giro e zoom         | Pronto                      |
| Mundo em chunks com geração procedural    | Pronto                      |
| Mineração e destroços com física          | Pronto                      |
| Construção com blocos                     | Pronto (básico)             |
| Inventário em barra de itens              | Pronto (básico)             |
| Meteoros com cratera                      | Pronto                      |
| Missões                                   | Protótipo linear (a refazer) |
| Salvar no navegador                       | Pronto (básico)             |
| Crafting e receitas                       | Planejado                   |
| Ferramentas com níveis                    | Planejado                   |
| Base: módulos, energia, oxigênio          | Planejado **(proposta)**    |
| Veículos: rover                           | Planejado                   |
| Automação de mineração e refinaria        | Planejado **(proposta)**    |
| Foguete e viagem ao novo planeta          | Planejado                   |
| História, diálogos e personagens          | Planejado                   |
| Menu, configurações e tela de pausa       | Planejado                   |
| Trilha sonora                             | Planejado                   |

## Progressão (proposta)

| Fase | Tema                    | O jogador ganha                                         |
| ---- | ----------------------- | ------------------------------------------------------- |
| 0    | Pouso                   | Ferramentas básicas, primeiros recursos, reparo inicial |
| 1    | Base                    | Oficina, gerador, armazenamento, primeiras receitas     |
| 2    | Exploração              | Rover, mapa, regiões distantes, novos minérios          |
| 3    | Indústria               | Refinaria, mineração automática, materiais avançados    |
| 4    | Foguete                 | Combustível, estrutura, navegação, lançamento           |
| 5    | Novo mundo              | Chegada ao planeta com vida, final da primeira campanha |

## Controles e UX

- Jogável com um dedo: joystick à esquerda, ações à direita, mira por toque no mundo.
- Em computador, tudo tem atalho de teclado e mouse.
- Textos com bom contraste e tamanho mínimo legível em tela pequena de celular.
- O jogo escolhe a qualidade gráfica sozinho e o jogador pode mudar.

## Perguntas em aberto

- Haverá sobrevivência (oxigênio, energia, dano) ou só exploração e construção?
- O mundo será uma Lua só ou haverá outros corpos celestes antes do destino final?
- Inimigos ou perigos além de meteoros?
- A campanha termina na chegada ao novo planeta, ou o novo planeta é jogável?
- Multiplayer está fora do escopo? **(proposta: sim, por enquanto)**
- Mudanças que o dono ainda quer fazer no jogo atual **(a detalhar)**.
