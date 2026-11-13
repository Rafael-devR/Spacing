// O navegador só deixa o som começar dentro de um toque do jogador. A tela de título cria o contexto de áudio no toque em "Jogar"
// (primeAudio) e o jogo, que só carrega depois, usa esse mesmo contexto (takePrimedAudio em Sfx.init). Sem dependências: a tela de
// título importa isto sem carregar o jogo.
type AudioCtor = typeof AudioContext;

let primed: AudioContext | null = null;

/** Cria (ou retoma) o contexto de áudio. Chame dentro de um toque. */
export function primeAudio(): void {
  try {
    if (!primed) {
      const AC: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (AC) primed = new AC();
    }
    void primed?.resume();
  } catch {
    primed = null;
  }
}

/** Entrega o contexto preparado (uma vez só). */
export function takePrimedAudio(): AudioContext | null {
  const c = primed;
  primed = null;
  return c;
}
