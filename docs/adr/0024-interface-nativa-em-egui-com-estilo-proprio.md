# ADR 0024: Interface do nativo em egui, com estilo próprio (fonte de pixel e ícones flutuantes)

Status: **aceito** (dono, 2026-11-15)
Data: 2026-11-15

## Contexto

O porte para Rust ([ADR 0023](0023-porte-para-rust-nativo.md)) usa egui para as telas. O dono quer refazer todas as telas com
design e estrutura novos, mais simples, com fonte de pixel e ícones flutuantes com brilho. Ele também disse que HTML/CSS é limitado
para o que quer. A referência de direção é Garbage Country (interface mínima, informação presa aos objetos), sem copiar nada dela.

## Decisão

- A interface do nativo continua em **egui**, com um **estilo próprio** em um único módulo (`estilo.rs`): tokens de cor, fio,
  tamanho de texto e fonte.
- A fonte de pixel é carregada no egui como fonte própria, com licença livre e cobertura dos acentos do português.
- Ícones flutuantes são os modelos 3D já existentes, com movimento lento e halo aditivo; sem efeito de varredura ou tremor.
- O HUD antigo (Fredoka, Chakra Petch, JetBrains Mono) fica só na versão web. No nativo, quem manda é
  [INTERFACE_NATIVA.md](../design/INTERFACE_NATIVA.md).

## Alternativas consideradas

- **HTML/CSS numa WebView:** descartado. Vai contra o objetivo do porte (sair da WebView) e o dono achou limitado.
- **Outra biblioteca de interface em Rust:** descartada por enquanto. Mais trabalho e mais risco no Android, sem ganho claro para
  telas simples.

## Consequências

- Cada tela é redesenhada, não portada: o código antigo de `hud.rs` e das telas de estação são substituídos aos poucos.
- Toda tela nova passa por uma captura aprovada pelo dono antes de entrar no jogo (`spacing --telas`, a ser feito).
- A escolha da fonte fica em aberto até o dono olhar as capturas.
