# Base lunar (inicial)

A base é o lugar seguro do jogador: lá dentro o traje recarrega, meteoros não alcançam, dá para descansar e
fabricar equipamentos. A versão inicial é um único módulo simples, mas tudo é montado a partir de dados para
a base crescer depois.

## Onde fica

No platô a nordeste do módulo de pouso, a uns 14 blocos dele, com a porta virada para o pouso. É um habitat
de 9×7 blocos por fora (7×5 por dentro, 3 de altura), apoiado no ponto mais alto do terreno.

## Entrada: câmara de pressurização

Proposta escolhida, pensada para parecer bem feita e não acontecer por acidente:

1. **Círculo de entrada** azul no chão em frente à porta. Perto dele aparece o botão **"Entrar na base"**
   (no celular, acima do polegar direito; no computador, também F ou Enter).
2. A **porta corre** para dentro da parede e o astronauta **entra andando sozinho** até a câmara.
3. A porta fecha e **duas portas de bloqueio** (com faixas de atenção) descem sobre a tela, com a leitura
   **"Câmara de pressurização"** subindo de 0 a 100% e o chiado do ar entrando.
4. Atrás das portas de bloqueio a câmera troca para o **interior**: o telhado some, as paredes da frente
   abaixam e o mundo de fora **deixa de aparecer** (terreno, pedras, céu, módulo de pouso); fica só a sala
   sobre um fundo escuro, com a luz de dentro acesa. A luz da porta fica verde.
5. As portas de bloqueio abrem e a IA do traje avisa que a base está pressurizada.

**Sair** é o caminho inverso: botão "Sair da base" perto da porta, "Despressurizando" de 100 a 0%, a câmera
volta para fora, a porta abre e o astronauta sai andando.

Por que um botão e não entrar ao encostar: evita entrar sem querer enquanto se minera em volta da base, e o
mesmo botão serve para tudo que se usa na base (porta, bancada, beliche).

## Dentro da base

A base é um **ambiente à parte** ([ADR 0006](../adr/0006-interior-da-base-como-camada-isolada.md)):

- Só a sala aparece: piso de placas, paredes com nervuras, luminárias no alto, canos da ventilação, a janela
  com a Terra. O lado de fora some.
- No alto da tela, no lugar da bússola, o aviso **"Habitat 01 · Pressurizado"**. Somem os marcadores de
  objetivo e de itens e o botão de construir.
- O mundo de fora fica **travado**: não se minera, não se constrói e não se mira nada.
- Som: o fundo da cratera quase some, o eco encurta e entra a ventilação. Meteoros não nascem enquanto se está
  dentro; um que já estava caindo chega como um tremor grave pelo casco.

- Anda-se livremente pelo joystick ou teclado; paredes e móveis bloqueiam.
- **Pressurizado:** oxigênio, bateria e integridade recarregam, como perto do módulo de pouso.
- **Abrigado:** meteoros não causam dano, e nenhum meteoro cai a menos de 5 blocos da base.
- Móveis: **bancada de fabricação**, **beliche**, armário e console (os dois últimos, por enquanto, só
  decoram). Na parede, uma janela com a Terra.

### Beliche: descansar

"Descansar" escurece a tela por um instante, enche o traje e passa a ser o **ponto de renascimento**: se o
astronauta morrer, acorda dentro da base em vez de no módulo de pouso.

### Bancada de fabricação

1. "Usar bancada" abre a lista de receitas, com o que cada uma precisa (verde = tem, vermelho = falta).
2. "Fabricar" gasta os materiais na hora e começa a impressão:
   - o tampo da bancada acende em grade azul;
   - um **holograma** em linhas mostra a peça inteira;
   - a peça é **impressa de baixo para cima**: um plano de corte sobe com uma camada brilhante;
   - **dois lasers** num pórtico varrem a camada atual, soltando **faíscas**, com o som do laser vindo da bancada.
3. No fim: clarão, a peça gira no ar, **voa até o astronauta** e aparece "Fabricação concluída".

## Primeira receita: Mapa

- **Materiais:** 6 regolito + 2 minério de ferro (ajustável em `src/data/recipes.ts`).
- **Equipamento**, não item: não ocupa espaço no inventário. Ao terminar já fica **equipado** no traje e
  aparece em "Equipamento no traje", na mochila.
- **Uso:** libera o botão do tablet, que abre o mapa em holograma ([MAPA.md](MAPA.md)).

## Comida, fome e energia (preparado, desligado)

Ainda não existem no jogo, mas a estrutura está pronta:

- `NEEDS.energy` em `src/data/survival.ts` (desligado): máximo de energia e quanto a **fome** tira por
  minuto.
- `food: { energy }` em `ItemData` (`src/data/items.ts`): a **energia vem da comida**. Nenhum item é comida
  ainda.
- `Survival.energy`, `Survival.eat(item)` e o gasto por fome só rodam com o interruptor ligado; o salvamento
  já aceita o campo `energy` no traje.

Para ligar: definir comidas e receitas, `enabled: true`, um medidor no HUD e os avisos da IA.

## Como a base cresce

| Peça                             | Onde                                                | Para crescer                                  |
| -------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| Módulos (tamanho, porta, móveis) | `src/data/base.ts`                                  | Novos `ModuleDef` em `BASE_MODULES`           |
| Colisão e pontos de uso          | `src/world/baseLayout.ts`, `src/world/Structure.ts` | Corredores entre módulos (porta interna)      |
| Modelo e corte                   | `src/render/baseModel.ts`                           | Novos tipos de móvel em `buildFurniture`      |
| Receitas                         | `src/data/recipes.ts`                               | Novas entradas; outras estações (`Station`)   |
| Equipamentos                     | `src/data/equipment.ts`, `src/systems/Equipment.ts` | Novos encaixes (capacete, tanque, ferramenta) |
| Experiência                      | `src/app/BaseDirector.ts`                           | Novas ações no botão do lugar                 |

Decisão técnica em [ADR 0005](../adr/0005-base-como-estrutura-sobre-os-voxels.md).

## Itens no chão: contorno

Todo item solto no mundo (minerado voando até o jogador ou caído na morte) tem um **contorno branco**
(casco invertido: uma cópia um pouco maior que só mostra o verso), para ser visto de longe e contra o chão
claro.

## Testar

- `tests/base.test.ts`: colisão da base, porta, corte, área sem edição, astronauta preso pelas paredes,
  fabricação, equipamento, abrigo, descanso e energia desligada. `tests/save.test.ts`: salvamento versão 5.
- `tools/visual-check/base.mjs`: no navegador, entra pela porta, anda por dentro, fabrica o mapa, descansa,
  salva e sai, com capturas de cada passo.
- No celular: conforto do botão de ação, ritmo da câmara (2,2 s), leitura do laser e do corte com a câmera
  girada.

## Em aberto

- **Morte e equipamento:** a regra "perde todos os itens" vale também para o equipamento? Hoje o mapa
  **fica** no traje ao morrer.
- O que o armário e o console vão fazer (guardar itens? missões? rádio?).
- Mais módulos: estufa (comida), oficina, garagem do rover, e onde eles encaixam.
- A base pode ser danificada (meteoros, tempestade solar)?
