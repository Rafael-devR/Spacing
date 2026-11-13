# Estufa (cápsula de vidro para plantar)

Objetivo de longo prazo do jogo, segundo o dono: **a comida**. O jogador constrói uma cápsula de vidro, separada da base, planta
batata nela e come para não passar fome. Feito: obter e construir a cápsula (parte 1), **canteiros, solo, água, crescimento e
colheita** (parte 2) e **a fome ligada** (parte 3). Radiação, temperatura e outras plantas ficam para depois. O mapa visual que o
dono aprovou foi uma página temporária; o que vale é este documento.

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

5. **Canteiros.** Com a estufa pronta, o **canteiro** (vem do baú ou da bancada: 3 tijolos + 1 barra de ferro) vai no modo construir:
   um fantasma verde ou vermelho mostra a célula; vale no piso, dentro das paredes e fora do corredor da porta. O canteiro é sólido
   (1 bloco).
6. **Plantar.** Perto do canteiro, o botão de ação faz o que der agora: **Encher com solo** (solo fértil: baú ou bancada, 3 regolito +
   1 gelo; em Marte, poeira marciana lavada), **Plantar batata** (a batata é a semente), **Regar (gelo)** (o gelo derrete e enche a
   água), **Colher batatas** (3 batatas; o solo fica). Sem o item, o botão diz o que falta. Nada de barra na tela: o estado aparece no
   canteiro (solo seco ou molhado, a planta em 5 estágios, murcha sem água) e na **luzinha** dele (verde crescendo, âmbar com sede,
   azul pronta).
7. **Comer.** Com uma batata na barra e energia abaixo de 95, o botão de ação diz **Comer batata (+25)** quando não há outra coisa ao
   alcance.

Depois de pronta, o astronauta **entra pela porta** (vão de 1 bloco por 2 de altura no meio do lado sul) e anda sobre o piso.

## Regras e números (`src/data/greenhouse.ts`)

- **Tamanho:** 7×7 blocos por fora (5×5 por dentro), paredes de 3 blocos, cúpula de vidro de 3 blocos acima delas. A porta fica sempre no
  lado **sul**; não há rotação por ora.
- **Peças, na ordem de entrega e com o custo (exemplos que o dono pode ajustar):** piso (8 tijolos de regolito), parede sul com a porta
  (3 barras de ferro + 2 tijolos), paredes oeste, leste e norte (4 barras + 2 tijolos cada), estrutura da cúpula (6 barras + 3 fibras
  de basalto) e vidro da cúpula (8 vidros). São itens que já existem e se fabricam na bancada (nada vem do nada).
- **Baú:** projeto ×1, 20 tijolos, 24 barras de ferro, 4 fibras de basalto e 10 vidros: dá para construir tudo e sobra um pouco.
- **Onde assenta:** o chão sob a estufa pode variar **no máximo 1 bloco** (o piso fica na altura do ponto mais alto; as colunas mais
  baixas são preenchidas). Recusa: chão desnivelado, lava embaixo, a menos de 4 blocos da base, a menos de 7 do centro do módulo de pouso, o astronauta em cima, ou uma porta que
  ficaria presa num paredão (as 3×2 colunas em frente à porta precisam estar a no máximo 2 blocos do piso). O jogo avisa o motivo.
- **Terreno:** ao assentar, o jogo **nivela** a pegada (tira o que sobra, enche o que falta, remove pedras soltas) e deixa a faixa de
  fora da porta **rente ao piso**, para o astronauta entrar andando. Esses ajustes são edições de blocos salvas com o mundo.
- **Uma obra por vez.** O projeto da obra já assentada não volta ao desmontar (não há desmontar para o jogador ainda; só o modo de teste).

## Cultivo e fome (números em `data/greenhouse.ts` `FARM` e `data/survival.ts` `NEEDS`)

- A batata leva **3 minutos** da semente à colheita na Lua, **só com o jogo aberto** e só com água. Em Marte, com menos sol, ~1,5×
  mais devagar (luz = raiz do sol do planeta). Um enchimento de água dura ~110 s de crescimento: uma batata pede uma ou duas regas.
