// Acumulador de passo fixo: a física roda sempre com o mesmo dt, independente do FPS.

export class FixedStep {
  private acc = 0;

  constructor(
    readonly step: number,
    private readonly maxSteps: number,
  ) {}

  /**
   * Acumula o tempo do quadro e devolve quantos passos simular.
   * Se o atraso passar do limite, descarta o excesso (o jogo desacelera em vez de travar).
   */
  advance(frameDt: number): number {
    this.acc += Math.max(0, frameDt);
    let n = Math.floor(this.acc / this.step);
    if (n > this.maxSteps) {
      n = this.maxSteps;
      this.acc = 0;
    } else {
      this.acc -= n * this.step;
    }
    return n;
  }

  /** fração entre o último passo e o próximo, para interpolar a renderização */
  get alpha(): number {
    return this.acc / this.step;
  }

  reset(): void {
    this.acc = 0;
  }
}
