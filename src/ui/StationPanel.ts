// Fachada das telas das estações (docs/design/FORNO.md, ADR 0018). O jogo fala com uma tela só (`show`, `close`, `open`…); aqui se
// escolhe qual: o **forno** usa a tela nova em PixiJS (ui/FurnacePanel.ts, carregada só quando abre pela primeira vez); a bancada
// e o eletrolisador seguem na tela em Canvas 2D (ui/CraftPanel.ts). Se o Pixi não iniciar (sem WebGL), o forno cai na antiga.
import type { EquipId } from '../data/equipment';
import type { ItemId } from '../data/items';
import type { Recipe } from '../data/recipes';
import type { StationId } from '../data/stations';
import type { Crafting } from '../systems/Crafting';
import { CraftPanel, type EnergyView } from './CraftPanel';
import type { FurnacePanel } from './FurnacePanel';
import { el } from './dom';

type Icons = { items: Record<ItemId, string>; equip: Record<EquipId, string>; stations: Partial<Record<StationId, string>> };

export class StationPanel {
  readonly craft: CraftPanel;
  /** a tela do forno, quando já carregou (para o teste no navegador) */
  furnace: FurnacePanel | null = null;
  private loading = false;
  /** o jogador fechou enquanto o forno ainda carregava: não abre depois */
  private cancelled = false;
  private failed = false;
  private icons: Icons | null = null;
  private toggle: ((open: boolean) => void) | null = null;
  private handlers: {
    craft: ((r: Recipe, batch: number) => void) | null;
    take: ((station: StationId, slot?: number) => void) | null;
    pause: ((station: StationId, slot: number) => void) | null;
    cancel: ((station: StationId, slot: number) => void) | null;
  } = { craft: null, take: null, pause: null, cancel: null };

  constructor(
    private readonly crafting: Crafting,
    private readonly energy: EnergyView,
  ) {
    this.craft = new CraftPanel(crafting, energy);
  }

  // ---------- a mesma interface do CraftPanel ----------

  get open(): boolean {
    return this.craft.open || !!this.furnace?.open || this.loading;
  }

  get current(): StationId {
    return this.furnace?.open ? 'furnace' : this.craft.current;
  }

  set onToggle(fn: ((open: boolean) => void) | null) {
    this.toggle = fn;
    this.craft.onToggle = fn;
    if (this.furnace) this.furnace.onToggle = fn;
  }

  set onCraft(fn: ((r: Recipe, batch: number) => void) | null) {
    this.handlers.craft = fn;
    this.craft.onCraft = fn;
    if (this.furnace) this.furnace.onCraft = fn;
  }

  set onTake(fn: ((station: StationId, slot?: number) => void) | null) {
    this.handlers.take = fn;
    this.craft.onTake = fn;
    if (this.furnace) this.furnace.onTake = fn;
  }

  set onPause(fn: ((station: StationId, slot: number) => void) | null) {
    this.handlers.pause = fn;
    this.craft.onPause = fn;
    if (this.furnace) this.furnace.onPause = fn;
  }

  set onCancel(fn: ((station: StationId, slot: number) => void) | null) {
    this.handlers.cancel = fn;
    this.craft.onCancel = fn;
    if (this.furnace) this.furnace.onCancel = fn;
  }

  setIcons(items: Record<ItemId, string>, equip: Record<EquipId, string>, stations: Partial<Record<StationId, string>> = {}): void {
    this.icons = { items, equip, stations };
    this.craft.setIcons(items, equip, stations);
    this.furnace?.setIcons(items, equip, stations);
  }

  show(station: StationId = 'workbench'): void {
    if (station !== 'furnace' || this.failed) {
      this.craft.show(station);
      return;
    }
    if (this.furnace) {
      this.furnace.show();
      return;
    }
    if (this.loading) return;
    this.loading = true;
    this.cancelled = false;
    const root = el('#furnace');
    root.hidden = false;
    root.classList.add('loading');
    void this.loadFurnace().then((ok) => {
      this.loading = false;
      root.classList.remove('loading');
      root.hidden = true;
      if (this.cancelled) return;
      if (ok && this.furnace) this.furnace.show();
      else this.craft.show('furnace');
    });
  }

  close(): void {
    if (this.loading) this.cancelled = true;
    this.craft.close();
    this.furnace?.close();
  }

  render(): void {
    this.craft.render();
    this.furnace?.render();
  }

  // ---------- carregar o forno ----------

  private async loadFurnace(): Promise<boolean> {
    try {
      const { FurnacePanel } = await import('./FurnacePanel');
      const p = await FurnacePanel.create(this.crafting, this.energy, el('#furnace'));
      p.onToggle = this.toggle;
      p.onCraft = this.handlers.craft;
      p.onTake = this.handlers.take;
      p.onPause = this.handlers.pause;
      p.onCancel = this.handlers.cancel;
      if (this.icons) p.setIcons(this.icons.items, this.icons.equip, this.icons.stations);
      this.furnace = p;
      return true;
    } catch (err) {
      // sem WebGL (ou o Pixi não carregou): o forno continua funcionando na tela antiga
      console.warn('tela do forno em Pixi indisponível; usando a antiga', err);
      this.failed = true;
      return false;
    }
  }
}
