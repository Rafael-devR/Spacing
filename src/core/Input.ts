// Controles: teclado + mouse no computador; joystick, botões e toques no celular.
import type { MoveInput } from '../entities/Player';

export interface PointerState {
  x: number;
  y: number;
  /** o ponteiro está sobre o mundo (mouse) ou tocando nele (toque) */
  inside: boolean;
  down: boolean;
  button: number;
  type: string;
  startT: number;
  /** distância percorrida desde o toque, em pixels */
  moved: number;
  /** ponto de mira: igual a x, y no mouse; no toque fica acima do dedo (ver Input.aimOffset) */
  aimX: number;
  aimY: number;
}

export class Input implements MoveInput {
  moveX = 0;
  moveY = 0;
  jump = false;
  readonly touch: boolean;
  readonly pointer: PointerState = {
    x: 0, y: 0, inside: false, down: false, button: 0, type: 'mouse', startT: 0, moved: 0, aimX: 0, aimY: 0,
  };
  /** no toque, quantos pixels acima do dedo fica a mira (0 = embaixo do dedo) */
  aimOffset = 0;

  onTap: ((x: number, y: number, button: number) => void) | null = null;
  onRotate: ((dir: number) => void) | null = null;
  onZoom: ((factor: number) => void) | null = null;
  onHotbar: ((index: number) => void) | null = null;
  onBuildToggle: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onBag: (() => void) | null = null;
  /** botão de ação do lugar (porta, bancada, beliche) */
  onUse: (() => void) | null = null;

  private readonly keys = new Set<string>();
  private readonly joy: { x: number; y: number; id: number | null } = { x: 0, y: 0, id: null };
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private knob: HTMLElement | null = null;
  private joyBase: HTMLElement | null = null;

  constructor(canvas: HTMLElement, joystick: { base: HTMLElement | null; knob: HTMLElement | null }) {
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') {
        this.onPause?.();
        return;
      }
      this.keys.add(k);
      if (k === ' ') {
        this.jump = true;
        e.preventDefault();
      }
      if (k === 'q') this.onRotate?.(-1);
      if (k === 'e') this.onRotate?.(1);
      if (k === 'b') this.onBuildToggle?.();
      if (k === 'f' || k === 'enter') this.onUse?.();
      if (k === 'i' || k === 'tab') {
        e.preventDefault();
        this.onBag?.();
      }
      if (/^[1-8]$/.test(k)) this.onHotbar?.(Number(k) - 1);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.reset());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.onZoom?.(e.deltaY > 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );

    canvas.addEventListener('pointerdown', (e) => {
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        // ponteiro sintético (testes) ou já solto
      }
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.pointer.down = false;
        this.pinch = this.pinchDist();
        return;
      }
      if (this.touches.size > 2) return;
      if (e.pointerType === 'mouse' && e.button === 2) {
        this.onTap?.(e.clientX, e.clientY, 2);
        return;
      }
      Object.assign(this.pointer, {
        x: e.clientX, y: e.clientY, inside: true, down: true, button: e.button,
        type: e.pointerType, startT: performance.now(), moved: 0,
      });
      this.aim();
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (t) {
        t.x = e.clientX;
        t.y = e.clientY;
      }
      if (this.touches.size === 2) {
        const d = this.pinchDist();
        if (this.pinch > 0 && d > 0) this.onZoom?.(this.pinch / d);
        this.pinch = d;
        return;
      }
      const p = this.pointer;
      p.moved += Math.hypot(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX;
      p.y = e.clientY;
      p.inside = true;
      p.type = e.pointerType;
      this.aim();
    });
    const end = (e: PointerEvent): void => {
      const had = this.touches.delete(e.pointerId);
      const p = this.pointer;
      if (this.touches.size === 0 && had && p.down) {
        const quick = performance.now() - p.startT < 260 && p.moved < 12;
        if (quick) this.onTap?.(p.x, p.y, p.button);
      }
      if (this.touches.size < 2) this.pinch = 0;
      p.down = false;
      if (e.pointerType !== 'mouse') p.inside = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.pointer.inside = false;
    });

    this.setupJoystick(joystick.base, joystick.knob);
  }

  /** mira deslocada: o dedo não cobre o bloco que está sendo minerado */
  private aim(): void {
    const p = this.pointer;
    const off = p.type === 'mouse' ? 0 : this.aimOffset;
    p.aimX = p.x;
    p.aimY = Math.max(6, p.y - off);
  }

  /** a mira deslocada está visível agora (dedo segurando no mundo) */
  get aiming(): boolean {
    const p = this.pointer;
    return p.down && p.type !== 'mouse' && this.aimOffset > 0 && this.touches.size === 1;
  }

  private pinchDist(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private setupJoystick(base: HTMLElement | null, knob: HTMLElement | null): void {
    if (!base || !knob) return;
    this.joyBase = base;
    this.knob = knob;
    const R = 46;
    const move = (e: PointerEvent): void => {
      const r = base.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy.x = dx / R;
      this.joy.y = -dy / R;
    };
    base.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      base.setPointerCapture(e.pointerId);
      this.joy.id = e.pointerId;
      base.classList.add('active');
      move(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joy.id) move(e);
    });
    const stop = (e: PointerEvent): void => {
      if (e.pointerId !== this.joy.id) return;
      this.releaseJoystick();
    };
    base.addEventListener('pointerup', stop);
    base.addEventListener('pointercancel', stop);
  }

  private releaseJoystick(): void {
    this.joy.id = null;
    this.joy.x = this.joy.y = 0;
    if (this.knob) this.knob.style.transform = '';
    this.joyBase?.classList.remove('active');
  }

  /** Solta tudo (ao pausar ou perder o foco). */
  reset(): void {
    this.keys.clear();
    this.pointer.down = false;
    this.touches.clear();
    this.pinch = 0;
    this.releaseJoystick();
    this.moveX = this.moveY = 0;
    this.jump = false;
  }

  update(): void {
    const k = this.keys;
    let x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let y = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    if (this.joy.id !== null) {
      const l = Math.hypot(this.joy.x, this.joy.y);
      if (l > 0.15) {
        x = this.joy.x;
        y = this.joy.y;
      }
    }
    this.moveX = x;
    this.moveY = y;
  }

  get hasMoveInput(): boolean {
    return this.moveX !== 0 || this.moveY !== 0;
  }
}
