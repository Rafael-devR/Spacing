// Os 32 espaços do inventário na tela (docs/design/INVENTARIO.md): 3 fileiras da mochila e, separada por um fio, a barra de itens.
// Só desenha; quem mexe é a mão (hand.ts). Cada espaço tem `data-inv` (índice do inventário), que a mão usa para achar origem e
// destino. `data-index` fica igual ao índice para os testes no navegador.
import { BAG_SIZE, HOTBAR_SIZE, type ItemId } from '../../data/items';
import type { Inventory } from '../../systems/Inventory';
import { renderSlot } from '../Hud';

export function slotEl(index: number): HTMLDivElement {
  const b = document.createElement('div');
  b.className = 'slot';
  b.dataset.inv = String(index);
  b.dataset.index = String(index);
  b.innerHTML = `<img alt="" hidden draggable="false"><span class="count"></span>`;
  return b;
}

export class InvGrid {
  readonly bag: HTMLElement;
  readonly bar: HTMLElement;
  private readonly cells: HTMLDivElement[] = [];

  constructor(bag: HTMLElement, bar: HTMLElement) {
    this.bag = bag;
    this.bar = bar;
    // mochila: índices HOTBAR_SIZE.. ; barra: 0..HOTBAR_SIZE-1
    for (let k = 0; k < BAG_SIZE; k++) {
      const c = slotEl(HOTBAR_SIZE + k);
      bag.appendChild(c);
      this.cells[HOTBAR_SIZE + k] = c;
    }
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const c = slotEl(i);
      c.insertAdjacentHTML('afterbegin', `<span class="key">${i + 1}</span>`);
      bar.appendChild(c);
      this.cells[i] = c;
    }
  }

  cell(i: number): HTMLDivElement | undefined {
    return this.cells[i];
  }

  /** `held`: espaço na mão (toque e toque); `lifted`: espaço sendo arrastado */
  render(inv: Inventory, icons: Record<ItemId, string>, held: number | null, lifted: number | null): void {
    this.cells.forEach((c, i) => {
      renderSlot(c, inv.slot(i), icons);
      c.classList.toggle('held', i === held);
      c.classList.toggle('lifted', i === lifted);
      c.classList.toggle('selected', i === inv.selected);
    });
  }
}
