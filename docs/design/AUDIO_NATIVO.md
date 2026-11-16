# Áudio nativo (M6)

Porte do áudio do jogo web (`src/audio/Sfx.ts`, branch `web`) para Rust. **A ideia, os sons e as distâncias são os
mesmos** do [AUDIO.md](AUDIO.md) (na Lua não há ar: o traje reconstrói a vibração do chão dentro do capacete; perto soa
limpo, longe soa grave e com eco). Este arquivo diz só **como** ficou no nativo e no que difere do WebAudio.

## Peças

| Peça | Onde | O que faz |
| ---- | ---- | --------- |
| `spacing-audio` | `native/spacing-audio/` | Caixa nova, sem gráficos e sem o jogo. Roda sozinha nos testes. |
| `spatial.rs` | idem | Porte de `spatial.ts`: volume, corte do filtro, eco e lado pela distância e pela câmera. |
| `sounds.rs` | idem | A "receita" de cada som (`SoundName`): camadas de tom e de ruído com envelope, igual ao `play()` do TS. |
| `dsp.rs` | idem | Filtro biquad (as mesmas contas do WebAudio), ruído, osciladores sem serrilhado, eco da cratera. |
| `mixer.rs` | idem | A mesa de som: soma as vozes, posiciona, aplica eco, abafamento e volume. Não sabe de placa de som. |
| `device.rs` | idem | Abre a saída com **cpal** (AAudio no Android, WASAPI no Windows) e entrega os blocos do mixer. |
| `Sfx` e `Renderer` (lib.rs) | idem | O **controle** que o jogo usa (barato de copiar; sem placa de som vira mudo) e o lado da thread de áudio. |
| `sons.rs` | `spacing-app` | O mapa **evento do jogo → som**, num lugar só (não espalha chamadas pelo `game.rs`). |

O jogo (`spacing-app`) só conhece o `Sfx`: `sfx.play(Sound::Hit, 1.0, Some(ponto))`.

## Como o som chega à placa

```
jogo (thread principal)           fila de comandos            thread de áudio (cpal)
sfx.play / set_listener  ───►  Mutex<Vec<Comando>>  ───►  Mixer::render(bloco)  ───►  placa
```

- O jogo **monta a receita** (alocação, sorteios) e manda pronta; a thread de áudio só toca. A fila é trocada por uma
  vazia a cada bloco (`try_lock`: se o jogo estiver escrevendo, fica para o próximo bloco, sem travar o som).
- Cada som do mundo vira um **emissor**: filtro passa-baixa (pela distância) → volume (pela distância) → posição
  (`equalpower`, como o `PannerNode`) → saída + envio para o eco. Sons do capacete não têm emissor: vão direto ao centro.
- Parâmetros mudam com suavização de ~40 ms (igual ao `setTargetAtTime`), sem estalo.
- O ouvinte é o mesmo do TS: um pouco atrás do astronauta, olhando para onde a câmera olha; a distância é medida até o
  astronauta.
- Máximo de vozes (32 emissores, 64 camadas soltas): passando disso, o som novo é ignorado, não o antigo.

## Diferenças do WebAudio (de propósito)

| WebAudio | Nativo | Por quê |
| -------- | ------ | ------- |
| `ConvolverNode` com resposta de 2,4 s | Eco por **linhas de atraso** (4 pentes + 2 passa-tudo por canal) | Convolução de 2,4 s custa ~230 mil contas por amostra; as linhas de atraso custam ~20. O som é o mesmo tipo de cauda difusa. O volume é calibrado para dar a mesma energia que o `normalize` do ConvolverNode. |
| Osciladores de tabela | Onda quadrada e dente de serra com **polyBLEP** | Mesma forma, sem serrilhado. |
| `setTimeout` para notas em sequência | Cada camada tem um **atraso** em amostras | O relógio do áudio é o da placa, não o do jogo (o jogo trava e o som não). |
| Navegador exige toque para começar o som | Não há essa regra no Android/Windows | O som abre junto com o app. |

## O que o jogo liga (e onde)

Igual ao jogo web (`Game.wireEvents`, `SurvivalDirector`, `MeteorDirector`, `MarsDirector`, `BaseDirector`):
passos, pulo e pouso; golpe, bloco quebrado e colocado; coleta (sobe de tom em sequência); recusas; alarmes e bipes do
traje, respiração, batimento e carga; dano, morte (abafa) e renascer; meteoro (assobio que acompanha o meteoro e
estrondo), Marte (vento, rajada, ronco, chiado da lava); módulo de pouso (zumbido em laço); dentro da base (ventilação,
eco curto); portas, câmara de pressão, descanso, bancada, tablet; interface (barra de itens, modo construir).
Pausa **congela** o áudio; ir para o fundo (Android) também.

## Configurações

- **Som** (`prefs.json`, já existia): liga e desliga tudo (volume vai a zero em 50 ms).
- **Vibração** (`spacing-app/src/vibracao.rs`): os mesmos seis padrões do jogo web (`haptics.ts`: tick 6 ms, tap 12 ms, medium 28 ms,
  heavy 60-30-90, success 20-40-20, death 120-60-200-80-300). Dispara junto com o som, no mesmo lugar (`Sons::sentir`). No Android chama
  `Vibrator.vibrate(VibrationEffect.createWaveform)` por JNI (crate `jni`, contexto do `ndk_context`), numa thread própria para não
  atrasar o quadro; precisa da permissão `VIBRATE` (no manifesto). Pedidos juntos viram só o último. No computador não faz nada. A
  escolha **Vibração** vale na hora (`Vibra::ativa`).

## Testes

- `cargo test -p spacing-audio`: contas posicionais (as mesmas do `spatial.test.ts`), filtro, envelopes, e o **mixer
  inteiro sem placa de som**: toca um som à direita e à esquerda e confere o volume de cada canal; longe é mais baixo;
  o zumbido do módulo some de longe; pausa congela; nada passa de ±1; sem `NaN`.
- `spacing --som <pasta>`: grava um `.wav` de cada som (perto, longe, direita, esquerda, dentro da base) para ouvir no
  computador e imprime o volume de cada um.
- `spacing --roteiro`: 12 etapas de som e 4 de vibração (65 no total): andar, pular, minerar, missão, meteoro, tablet, morte, mochila, forno… O `Sfx` de teste registra o que o jogo pediu.
- No título e no carregamento **só se ouvem os cliques**: o fundo (cratera, ventilação, vento) liga junto com o jogo (`set_world`).
- **No celular** (só o dono confere): se os sons estão no ponto, se o zumbido do módulo incomoda, se há estalos ou
  atraso entre o gesto e o som.

## Em aberto

Os mesmos do [AUDIO.md](AUDIO.md) (HRTF, som do domo, trilha) e: latência no celular (hoje o
tamanho do buffer é o padrão da placa; se houver atraso, pedir buffer mínimo), pausa automática do som ao receber
uma ligação (foco de áudio do Android).
