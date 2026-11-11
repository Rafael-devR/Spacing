// Equipamentos: ficam no traje, fora do inventário (docs/design/BASE.md).
// Cada equipamento ocupa um encaixe; crescer = acrescentar encaixes e equipamentos aqui.
import { DRILLS, type DrillId } from './drills';

/** encaixes do traje (mais tarde: capacete, tanque extra, mochila...) */
export type EquipSlot = 'drill' | 'map';

export type EquipId = 'map' | 'drill_iron' | 'drill_crystal';

export interface EquipData {
  name: string;
  slot: EquipSlot;
  /** texto curto da bancada */
  description: string;
  /** só nas brocas: qual broca de data/drills.ts este equipamento é */
  drill?: DrillId;
}

export const EQUIPMENT: Record<EquipId, EquipData> = {
  map: {
    name: 'Mapa',
    slot: 'map',
    description: 'Tablet no pulso do traje: abre o mapa da cratera com a sonda, a base, o objetivo e os itens (botão do tablet ou M).',
  },
  drill_iron: { name: DRILLS.iron.name, slot: 'drill', description: DRILLS.iron.description, drill: 'iron' },
  drill_crystal: { name: DRILLS.crystal.name, slot: 'drill', description: DRILLS.crystal.description, drill: 'crystal' },
};

/** na ordem em que aparecem na mochila */
export const EQUIP_SLOTS: EquipSlot[] = ['drill', 'map'];

export function isEquipId(v: unknown): v is EquipId {
  return typeof v === 'string' && v in EQUIPMENT;
}
