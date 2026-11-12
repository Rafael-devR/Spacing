# Modelos (Blender)

Scripts que geram os modelos 3D do jogo em `src/assets/models/*.glb` ([docs/design/MODELOS.md](../../docs/design/MODELOS.md),
[ADR 0013](../../docs/adr/0013-modelos-do-blender-por-script.md)).

## Uso

```bash
tools/models/build.sh            # todos os modelos
tools/models/build.sh lander     # um só
PREVIEW=/tmp/prev tools/models/build.sh lander   # também salva /tmp/prev/lander.png (e uma de perto, se o script fizer)
```

Imprime os triângulos de cada modelo. Depois rode `npm test` (o teste confere o orçamento e os pontos marcados) e olhe o
jogo com o `tools/visual-check`.

## Montar o Blender (Codespace, sem apt e sem GPU)

```bash
mkdir -p /tmp/blender && cd /tmp/blender
curl -O https://download.blender.org/release/Blender4.5/blender-4.5.16-linux-x64.tar.xz
tar xf blender-4.5.16-linux-x64.tar.xz
```

Mesmo sem janela, o Blender pede seis bibliotecas do X11 e do OpenGL que o Codespace não tem (`libXfixes`, `libXi`,
`libxkbcommon`, `libSM`, `libICE`, `libGL`). O `build.sh` cria versões vazias delas em `/tmp/blender/stubs` na primeira vez
(precisa do `gcc`); sem janela o Blender nunca as chama. Por isso a prévia usa o Cycles na CPU: o Eevee e o Workbench
precisam de GPU. Outro lugar para o Blender: `BLENDER=/caminho/blender tools/models/build.sh`.

## Escrever um modelo novo

1. Copie a estrutura de `lander.py`: monte as peças com `lib.cyl`, `lib.cube`, `lib.rod`; pinte com `lib.paint` (hex, com
   variação por face); chanfre com `lib.bevel`; junte com `lib.join`; asse a oclusão com `lib.bake_ao`; exporte.
2. Pontos que o código usa: `lib.empty('nome', posição)`. Peças que brilham: nome começando por `glow`.
3. Ponha o orçamento e os pontos em `tests/models.test.ts` e o carregamento em `src/render/gltfModels.ts`.
4. Modelos que encaixam num lugar do jogo (base, móveis, estações) usam as coordenadas do jogo: `lib.G`, `lib.gbox`,
   `lib.gcyl`, `lib.grod`, `lib.gempty` (x, y para cima, z para o sul). Medidas da base em `lib.HAB`.
5. Animação: objetos separados com quadros-chave lineares (`lib.timeline(quadros)`, `lib.keys(obj, 'location' |
   'rotation_euler', [(quadro, valor), ...])`, o primeiro igual ao último para fechar o laço) e `lib.export(out, anim=True)`.
   O jogo toca o laço enquanto a máquina trabalha. Pivô de uma peça que gira: `lib.set_origin`; peça presa a outra que
   se mexe: `lib.parent`.
