// Tela de carregamento (docs/design/TITULO.md): entre "Jogar" e o primeiro quadro do jogo. Cada etapa tem um peso (quanto da barra
// ela ocupa, mais ou menos o tempo que leva num celular) e um nome; a barra só anda para a frente. Embaixo, uma dica do jogo.
import type { PlanetDef } from '../../data/planets';
import { t, type MessageKey } from '../../i18n';
import { el } from '../dom';

export type LoadStep = 'code' | 'models' | 'world' | 'terrain' | 'place' | 'shaders' | 'icons' | 'audio' | 'frames';

const STEPS: { id: LoadStep; w: number }[] = [
  { id: 'code', w: 10 }, { id: 'models', w: 14 }, { id: 'world', w: 8 }, { id: 'terrain', w: 34 }, { id: 'place', w: 4 },
  { id: 'shaders', w: 12 }, { id: 'icons', w: 10 }, { id: 'audio', w: 3 }, { id: 'frames', w: 5 },
];
const TOTAL = STEPS.reduce((s, x) => s + x.w, 0);
const TIPS: MessageKey[] = ['load.tip.0', 'load.tip.1', 'load.tip.2', 'load.tip.3', 'load.tip.4', 'load.tip.5'];

export class LoadingScreen {
  private readonly root = el('#boot');
  private readonly bar = el('#boot-bar');
  private readonly pct = el('#boot-pct');
  private readonly label = el('#boot-step');
  private shown = 0;
  /** quando começou (para medir) e quanto cada etapa levou, em ms */
  readonly times: Partial<Record<LoadStep, number>> = {};
  private stepT = 0;
  private step: LoadStep | null = null;

  show(planet: PlanetDef): void {
    el('#boot-planet').textContent = planet.name;
    el('#boot-region').textContent = planet.region;
    el('#boot-tip').textContent = t(TIPS[Math.floor(Math.random() * TIPS.length)]);
    this.root.hidden = false;
    this.root.classList.remove('done');
    this.set('code', 0);
  }

  /** etapa `id` com `f` (0..1) feito */
  set(id: LoadStep, f: number): void {
    const now = performance.now();
    if (this.step !== id) {
      if (this.step) this.times[this.step] = Math.round(now - this.stepT);
      this.step = id;
      this.stepT = now;
      this.label.textContent = t(`load.step.${id}`);
    }
    let done = 0;
    for (const s of STEPS) {
      if (s.id === id) {
        done += s.w * Math.max(0, Math.min(1, f));
        break;
      }
      done += s.w;
    }
    const v = Math.max(this.shown, done / TOTAL);
    this.shown = v;
    this.bar.style.transform = `scaleX(${v.toFixed(4)})`;
    this.pct.textContent = `${Math.round(v * 100)}%`;
  }

  /** mostra um erro no lugar da etapa */
  fail(message: string): void {
    this.label.textContent = t('boot.error', { message });
    this.root.classList.add('failed');
  }

  /** termina: some com uma transição curta */
  hide(): void {
    if (this.step) this.times[this.step] = Math.round(performance.now() - this.stepT);
    this.set('frames', 1);
    this.root.classList.add('done');
    setTimeout(() => (this.root.hidden = true), 600);
  }
}
