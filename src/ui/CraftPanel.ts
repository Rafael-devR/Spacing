// Tela da bancada: lista as receitas da estação, mostra o que falta e começa a fabricação.
import { EQUIPMENT, type EquipId } from '../data/equipment';
import { ITEMS, type ItemId } from '../data/items';
import type { Recipe } from '../data/recipes';
import { t } from '../i18n';
import type { Crafting } from '../systems/Crafting';
import { el } from './dom';

export class CraftPanel {
  onCraft: ((r: Recipe) => void) | null = null;
  onToggle: ((open: boolean) => void) | null = null;
  private readonly root = el('#craft');
  private readonly list = el('#craft-list');
  private itemIcons = {} as Record<ItemId, string>;
  private equipIcons = {} as Record<EquipId, string>;

  constructor(private readonly crafting: Crafting) {
    el('#craft-close').addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  setIcons(items: Record<ItemId, string>, equip: Record<EquipId, string>): void {
    this.itemIcons = items;
    this.equipIcons = equip;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    if (this.open) return;
    this.root.hidden = false;
    this.render();
    this.onToggle?.(true);
  }

  close(): void {
    if (!this.open) return;
    this.root.hidden = true;
    this.onToggle?.(false);
  }

  render(): void {
    if (!this.open) return;
    this.list.innerHTML = '';
    for (const r of this.crafting.recipes('workbench')) {
      const check = this.crafting.check(r);
      const out = r.output;
      const name = out.kind === 'item' ? ITEMS[out.item].name : EQUIPMENT[out.equip].name;
      const icon = out.kind === 'item' ? this.itemIcons[out.item] : this.equipIcons[out.equip];
      const desc = out.kind === 'equip' ? EQUIPMENT[out.equip].description : '';
      const row = document.createElement('div');
      row.className = 'recipe';
      row.dataset.recipe = r.id;
      const needs = (Object.entries(r.inputs) as [ItemId, number][])
        .map(([item, n]) => {
          const have = this.crafting.has(item);
          const ok = have >= n;
          return `<span class="need ${ok ? 'ok' : 'miss'}" title="${ITEMS[item].name}"><img alt="" src="${this.itemIcons[item]}">${Math.min(have, n)}/${n}</span>`;
        })
        .join('');
      const tag = out.kind === 'equip' ? `<span class="recipe-tag">${t('craft.equipTag')}</span>` : '';
      const label = check.owned
        ? t('craft.owned')
        : check.busy
          ? t('craft.busy')
          : check.ok
            ? t('craft.make')
            : t('craft.missing');
      row.innerHTML =
        `<img alt="" src="${icon}">` +
        `<div class="recipe-info"><div><span class="recipe-name">${name}</span>${tag}</div>` +
        (desc ? `<span class="recipe-desc">${desc}</span>` : '') +
        `<div class="recipe-needs">${needs}</div></div>` +
        `<button class="cta" type="button" ${check.ok ? '' : 'disabled'}>${label}</button>`;
      row.querySelector('button')?.addEventListener('click', () => {
        if (!this.crafting.check(r).ok) return;
        this.close();
        this.onCraft?.(r);
      });
      this.list.appendChild(row);
    }
  }
}
