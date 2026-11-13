# Base lunar (inicial)

A base é o lugar seguro do jogador: lá dentro o traje recarrega, meteoros não alcançam, dá para descansar e
fabricar equipamentos. A versão inicial é um único módulo simples, mas tudo é montado a partir de dados para
a base crescer depois.

## Onde fica

No platô a nordeste do módulo de pouso, a uns 14 blocos dele, com a porta virada para o pouso. É um habitat
de 11×9 blocos por fora (9×7 por dentro, 3 de altura), sobre uma **plataforma plana** que o gerador nivela em toda semente (ver abaixo). Cresceu de 9×7 em
2026-11-12 (pedido do dono: interior um pouco maior e com mais detalhe); a porta ficou no mesmo lugar do mundo. Painel
solar que ficou embaixo da base nova volta para o inventário ao carregar.

Dentro: bancada, estante e armário na parede norte, horta hidropônica no canto; beliche na oeste; console, forno solar,
eletrolisador e tanque de água na leste; mesa e caixas na sul. Estante, horta, mesa, tanque e caixas são enfeite (ocupam
lugar, sem botão de usar).

## Plataforma e degrau

O terreno em volta da base varia com a semente (medido: de 0 a 2 blocos de desnível na Lua e até 4 em Marte), e o degrau da porta
era uma caixa fixa, sem colisão, que ficava flutuando (2026-11-13). Agora o **gerador** (`Terrain` e `MarsTerrain`, via
`src/world/basePad.ts`) nivela uma plataforma sob a base, na altura do planalto do pouso, com folga de 2 blocos em volta e uma faixa
plana de 6 blocos em frente à porta; dali o relevo volta ao natural de forma suave (sem paredões: o teste confere). Em frente à porta
há uma **sacada de 3×2 blocos de metal** (`HULL`: sólida, sem minerar), um bloco acima da plataforma e rente ao piso: é o degrau.
Nenhum objeto solto nasce na plataforma. A conta só usa a semente e `HAB_MODULE`, então o worker dos chunks e o jogo chegam às mesmas
alturas. Mudou o módulo (tamanho, origem, porta)? A plataforma e a sacada acompanham. `WORLD_GEN` subiu (Lua 3, Marte 2): mundos
salvos são refeitos, o progresso fica. Testes: `tests/basepad.test.ts` (13 sementes × Lua e Marte).

## Entrada: câmara de pressurização

Proposta escolhida, pensada para parecer bem feita e não acontecer por acidente:

1. **Círculo de entrada** azul no chão em frente à porta. Perto dele aparece o botão **"Entrar na base"**
   (no celular, acima do polegar direito; no computador, também F ou Enter).
2. A **porta corre** para dentro da parede e o astronauta **entra andando sozinho** até a câmara.
3. A porta fecha e **duas portas de bloqueio** (com faixas de atenção) descem sobre a tela, com a leitura
   **"Câmara de pressurização"** subindo de 0 a 100% e o chiado do ar entrando.
4. Atrás das portas de bloqueio a câmera troca para o **interior**: o telhado e as paredes da frente **somem por
   inteiro** (sem meia altura) e o mundo de fora **deixa de aparecer** (terreno, pedras, céu, módulo de pouso); fica
   só a sala sobre um fundo escuro, com a luz de dentro acesa. A luz da porta fica verde.
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

A bancada é uma das estações de fabricação; o forno solar e o eletrolisador ficam na parede leste. Como as estações
trabalham sozinhas, a tela técnica e os tempos estão em [CRAFTING.md](CRAFTING.md).

1. Usar a bancada abre a tela técnica dela: receitas à esquerda, processo ao vivo à direita.
2. "Fabricar" gasta os materiais na hora e começa a impressão, que dura de 1 a 2 minutos (o jogador pode sair):
   - o tampo da bancada acende em grade azul;
   - um **holograma** em linhas mostra a peça inteira;
   - a peça é **impressa de baixo para cima**: um plano de corte sobe com uma camada brilhante;
   - **dois lasers** num pórtico varrem a camada atual, soltando **faíscas**, com o som do laser vindo da bancada.
3. No fim: clarão e a peça fica girando na bancada até o jogador usar **"Pegar"**; então ela **voa até o astronauta**
   (ou até o lugar da máquina nova) e aparece "Fabricação concluída".

## Primeira receita: Mapa

- **Materiais:** 1 placa de circuito + 1 vidro + 1 barra de ferro (`src/data/recipes.ts`). A placa vem do módulo de
  pouso no começo do jogo; o vidro e a barra saem do forno solar, que a bancada fabrica primeiro.
- **Equipamento**, não item: não ocupa espaço no inventário. Ao terminar já fica **equipado** no traje e
  aparece em "Equipamento no traje", na mochila.
- **Uso:** libera o botão do tablet, que abre o mapa da cratera ([MAPA.md](MAPA.md)).

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
| Modelo e corte                   | `src/render/baseModel.ts`; modelos em `tools/models/` (`habitat`, `habitat_interior`, `furniture`) | Móvel novo: tipo em `data/base.ts` + peça em `furniture.py` |
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
