// Tela da mochila: mostra todos os espaços (mochila em cima, barra embaixo) e deixa reorganizar.
// Toque num item para pegar e toque em outro espaço para soltar: junta pilhas iguais, troca diferentes.
import { BAG_SIZE, HOTBAR_SIZE, type ItemId } from '../data/items';
import { t } from '../i18n';
import type { Inventory } from '../systems/Inventory';
import { el } from './dom';
import { renderSlot } from './Hud';

export class Bag {
  /** chamado ao abrir ou fechar */
  onToggle: ((open: boolean) => void) | null = null;
  private readonly root = el('#bag');
  private readonly cells: HTMLButtonElement[] = [];
  /** espaço "na mão" (escolhido para mover); null = nenhum */
  private held: number | null = null;
  private icons = {} as Record<ItemId, string>;

  constructor(private readonly inv: Inventory) {
    const grid = el('#bag-grid');
    const bar = el('#bag-hotbar');
    // índices: barra = 0..HOTBAR_SIZE-1, mochila = HOTBAR_SIZE..
    for (let k = 0; k < BAG_SIZE + HOTBAR_SIZE; k++) {
      const index = k < BAG_SIZE ? HOTBAR_SIZE + k : k - BAG_SIZE;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.dataset.index = String(index);
      b.innerHTML = `<img alt="" hidden><span class="count"></span>`;
      b.addEventListener('click', () => this.tap(index));
      (k < BAG_SIZE ? grid : bar).appendChild(b);
      this.cells[index] = b;
    }
    el('#bag-close').addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  setIcons(icons: Record<ItemId, string>): void {
    this.icons = icons;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    if (this.open) return;
    this.held = null;
    this.root.hidden = false;
    this.render();
    this.onToggle?.(true);
  }

  close(): void {
    if (!this.open) return;
    this.root.hidden = true;
    this.held = null;
    this.onToggle?.(false);
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  private tap(i: number): void {
    if (this.held === null) {
      if (this.inv.slot(i)) this.held = i;
    } else {
      if (this.held !== i) this.inv.move(this.held, i);
      this.held = null;
    }
    this.render();
  }

  render(): void {
    if (!this.open) return;
    this.cells.forEach((b, i) => {
      renderSlot(b, this.inv.slot(i), this.icons);
      b.classList.toggle('held', i === this.held);
      b.classList.toggle('selected', i === this.inv.selected);
    });
    el('#bag-hint').textContent = t(this.held === null ? 'bag.hintPick' : 'bag.hintDrop');
  }
}
