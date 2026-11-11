// Controles: teclado + mouse no computador; joystick, botões e toques no celular.
export class Input {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.moveX = 0;
    this.moveY = 0;
    this.jump = false;
    this.keys = new Set();
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    // ponteiro sobre o mundo
    this.pointer = { x: 0, y: 0, inside: false, down: false, button: 0, type: 'mouse', startT: 0, moved: 0 };
    this.onTap = null; // (x, y) => void
    this.onRotate = null;
    this.onZoom = null;
    this.onHotbar = null;
    this.onBuildToggle = null;
    this.joy = { x: 0, y: 0, id: null };
    this.touches = new Map();
    this.pinch = 0;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ') { this.jump = true; e.preventDefault(); }
      if (k === 'q') this.onRotate?.(-1);
      if (k === 'e') this.onRotate?.(1);
      if (k === 'b') this.onBuildToggle?.();
      if (/^[1-8]$/.test(k)) this.onHotbar?.(Number(k) - 1);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this.keys.clear(); this.pointer.down = false; });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.onZoom?.(e.deltaY > 0 ? 1.1 : 1 / 1.1); }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.pointer.down = false;
        this.pinch = this.pinchDist();
        return;
      }
      if (this.touches.size > 2) return;
      if (e.pointerType === 'mouse' && e.button === 2) { this.onTap?.(e.clientX, e.clientY, 2); return; }
      Object.assign(this.pointer, {
        x: e.clientX, y: e.clientY, inside: true, down: true, button: e.button,
        type: e.pointerType, startT: performance.now(), moved: 0,
      });
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (t) { t.x = e.clientX; t.y = e.clientY; }
      if (this.touches.size === 2) {
        const d = this.pinchDist();
        if (this.pinch > 0 && d > 0) this.onZoom?.(this.pinch / d);
        this.pinch = d;
        return;
      }
      const p = this.pointer;
      p.moved += Math.hypot(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX; p.y = e.clientY;
      p.inside = true;
      p.type = e.pointerType;
    });
    const end = (e) => {
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
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.pointer.inside = false; });

    this.setupJoystick(ui.joystick, ui.knob);
  }

  pinchDist() {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  setupJoystick(base, knob) {
    if (!base) return;
    const R = 46;
    const move = (e) => {
      const r = base.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
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
    base.addEventListener('pointermove', (e) => { if (e.pointerId === this.joy.id) move(e); });
    const stop = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.id = null;
      this.joy.x = this.joy.y = 0;
      knob.style.transform = '';
      base.classList.remove('active');
    };
    base.addEventListener('pointerup', stop);
    base.addEventListener('pointercancel', stop);
  }

  update() {
    const k = this.keys;
    let x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let y = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    if (this.joy.id !== null) {
      const l = Math.hypot(this.joy.x, this.joy.y);
      if (l > 0.15) { x = this.joy.x; y = this.joy.y; }
    }
    this.moveX = x;
    this.moveY = y;
  }

  get hasMoveInput() { return this.moveX !== 0 || this.moveY !== 0; }
}
