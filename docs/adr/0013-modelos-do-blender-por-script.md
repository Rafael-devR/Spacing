# ADR 0013: Modelos 3D gerados por scripts do Blender, carregados como glTF com os materiais do jogo

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

Os modelos eram geometria montada em código Three.js. O dono quer mais qualidade e pediu que o Claude faça os modelos.
O ambiente é um Codespace sem `apt` e sem GPU; o Claude não opera programas com janela.

## Opções

1. **Melhorar a geometria em código:** sem dependências, mas sem chanfros, booleanas, oclusão assada nem prévia; teto baixo.
2. **MagicaVoxel:** só Windows e Mac, e precisa de janela.
3. **Blender no PC do dono:** o Claude não alcança programas na máquina dele; só serviria para revisão manual.
4. **Blender 4.5 sem janela no Codespace, por script Python** (escolhida). Faltam bibliotecas do X11 e do OpenGL que o
   Blender pede ao abrir; versões vazias delas resolvem, porque sem janela ele não as chama. A prévia usa o Cycles na CPU.

## Decisão

- Um script por modelo em `tools/models/`, ajudantes em `lib.py`, `build.sh` gera `src/assets/models/*.glb`. O `.glb` entra
  no repositório (o jogo não depende do Blender para rodar nem para os testes).
- O `.glb` leva **só** geometria, normais, cor por vértice (com a oclusão assada) e vazios com nome. **Sem materiais nem
  texturas:** `render/gltfModels.ts` troca tudo pelo material do jogo (Lambert com o GLSL injetado, sombreamento plano, cor
  por vértice) e um material com brilho próprio para peças `glow*`.
- Os modelos carregam antes do jogo montar a cena (`await loadModels()` em `main.ts`). Se um não carregar, `model()` dá
  null e o código usa o modelo antigo.
- O que muda no jogo (luzes, feixe, animação) fica no código, posicionado pelos vazios do modelo.
- `tests/models.test.ts` lê cada `.glb` e confere o teto de triângulos, a cor por vértice, a falta de materiais e os vazios.

## Consequências

- Mais qualidade sem custo extra no celular: o módulo de pouso passou de ~25 peças para 2 malhas (2.060 triângulos).
- Mudar um modelo pede o Blender montado (README de `tools/models/`), que vive em `/tmp` e pode sumir ao reiniciar.
- `vite.config.ts` trata `.glb` como arquivo (`assetsInclude`); o jogo importa com `?url`, os testes com `?inline`.
- Começar o jogo espera os `.glb` (pequenos: 140 KB o módulo).
