// Números da sobrevivência (docs/design/SOBREVIVENCIA.md). Ponto de partida para ajustar em teste.
import { PLANET } from '../core/planet';

export interface SuitData {
  id: string;
  name: string;
  /** segundos de oxigênio andando (escala 0..100) */
  o2Seconds: number;
  /** multiplicador do consumo de oxigênio parado */
  o2IdleMul: number;
  /** multiplicador do consumo de oxigênio minerando */
  o2MineMul: number;
  /** bateria gasta por segundo de furadeira ligada */
  drillDrain: number;
}

export const SUITS = {
  emergency: {
    id: 'emergency',
    name: 'Traje de emergência',
    o2Seconds: 480,
    o2IdleMul: 0.8,
    o2MineMul: 1.4,
    drillDrain: 0.8,
  },
} satisfies Record<string, SuitData>;

export type SuitId = keyof typeof SUITS;

export const SURVIVAL = {
  /** raio da área pressurizada do módulo de pouso (blocos) */
  pressureRadius: 4.5,
  /** recarga por segundo dentro da área pressurizada */
  refill: { o2: 25, battery: 15, integrity: 5 },
  /** dano por segundo sem oxigênio */
  asphyxiaDps: 8,
  /** velocidade da furadeira sem bateria */
  noBatteryDrillRate: 1 / 3,
  /** queda: sem dano até esta velocidade de impacto (m/s) */
  fallSafeSpeed: PLANET.physics.fallSafeSpeed,
  /** dano por m/s acima do limite */
  fallDamagePerSpeed: 6,
  /** meteoro: dano máximo no centro e raio de alcance */
  meteorMaxDamage: 60,
  meteorRadius: 7,
  /** avisos de oxigênio (fração 0..1): nível 1 e nível 2 */
  o2Warn: [0.3, 0.15] as const,
  /** aviso de bateria fraca (fração) */
  batteryWarn: 0.2,
  /** segundos de invulnerabilidade ao renascer */
  respawnInvulnerable: 3,
  /** distância para recolher itens caídos (blocos) */
  pickupRadius: 1.2,
} as const;

/**
 * Necessidades do corpo, ainda **desligadas** (docs/design/BASE.md): a fome consome energia e a energia vem
 * da comida (`food` em data/items.ts). Ligar = `enabled: true`, medidor no HUD e comida no jogo.
 */
export const NEEDS = {
  energy: {
    enabled: false,
    max: 100,
    /** quanto a fome tira da energia por minuto */
    hungerPerMinute: 1.2,
  },
} as const;
