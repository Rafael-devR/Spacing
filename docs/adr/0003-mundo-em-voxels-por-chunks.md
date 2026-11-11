# ADR 0003: Mundo em voxels dividido em chunks

- **Status:** aceita
- **Data:** 2026-11-11

## Contexto

O mundo é feito de blocos, é explorável em todas as direções e o jogador pode minerar e construir. Precisa
rodar em celular, ter oclusão ambiente nos cantos e mostrar minérios como pepitas saindo dos blocos.

## Decisão

- O mundo é uma grade de blocos de 1 byte, dividida em **chunks de 16 × 16 × 48**.
- O terreno é **procedural e determinístico**: dada a semente, o chunk é sempre o mesmo. Só as **edições do
  jogador** (blocos alterados, objetos removidos, objetos criados) são salvas, como diferença por chunk.
- Cada chunk vira **uma malha** com só as faces visíveis, cor e oclusão ambiente **por vértice**, sem
  texturas. Minérios acrescentam pequenas pirâmides facetadas sobre as faces.
- Editar um bloco refaz o chunk dele e os vizinhos de borda, uma vez por lote.
- Pedras, minérios soltos e meteoritos **não são blocos**: são malhas separadas apoiadas no terreno.
- Chunks em torno do jogador são mantidos; os distantes são descartados. O raio depende do zoom.

## Alternativas consideradas

| Opção                         | Por que não                                                              |
| ----------------------------- | ------------------------------------------------------------------------ |
| Malha gulosa (greedy meshing) | Junta faces iguais, mas a variação de cor e a oclusão por vértice quebram o ganho |
| Um objeto 3D por bloco        | Milhares de draw calls; inviável em celular                              |
| Terreno por heightmap suave   | Não permite cavar nem construir com blocos                               |
| Salvar o mundo inteiro        | Cresce sem limite; a semente já reproduz o que não foi tocado            |

## Consequências

- Poucos draw calls e malhas pequenas; editar é barato.
- A altura do mundo é fixa em 48 blocos, e há no máximo 255 tipos de bloco.
- Geração e malha rodam na thread principal e podem engasgar em aparelho fraco. **Próximo passo:** mover
  para um Web Worker (ver [roadmap](../ROADMAP.md), v0.7).
- Mudar o gerador muda o mundo de todos os saves existentes. Qualquer mudança em `terrain.js` precisa de
  um novo número de versão do mundo ou deve ser tratada como quebra de compatibilidade.
