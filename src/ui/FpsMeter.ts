// Contador de FPS no canto da tela (ajuste "Mostrar FPS"): média de meio segundo, só atualiza o texto quando está visível.
import { maybeEl } from './dom';

export class FpsMeter {
  private visible = false;
  private frames = 0;
  private since = 0;
  private readonly box = maybeEl('#fps-meter');

  setVisible(on: boolean): void {
    this.visible = on;
    if (this.box) this.box.hidden = !on;
    this.frames = 0;
    this.since = 0;
  }

  /** chamar uma vez por quadro desenhado */
  frame(now: number): void {
    if (!this.visible || !this.box) return;
    if (!this.since) this.since = now;
    this.frames++;
    const dt = now - this.since;
    if (dt < 500) return;
    this.box.textContent = `${Math.round((this.frames * 1000) / dt)} FPS`;
    this.frames = 0;
    this.since = now;
  }
}
