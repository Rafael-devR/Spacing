// Medidores do traje: oxigênio, bateria e integridade (docs/design/SOBREVIVENCIA.md).
// Roda no passo fixo, não desenha nada e publica eventos; o Game decide a resposta.
import type { DeathCause, GameBus, Meter, Vec3Like } from '../app/events';
import { ITEMS, type ItemId } from '../data/items';
import { NEEDS, SURVIVAL, SUITS, type SuitData, type SuitId } from '../data/survival';

export interface SurvivalSave {
  suit: SuitId;
  o2: number;
  battery: number;
  integrity: number;
  /** energia do corpo (só quando NEEDS.energy estiver ligado) */
  energy?: number;
}

export interface SurvivalDeps {
  events: GameBus;
  /** posição atual do jogador */
  position: () => Vec3Like;
  /** o jogador está andando (consome mais oxigênio que parado) */
  moving: () => boolean;
  /** a furadeira está ligada neste passo */
  mining: () => boolean;
  /** centro da área pressurizada (módulo de pouso) */
  pressureCenter: () => Vec3Like;
  /** dentro da base: pressurizado e protegido de meteoros */
  sheltered?: () => boolean;
  /** multiplicador do gasto de bateria da broca em uso (1 = broca inicial) */
  drillDrain?: () => number;
}

const clamp = (v: number): number => Math.max(0, Math.min(100, v));

export class Survival {
  o2 = 100;
  battery = 100;
  integrity = 100;
  /** energia do corpo, 0..100 (desligada por enquanto: NEEDS.energy.enabled) */
  energy: number = NEEDS.energy.max;
  suitId: SuitId = 'emergency';
  dead = false;
  /** segundos restantes sem levar dano */
  invulnerable = 0;
  /** dentro da área pressurizada neste passo */
  inPressure = false;
  private o2Level: 0 | 1 | 2 = 0;
  private batteryLevel: 0 | 1 = 0;
  private asphyxia = false;

  constructor(
    private readonly d: SurvivalDeps,
    saved?: SurvivalSave | null,
  ) {
    if (saved) {
      this.suitId = saved.suit in SUITS ? saved.suit : 'emergency';
      this.o2 = clamp(saved.o2);
      this.battery = clamp(saved.battery);
      this.integrity = clamp(saved.integrity) || 100; // salvou morto: volta inteiro
      if (typeof saved.energy === 'number') this.energy = clamp(saved.energy);
    }
    this.o2Level = this.levelFor(this.o2);
    this.batteryLevel = this.battery / 100 < SURVIVAL.batteryWarn ? 1 : 0;
    d.events.on('meteor:impact', ({ distance }) => {
      if (this.d.sheltered?.()) return;
      if (distance < SURVIVAL.meteorRadius) this.damage(SURVIVAL.meteorMaxDamage * (1 - distance / SURVIVAL.meteorRadius), 'meteor');
    });
    d.events.on('player:land', ({ speed }) => {
      if (speed > SURVIVAL.fallSafeSpeed) this.damage((speed - SURVIVAL.fallSafeSpeed) * SURVIVAL.fallDamagePerSpeed, 'fall');
    });
  }

  get suit(): SuitData {
    return SUITS[this.suitId];
  }

  /** velocidade da furadeira (cai sem bateria) */
  drillRate(): number {
    return this.battery > 0 ? 1 : SURVIVAL.noBatteryDrillRate;
  }

