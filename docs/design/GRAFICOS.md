# Gráficos avançados

O jogador escolhe uma **qualidade** no menu de pausa (Automática, Baixa, Média, Alta) e, em **Gráficos avançados…**, pode
trocar cada item por cima dela. O que fica em "Padrão" segue a qualidade. Tudo é guardado nas preferências
(`spacing.prefs.v1`, campo `gfx`) e vale no próximo jogo.

## Os ajustes

| Grupo | Ajuste | Opções | Custo medido no celular (Adreno 710, tela 2,8×) |
| ----- | ------ | ------ | ------ |
| Imagem | Resolução | Padrão, 0,5×, 0,75×, 1×, 1,25×, 1,5×, 2×, Nativa | o mais pesado: o custo cresce com os pixels |
| Imagem | Antisserrilhado (MSAA) | Padrão, Desligado, 2×, 4× | ~5 ms (4×) |
| Imagem | Sombras | Padrão, Sem sombra, Baixa 1024, Média 2048, Alta 4096 | ~4,6 ms (2048) |
| Efeitos | Bloom | Padrão, Ligado, Desligado | ~2,6 ms |
| Efeitos | Aberração de cor, Vinheta, Ruído de filme, Onda de choque | Ligado, Desligado | < 1 ms cada (a onda só custa enquanto há uma) |
| Efeitos | Brilho dos cristais | Ligado, Desligado | ~1,4 ms |
| Desempenho | Limite de FPS | Livre, 30, 60, 90, 120 | iguala o ritmo dos quadros |
| Desempenho | Medidor de desempenho | Ligado, Desligado | nenhum |

- **Resolução nativa** = a densidade real da tela (`devicePixelRatio`), limitada pelo tamanho máximo de textura da placa
  (`Post.construct`). O menu mostra o tamanho do desenho em pixels.
- **Limite de FPS** pula quadros em ritmo fixo (`Game.frame`). Numa tela de 120 Hz, um limite de 60 deixa o movimento
  uniforme quando o aparelho não chega a 120. Fica desligado durante o teste de desempenho.
- Os efeitos de tela (aberração, vinheta, ruído) são `#ifdef` no shader da passada final (`FX_CHROMA`, `FX_VIGNETTE`,
  `FX_NOISE`): desligar tira o custo de verdade. O bloom é `USE_BLOOM`.
- Sombra "sem sombra" desliga o `castShadow` do sol (o Three.js recompila os shaders uma vez, no momento da troca).

## Resolução dinâmica

Com a resolução em automático (sem escolha manual) e fora do teste de desempenho, o jogo baixa a resolução um degrau
(1 → 0,85 → 0,72 → 0,6 da escolhida) quando a **GPU** não acompanha a tela, e sobe de volta quando sobra folga por vários
segundos. Quadro lento por causa da CPU (gerar chunk) não conta. O tamanho mostrado no menu é o real de agora. Escolher uma
resolução no menu desliga a dinâmica. Detalhes e números: [ADR 0012](../adr/0012-chunks-em-worker-e-resolucao-dinamica.md),
`src/render/scaler.ts`.

## Onde está no código

- `src/render/graphics.ts`: tipos, `resolveQuality` (preset + trocas), leitura segura (`parseGfx`), tamanho do desenho.
- `src/render/post.ts`: `QualityPreset` (agora com os três efeitos), `Post.build` e as `defines` da passada final.
- `src/app/Game.ts`: `applyQuality` aplica tudo (preset resolvido, sombra do sol, brilho, limite, contador); `setGfx` salva.
- `src/ui/GraphicsMenu.ts` (tela, gerada de uma tabela) e `src/ui/FpsMeter.ts`; teste `tools/visual-check/gfx.mjs`.
- O teste de desempenho usa o preset já com as trocas (`Game.gfxQ`) e só desliga o que está ligado de verdade.

## Presets

Todas as otimizações de shader e de passadas (sombra só nas faces voltadas para o sol, bloom e tons na passada final)
valem para as três qualidades. **Média e Alta usam MSAA 2×**; a Baixa não usa MSAA.

## Medidor de desempenho e limite de FPS

O **Medidor de desempenho** (menu Gráficos) é um overlay no estilo MSI Afterburner / RTSS, à direita da tela: **FPS**, **tempo do
quadro**, **1% low** (o FPS dos piores 1% dos quadros dos últimos 5 s: é o número que mostra a instabilidade que a média esconde),
**pior quadro**, **CPU** do jogo, **resolução** atual da resolução dinâmica e um **gráfico dos últimos tempos de quadro** (verde no
ritmo, amarelo lento, vermelho travada; a linha branca é o tempo de um quadro no limite). Contas em `src/core/framestats.ts`,
desenho em `src/ui/FpsMeter.ts`. Só trabalha enquanto está visível.

O **limite de FPS** (`src/core/framecap.ts`) anda numa **grade de tempo fixa**: o jeito antigo medido "desde o último quadro"
acumulava desvio e, em tela que não é múltiplo do limite (90 Hz com limite de 60), só entregava 45 FPS. Teste: `tests/framecap.test.ts`.
