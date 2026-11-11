// Partes do HUD da base: botão de ação do lugar, transição da câmara de pressurização e o escuro do descanso.
import { el } from './dom';

export class BaseHud {
  onUse: (() => void) | null = null;
  private readonly use = el<HTMLButtonElement>('#btn-use');
  private readonly useLabel = el('#btn-use .use-label');
  private readonly airlock = el('#airlock');
  private readonly fade = el('#fade');
  private current: string | null = null;

  constructor() {
    this.use.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onUse?.();
    });
  }

  /** Mostra o botão de ação com o texto (null = esconde). */
  setUse(label: string | null): void {
    if (label === this.current) return;
    this.current = label;
    this.use.hidden = !label;
    if (label) this.useLabel.textContent = label;
  }

  /** Portas de bloqueio fechadas (true) ou abertas. */
  airlockClosed(closed: boolean, kicker = '', sub = ''): void {
    if (closed) {
      this.airlock.hidden = false;
      el('#airlock-kicker').textContent = kicker;
      el('#airlock-sub').textContent = sub;
      this.airlock.classList.remove('done');
      // força o layout antes de fechar, para a transição acontecer
      void this.airlock.offsetWidth;
      this.airlock.classList.add('closed');
    } else {
      this.airlock.classList.remove('closed');
      window.setTimeout(() => {
        if (!this.airlock.classList.contains('closed')) this.airlock.hidden = true;
      }, 420);
    }
  }

  /** Leitura da câmara: 0..1. */
  airlockProgress(f: number, sub?: string): void {
    const pct = Math.round(f * 100);
    el('#airlock-value').textContent = `${pct}%`;
    el('#airlock-fill').style.width = `${pct}%`;
    if (sub) el('#airlock-sub').textContent = sub;
    this.airlock.classList.toggle('done', f >= 1);
  }

  /** Tela escura do descanso. */
  setFade(on: boolean, text = ''): void {
    if (on) {
      this.fade.hidden = false;
      el('#fade-text').textContent = text;
      void this.fade.offsetWidth;
      this.fade.classList.add('on');
    } else {
      this.fade.classList.remove('on');
      window.setTimeout(() => {
        if (!this.fade.classList.contains('on')) this.fade.hidden = true;
      }, 650);
    }
  }
}
