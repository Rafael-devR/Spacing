# História

A história ainda será escrita com o dono do projeto. Este documento guarda o que já está decidido, o que
falta decidir e uma proposta inicial para discutir. **Nada abaixo da seção "Proposta" é canônico.**

## Já decidido

- O jogador é um astronauta que cai no **polo sul da Lua**, perto da cratera Shackleton.
- O módulo de pouso está **avariado**.
- O objetivo final é **sair do planeta e chegar a um mundo melhor, com vida**.
- O tom é cartoon, simpático e visual, nada sombrio ou realista demais.
- A base é **ciência real** do polo sul lunar. A ficção científica fica em poucos elementos: o Gerador de
  Domo, o cristal lunar, os meteoritos com matéria exótica e uma **IA no traje** que fala com o jogador
  ([design/SOBREVIVENCIA.md](design/SOBREVIVENCIA.md)).
- O jogador sobrevive com oxigênio e bateria limitados. Isso dá motivo às missões: cada saída da base
  é uma pequena expedição.

## Perguntas para decidir

1. Quem é o astronauta? Tem nome, voz, passado? Ou é um avatar em branco?
2. Por que a Lua? Missão científica, fuga, acidente?
3. Por que precisa ir embora? A Terra deixou de ser opção? O que aconteceu?
4. O que é o "mundo melhor"? Já foi descoberto? Como o jogador sabe que ele existe?
5. Além da IA do traje, há outra companhia: um robô, um rádio com alguém na Terra? Qual a personalidade da IA?
6. Há antagonista, ou o desafio é só o ambiente?
7. Qual o tamanho da campanha: quantos atos e quantas horas de jogo?
8. Humor leve, emoção, mistério? Qual a mistura?

## Proposta (rascunho para discutir)

Estrutura em três atos, ligada à progressão de [GAME_DESIGN.md](GAME_DESIGN.md):

- **Ato I: Sobreviver.** Pouso forçado, reparo do módulo, primeira base. Ensina minerar, craftar e construir.
- **Ato II: Descobrir.** Um sinal ou pista aponta para fora da Lua. Exploração com rover, novos minérios,
  indústria. Revela por que o jogador precisa partir.
- **Ato III: Partir.** Montar o foguete peça por peça, lançar e chegar ao novo mundo.

## Como as missões são escritas

Cada missão precisa responder a cinco perguntas antes de virar código:

| Pergunta            | Exemplo                                                        |
| ------------------- | -------------------------------------------------------------- |
| Motivo na história  | O rádio do módulo precisa de energia para captar o sinal       |
| Objetivo            | Levar 3 cristais ao módulo                                     |
| O que ensina        | Cristais ficam no subsolo; cavar com cuidado                   |
| Recompensa          | Rádio liga e revela a próxima pista                            |
| Como termina        | Banner de objetivo concluído e nova linha de diálogo           |

Missões serão **dados**, não código: um arquivo por missão em `src/data/missions/`, com objetivos, falas e
recompensas. O sistema de missões só interpreta esses dados. Ver [ARCHITECTURE.md](ARCHITECTURE.md).

## Missões atuais (protótipo)

A cadeia atual do `v0.1.0` é provisória e será substituída: coletar regolito, gelo e ferro, investigar um
meteorito, minerar o meteorito e reparar o módulo. Serve para testar o sistema, não é a história.
