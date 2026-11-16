# ADR 0020: Tela de título leve e carregamento em etapas

- **Status:** aceita
- **Data:** 2026-11-13

## Contexto

O jogo montava tudo antes de mostrar a tela inicial: importava todo o código, carregava os modelos, gerava o mundo e só então liberava
"Começar". A escolha do planeta ficava na própria tela e recarregava a página. O dono pediu uma tela de título de verdade (planeta voxel
no fundo, botões de sempre, configurações) que **não carrega o jogo**, e uma tela de carregamento que faz tudo certinho depois de "Jogar".

## Decisão

- `main.ts` mostra só o título (Three.js, o planeta e as estrelas). O jogo (`app/Game`) e os modelos (`render/gltfModels`) são
  importados com `import()` depois de "Jogar": o build separa um pedaço só do jogo.
- O planeta da sessão (`core/planet.ts`, fixo enquanto a página está aberta) passa a ser fixado nesse momento. A escolha em si fica em
  `core/planetChoice.ts`, sem estado, e as chaves que o título lê em `core/keys.ts`. **Regra:** o título não importa `core/planet.ts`
  nem quem o importa (`data/survival.ts`, `core/save.ts`…). Assim trocar o planeta nas configurações vale sem recarregar.
- `Game.boot(report)` vira assíncrono e em etapas (terreno chunk a chunk, lugar, shaders, ícones, som), com um quadro entre elas para a
  barra andar; o jogo desenha alguns quadros escondido antes de começar. `Game.start()` é chamado pelo carregamento, sem segundo toque.
- O som nasce no toque em "Jogar" (`audio/unlock.ts`) e o `Sfx` usa esse contexto quando o jogo carrega.
- "Novo jogo" no título passa `newGame` ao `Game`, que apaga o salvamento do planeta (ou do modo de teste) antes de ler.

## Consequências

- A tela de título abre rápido e não gasta o celular gerando um mundo que talvez nem seja jogado.
- Trocar de planeta não recarrega a página.
- `window.spacing` só existe depois de "Jogar": os testes no navegador clicam em `#btn-start` e esperam o estado `playing`.
- Voltar do jogo para o título ainda recarrega a página (Novo jogo no menu de pausa, sair do modo de teste).