  step(dt: number): void {
    if (this.dead) return;
    const { d } = this;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    const p = d.position(), c = d.pressureCenter();
    const inside =
      (Math.hypot(p.x - c.x, p.z - c.z) < SURVIVAL.pressureRadius && Math.abs(p.y - c.y) < 4) || !!d.sheltered?.();
    if (inside !== this.inPressure) {
      this.inPressure = inside;
      d.events.emit('suit:recharge', { on: inside });
    }

    const mining = d.mining();
    if (inside) {
      this.o2 = clamp(this.o2 + SURVIVAL.refill.o2 * dt);
      this.battery = clamp(this.battery + SURVIVAL.refill.battery * dt);
      this.integrity = clamp(this.integrity + SURVIVAL.refill.integrity * dt);
    } else {
      const s = this.suit;
      const mul = mining ? s.o2MineMul : d.moving() ? 1 : s.o2IdleMul;
      this.o2 = clamp(this.o2 - (100 / s.o2Seconds) * mul * dt);
    }
    if (mining && this.battery > 0) this.battery = clamp(this.battery - this.suit.drillDrain * (d.drillDrain?.() ?? 1) * dt);

    if (NEEDS.energy.enabled) this.energy = clamp(this.energy - (NEEDS.energy.hungerPerMinute / 60) * dt);

    this.updateWarnings();

    const noAir = this.o2 <= 0;
    if (noAir !== this.asphyxia) {
      this.asphyxia = noAir;
      d.events.emit('suit:asphyxia', { on: noAir });
    }
    if (noAir) this.damage(SURVIVAL.asphyxiaDps * dt, 'asphyxia', true);
  }

  private levelFor(o2: number): 0 | 1 | 2 {
    const f = o2 / 100;
    return f <= SURVIVAL.o2Warn[1] ? 2 : f <= SURVIVAL.o2Warn[0] ? 1 : 0;
  }

  private updateWarnings(): void {
    const level = this.levelFor(this.o2);
    if (level !== this.o2Level) {
      // avisa ao piorar; ao melhorar só quando volta ao normal (evita repetir perto do limite)
      if (level > this.o2Level || level === 0) this.warn('o2', level);
      this.o2Level = level;
    }
    const bl: 0 | 1 = this.battery / 100 < SURVIVAL.batteryWarn ? 1 : 0;
    if (bl !== this.batteryLevel) {
      this.batteryLevel = bl;
      this.warn('battery', bl);
    }
  }

  private warn(meter: Meter, level: 0 | 1 | 2): void {
    this.d.events.emit('suit:warning', { meter, level });
  }

  /**
   * Causa dano à integridade. `continuous` = dano por segundo (asfixia): não publica
   * 'player:damaged' a cada passo, só a morte.
   */
  damage(amount: number, cause: DeathCause, continuous = false): void {
    if (this.dead || amount <= 0) return;
    if (this.invulnerable > 0 && !continuous) return;
    this.integrity = clamp(this.integrity - amount);
    if (!continuous) this.d.events.emit('player:damaged', { amount, cause, integrity: this.integrity });
    if (this.integrity <= 0) {
      this.dead = true;
      const p = this.d.position();
      this.d.events.emit('player:died', { x: p.x, y: p.y, z: p.z, cause });
    }
  }

  /** Comer: devolve energia se o item for comida. Retorna false se não for (ainda nada é comida). */
  eat(item: ItemId): boolean {
    const food = ITEMS[item].food;
    if (!food) return false;
    this.energy = clamp(this.energy + food.energy);
    return true;
  }

  /** Descansar na base: traje cheio. (Com a energia ligada, o descanso não substitui a comida.) */
  rest(): void {
    if (this.dead) return;
    this.o2 = this.battery = this.integrity = 100;
    this.updateWarnings();
  }

  /** Traje de emergência novo: medidores cheios e alguns segundos sem dano. */
  respawn(): void {
    this.suitId = 'emergency';
    this.o2 = this.battery = this.integrity = 100;
    this.dead = false;
    this.invulnerable = SURVIVAL.respawnInvulnerable;
    if (this.asphyxia) {
      this.asphyxia = false;
      this.d.events.emit('suit:asphyxia', { on: false });
    }
    if (this.o2Level !== 0) this.warn('o2', 0);
    if (this.batteryLevel !== 0) this.warn('battery', 0);
    this.o2Level = 0;
    this.batteryLevel = 0;
  }

  serialize(): SurvivalSave {
    const out: SurvivalSave = { suit: this.suitId, o2: this.o2, battery: this.battery, integrity: this.integrity };
    if (NEEDS.energy.enabled) out.energy = this.energy;
    return out;
  }
}
