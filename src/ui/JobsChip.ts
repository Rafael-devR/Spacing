// Trabalhos das estações no HUD (docs/design/CRAFTING.md): um selo por estação com o ícone do que está sendo
// fabricado e o tempo que falta, ou "pronto". Assim o jogador sabe, lá fora, quando voltar à base.
import { EQUIPMENT, type EquipId } from '../data/equipment';
import { ITEMS, type ItemId } from '../data/items';
import type { RecipeOutput } from '../data/recipes';
import { STATIONS, type StationId } from '../data/stations';
import { t } from '../i18n';
import type { Crafting } from '../systems/Crafting';
import { el, mmss } from './dom';

export class JobsChip {
  private readonly root = el('#jobs');
  private icons: { items: Record<ItemId, string>; equip: Record<EquipId, string>; stations: Partial<Record<StationId, string>> } | null = null;
  private last = '';
  private t = 0;

  constructor(private readonly crafting: Crafting) {}

  setIcons(items: Record<ItemId, string>, equip: Record<EquipId, string>, stations: Partial<Record<StationId, string>>): void {
    this.icons = { items, equip, stations };
  }

  private icon(o: RecipeOutput): string {
    if (!this.icons) return '';
    if (o.kind === 'item') return this.icons.items[o.item];
    if (o.kind === 'equip') return this.icons.equip[o.equip];
    return this.icons.stations[o.station] ?? '';
  }

  /** a cada quadro; o DOM só muda quando o texto muda (no máximo 4 vezes por segundo) */
  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const html = this.crafting
      .activeJobs()
      .map((view) => {
        const station = view.station;
        const o = view.recipe.outputs[0];
        const name = o.kind === 'item' ? ITEMS[o.item].name : o.kind === 'equip' ? EQUIPMENT[o.equip].name : STATIONS[o.station].name;
        const time = view.ready ? t('craft.status.ready') : Number.isFinite(view.remaining) ? mmss(view.remaining) : '—';
        return `<span class="job${view.ready ? ' ready' : ''}" title="${STATIONS[station].name}: ${name}"><img alt="" src="${this.icon(o)}">${time}</span>`;
      })
      .join('');
    if (html !== this.last) {
      this.last = html;
      this.root.innerHTML = html;
    }
  }
}
