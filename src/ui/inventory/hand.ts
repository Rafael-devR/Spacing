// A "mão" da tela do inventário (docs/design/INVENTARIO.md): todos os gestos de mexer em itens, como no Minecraft.
//   - arrastar: o item segue o dedo e cai onde o dedo soltar;
//   - tocar e tocar: o primeiro toque pega, o segundo solta (o mesmo espaço de novo cancela);
//   - toque longo (ou botão direito): pega metade da pilha;
//   - toque duplo (ou Shift + clique): manda rápido (quem decide para onde é a tela: barra ↔ mochila, ou a entrada da máquina).
// A mão não guarda itens: eles só mudam de lugar ao soltar (`Inventory.moveN`). Fechar no meio de um gesto não perde nada.
// Origens: espaços do inventário (`data-inv`) e a saída de uma máquina (`data-out`). Destinos: espaços do inventário e áreas da tela
// que aceitam itens (`data-drop`).
import type { ItemId } from '../../data/items';
import type { Inventory } from '../../systems/Inventory';

export interface HandHost {
  readonly inv: Inventory;
  icon(item: ItemId): string | undefined;
  /** soltou `n` unidades do espaço `from` numa área da tela (`data-drop`); devolve se aceitou */
  dropOn(target: HTMLElement, from: number, n: number): boolean;
  /** a área aceita esse item? (acende verde ou vermelho enquanto arrasta) */
  accepts(target: HTMLElement, item: ItemId): boolean;
  /** mandar rápido (toque duplo) */
  quick(from: number): void;
  /** a saída da máquina foi tocada ou arrastada para o inventário */
  takeOut(source: HTMLElement): void;
  /** o item tocado (para mostrar detalhes) */
  focus(item: ItemId | null): void;
  feedback(kind: 'pick' | 'drop' | 'deny' | 'half'): void;
  /** algo mudou (redesenhar) */
  changed(): void;
}

type Src = { kind: 'inv'; index: number } | { kind: 'out'; el: HTMLElement };

interface Press {
  id: number;
  src: Src | null;
  /** elemento tocado (espaço, saída ou área de soltar) */
  target: HTMLElement;
  x0: number;
  y0: number;
  half: boolean;
  timer: number;
}

const LONG_MS = 380;
const DOUBLE_MS = 330;
const SLOP = 8;
const SELECTOR = '[data-inv],[data-out],[data-drop]';

export class Hand {
  /** espaço na mão no modo tocar e tocar */
  held: { index: number; n: number; t: number } | null = null;
  /** espaço sendo arrastado agora */
  lifted: number | null = null;
  private press: Press | null = null;
  private drag: { src: Src; n: number } | null = null;
  private hover: HTMLElement | null = null;
  private last = { index: -1, t: 0 };

