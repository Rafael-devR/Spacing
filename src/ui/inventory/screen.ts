// A tela de itens (docs/design/INVENTARIO.md, ESTACOES.md, ADR 0019): um painel à esquerda que muda (o traje na mochila, a máquina
// numa estação) e o inventário à direita, sempre o mesmo. Em pé, um em cima do outro. A mão (hand.ts) cuida dos gestos; o painel da
// vez decide o que acontece quando um item cai nele. Enquanto aberta, a tela tem um relógio próprio para o painel animar.
import { ITEMS, type ItemId } from '../../data/items';
import { t } from '../../i18n';
import type { Inventory } from '../../systems/Inventory';
import { el } from '../dom';
import { InvGrid } from './grid';
import { Hand } from './hand';

/** o lado esquerdo da tela */
export interface Pane {
  readonly el: HTMLElement;
  onOpen?(): void;
  onClose?(): void;
  /** o inventário mudou */
  render(): void;
  /** a cada quadro com a tela aberta */
  frame?(dt: number): void;
  dropOn?(target: HTMLElement, from: number, n: number): boolean;
  accepts?(target: HTMLElement, item: ItemId): boolean;
  /** toque duplo num espaço; devolve false para o padrão (barra ↔ mochila) */
  quick?(from: number): boolean;
  takeOut?(source: HTMLElement): void;
  focus?(item: ItemId | null): void;
}

export type Feedback = 'pick' | 'drop' | 'deny' | 'half' | 'open' | 'close';

export class InvScreen {
  readonly root = el('#inv');
  readonly grid: InvGrid;
  readonly hand: Hand;
  onFeedback: ((k: Feedback) => void) | null = null;
  icons = {} as Record<ItemId, string>;
  private readonly left: HTMLElement;
  private readonly hint: HTMLElement;
  private pane: Pane | null = null;
  private raf = 0;
  private last = 0;

  constructor(readonly inv: Inventory) {
    const r = this.root;
    r.innerHTML = `
      <div class="ui-frame">
        <div class="ui-left"></div>
        <section class="inv-pane" aria-label="${t('inv.title')}">
          <header class="ui-head">
            <div class="ui-title"><span class="ui-k">${t('inv.kicker')}</span><h2>${t('inv.title')}</h2></div>
            <span class="inv-hint" id="bag-hint"></span>
            <button class="ui-btn" type="button" data-hit="sort">${t('inv.sort')}</button>
          </header>
          <div class="inv-grid" id="bag-grid"></div>
          <div class="inv-sep"><span>${t('inv.hotbar')}</span></div>
          <div class="inv-grid" id="bag-hotbar"></div>
        </section>
      </div>
      <div class="hand-ghost slot" hidden aria-hidden="true"></div>`;
    this.left = r.querySelector('.ui-left') as HTMLElement;
    this.hint = r.querySelector('#bag-hint') as HTMLElement;
    this.grid = new InvGrid(r.querySelector('#bag-grid') as HTMLElement, r.querySelector('#bag-hotbar') as HTMLElement);
    this.hand = new Hand(r, r.querySelector('.hand-ghost') as HTMLElement, {
      inv,
      icon: (item) => this.icons[item],
      dropOn: (target, from, n) => this.pane?.dropOn?.(target, from, n) ?? false,
      accepts: (target, item) => this.pane?.accepts?.(target, item) ?? false,
      quick: (from) => {
        if (!this.pane?.quick?.(from)) this.feedback(inv.quickMove(from) > 0 ? 'drop' : 'deny');
      },
      takeOut: (src) => this.pane?.takeOut?.(src),
      focus: (item) => this.pane?.focus?.(item),
      feedback: (k) => this.feedback(k),
      changed: () => this.render(),
    });
    (r.querySelector('[data-hit="sort"]') as HTMLElement).addEventListener('click', () => {
      inv.sortBag();
      this.feedback('drop');
    });
    const shift = (e: KeyboardEvent): void => this.hand.setShift(e.shiftKey);
    window.addEventListener('keydown', shift);
    window.addEventListener('keyup', shift);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** o painel aberto agora */
  get current(): Pane | null {
    return this.open ? this.pane : null;
  }

  show(pane: Pane): void {
    if (this.open && this.pane === pane) return;
    if (this.open) this.close();
    this.pane = pane;
    this.left.replaceChildren(pane.el);
    this.hand.reset();
    this.root.hidden = false;
    pane.onOpen?.();
    this.render();
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.open) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.pane?.frame?.(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  close(): void {
    if (!this.open) return;
    cancelAnimationFrame(this.raf);
    this.hand.reset();
    this.root.hidden = true;
    const p = this.pane;
    this.pane = null;
    p?.onClose?.();
  }

  render(): void {
    if (!this.open) return;
    const h = this.hand;
    this.grid.render(this.inv, this.icons, h.held?.index ?? null, h.lifted);
    this.hint.textContent = h.held ? t('bag.hintDrop') : '';
    this.root.classList.toggle('holding', !!h.held);
    this.pane?.render();
  }

  private feedback(k: Feedback): void {
    this.onFeedback?.(k);
  }

  /** nome curto de um item (detalhes) */
  static itemName(item: ItemId): string {
    return ITEMS[item].name;
  }
}
