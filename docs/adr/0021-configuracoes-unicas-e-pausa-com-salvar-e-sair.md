# ADR 0021: Configurações únicas e pausa com Salvar e Sair

- **Status:** aceita
- **Data:** 2026-11-13

## Contexto

As configurações existiam em dois lugares com códigos diferentes: o menu de pausa (gráficos, som, tremor, mira, tela cheia,
orientação, vibração) e a tela de título (planeta, gráficos, som, vibração, tela cheia). A pausa não tinha Salvar nem Sair. O dono pediu
a pausa refeita, com sair e salvar, usando as configurações novas e descartando as velhas.

## Decisão

- Uma **tela de configurações só** (`ui/settings/SettingsPanel.ts`, `#settings`), usada no título e na pausa. Ela só desenha e avisa;
  cada dono grava do seu jeito (o título sem o jogo carregado, por `core/prefsLite.ts`; o jogo também ajusta o que roda).
- A tela é um único elemento no HTML. Quem a larga solta os ouvintes (`dispose`), senão os dois donos reagiriam ao mesmo toque e
  desfariam um ao outro (aconteceu: o som ligava e desligava na mesma batida).
- A pausa vira só botões: Continuar, Salvar, Configurações, Controles, Teste de desempenho, Sair para o título, Novo jogo.
- **Sair para o título** grava e recarrega a página (o título é a primeira tela). Simples e sem estado velho na memória.
- `Game.persist()` devolve se gravou, para o botão Salvar dizer a verdade.

## Consequências

- Uma mudança nas configurações (linha nova, por exemplo) é feita num lugar só.
- O título continua sem importar `core/prefs.ts` nem o planeta da sessão (ADR 0020); o formato guardado é o mesmo.
- Sair recarrega a página: leva o tempo de abrir o título de novo, e a tela cheia do navegador se perde.
