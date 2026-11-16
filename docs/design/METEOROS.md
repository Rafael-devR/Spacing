# Meteoros

O meteoro é o maior espetáculo do jogo: avisa, cruza a tela em chamas, bate com uma onda de choque que entorta a imagem,
joga blocos incandescentes e deixa cratera, fumaça e brasa. Esta página explica como ele é montado e onde afinar cada parte.
**Todos os números ficam em `src/data/meteors.ts`**; o código só os lê.

## O que acontece, em ordem

| Tempo | O que se vê e sente | Onde está |
| --- | --- | --- |
| −1,6 s | **Aviso**: mira de dois anéis no chão que pulsa, gira e encolhe | `meteorFx.warn` |
| 0 a 1,7 s | **Voo**: rocha escura com manchas de brasa girando; brilho em volta; rastro de chamas que escurece até virar fumaça e fica no céu; o ar treme em volta dele; o assobio acompanha | `meteorFx.fly`, `shockwave.haze` |
| 0 | **Clarão** branco-quente; tela vai ao branco e volta; **pausa de impacto** de 0,07 s | `meteorFx.impact`, `MeteorDirector` |
| 0 a 0,9 s | **Onda de choque**: um círculo que cresce, entortando a luz e o chão atrás dele, com borda clara e cores se separando | `shockwave.ts`, passada final |
| 0 a 1 s | **Bola de fogo** (laranja que escurece) com núcleo quente; **anel de poeira** rente ao chão; **bolha** da onda (a borda de uma esfera) | `meteorFx.impact` |
| 0 a 10 s | **Blocos** da cratera saem em brasa, soltam fumaça no voo, **quebram em pedaços** ao bater e esfriam até a cor da rocha | `Meteors.eject`, `Debris` |
| 0 a 6 s | **Coluna de fumaça** que sobe e **brasa** no fundo da cratera | `meteorFx.impact` |
| 0 a 0,55 s | **Câmera lenta** (só a menos de 16 blocos) e **soco de zoom**; tremor e vibração | `MeteorDirector`, `IsoRig.punch` |

Nada disso muda a regra do jogo: aviso, tempo de voo, cratera, dano e distância mínima da base são os de sempre.

## Como o meteoro vem

Para ser visto, ele **entra de lado** em relação à câmera (para a direita ou para a esquerda da tela), inclinado a uns 48°. Quase
vertical, ele passaria o voo todo fora da tela, porque a câmera olha de cima. O ponto de queda dos meteoros sorteados também
**prefere o que cabe na tela** (`pickMin`, `pickMax`, `viewDepth`, `viewSide`): a vista do celular em paisagem mostra só uns 10 blocos
de profundidade. Dentro da base não caem meteoros novos e o impacto é só um tremor grave pelo casco.

## Peças e arquivos

- `src/data/meteors.ts`: os números (voo, aviso, impacto, onda, câmera).
- `src/entities/Meteors.ts`: quando e onde cai, a cratera, os objetos atingidos, os blocos ejetados, o meteorito.
- `src/render/meteorFx.ts`: tudo o que se desenha do meteoro (rocha, brilho, rastro, aviso, impacto).
- `src/render/puffs.ts`: **baforadas**, sprites macios para fogo (aditivo) e fumaça (mistura normal), em dois desenhos de instâncias.
- `src/render/shockwave.ts` + passada final (`render/post.ts`, `FX_SHOCK`): a **distorção** ([ADR 0014](../adr/0014-onda-de-choque-na-passada-final.md)).
- `src/app/MeteorDirector.ts`: som, tremor, soco de zoom, pausa, câmera lenta, clarão de tela e as ondas.
- `src/entities/Debris.ts`: brasa que esfria, fumaça no voo, quebra em pedaços.
- `tools/models/meteor.py` → `src/assets/models/meteor.glb`: três rochas (`rock_a`, `rock_b`, `rock_c`) com manchas `lit_*`.

## Vocabulário

| Termo | O que é |
| --- | --- |
| **Onda de choque** (*shockwave*) | o anel que se expande a partir da explosão |
| **Distorção / refração** | a imagem de trás do anel é empurrada, como a luz dobrando perto de um buraco negro |
| **Aberração cromática** | as cores vermelha e azul se separam um pouco na borda |
| **Pausa de impacto** (*hit stop*) | o jogo para por um instante no choque, para dar peso |
| **Câmera lenta** (*slow motion*) | o tempo corre devagar por meio segundo |
| **Soco de zoom** (*camera punch*) | a câmera chega perto de uma vez e volta |
| **Tremor** (*screen shake*) | a câmera balança |
| **Clarão** (*flash*) | a tela vai ao branco e volta |
| **Bola de fogo**, **núcleo quente** | o corpo laranja e o miolo quase branco da explosão |
| **Ejeta** (*ejecta*) | o material arremessado da cratera (os blocos) |
| **Baforada** (*puff*) | um sprite macio de fogo ou fumaça |
| **Bloom** | brilho em volta do que é muito claro |

## Afinar

Quer mais ou menos distorção? `SHOCK.strength` (força) e `SHOCK.chroma` (separação de cores). Onda maior? `SHOCK.radius`.
Mais pedaços voando? `IMPACT_FX.blocks` e `gravel`. Câmera lenta mais longa? `IMPACT_CAMERA.slowMo`. No menu **Gráficos**, o item
**Onda de choque** liga e desliga a distorção (a bolha, o fogo e a poeira continuam).

## Testes

- `tests/shockwave.test.ts` (da onda no mundo ao anel na tela), `tests/puffs.test.ts`, `tests/rig.test.ts` (soco de zoom),
  `tests/debris.test.ts` (brasa, fumaça, quebra), `tests/models.test.ts` (rochas).
- `tools/visual-check/meteors.mjs`: lança um meteoro, congela o jogo em momentos-chave, tira capturas e confere por dentro (ondas,
  baforadas, destroços, nada sobrando na cena).
- No celular: o aviso, o voo cruzando a tela, a distorção da onda, o peso do impacto, a fluidez com vários meteoros.
