// Inventário do jogador: quantidades por item e item selecionado na barra.
// Toda mudança publica 'inventory:changed'; coletas publicam também 'item:collected'.
import type { GameBus } from '../app/events';
import { ITEMS, ITEM_ORDER, type ItemId } from '../data/items';

export class Inventory {
  private readonly counts = new Map<ItemId, number>();
  private selectedIndex = 0;

  constructor(
    private readonly events?: GameBus,
    initial: Partial<Record<ItemId, number>> = {},
  ) {
    for (const item of ITEM_ORDER) this.counts.set(item, Math.max(0, Math.floor(initial[item] ?? 0)));
  }

  count(item: ItemId): number {
    return this.counts.get(item) ?? 0;
  }

  has(item: ItemId, n = 1): boolean {
    return this.count(item) >= n;
  }

  /** Adiciona itens. `collected` = veio do mundo (dispara 'item:collected'). */
  add(item: ItemId, n = 1, collected = true): void {
    if (n <= 0) return;
    this.counts.set(item, this.count(item) + n);
    if (collected) this.events?.emit('item:collected', { item, amount: n });
    this.events?.emit('inventory:changed', { item });
  }

  /** Remove até n itens; retorna quantos saíram. */
  remove(item: ItemId, n = 1): number {
    const taken = Math.min(n, this.count(item));
    if (taken <= 0) return 0;
    this.counts.set(item, this.count(item) - taken);
    this.events?.emit('inventory:changed', { item });
    return taken;
  }

  /** Remove um conjunto de itens só se houver todos. */
  removeAll(needs: Partial<Record<ItemId, number>>): boolean {
    const list = Object.entries(needs) as [ItemId, number][];
    if (!list.every(([k, n]) => this.has(k, n))) return false;
    for (const [k, n] of list) this.counts.set(k, this.count(k) - n);
    this.events?.emit('inventory:changed', { item: null });
    return true;
  }

  /** Esvazia o inventário e devolve o que havia (usado na morte, v0.3). */
  takeEverything(): Partial<Record<ItemId, number>> {
    const out = this.serialize();
    for (const item of ITEM_ORDER) this.counts.set(item, 0);
    this.events?.emit('inventory:changed', { item: null });
    return out;
  }

  get selected(): number {
    return this.selectedIndex;
  }

  selectedItem(): ItemId {
    return ITEM_ORDER[this.selectedIndex];
  }

  /** item selecionado, se ele constrói um bloco */
  selectedBlockItem(): ItemId | null {
    const item = this.selectedItem();
    return ITEMS[item].block !== undefined ? item : null;
  }

  select(index: number): void {
    if (index < 0 || index >= ITEM_ORDER.length || index === this.selectedIndex) return;
    this.selectedIndex = index;
    this.events?.emit('inventory:selected', { index, item: ITEM_ORDER[index] });
  }

  serialize(): Partial<Record<ItemId, number>> {
    const out: Partial<Record<ItemId, number>> = {};
    for (const [k, n] of this.counts) if (n > 0) out[k] = n;
    return out;
  }
}
