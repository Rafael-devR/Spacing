# Itens e receitas (panorama)

Tudo o que existe hoje no jogo como item, equipamento, máquina e receita, numa lista fácil de conferir. O porquê de cada
coisa, a química, os tempos e a tela estão em [CRAFTING.md](CRAFTING.md). Se esta lista discordar do código
(`src/data/items.ts`, `recipes.ts`, `stations.ts`, `equipment.ts`), o código manda.

Legenda: ✅ tem uso em receita · 🧱 só construção · 🔬 Marte, uso planejado (ainda sem receita).

## Itens (28)

### Lua: minerados (9)

| Item | De onde vem | Vira / entra em | |
| --- | --- | --- | --- |
| Regolito | Superfície | Tijolo, Vidro (forno); Silício (eletrolisador); construir | ✅ |
| Rocha lunar | Subsolo, pedregulhos | Forno solar (bancada); construir | ✅ |
| Basalto | Mares escuros, nível 1 | Fibra de basalto (forno); construir | ✅ |
| Gelo | Fundo de crateras | H₂ + O₂ (eletrolisador); construir | ✅ |
| Minério de ferro | Veios, meteorito | Barra de ferro (forno); Forno solar (bancada) | ✅ |
| Ilmenita | Pedras escuras soltas e blocos no basalto e no norito, nível 1 | Óxido de titânio + ferro + água (forno, com H₂) | ✅ |
| Ouro | Pedras com pepitas e blocos no fundo (norito), nível 2 | Placa de circuito (bancada) | ✅ |
| Cristal lunar | Bloco e pedra solta, nível 1, meteorito | Broca de cristal (bancada) | ✅ |
| Anortosito | Picos das terras altas | Vidro (forno, 2 → 1); construir | ✅ |

### Lua: fabricados (11)

| Item | Feito em | Com | Entra em |
| --- | --- | --- | --- |
| Barra de ferro | Forno | 2 minério de ferro (ou da ilmenita) | Mapa, Broca de ferro, Eletrolisador |
| Tijolo de regolito (×2) | Forno | 4 regolito | Broca de ferro, Eletrolisador |
| Vidro | Forno | 3 regolito, ou 2 anortosito | Mapa, Eletrolisador |
| Fibra de basalto | Forno | 2 basalto | Broca de cristal |
| Óxido de titânio | Forno | 1 ilmenita + 1 H₂ | Lingote de titânio |
| Cilindro de H₂ (×2) | Eletrolisador | 2 gelo | Redução da ilmenita |
| Cilindro de O₂ | Eletrolisador | sai da água, do titânio e do silício | **Reserva do traje** (conecta sozinho a 15% de ar) |
| Lingote de titânio | Eletrolisador | 1 óxido de titânio | Broca de cristal |
| Silício | Eletrolisador | 4 regolito | Placa de circuito, Painel solar |
| Placa de circuito | Bancada (e 1 do módulo de pouso no começo) | 1 silício + 1 ouro | Mapa |
| Painel solar | Bancada | 2 silício + 1 vidro + 1 barra de ferro | **Colocado no chão**: gera eletricidade para a base ([ENERGIA.md](ENERGIA.md)) |

### Marte (8)

| Item | De onde vem | Hoje | Planejado | |
| --- | --- | --- | --- | --- |
| Poeira marciana | Superfície | Construir, missão | Tijolo marciano | 🔬 |
| Rocha marciana | Subsolo, pedras | Construir | — | 🧱 |
| Areia escura | Dunas | Construir | Vidro escuro | 🔬 |
| Rocha sedimentar | Cânion | Construir | — | 🧱 |
| Basalto vulcânico | Vulcão, nível 1 | Construir | Fibra de basalto | 🔬 |
| Hematita | Rochas e esferas no chão | Missão | Barra de ferro (×2) | 🔬 |
| Olivina | Basalto do vulcão, nível 1 | Missão | Forno refratário | 🔬 |
| Gipsita | Veios do cânion | Missão | Água e gesso | 🔬 |

## Blocos que não são itens próprios

Brecha e norito soltam **rocha lunar**; basalto vítreo solta **basalto**; os blocos de ilmenita e de ouro soltam o
minério. Onde cada um aparece: [MUNDO.md](MUNDO.md).

## Estações (3)

| Estação | Como se obtém | Faz | Vagas | Energia |
| --- | --- | --- | --- | --- |
| Bancada de fabricação | Já vem na base | Equipamentos, máquinas, placa de circuito, painel solar | 1 | eletricidade |
| Forno solar | Bancada: 6 rocha lunar + 3 minério de ferro | Fundir, sinterizar, reduzir | 3 | sol dos espelhos |
| Eletrolisador | Bancada: 4 barras de ferro + 2 vidros + 2 tijolos | Separar água; tirar metal e silício de óxidos | 2 | eletricidade |

## Equipamentos (3 + a broca do traje)

| Equipamento | Receita (bancada) | Faz |
| --- | --- | --- |
| Mapa | placa de circuito + vidro + barra de ferro | Tablet com o mapa da cratera |
| Broca de regolito | já vem no traje | Nível 0 |
| Broca de ferro | 4 barras de ferro + 2 tijolos | Nível 1, 1,7× mais rápida |
| Broca de cristal | 4 cristais + 2 lingotes de titânio + 2 fibras de basalto | Nível 2 (ouro), 2,6× mais rápida |

## Receitas (16)

| Estação | Receitas |
| --- | --- |
| Bancada (7) | Forno solar, Eletrolisador, Mapa, Placa de circuito, Painel solar, Broca de ferro, Broca de cristal |
| Forno solar (6) | Barra de ferro, Tijolo, Vidro (de regolito), Vidro (de anortosito), Fibra de basalto, Redução da ilmenita |
| Eletrolisador (3) | Água → H₂ + O₂, Titânio, Silício |

## O que mudou (2026-11-12)

Antes havia 3 receitas, todas de equipamento e direto do minério; ilmenita e ouro não serviam para nada e o Mapa era
feito de regolito. Agora todo item da Lua entra em alguma receita (o O₂ é a reserva do traje), a química é a real e o
tempo depende do material. Marte ganha fabricação na próxima fase.
