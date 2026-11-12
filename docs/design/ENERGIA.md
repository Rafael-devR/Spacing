# Energia da base: nada vem do nada

- **Status:** aprovado pelo dono em 2026-11-12 e implementado (energia das máquinas). Decisão técnica em
  [ADR 0010](../adr/0010-energia-da-base.md).
- Relacionado: [CRAFTING.md](CRAFTING.md) (as estações gastam essa energia) e [SOBREVIVENCIA.md](SOBREVIVENCIA.md).

## A regra

O dono pediu (2026-11-12): **nada é criado do nada; tudo vem de alguma coisa, igual na vida real.** O calor do forno,
a corrente do eletrolisador e o laser da bancada precisam vir de algum lugar. A regra vale para tudo o que entrar no
jogo daqui em diante: antes de criar algo, dizer de onde vem a matéria e de onde vem a energia.

## De onde vem a energia

| Fonte | Como funciona (real) | No jogo |
| --- | --- | --- |
| **Painéis do telhado** | Células de silício transformam luz em eletricidade | 2 painéis no Habitat 01, 1 kW cada com sol cheio. Já vêm com a base |
| **Painéis solares no chão** | Iguais, montados pelo jogador | Fabricados na bancada (2 silício + 1 vidro + 1 barra de ferro), **colocados livres no mundo** como um objeto. 1,5 kW cada |
| **Espelhos do forno** | Forno solar: espelhos concentram a luz num ponto (ESA testou com regolito) | O forno não usa eletricidade para o calor: a velocidade dele é o sol que chega |
| **Bateria da base** | Guarda a sobra e entrega na falta | 900 kJ, começa cheia. Carrega com a sobra, descarrega na falta |

### Painel solar no mundo

- Fica no inventário como item (até 8 por espaço). No modo construir, com ele na mão, tocar no **chão** (face de cima
  de um bloco) coloca o painel ali, virado para o sol. Minerar o painel **desmonta e devolve** o item.
- **Cabo:** o painel só se liga se estiver a até **24 blocos** do centro da base. Mais longe, não gera.
- **Sombra:** o painel precisa ver o sol. Um raio parte do painel na direção do sol; se bater num morro ou num bloco,
  ele está na sombra. **Na Lua, sombra = nada** (sem ar para espalhar a luz: as crateras de sombra eterna são reais). Em
  Marte a sombra ainda deixa 30% (luz do céu).
- Ao colocar, a IA do traje diz se ficou **ligado**, **na sombra** ou **longe demais**.
- No polo sul da Lua há picos quase sempre iluminados: os melhores lugares são altos e abertos.

### Sol em cada planeta

| | Lua | Marte |
| --- | --- | --- |
| Luz do sol | 1 | 0,43 (Marte recebe ~43%) |
| Tempestade de poeira | — | tira até 70% no auge |
| Sombra deixa passar | 0 | 0,3 |

## Para onde vai

| Consumidor | kW | Quando |
| --- | --- | --- |
| Habitat (ar, calor, luz) | 0,4 | sempre (prioridade: nunca desacelera) |
| Bancada | 1,2 | trabalhando |
| Eletrolisador | 2,4 | trabalhando |
| Forno (controles) | 0,15 | trabalhando (o calor é dos espelhos) |
| Recarga do traje | 0,6 | dentro da base, com a bateria do traje abaixo de 100 |

O consumo de uma estação é o mesmo com 1 ou 3 trabalhos: a energia dela é **dividida** entre as vagas
([CRAFTING.md](CRAFTING.md)).

## Faltou energia

1. Geração ≥ consumo: tudo na velocidade cheia, a sobra carrega a bateria.
2. Geração < consumo: a bateria cobre a diferença; tudo continua na velocidade cheia.
3. Bateria vazia: **o que é elétrico desacelera na proporção** (gera 2 kW, pede 4 kW → tudo a 50%). Nada para de vez.
   A recarga do traje na base também fica mais lenta.

Exemplo de começo de jogo: telhado 2 kW; habitat 0,4 + eletrolisador 2,4 = 2,8 kW. A bateria segura ~19 min; depois o
eletrolisador anda a ~70%. Dois painéis no chão resolvem.

## Telas

- **Console do habitat → "Energia da base":** tela cheia com o caminho sol → painéis → bateria → consumidores. Cada
  pontinho num fio é um pacote de energia; fio mais grosso e mais pontinhos = mais energia. A bateria enche e esvazia.
  Embaixo, frases curtas: "Gerando mais do que gasta: a bateria está carregando", "a bateria acaba em ~5 min", "Bateria
  vazia: as máquinas andam a 70%", e quantos painéis estão ligados, na sombra ou longe.
- **Tela de cada estação:** no canto, de onde vem a energia (sol ou raio) com uma barra e uma palavra (cheia, fraca,
  muito fraca, sem energia). Os pacotes de energia descem da fonte e se dividem entre as vagas que trabalham.

## Ainda não segue a regra (próximas etapas, já combinado)

- **Oxigênio:** encher o traje no módulo de pouso e na base ainda vem "do nada". Plano: tanque de O₂ na base e no módulo,
  que acaba e é reposto pelo eletrolisador (cilindros de O₂).
- **Bateria do traje no módulo de pouso:** o módulo deveria ter seus próprios painéis e bateria.
- **Integridade do traje:** o reparo deveria gastar material (kit de reparo com fibra de basalto).
- **Noite:** o sol hoje é fixo. No polo sul ele fica sempre baixo; um ciclo de luz faria a bateria importar mais.

## Onde está no código

| Parte | Arquivo |
| --- | --- |
| Números (kW, bateria, alcance do cabo, sombra, direção do sol) | `src/data/power.ts`; luz de cada planeta em `src/data/planets.ts` (`solar`) |
| Regras: geração, consumo, bateria, velocidade | `src/systems/Power.ts` |
| Consumo das estações e de onde vem a energia delas | `src/data/stations.ts` (`kw`, `energy`) |
| Painel no mundo (objeto, colocar, desmontar, sombra) | `src/data/props.ts`, `src/systems/Interaction.ts` (`placeProp`), `src/world/World.ts` (`placedProps`, `sunExposure`), modelo em `src/render/models.ts` |
| Tela de energia | `src/ui/PowerPanel.ts` (console) |
| Recarga do traje pela base | `src/systems/Survival.ts` (`baseCharge`) |
| Salvamento (v8: bateria) | `src/core/save.ts` |
| Testes | `tests/power.test.ts`, `tools/visual-check/base.mjs`, `tools/visual-check/stations.mjs` |
