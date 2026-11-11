// Equipamentos: ficam no traje, fora do inventário (docs/design/BASE.md).
// Cada equipamento ocupa um encaixe; crescer = acrescentar encaixes e equipamentos aqui.

/** encaixes do traje (mais tarde: capacete, tanque extra, ferramenta, mochila...) */
export type EquipSlot = 'map';

export type EquipId = 'map';

export interface EquipData {
  name: string;
  slot: EquipSlot;
  /** texto curto da bancada */
  description: string;
}

export const EQUIPMENT: Record<EquipId, EquipData> = {
  map: {
    name: 'Mapa',
    slot: 'map',
    description: 'Mapa da cratera no pulso do traje. Fica equipado; em breve abre o tablet de navegação.',
  },
};

export const EQUIP_SLOTS: EquipSlot[] = ['map'];

export function isEquipId(v: unknown): v is EquipId {
  return typeof v === 'string' && v in EQUIPMENT;
}
