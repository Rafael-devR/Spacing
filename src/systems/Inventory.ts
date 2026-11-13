// Inventário do jogador em espaços (slots), como no Minecraft: a barra de itens são os primeiros
// HOTBAR_SIZE espaços e a mochila são os seguintes. Nenhum espaço é preso a um tipo de item.
// Coletar junta primeiro em pilhas do mesmo item que ainda cabem e depois ocupa o primeiro espaço vazio,
// sempre da barra para a mochila. Detalhes em docs/design/INVENTARIO.md.
// Toda mudança publica 'inventory:changed'; coletas publicam também 'item:collected'.
import type { GameBus } from '../app/events';
import { BAG_SIZE, HOTBAR_SIZE, ITEMS, ITEM_ORDER, isItemId, stackSize, type ItemId } from '../data/items';

export const SLOT_COUNT = HOTBAR_SIZE + BAG_SIZE;

export interface Stack {
  item: ItemId;
  n: number;
}

export type Slot = Stack | null;

export interface InventorySave {
  slots: Slot[];
  /** espaço selecionado na barra */
  selected: number;
}

export type ItemCounts = Partial<Record<ItemId, number>>;

export class Inventory {
  private readonly slots: Slot[] = new Array<Slot>(SLOT_COUNT).fill(null);
  private selectedIndex = 0;

  /** `initial`: salvamento com espaços (v4) ou só quantidades (formatos antigos e testes). */
  constructor(
    private readonly events?: GameBus,
    initial: InventorySave | ItemCounts | null = null,
  ) {
    if (initial && Array.isArray((initial as InventorySave).slots)) this.load(initial as InventorySave);
    else if (initial) {
      for (const item of ITEM_ORDER) {
        const n = Math.max(0, Math.floor((initial as ItemCounts)[item] ?? 0));
        if (n) this.put(item, n);
      }
    }
  }

  private load(s: InventorySave): void {
    s.slots.slice(0, SLOT_COUNT).forEach((st, i) => {
      if (st && isItemId(st.item) && st.n > 0) this.slots[i] = { item: st.item, n: Math.min(Math.floor(st.n), stackSize(st.item)) };
    });
    if (s.selected >= 0 && s.selected < HOTBAR_SIZE) this.selectedIndex = Math.floor(s.selected);
  }