  constructor(
    private readonly root: HTMLElement,
    private readonly ghost: HTMLElement,
    private readonly host: HandHost,
  ) {
    root.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', () => this.reset());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** larga tudo sem mexer em nada (a tela fechou) */
  reset(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
    this.drag = null;
    this.held = null;
    this.lifted = null;
    this.setHover(null);
    this.ghost.hidden = true;
  }

  private srcOf(t: HTMLElement): Src | null {
    if (t.dataset.inv !== undefined) {
      const index = Number(t.dataset.inv);
      return this.host.inv.slot(index) ? { kind: 'inv', index } : null;
    }
    if (t.dataset.out !== undefined && t.dataset.ready === '1') return { kind: 'out', el: t };
    return null;
  }

  private down(e: PointerEvent): void {
    if (this.press || (e.button !== 0 && e.button !== 2)) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(SELECTOR);
    if (!target || !this.root.contains(target)) {
      // toque fora de um espaço solta o que estava na mão
      if (this.held && !(e.target as HTMLElement).closest('button')) {
        this.held = null;
        this.host.changed();
      }
      return;
    }
    e.preventDefault();
    const src = this.srcOf(target);
    const p: Press = { id: e.pointerId, src, target, x0: e.clientX, y0: e.clientY, half: e.button === 2, timer: 0 };
    if (src?.kind === 'inv' && !p.half && !this.held) {
      p.timer = window.setTimeout(() => {
        if (this.press !== p || this.drag) return;
        p.half = true;
        this.host.feedback('half');
        const s = this.host.inv.slot(src.index);
        if (s && s.n > 1) this.showGhost(s.item, Math.ceil(s.n / 2), e.clientX, e.clientY);
      }, LONG_MS);
    }
    this.press = p;
  }

  private move(e: PointerEvent): void {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    if (!this.drag) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < SLOP) return;
      clearTimeout(p.timer);
      // arrastar o que está na mão (tocar e tocar) também vale
      const src = p.src ?? null;
      if (!src) return;
      let n = 0;
      if (src.kind === 'inv') {
        const s = this.host.inv.slot(src.index);
        if (!s) return;
        n = this.held?.index === src.index ? this.held.n : p.half ? Math.ceil(s.n / 2) : s.n;
        this.lifted = src.index;
        this.showGhost(s.item, n, e.clientX, e.clientY);
        this.host.focus(s.item);
      } else {
        const img = src.el.querySelector('img');
        this.ghost.innerHTML = `<img alt="" src="${img?.getAttribute('src') ?? ''}"><span class="count">${src.el.querySelector('.count')?.textContent ?? ''}</span>`;
        this.ghost.hidden = false;
      }
      this.held = null;
      this.drag = { src, n };
      this.host.feedback('pick');
      this.host.changed();
    }
    this.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    this.setHover(this.under(e.clientX, e.clientY));
  }

  private up(e: PointerEvent): void {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    clearTimeout(p.timer);
    this.press = null;
    if (this.drag) {
      const d = this.drag;
      const target = this.under(e.clientX, e.clientY);
      this.drag = null;
      this.lifted = null;
      this.ghost.hidden = true;
      this.setHover(null);
      if (target) this.drop(d.src, d.n, target);
      this.host.changed();
      return;
    }
    this.ghost.hidden = true;
    this.tap(p);
    this.host.changed();
  }

  private tap(p: Press): void {
    const now = performance.now();
    const t = p.target;
    const index = t.dataset.inv !== undefined ? Number(t.dataset.inv) : -1;
    if (this.held) {
      const h = this.held;
      this.held = null;
      if (index === h.index) {
        // o mesmo espaço: toque duplo manda rápido; devagar, só larga
        if (now - h.t < DOUBLE_MS) this.host.quick(index);
        return;
      }
      this.drop({ kind: 'inv', index: h.index }, h.n, t);
      return;
    }
    if (p.src?.kind === 'out') {
      this.host.takeOut(p.src.el);
      return;
    }
    if (index < 0) return;
    const s = this.host.inv.slot(index);
    if (!s) return;
    // Shift + clique: manda rápido; um segundo toque logo depois de largar também (toque duplo em espaço que acabou de soltar)
    if (this.shift(p) || (this.last.index === index && now - this.last.t < DOUBLE_MS)) {
      this.last.index = -1;
      this.host.quick(index);
      return;
    }
    this.held = { index, n: p.half ? Math.ceil(s.n / 2) : s.n, t: now };
    this.last = { index, t: now };
    this.host.focus(s.item);
    this.host.feedback(p.half ? 'half' : 'pick');
  }

  private shiftDown = false;

  /** chamado pela tela com o estado da tecla Shift */
  setShift(v: boolean): void {
    this.shiftDown = v;
  }

  private shift(p: Press): boolean {
    void p;
    return this.shiftDown;
  }

  private drop(src: Src, n: number, target: HTMLElement): void {
    if (src.kind === 'out') {
      if (target.dataset.inv !== undefined || target.closest('.inv-pane')) this.host.takeOut(src.el);
      return;
    }
    if (target.dataset.inv !== undefined) {
      const to = Number(target.dataset.inv);
      if (to === src.index) return;
      const moved = this.host.inv.moveN(src.index, to, n);
      this.host.feedback(moved > 0 ? 'drop' : 'deny');
      if (moved > 0) this.last = { index: to, t: 0 };
      return;
    }
    if (target.dataset.drop !== undefined) this.host.feedback(this.host.dropOn(target, src.index, n) ? 'drop' : 'deny');
  }

  private under(x: number, y: number): HTMLElement | null {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const t = hit?.closest<HTMLElement>(SELECTOR) ?? null;
    if (t && this.root.contains(t)) return t;
    // fora de um espaço mas dentro do inventário: só a saída da máquina aceita (pega tudo)
    return hit?.closest<HTMLElement>('.inv-pane') ?? null;
  }

  private setHover(t: HTMLElement | null): void {
    if (this.hover === t) return;
    this.hover?.classList.remove('drop-ok', 'drop-no');
    this.hover = t;
    if (!t || !this.drag) return;
    const d = this.drag;
    let ok = false;
    if (d.src.kind === 'out') ok = t.dataset.inv !== undefined || t.classList.contains('inv-pane');
    else if (t.dataset.inv !== undefined) ok = Number(t.dataset.inv) !== d.src.index;
    else if (t.dataset.drop !== undefined) {
      const s = this.host.inv.slot(d.src.index);
      ok = !!s && this.host.accepts(t, s.item);
    }
    if (t.classList.contains('inv-pane') && d.src.kind !== 'out') return;
    t.classList.add(ok ? 'drop-ok' : 'drop-no');
  }

  private showGhost(item: ItemId, n: number, x: number, y: number): void {
    this.ghost.innerHTML = `<img alt="" src="${this.host.icon(item) ?? ''}"><span class="count">${n > 1 ? n : ''}</span>`;
    this.ghost.style.transform = `translate(${x}px, ${y}px)`;
    this.ghost.hidden = false;
  }
}
