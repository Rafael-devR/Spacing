// Equipamentos no traje, fora do inventário (docs/design/BASE.md). Um encaixe por tipo.
import type { GameBus } from '../app/events';
import { EQUIPMENT, EQUIP_SLOTS, isEquipId, type EquipId, type EquipSlot } from '../data/equipment';

export type EquipmentSave = Partial<Record<EquipSlot, EquipId>>;

export class Equipment {
  private readonly slots = new Map<EquipSlot, EquipId>();

  constructor(
    private readonly events?: GameBus,
    saved: EquipmentSave | null = null,
  ) {
    if (saved)
      for (const slot of EQUIP_SLOTS) {
        const id = saved[slot];
        if (isEquipId(id) && EQUIPMENT[id].slot === slot) this.slots.set(slot, id);
      }
  }

  has(id: EquipId): boolean {
    return this.slots.get(EQUIPMENT[id].slot) === id;
  }

  inSlot(slot: EquipSlot): EquipId | null {
    return this.slots.get(slot) ?? null;
  }

  /** Equipa (trocando o que estiver no encaixe). */
  equip(id: EquipId): void {
    const slot = EQUIPMENT[id].slot;
    if (this.slots.get(slot) === id) return;
    this.slots.set(slot, id);
    this.events?.emit('equipment:changed', { slot, id });
  }

  serialize(): EquipmentSave {
    return Object.fromEntries(this.slots) as EquipmentSave;
  }
}
