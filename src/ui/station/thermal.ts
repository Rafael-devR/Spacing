// Calor e ventoinha do forno (docs/design/ESTACOES.md). Sem desenho: o que a tela mostra de temperatura, resfriamento e brilho sai
// daqui, para testar em Node. A câmara esquenta em poucos segundos com trabalho e esfria devagar sem ele; a ventoinha acelera com o
// calor, tem inércia e continua girando enquanto o forno esfria.
import type { JobView } from '../../systems/Crafting';

/** mistura duas cores 0xRRGGBB (t de 0 a 1) */
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** 0xRRGGBB → '#rrggbb' */
export const css = (c: number): string => '#' + c.toString(16).padStart(6, '0');

/** temperatura ambiente da câmara (°C) */
export const AMBIENT = 22;
/** fim da escala do termômetro (°C) */
export const MAX_TEMP = 1600;

/** quanto a câmara leva para chegar perto do alvo (constante de tempo, s): esquenta rápido, esfria devagar */
const TAU_HEAT = 1.4;
const TAU_COOL = 3.2;
/** a ventoinha acelera rápido e desacelera devagar */
const TAU_FAN_UP = 0.8;
const TAU_FAN_DOWN = 2.8;
/** velocidade máxima da ventoinha (rad/s) */
export const FAN_MAX_SPEED = 15;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** O alvo da câmara: a maior temperatura de processo entre as vagas que trabalham, vezes a energia que chega. */
export function targetTemp(jobs: readonly (JobView | null)[], speed: number): number {
  let top = 0;
  for (const j of jobs) if (j && !j.ready && !j.paused && !j.leftover) top = Math.max(top, j.recipe.process.temp ?? 1200);
  if (top <= 0) return AMBIENT;
  return AMBIENT + (top - AMBIENT) * clamp(speed, 0, 1);
}

/** 0 (ambiente) a 1 (fim da escala) */
export const heat01 = (temp: number): number => clamp((temp - AMBIENT) / (MAX_TEMP - AMBIENT), 0, 1);

/** Rampa do brilho do calor: preto-roxo, brasa, laranja, amarelo, quase branco. */
const RAMP: [number, number][] = [
  [AMBIENT, 0x15202a],
  [300, 0x3a1c1c],
  [600, 0x7a1f1f],
  [900, 0xd4391a],
  [1100, 0xff6a1a],
  [1300, 0xff9a2a],
  [1450, 0xffc94a],
  [MAX_TEMP, 0xfff1c8],
];

export function heatColor(temp: number): number {
  if (temp <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i];
    if (temp <= t1) {
      const [t0, c0] = RAMP[i - 1];
      return mix(c0, c1, (temp - t0) / (t1 - t0));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export class ThermalModel {
  /** °C da câmara */
  temp = AMBIENT;
  /** 0 a 1: rotação da ventoinha em relação ao máximo */
  fan = 0;
  /** ângulo da ventoinha (rad) */
  angle = 0;

  /** Avança `dt` segundos. `target` vem de `targetTemp`. */
  update(dt: number, target: number): void {
    dt = Math.min(dt, 0.1);
    const tau = target > this.temp ? TAU_HEAT : TAU_COOL;
    this.temp += (target - this.temp) * (1 - Math.exp(-dt / tau));
    if (Math.abs(this.temp - target) < 0.5) this.temp = target;
    // a ventoinha gira se há calor para tirar; um mínimo fraco enquanto a câmara estiver acima do ambiente
    const hot = heat01(this.temp);
    const want = this.temp > AMBIENT + 12 ? clamp(0.14 + hot * 1.05, 0, 1) : 0;
    const tauFan = want > this.fan ? TAU_FAN_UP : TAU_FAN_DOWN;
    this.fan += (want - this.fan) * (1 - Math.exp(-dt / tauFan));
    if (this.fan < 0.002 && want === 0) this.fan = 0;
    this.angle = (this.angle + this.fan * FAN_MAX_SPEED * dt) % (Math.PI * 2);
  }

  get heat(): number {
    return heat01(this.temp);
  }

  /** a ventoinha ainda esfria algo (para mostrar "esfriando") */
  get cooling(): boolean {
    return this.temp > AMBIENT + 25 && this.fan > 0.02;
  }
}

/** "°C" arredondado para o termômetro */
export const tempText = (temp: number): string => `${Math.round(temp)}°C`;
