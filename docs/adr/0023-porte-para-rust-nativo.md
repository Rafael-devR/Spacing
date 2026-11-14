# ADR 0023: Porte para Rust nativo (Android primeiro, Windows depois)

Status: **proposto** (plano aprovado pelo dono em conversa; implementação ainda não começou)
Data: 2026-11-14

## Contexto

O jogo é TypeScript + Three.js ([ADR 0001](0001-web-com-threejs.md)) e hoje roda no Android dentro de uma WebView
([ADR 0022](0022-app-android-com-capacitor-e-apk-pelo-github.md)). O dono quer um aplicativo nativo de verdade, com uma pilha
moderna, e a possibilidade de sair para Windows. O protótipo ([NATIVO.md](../design/NATIVO.md)) mediu, no celular do dono, que o
nativo (Rust + Vulkan) ganha de 1,2x a 2x em chamadas de desenho e empata em triângulos. Ou seja: o desempenho melhora onde o
gargalo é a CPU, mas a razão principal da mudança é outra (produto e plataforma).

## Decisão

Portar o jogo para Rust, com `wgpu` (gráficos), `winit` (janela e entrada), `egui` (interface), `gltf` (modelos), `cpal` (som) e
`serde` (salvamento), num workspace Cargo em `native/`. A lógica fica num crate sem gráficos (`spacing-core`) provado igual ao TS
por **vetores dourados**. A versão web fica congelada (só bugs) até o jogo nativo estar completo. Plano e etapas em
[PORTE_RUST.md](../design/PORTE_RUST.md).

## Alternativas

- **Bevy:** muita coisa pronta, mas força refazer a arquitetura, API instável, compilação pesada. Revisitar só se o dono preferir.
- **Otimizar o Three.js** (juntar malhas, instanciar): barato e dá parte do ganho. Continua valendo **em paralelo** como linha de
  base de comparação do M2.
- **Capacitor + WebView (hoje):** funciona, mas é o navegador; não é nativo.
- **Godot/Unity:** outras linguagens; fora do pedido.

## Consequências

- Meses de trabalho; um crate de lógica testável sem tela; UI e render reescritos.
- Salvamentos do navegador não passam sozinhos: exportar/importar na versão web antes de congelar.
- Ferramentas de teste visual mudam (desktop sem janela no lugar de Playwright).
- Parada de avaliação ao fim do M2 (andar na Lua, comparação de FPS no celular do dono) antes de seguir.
