# Menu de pausa e configurações

> Desde 2026-11-13 ([ADR 0021](../adr/0021-configuracoes-unicas-e-pausa-com-salvar-e-sair.md)). Substitui o menu de pausa antigo, que
> misturava as configurações (gráficos, som, tremor, mira, tela) com os botões.

Pedido do dono: refazer a pausa "já emendando tudo", com **sair, salvar** etc., já com as **configurações novas** (as da tela de
título) e **descartando as velhas**. O visual é o do HUD e do título: letras redondas, cartões escuros arredondados, botão claro para a
ação principal.

## Pausa

```
┌ Pausado ─────────── Missão 01 · Cratera Shackleton ┐
│ ( Continuar )                                       │
│ [Salvar] [Configurações] [Controles] [Teste de desempenho]
│ ─────────────────────────────────────────────────── │
│ [ Sair para o título ]        [ Novo jogo ]         │
│ Salvo às 18:57                      Versão 0.3.0    │
└─────────────────────────────────────────────────────┘
```

- **Continuar** (Esc, ou tocar fora do cartão).
- **Salvar**: grava agora e o botão vira "Salvo ✓" por um instante (ou "Não foi possível salvar"). Pausar já grava sozinho: a linha de
  baixo mostra a hora do último salvamento.
- **Configurações**: abre a tela única abaixo. Esc ou Voltar leva de volta à pausa.
- **Controles**: a ajuda de sempre.
- **Teste de desempenho**: o mesmo de antes ([BENCHMARK.md](BENCHMARK.md)).
- **Sair para o título**: grava e recarrega a página, que abre na tela de título (com "Continuar missão").
- **Novo jogo**: pede um segundo toque (4 s para confirmar) e apaga só o progresso do planeta atual.

## Configurações (uma tela só, no título e na pausa)

`src/ui/settings/SettingsPanel.ts`, o elemento `#settings` do `index.html`. Quem abre diz de onde (`where: 'title' | 'game'`):

| Linha | Título | Jogo |
| --- | --- | --- |
| Planeta (Lua, Marte; provisório até existir a viagem) | sim | não (muda o mundo) |
| Gráficos: Automática, Baixa, Média, Alta | sim | sim |
| Gráficos avançados… ([GRAFICOS.md](GRAFICOS.md)) | não | sim |
| Som, Vibração (se o aparelho vibra) | sim | sim |
| Tremor de tela (Desligado, Baixo, Normal) | sim | sim |
| Mira ao segurar (só no toque) | sim | sim |
| Tela cheia e orientação (se o navegador deixa) | sim | sim |

O painel só desenha e avisa. No título, `TitleScreen` grava as preferências com `core/prefsLite.ts` (o título não pode importar
`core/prefs.ts`, que puxa o salvamento e o planeta); no jogo, `Game` também ajusta o que está rodando (qualidade, som, tremor, mira…).
Mesma chave e mesmo formato (`spacing.prefs.v1`), então o que se muda num vale no outro. A tela é **uma só no HTML**: o título solta
os ouvintes dela (`dispose`) quando o jogo carrega, para o jogo ser o único dono.

## Código e testes

- `src/ui/PauseMenu.ts` (os botões), `src/ui/settings/SettingsPanel.ts`, `src/core/prefsLite.ts`; ligação em `Game`
  (`pauseMenu`, `settings`, `exitToTitle`, `persist()` agora devolve se gravou).
- Esc no jogo: ajuda → gráficos avançados (volta às configurações) → configurações (volta à pausa) → pausa.
- Teste no navegador: `tools/visual-check/pause.mjs` (botões, Salvar grava, configurações valem e ficam guardadas, Sair leva ao título
  com o jogo salvo, Novo jogo pede confirmação, em pé); `gfx.mjs`, `title.mjs` e `mars.mjs` também passam por ela.
