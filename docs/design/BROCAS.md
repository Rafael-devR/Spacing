# Brocas

A ferramenta com que o astronauta quebra blocos evolui junto com o jogador. Hoje existe a **broca do traje** e
mais duas, fabricadas na bancada da base. Tudo é dado: acrescentar uma broca não mexe nos sistemas.

## Como funciona

Uma broca tem três números (`src/data/drills.ts`):

| Campo   | O que faz                                                                     |
| ------- | ----------------------------------------------------------------------------- |
| `tier`  | o **nível**: quebra alvos que peçam esse nível ou menos                       |
| `speed` | multiplicador da velocidade (tempo = dureza do alvo ÷ `speed`)                 |
| `drain` | multiplicador do gasto de bateria (a bateria do traje alimenta a broca)        |

Cada bloco (`data/blocks.ts`) e cada objeto minerável (`data/props.ts`) tem um `tier` mínimo. Sem o campo, vale 0:
qualquer broca quebra. Se a broca em uso é fraca demais, o alvo fica com o contorno avermelhado, não quebra e a
IA do traje avisa uma vez: **"Basalto pede a broca de ferro. Fabrique na bancada da base."**

## As brocas

| Broca               | Nível | Velocidade | Bateria | Como conseguir                              |
| ------------------- | ----- | ---------- | ------- | ------------------------------------------- |
| Broca de regolito   | 0     | 1×         | 1×      | já vem no traje                             |
| Broca de ferro      | 1     | 1,7×       | 1,15×   | bancada: 4 ferro, 4 rocha lunar             |
| Broca de cristal    | 2     | 2,6×       | 1,35×   | bancada: 4 cristal, 4 ferro, 4 basalto      |

O que cada nível abre:

- **Nível 0:** regolito, rocha lunar, gelo, ferro, pedregulho e meteorito. É tudo o que a primeira missão pede,
  então dá para jogar do começo até reparar o módulo sem fabricar broca nenhuma.
- **Nível 1:** basalto, cristal (bloco e pedra solta) e ilmenita.
- **Nível 2:** ouro.

A progressão sai do próprio jogo: o ferro e o cristal do meteorito pagam a broca de ferro, o basalto que ela abre
paga a de cristal, e a de cristal abre o ouro.

## No jogo

- A broca é um **equipamento** no encaixe `drill` (ao lado do Mapa, na mochila). Equipar uma troca a anterior.
- Não se fabrica uma broca igual ou pior que a equipada (a bancada mostra "Equipado").
- A **ponta no astronauta** muda de cor, tamanho e brilho conforme a broca (ferro prateado, cristal azul-gelo).
- A peça é impressa pelos lasers da bancada como qualquer equipamento (`render/equipModels.ts`).

## Salvamento

A broca é o encaixe `drill` de `equipment` (campo aditivo desde o formato 5): salvamentos antigos continuam valendo e
abrem com a broca do traje.

## Como acrescentar uma broca

1. `data/drills.ts`: uma entrada em `DRILLS` e em `DRILL_ORDER`.
2. `data/equipment.ts`: um equipamento no encaixe `drill` com `drill: '<id>'`, e o id em `EquipId`.
3. `data/recipes.ts`: a receita da bancada.
4. Opcional: `tier` em blocos e objetos que só ela abre.

Os testes (`tests/drills.test.ts`) conferem que a ordem é crescente, que toda broca tem receita e que a primeira
missão continua possível só com a broca inicial.

## Em aberto

- Brocas especializadas (mais rápidas em gelo, por exemplo): bastaria um multiplicador por bloco em `DrillData`.
- Desgaste e conserto da broca.
- Ligar a primeira broca a um passo de missão.
- Tirar a energia do traje por outras ferramentas (lanterna, cortador).
