# Estufa (cápsula de vidro para plantar)

Objetivo de longo prazo do jogo, segundo o dono: **a comida**. O jogador constrói uma cápsula de vidro, separada da base, e no futuro
planta nela (batata, solo, água, luz, fome). Isto aqui descreve a **primeira parte, já feita: obter e construir a cápsula.** Plantio,
canteiros, solo, água, luz, radiação e fome **ainda não existem** (ver "Depois"). O mapa visual que o dono aprovou foi uma página
temporária; o que vale é este documento.

## O que o jogador faz

1. **Baú da base.** Dentro da base, perto das caixas da parede sul, o botão de ação diz **Abrir o baú**. Abre uma vez e entrega o
   **projeto da estufa** e o material (a história decide de onde isso vem; por ora o baú já traz). Mochila cheia: não tira nada.
2. **Holograma.** Lá fora, escolha o projeto na barra, ligue o modo construir e mire o chão: um **holograma da cápsula inteira** acompanha
   a mira, **verde** se ela assenta ali e **vermelho** se não. Tocar assenta a obra (gasta o projeto).
3. **Construir por partes.** Perto da obra, o botão de ação diz **Entregar: <peça>**. Cada peça entregue gasta o material e vira uma
   versão **simples** (cinza, fosca): é o "baixa qualidade". Uma **etiqueta no mundo**, ao lado da cápsula, mostra as bolinhas de
   progresso, a próxima peça, o material que ela pede e o que falta. Sem material: o botão avisa o que falta e não gasta nada.
4. **Finalizar.** Com as 7 peças entregues o botão vira **Finalizar a estufa** (sem custo): todas as peças passam para a **alta
   qualidade** (metal claro, friso azul, vidro limpo) com um brilho. A obra para de pedir ações.

Depois de pronta, o astronauta **entra pela porta** (vão de 1 bloco por 2 de altura no meio do lado sul) e anda sobre o piso.

## Regras e números (`src/data/greenhouse.ts`)

- **Tamanho:** 7×7 blocos por fora (5×5 por dentro), paredes de 3 blocos, cúpula de vidro de 3 blocos acima delas. A porta fica sempre no
  lado **sul**; não há rotação por ora.
- **Peças, na ordem de entrega e com o custo (exemplos que o dono pode ajustar):** piso (8 tijolos de regolito), parede sul com a porta
  (3 barras de ferro + 2 tijolos), paredes oeste, leste e norte (4 barras + 2 tijolos cada), estrutura da cúpula (6 barras + 3 fibras
  de basalto) e vidro da cúpula (8 vidros). São itens que já existem e se fabricam na bancada (nada vem do nada).
- **Baú:** projeto ×1, 20 tijolos, 24 barras de ferro, 4 fibras de basalto e 10 vidros: dá para construir tudo e sobra um pouco.
- **Onde assenta:** o chão sob a estufa pode variar **no máximo 1 bloco** (o piso fica na altura do ponto mais alto; as colunas mais
  baixas são preenchidas). Recusa: chão desnivelado, lava embaixo, a menos de 4 blocos da base, o astronauta em cima, ou uma porta que
  ficaria presa num paredão (as 3×2 colunas em frente à porta precisam estar a no máximo 2 blocos do piso). O jogo avisa o motivo.
- **Terreno:** ao assentar, o jogo **nivela** a pegada (tira o que sobra, enche o que falta, remove pedras soltas) e deixa a faixa de
  fora da porta **rente ao piso**, para o astronauta entrar andando. Esses ajustes são edições de blocos salvas com o mundo.
- **Uma obra por vez.** O projeto da obra já assentada não volta ao desmontar (não há desmontar para o jogador ainda; só o modo de teste).

## Como está feito

- Regras e estado: `src/systems/Greenhouse.ts` (baú, checagem do lugar, entrega, finalização; testes em `tests/greenhouse.test.ts`).
- Dados: `src/data/greenhouse.ts`. Item: `greenhouse_plan` em `src/data/items.ts` (campo `site`).
- Colisão: `src/world/greenhouseLayout.ts` cria uma `Structure` (a mesma peça da base). O chão nivelado é sólido desde o início; cada
  peça fecha as células dela (paredes de 3 blocos com o vão da porta, e o teto com a estrutura da cúpula).
- Desenho: `src/render/greenhouseModel.ts` (geometria simples; cada peça tem **holograma**, **baixa** e **alta** qualidade; a etiqueta é
  um sprite com canvas). O fantasma de colocação usa o mesmo modelo, só com o holograma.
- Ligação com o jogo: `src/app/GreenhouseDirector.ts` (fantasma, assentamento, nivelamento, botão de ação, etiqueta). O botão de ação
  vem do `BaseDirector`, que disputa o lugar com os da base; o baú é o móvel `crates` da base.
- Salvamento: versão 11, campo `greenhouse` (`chestOpened` e a obra: posição, altura do piso, peças entregues, pronta). Mundo refeito
  (`renewWorld`): o projeto e o material entregue voltam para a mochila e o baú continua aberto.
- Teste: `tools/visual-check/greenhouse.mjs` (baú, assentamento, entrega pelo botão, colisão, finalização, entrar, salvamento) e a
  seção **Estufa** do modo de teste (`gh.*`, [TESTE.md](TESTE.md)).

## Depois (ainda não existe, decisões do dono)

- **Plantar e colher:** canteiro, batata, estágios no próprio modelo (sem barras), tempo de crescimento **só com o jogo aberto**
  (por volta de 3 minutos para testar).
- **Solo** (o regolito não serve: precisa de preparo), **água**, **luz** (a cúpula filtra radiação; lâmpada gasta energia),
  **radiação e temperatura**.
- **Fome:** a energia do traje já tem a regra pronta e desligada (`NEEDS.energy.enabled` em `data/survival.ts`); liga quando houver
  comida suficiente.
- **A história** decide de onde vêm o projeto e as sementes (a queda em Marte já traria os itens). O baú é a ponte até lá.
- Rotação da cápsula, desmontar a obra e energia da base para a estufa.