  /** Total de um item somando todos os espaços. */
  count(item: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s?.item === item) n += s.n;
    return n;
  }

  has(item: ItemId, n = 1): boolean {
    return this.count(item) >= n;
  }

  slot(i: number): Slot {
    return this.slots[i] ?? null;
  }

  /** Quantas unidades de `item` ainda cabem (pilhas do mesmo item + espaços vazios). */
  room(item: ItemId): number {
    const max = stackSize(item);
    let r = 0;
    for (const s of this.slots) r += !s ? max : s.item === item ? max - s.n : 0;
    return r;
  }

  canAdd(item: ItemId, n = 1): boolean {
    return this.room(item) >= n;
  }

  /** Coloca nos espaços seguindo a ordem de coleta; devolve o que não coube. */
  private put(item: ItemId, n: number): number {
    const max = stackSize(item);
    // 1) completa pilhas do mesmo item
    for (const s of this.slots) {
      if (n <= 0) break;
      if (s?.item === item && s.n < max) {
        const k = Math.min(max - s.n, n);
        s.n += k;
        n -= k;
      }
    }
    // 2) primeiro espaço vazio (barra, depois mochila)
    for (let i = 0; i < SLOT_COUNT && n > 0; i++) {
      if (this.slots[i]) continue;
      const k = Math.min(max, n);
      this.slots[i] = { item, n: k };
      n -= k;
    }
    return n;
  }

  /**
   * Adiciona itens; devolve quantos **não couberam** (mochila cheia).
   * `collected` = veio do mundo (dispara 'item:collected' com o que entrou).
   */
  add(item: ItemId, n = 1, collected = true): number {
    if (n <= 0) return 0;
    const left = this.put(item, n);
    const added = n - left;
    if (added > 0) {
      if (collected) this.events?.emit('item:collected', { item, amount: added });
      this.events?.emit('inventory:changed', { item });
    }
    if (left > 0) this.events?.emit('inventory:full', { item, amount: left });
    return left;
  }

  /** Tira n unidades de um item, das últimas pilhas para as primeiras (poupa a barra). */
  private take(item: ItemId, n: number): number {
    let taken = 0;
    for (let i = SLOT_COUNT - 1; i >= 0 && taken < n; i--) {
      const s = this.slots[i];
      if (s?.item !== item) continue;
      const k = Math.min(s.n, n - taken);
      s.n -= k;
      taken += k;
      if (s.n === 0) this.slots[i] = null;
    }
    return taken;
  }

  /** Remove até n itens; retorna quantos saíram. */
  remove(item: ItemId, n = 1): number {
    const taken = this.take(item, n);
    if (taken > 0) this.events?.emit('inventory:changed', { item });
    return taken;
  }

  /** Tira um item do espaço selecionado na barra (construir). */
  removeSelected(n = 1): number {
    const s = this.slots[this.selectedIndex];
    if (!s) return 0;
    const k = Math.min(n, s.n);
    s.n -= k;
    const item = s.item;
    if (s.n === 0) this.slots[this.selectedIndex] = null;
    this.events?.emit('inventory:changed', { item });
    return k;
  }

  /** Remove um conjunto de itens só se houver todos. */
  removeAll(needs: ItemCounts): boolean {
    const list = Object.entries(needs) as [ItemId, number][];
    if (!list.every(([k, n]) => this.has(k, n))) return false;
    for (const [k, n] of list) this.take(k, n);
    this.events?.emit('inventory:changed', { item: null });
    return true;
  }

  /** Esvazia todos os espaços e devolve o total de cada item (morte). */
  takeEverything(): ItemCounts {
    const out = this.totals();
    this.slots.fill(null);
    this.events?.emit('inventory:changed', { item: null });
    return out;
  }

  /**
   * Move o conteúdo do espaço `from` para `to` (mochila): junta se for o mesmo item, troca se forem
   * diferentes, só move se `to` estiver vazio.
   */
  move(from: number, to: number): void {
    const a = this.slots[from];
    if (a) this.moveN(from, to, a.n);
  }

  /**
   * Move até `n` unidades do espaço `from` para `to` (a "mão" da tela do inventário, docs/design/INVENTARIO.md). Destino vazio
   * recebe; mesmo item junta até a pilha encher; item diferente só troca de lugar se a pilha inteira estiver indo (senão nada
   * muda). Pilha cheia do mesmo item também troca. Devolve quantas unidades mudaram de espaço.
   */
  moveN(from: number, to: number, n: number): number {
    if (from === to || !this.valid(from) || !this.valid(to)) return 0;
    const a = this.slots[from], b = this.slots[to];
    if (!a) return 0;
    n = Math.min(a.n, Math.floor(n));
    if (n <= 0) return 0;
    let moved: number;
    if (!b) {
      this.slots[to] = { item: a.item, n };
      a.n -= n;
      moved = n;
    } else if (b.item === a.item && b.n < stackSize(a.item)) {
      moved = Math.min(stackSize(a.item) - b.n, n);
      b.n += moved;
      a.n -= moved;
    } else if (n === a.n) {
      // outro item (ou pilha cheia): troca
      this.slots[from] = b;
      this.slots[to] = a;
      moved = n;
    } else return 0;
    if (a.n === 0 && this.slots[from] === a) this.slots[from] = null;
    this.changed(from, to);
    return moved;
  }

  /**
   * Mandar rápido (toque duplo): da barra para a mochila ou da mochila para a barra. Junta primeiro em pilhas iguais do outro lado,
   * depois usa o primeiro espaço vazio. Devolve quantas unidades foram.
   */
  quickMove(from: number): number {
    if (!this.valid(from)) return 0;
    const a = this.slots[from];
    if (!a) return 0;
    const [lo, hi] = from < HOTBAR_SIZE ? [HOTBAR_SIZE, SLOT_COUNT] : [0, HOTBAR_SIZE];
    const max = stackSize(a.item);
    const start = a.n;
    for (let i = lo; i < hi && a.n > 0; i++) {
      const b = this.slots[i];
      if (b?.item !== a.item || b.n >= max) continue;
      const k = Math.min(max - b.n, a.n);
      b.n += k;
      a.n -= k;
    }
    for (let i = lo; i < hi && a.n > 0; i++) {
      if (this.slots[i]) continue;
      this.slots[i] = { item: a.item, n: a.n };
      a.n = 0;
    }
    if (a.n === 0) this.slots[from] = null;
    const moved = start - a.n;
    if (moved > 0) this.changed(from, from);
    return moved;
  }

  /** Organizar: junta pilhas iguais da mochila e põe em ordem (ordem de referência dos itens). A barra não muda. */
  sortBag(): void {
    const totals = new Map<ItemId, number>();
    for (let i = HOTBAR_SIZE; i < SLOT_COUNT; i++) {
      const s = this.slots[i];
      if (s) totals.set(s.item, (totals.get(s.item) ?? 0) + s.n);
      this.slots[i] = null;
    }
    let k = HOTBAR_SIZE;
    for (const item of ITEM_ORDER) {
      let n = totals.get(item) ?? 0;
      while (n > 0 && k < SLOT_COUNT) {
        const q = Math.min(stackSize(item), n);
        this.slots[k++] = { item, n: q };
        n -= q;
      }
    }
    this.events?.emit('inventory:changed', { item: null });
  }

  private valid(i: number): boolean {
    return Number.isInteger(i) && i >= 0 && i < SLOT_COUNT;
  }

  private changed(a: number, b: number): void {
    this.events?.emit('inventory:changed', { item: null });
    if (a === this.selectedIndex || b === this.selectedIndex || a < HOTBAR_SIZE || b < HOTBAR_SIZE) this.emitSelected();
  }

  get selected(): number {
    return this.selectedIndex;
  }

  /** item no espaço selecionado (null = espaço vazio) */
  selectedItem(): ItemId | null {
    return this.slots[this.selectedIndex]?.item ?? null;
  }

  /** item selecionado, se ele constrói um bloco */
  selectedBlockItem(): ItemId | null {
    const item = this.selectedItem();
    return item && ITEMS[item].block !== undefined ? item : null;
  }

  select(index: number): void {
    if (index < 0 || index >= HOTBAR_SIZE || index === this.selectedIndex) return;
    this.selectedIndex = index;
    this.emitSelected();
  }

  private emitSelected(): void {
    this.events?.emit('inventory:selected', { index: this.selectedIndex, item: this.selectedItem() });
  }

  /** Total de cada item (para missões, morte, testes). */
  totals(): ItemCounts {
    const out: ItemCounts = {};
    for (const s of this.slots) if (s) out[s.item] = (out[s.item] ?? 0) + s.n;
    return out;
  }

  serialize(): InventorySave {
    return { slots: this.slots.map((s) => (s ? { item: s.item, n: s.n } : null)), selected: this.selectedIndex };
  }
}
