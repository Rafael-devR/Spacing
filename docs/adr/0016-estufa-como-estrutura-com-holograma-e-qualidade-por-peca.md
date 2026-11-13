# ADR 0016: Estufa como estrutura colocada pelo jogador, com holograma e qualidade por peça

- **Status:** aceita
- **Data:** 2026-11-13

## Contexto

O objetivo de longo prazo é a comida: uma cápsula de vidro, separada da base, onde o jogador vai plantar. O dono quer que ele a
**construa**, manual e intuitivo, sem menus: um holograma mostra onde cada coisa vai e quanto material falta; peça por peça fica em
baixa qualidade; ao terminar, tudo vira alta qualidade; e ele escolhe onde assentá-la no terreno. Esta decisão cobre só a **primeira
parte** (obter e construir a cápsula). Plantio e fome vêm depois.

## Opções

1. **Blocos de verdade (voxels) para a cápsula.** Reusa o terreno e a mineração, mas vidro curvo, porta e três qualidades por peça não
   cabem no sistema de blocos, e o jogador poderia minerar a cápsula.
2. **Modelo do Blender carregado como o da base.** Boa arte, mas as três aparências por peça e a variação (terreno, posição) exigiriam
   muitos arquivos; o holograma ficaria separado do modelo.
3. **`Structure` para a colisão (como a base) mais geometria simples por código, com três aparências por peça** (escolhida).

## Decisão

- A cápsula é uma `Structure` (`world/Structure.ts`, a mesma da base): sólida e não minerável. O chão nivelado é sólido desde o início;
  cada peça entregue fecha as células dela.
- O desenho é gerado por código (`render/greenhouseModel.ts`): cada peça tem holograma, baixa e alta qualidade, e a visibilidade vem do
  estado salvo. Nada de arquivo novo do Blender por enquanto: a arte pode ser trocada depois sem mudar as regras.
- O projeto é um item (`greenhouse_plan`, campo `site`) que abre um **holograma de colocação** no modo construir; o botão de ação
  existente (`BaseDirector`) serve a obra, sem tela nova. A etiqueta com o que falta fica **no mundo**, ao lado da cápsula.
- A colocação **nivela o terreno** (edições de blocos salvas) em vez de exigir chão plano; a tolerância é 1 bloco.
- Regras e números ficam em `systems/Greenhouse.ts` e `data/greenhouse.ts`, testáveis sem navegador.
- O baú vira o móvel `crates` da base. A história decide depois de onde o kit vem.

## Consequências

- A cápsula existe e dá para andar dentro dela; o plantio entra sobre essa base (canteiros serão objetos ou células dentro da estrutura).
- O salvamento sobe para a v11. Mundo refeito devolve o projeto e o material.
- Só uma obra, virada para o sul, 7×7: rotação, vários tamanhos e desmontar ficam para uma próxima parte.
- O vidro e o holograma pesam pouco (poucas malhas), mas é transparência: conferir o desempenho no celular.
