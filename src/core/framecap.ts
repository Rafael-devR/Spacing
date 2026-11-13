// Limite de FPS (docs/design/GRAFICOS.md). Decide, a cada tick do requestAnimationFrame, se o quadro deve ser desenhado.
// O jeito antigo media "o tempo desde o último quadro desenhado" e guardava o instante de agora: qualquer atraso virava
// desvio permanente, e com 30 FPS numa tela de 60 Hz o ritmo alternava entre 2 e 3 batidas da tela (25, 27, 30).
// Aqui o limite anda numa GRADE de tempo fixa: o próximo quadro vale a partir de `próximo += período`, sem desvio. Só se o
// jogo ficar mais de um período atrasado (travada, aba escondida) a grade recomeça dali.
export class FrameCap {
  private next = 0;

  /** `capMs` = tempo de um quadro no limite (1000 / FPS); 0 = sem limite */
  constructor(private capMs = 0) {}

  setCap(capMs: number): void {
    this.capMs = capMs;
    this.next = 0;
  }

  get periodMs(): number {
    return this.capMs;
  }

  /** `now` = o instante que o requestAnimationFrame entrega. true = desenha este quadro. */
  allow(now: number): boolean {
    if (this.capMs <= 0) return true;
    // o instante do tick varia um pouco (±1 ms): aceita um pouco antes da grade, nunca mais de um décimo do período
    const tolerance = Math.min(1.5, this.capMs * 0.1);
    if (now < this.next - tolerance) return false;
    this.next += this.capMs;
    if (this.next <= now) this.next = now + this.capMs; // atrasou um período inteiro ou mais: recomeça a grade
    return true;
  }
}