- Sem água a planta **para e murcha**, mas não morre (sem castigo enquanto o dono testa).
- Colheita: 3 batatas. Uma volta para a terra; duas viram comida.
- **Fome:** a energia do corpo cai 1,2 por minuto (cheia dura ~80 min). Avisos em 30% e 10%. Zerada, a integridade do traje cai
  0,35 por segundo (morrer de fome leva ~5 min: dá tempo de comer). Batata devolve 25. Ao renascer, a energia sobe para 60 (a ração
  do traje de emergência). Medidor laranja de energia no HUD, embaixo dos do traje.
- O baú tem dois lotes: **estufa** (projeto e material) e **cultivo** (2 canteiros, 4 solos, 4 batatas). Quem abriu o baú antes do
  cultivo existir abre de novo e pega só o lote novo.

## Câmera por dentro

Com a estufa pronta e o astronauta dentro dela, a câmera vira uma **câmera de segurança**: presa a um canto alto da cúpula
(`GH.camInset`, `camHeight`), com lente aberta (`camFov`, `camFovTall` no retrato) e parada no mundo, mas girando para manter o astronauta
no centro (com o leve atraso da câmera normal). Os botões de girar trocam de canto. Ao sair, a câmera normal volta numa transição suave
(`IsoRig.watch`, `Game.greenhouseCamera`).

## Como está feito

- Regras e estado: `src/systems/Greenhouse.ts` (baú, checagem do lugar, entrega, finalização; testes em `tests/greenhouse.test.ts`).
- Dados: `src/data/greenhouse.ts`. Item: `greenhouse_plan` em `src/data/items.ts` (campo `site`).
- Colisão: `src/world/greenhouseLayout.ts` cria uma `Structure` (a mesma peça da base). O chão nivelado é sólido desde o início; cada
  peça fecha as células dela (paredes de 3 blocos com o vão da porta, e o teto com a estrutura da cúpula).
- Desenho: modelos do Blender `tools/models/greenhouse.py` (cada peça com nó `<peça>_low` e `<peça>_high`) e `farm.py` (canteiro,
  `fx_led`, `soil_dry`/`soil_wet`, `potato_0`..`potato_4`, `potato_dry`). `src/render/greenhouseModel.ts` monta a cápsula (o
  **holograma** sai das malhas da baixa qualidade; sem o .glb, caixas feitas em código) e a etiqueta (sprite com canvas);
  `src/render/farmModel.ts` monta cada canteiro. O fantasma de colocação usa o mesmo modelo, só com o holograma.
- Ligação com o jogo: `src/app/GreenhouseDirector.ts` (fantasma, assentamento, nivelamento, botão de ação, etiqueta). O botão de ação
  vem do `BaseDirector`, que disputa o lugar com os da base; o baú é o móvel `crates` da base.
- Salvamento: versão 12, campo `greenhouse` (`chest`: lotes pegos; a obra: posição, altura do piso, peças entregues, pronta e os
  canteiros com solo, água e planta). Energia do corpo no `suit`. Mundo refeito (`renewWorld`): o projeto, o material entregue, os
  canteiros, o solo e as batatas plantadas voltam para a mochila.
- Teste: `tools/visual-check/greenhouse.mjs` (baú, assentamento, entrega pelo botão, colisão, finalização, entrar, salvamento) e a
  seção **Estufa** do modo de teste (`gh.*`, [TESTE.md](TESTE.md)).

## Depois (ainda não existe, decisões do dono)

- Outras plantas (alface, trigo, soja), adubo do que sobra, solo que cansa depois de várias colheitas.
- **Radiação e temperatura** (a cúpula filtra; frio da noite), energia da base para a estufa (lâmpadas em Marte).
- Cozinhar (forno) e comidas que rendem mais.
- **A história** decide de onde vêm o projeto e as sementes (a queda em Marte já traria os itens). O baú é a ponte até lá.
- Rotação da cápsula, desmontar a obra e mais de uma estufa.
