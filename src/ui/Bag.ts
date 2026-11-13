// Mochila (docs/design/INVENTARIO.md): a tela de itens com o **traje** do lado esquerdo (equipamentos e o item escolhido, com o
// nome e para que serve) e o inventário à direita. Os gestos (arrastar, metade, toque duplo) são da mão, em inventory/hand.ts.
import { EQUIPMENT, EQUIP_SLOTS, type EquipId } from '../data/equipment';
import { ITEMS, type ItemId } from '../data/items';
import { t } from '../i18n';
import type { Equipment } from '../systems/Equipment';
import type { Inventory } from '../systems/Inventory';
import type { InvScreen, Pane } from './inventory/screen';

export class Bag implements Pane {
  /** chamado ao abrir ou fechar */
  onToggle: ((open: boolean) => void) | null = null;
  readonly el: HTMLElement;
  private equipment: Equipment | null = null;
  private equipIcons = {} as Record<EquipId, string>;
  private focused: ItemId | null = null;
  private readonly detail: HTMLElement;
  private readonly equipRow: HTMLElement;

  constructor(
    private readonly screen: InvScreen,
    private readonly inv: Inventory,
  ) {
    const e = document.createElement('section');
    e.id = 'bag';
    e.className = 'pane bag-pane';
    e.setAttribute('aria-labelledby', 'bag-title');
    e.innerHTML = `
      <header class="ui-head">
        <button class="ui-back" id="bag-close" type="button" data-hit="back" aria-label="${t('ui.back')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <div class="ui-title"><span class="ui-k">${t('bag.kicker')}</span><h2 id="bag-title">${t('bag.title')}</h2></div>
      </header>
      <div class="bag-detail"></div>
      <span class="ui-label">${t('bag.equipLabel')}</span>
      <div class="equip-row" id="bag-equip"></div>
      <p class="bag-tips">${t('bag.tips')}</p>`;
    this.el = e;
    this.detail = e.querySelector('.bag-detail') as HTMLElement;
    this.equipRow = e.querySelector('#bag-equip') as HTMLElement;
    (e.querySelector('#bag-close') as HTMLElement).addEventListener('click', () => this.close());
  }

  setIcons(icons: Record<ItemId, string>): void {
    this.screen.icons = icons;
  }

  /** Equipamentos do traje (mostrados à esquerda; não fazem parte do inventário). */
  setEquipment(eq: Equipment, icons: Record<EquipId, string>): void {
    this.equipment = eq;
    this.equipIcons = icons;
  }

  get open(): boolean {
    return this.screen.current === this;
  }

  show(): void {
    if (this.open) return;
    this.focused = this.inv.selectedItem();
    this.screen.show(this);
  }

  close(): void {
    if (this.open) this.screen.close();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  onOpen(): void {
    this.onToggle?.(true);
  }

  onClose(): void {
    this.onToggle?.(false);
  }

  focus(item: ItemId | null): void {
    this.focused = item;
    this.renderDetail();
  }

  render(): void {
    if (!this.open) return;
    this.renderDetail();
    this.equipRow.innerHTML = '';
    for (const slot of EQUIP_SLOTS) {
      const id = this.equipment?.inSlot(slot) ?? null;
      const d = document.createElement('div');
      d.className = 'equip-slot' + (id ? ' on' : '');
      const src = id ? this.equipIcons[id] : '';
      d.innerHTML = `<span class="slot"><img alt="" ${id ? `src="${src}"` : 'hidden'}></span><span class="equip-txt"><b>${id ? EQUIPMENT[id].name : t(`bag.equipSlot.${slot}`)}</b><small>${id ? t('bag.equipOn') : t(`bag.equipEmpty.${slot}`)}</small></span>`;
      this.equipRow.appendChild(d);
    }
  }

  private renderDetail(): void {
    const item = this.focused;
    const n = item ? this.inv.count(item) : 0;
    if (!item || n <= 0) {
      this.detail.innerHTML = `<div class="slot empty"></div><div class="bag-detail-txt"><b>${t('bag.noneTitle')}</b><small>${t('bag.noneText')}</small></div>`;
      return;
    }
    const d = ITEMS[item];
    const kind = d.block !== undefined ? t('bag.kind.block') : d.place || d.site ? t('bag.kind.place') : d.food ? t('bag.kind.food') : t('bag.kind.resource');
    this.detail.innerHTML = `<div class="slot"><img alt="" src="${this.screen.icons[item] ?? ''}"></div>
      <div class="bag-detail-txt"><span class="ui-k">${kind} · ${n}</span><b>${d.name}</b><small>${d.about}</small></div>`;
  }
}
