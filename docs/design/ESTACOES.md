# Tela das estações

> Desde 2026-11-13 ([ADR 0019](../adr/0019-inventario-e-estacoes-em-html.md)). Substitui a tela técnica em Canvas (bancada e
> eletrolisador) e a tela do forno em PixiJS. As **regras** de fabricação não mudaram ([CRAFTING.md](CRAFTING.md)).

Pedido do dono: estação e inventário **juntos**, "onde coloca o item" em cima, "onde sai o item" embaixo, inventário ao lado,
visual **minimalista, espacial, simples**. Ele deixou o resto livre.

## Estrutura

Deitado (o jeito principal no celular):

```
┌ ‹  FORNO SOLAR              ☀ SOL 100% ▬▬ ┐ ┌ INVENTÁRIO         ORGANIZAR ┐
│ [▣][▣][▣][▣][▣]  ← receitas (rolam)       │ │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢              │
│                                            │ │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢              │
│  ENTRADA     ┌── câmara ──┐     SAÍDA      │ │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢              │
│  [▣ 2/4] ───▶│  animação  │───▶ [▣ ×1]     │ │ ─────────────────            │
│              └────────────┘                │ │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢  ← barra     │
│  Barra de ferro · 4 s              (i)     │ └──────────────────────────────┘
│  [−] 1× [+] [MÁX]        [ FABRICAR ]      │
│  V1 ▮▮▯ 0:12   V2 livre   V3 livre         │
└────────────────────────────────────────────┘
```

Em pé, a estação fica em cima e o inventário embaixo.

- **Receitas:** uma fileira de quadrados com o ícone do que sai. Ponto verde = dá para fazer agora; ✓ = já tem (equipamento ou
  estação); apagado = falta material. A escolhida tem cantoneiras.
- **Entrada:** um espaço por ingrediente da receita, com "tem/precisa" (vermelho quando falta). É um **alvo de soltar**: arrastar
  um item do inventário para cá (ou tocar duas vezes nele) escolhe a receita desta estação que usa aquele item (a que dá para
  fazer primeiro) e ajusta o lote ao que foi solto. Nada sai do inventário até tocar em **Fabricar**.
- **Câmara:** um quadro pequeno animado entre a entrada e a saída, com um fio tracejado que corre enquanto a estação trabalha
  (mais rápido com mais energia) e a leitura principal:
  - **forno:** cadinho que esquenta com a cor do calor (modelo `ThermalModel`), fagulhas, temperatura em °C;
  - **bancada:** mesa de impressão com dois lasers varrendo e a peça crescendo em camadas;
  - **eletrolisador:** célula com dois eletrodos e bolhas (mais do lado do hidrogênio), corrente em kW.
- **Saída:** mostra o que a receita faz (apagado, como prévia). Quando há algo pronto, acende em verde com o item e a
  quantidade esperando: **tocar ou arrastar para o inventário pega tudo** (equipamento é equipado, estação é instalada).
- **Linha da receita:** nome, tempo estimado (com divisão de energia entre vagas) e **(i)**, que abre a ciência da receita
  (reação, etapas, nota) por cima da câmara.
- **Quantidade e Fabricar:** −, lote, +, Máx (só receitas em lote) e o botão Fabricar, que diz por que não dá (faltam itens, vagas
  cheias, já equipado, trabalhando).
- **Vagas:** uma ficha por vaga (forno 3, eletrolisador 2, bancada 1) com ícone, barra por unidade e tempo. Tocar numa ficha troca
  a linha de controle por **Pegar / Pausar / Cancelar** daquela vaga (cancelar pede confirmação; × volta).
- **Estação não instalada:** a área da máquina mostra que ela ainda não existe e onde fabricar.

## Visual

O mesmo da mochila ([INVENTARIO.md](INVENTARIO.md)): fundo escuro translúcido, fios de 1 px, cantoneiras, letras Chakra Petch
(títulos) e JetBrains Mono (números). Cada estação tem **uma** cor de destaque (`STATIONS[...].accent`): ciano na bancada,
laranja no forno, azul no eletrolisador. Verde só para "pronto/dá para fazer", vermelho só para "falta".

## Energia (console)

A tela do console vira o mesmo estilo, sem inventário: geração (telhado, chão), bateria, consumo por máquina e a frase que explica
o equilíbrio ([ENERGIA.md](ENERGIA.md)).

## Código e testes

- Tela compartilhada: `src/ui/inventory/screen.ts`; estação: `src/ui/station/StationScreen.ts` (mesma interface do antigo
  tela: `show`, `close`, `open`, `onCraft`…), câmara: `src/ui/station/core.ts`, calor: `src/ui/station/thermal.ts`
  (`tests/furnaceModel.test.ts`). Energia: `src/ui/PowerPanel.ts`.
- Os elementos tocáveis têm `data-hit` (`back`, `r:<receita>`, `make`, `minus`, `plus`, `max`, `info`, `take`, `slot:N`, `take-slot`,
  `pause`, `cancel`, `close-job`); `hits` devolve onde estão, para os testes no navegador (`inventory.mjs`, `stations.mjs`,
  `base.mjs`, `drill.mjs`).
