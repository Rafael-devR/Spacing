// Resolução dinâmica (docs/adr/0012-chunks-em-worker-e-resolucao-dinamica.md): quando o desenho não acompanha a tela por
// causa da GPU, baixa a resolução um degrau; quando sobra folga por bastante tempo, tenta subir de novo. Puro (sem WebGL).
//
// Só mexe quando o atraso é da GPU: um quadro lento em que o jogo gastou quase todo o tempo em CPU (gerar chunk, por
// exemplo) não melhora com menos pixels, então não conta.

/** degraus da escala (multiplicam a resolução escolhida pelo jogador) */
export const SCALE_STEPS: readonly number[] = [1, 0.85, 0.72, 0.6];

export const SCALER = {
  /** quadros por janela de decisão */
  window: 90,
  /** quadro lento: mais que isto vezes o tempo de um quadro */
  slowFactor: 1.5,
  /** baixa um degrau se esta fração da janela foi lenta por causa da GPU (o teste do dono: 13% dos quadros lentos já se sente) */
  downAt: 0.1,
  /** quadro lento é "da GPU" se a CPU gastou menos que esta fração dele */
  gpuShare: 0.7,
  /** sobe um degrau depois de tantas janelas seguidas sem nenhum quadro lento */
  upAfter: 5,
  /** quadros com mais que isto (ms) são pausa ou aba escondida: não contam */
  ignoreOver: 250,
};

export class ResolutionScaler {
  /** índice em SCALE_STEPS */
  private step = 0;
  private frames = 0;
  private slowGpu = 0;
  private slowAny = 0;
  private calm = 0;
  /** janelas a esperar antes de tentar subir (dobra cada vez que a subida deu errado) */
  private hold = SCALER.upAfter;
  private sinceUp = 99;

  get scale(): number {
    return SCALE_STEPS[this.step];
  }

  /** volta ao máximo (mudou a qualidade, o tamanho da tela ou o jogador escolheu a resolução) */
  reset(): void {
    this.step = 0;
    this.frames = this.slowGpu = this.slowAny = this.calm = 0;
    this.hold = SCALER.upAfter;
    this.sinceUp = 99;
  }

  /**
   * Um quadro: `periodMs` desde o quadro anterior, `cpuMs` gasto pelo jogo nele, `budgetMs` o tempo de um quadro na taxa
   * alvo (16,7 para 60). Devolve a escala nova se mudou, senão null.
   */
  frame(periodMs: number, cpuMs: number, budgetMs: number): number | null {
    if (periodMs > SCALER.ignoreOver || periodMs <= 0) return null;
    this.frames++;
    if (periodMs > budgetMs * SCALER.slowFactor) {
      this.slowAny++;
      if (cpuMs < periodMs * SCALER.gpuShare) this.slowGpu++;
    }
    if (this.frames < SCALER.window) return null;

    const gpuFraction = this.slowGpu / this.frames;
    const calm = this.slowAny === 0;
    this.frames = this.slowGpu = this.slowAny = 0;
    this.sinceUp++;

    if (gpuFraction >= SCALER.downAt && this.step < SCALE_STEPS.length - 1) {
      // descer logo depois de subir: a subida foi cedo demais; espera o dobro da próxima vez
      if (this.sinceUp <= 2) this.hold = Math.min(this.hold * 2, 80);
      this.step++;
      this.calm = 0;
      return this.scale;
    }
    this.calm = calm ? this.calm + 1 : 0;
    if (this.calm >= this.hold && this.step > 0) {
      this.step--;
      this.calm = 0;
      this.sinceUp = 0;
      return this.scale;
    }
    return null;
  }
}
