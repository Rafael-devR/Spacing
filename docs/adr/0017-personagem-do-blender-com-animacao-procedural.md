# ADR 0017: Personagem do Blender com animação procedural

- **Status:** aceita
- **Data:** 2026-11-13

## Contexto

O astronauta era feito em código (caixas em `render/models.ts`) com uma animação simples: pernas e braços balançando, um
achatamento no pouso e a queda de costas na morte. O dono pediu um personagem **bonito e fofinho**, modelado no Blender, com
**várias animações bem trabalhadas** (correr, cair, pousar...) e segurando na mão o item escolhido. Ele mandou imagens de referência
(`docs/art/reference/personagem/`) e, ao ver as prévias, pediu: "mais fofinho, mais cartoon", braços mais naturais e, por fim,
"mais voxel".

## Opções

1. **Animações feitas no Blender** (esqueleto com pesos e clipes exportados no glTF, tocados por `AnimationMixer`). Clipes fixos
   precisam de mistura entre eles e de muitos clipes para cobrir velocidades, curvas, quedas de alturas diferentes; cada ajuste exige
   reexportar; malha com pesos (skinning) custa mais no celular.
2. **Modelo do Blender em peças rígidas, uma por articulação, animado por código** (escolhida).

## Decisão

- O `astronaut.py` gera um nó vazio por articulação com o pivô na junta; as malhas daquela parte ficam penduradas nele. Sem pesos:
  peças rígidas, como um boneco de blocos (combina com o estilo voxel e é barato).
- `render/astronaut.ts` transforma esses nós num esqueleto (quadril → tronco → cabeça, braços; quadril → pernas) sem mudar onde as
  peças estão, troca os materiais (o traje tem material próprio para piscar no dano) e cuida da broca (luva ou cinto) e do item na mão.
- `render/astronautAnim.ts` calcula a pose a cada quadro a partir do estado do jogador (velocidade, chão, velocidade vertical, curva,
  minerar, item, morte), por **pesos suavizados** entre camadas: parado, andar/correr, no ar (subir/cair), pouso (mola), inclinação
  na curva, segurar item, minerar, gestos (pôr bloco, comer, dor, pegar) e morte. Não usa Three.js: é testado em Node.
- Se o `.glb` não carregar, o modelo antigo em código assume, com as juntas que ele tem.

## Consequências

- Animação ajustável em números (`ANIM` e as funções de cada camada), sem reexportar o modelo, e sempre contínua (nada de corte entre
  clipes); a passada acompanha a distância andada, então o pé não escorrega.
- Juntas rígidas mostram a emenda ao dobrar; os blocos de cada membro entram um pouco no de cima para esconder isso.
- Animações novas são código: uma camada nova em `astronautAnim.ts` e, se tiver gatilho, um `Gesture`.
