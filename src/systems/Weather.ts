// Clima de Marte (docs/design/MARTE.md): tempestades de poeira que chegam, ficam e passam. Puro (sem Three.js): o
// MarsDirector lê `level` (0 calmo .. 1 tempestade) e o vento, e decide o que mostrar.
import { mulberry32 } from '../core/noise';

export type WeatherPhase = 'calm' | 'coming' | 'storm' | 'clearing';

/** durações em segundos: [mínimo, máximo] */
export const WEATHER = {
  calm: [110, 220],
  coming: [22, 22],
  storm: [55, 95],
  clearing: [25, 25],
  /** o primeiro calmo é mais curto: a primeira tempestade chega cedo para o jogador ver */
  firstCalm: [60, 90],
} as const;

/** nível de poeira no fim de cada fase */
const TARGET: Record<WeatherPhase, number> = { calm: 0, coming: 0.35, storm: 1, clearing: 0 };

export class Weather {
  phase: WeatherPhase = 'calm';
  /** tempo que falta na fase */
  left: number;
  /** poeira no ar agora, 0..1 */
  level = 0;
  /** direção do vento (radianos) e força (blocos/s) */
  windAngle: number;
  private from = 0;
  private dur: number;
  private readonly rand: () => number;

  constructor(seed = 1) {
    this.rand = mulberry32(seed);
    this.windAngle = this.rand() * Math.PI * 2;
    this.dur = this.left = this.pick(WEATHER.firstCalm);
  }

  private pick([a, b]: readonly [number, number]): number {
    return a + (b - a) * this.rand();
  }

  get windSpeed(): number {
    return 1 + this.level * 5;
  }

  get windX(): number {
    return Math.cos(this.windAngle) * this.windSpeed;
  }

  get windZ(): number {
    return Math.sin(this.windAngle) * this.windSpeed;
  }

  /** Avança o tempo. Devolve a fase nova quando ela muda (para avisos e sons). */
  update(dt: number): WeatherPhase | null {
    this.windAngle += (this.rand() - 0.5) * 0.02 * dt * 10;
    this.left -= dt;
    // o nível anda suave da fase anterior para a meta desta
    const k = Math.min(1, 1 - this.left / this.dur);
    const ease = k * k * (3 - 2 * k);
    this.level = this.from + (TARGET[this.phase] - this.from) * ease;
    if (this.left > 0) return null;
    this.from = TARGET[this.phase];
    const next: WeatherPhase = this.phase === 'calm' ? 'coming' : this.phase === 'coming' ? 'storm' : this.phase === 'storm' ? 'clearing' : 'calm';
    this.phase = next;
    this.dur = this.left = this.pick(WEATHER[next]);
    if (next === 'coming') this.windAngle = this.rand() * Math.PI * 2;
    return next;
  }
}
