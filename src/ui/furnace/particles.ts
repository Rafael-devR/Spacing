// Partículas da tela do forno (docs/design/FORNO.md): fagulhas, brasas, bolhas, fumaça, ar da ventoinha. Sprites reaproveitados
// (nunca criados no meio do jogo), com uma textura macia só. Duas camadas: `glow` soma luz; `smoke` mistura normal.
import { Container, Sprite, Texture } from 'pixi.js';
import { mix } from './theme';

export interface PSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** aceleração (px/s²); ay positivo desce */
  ax?: number;
  ay?: number;
  size: number;
  /** quanto o tamanho multiplica até o fim */
  growTo?: number;
  life: number;
  color: number;
  /** cor no fim da vida (padrão: a mesma) */
  to?: number;
  alpha?: number;
  /** freio por segundo */
  drag?: number;
}

interface P extends PSpec {
  spr: Sprite;
  t: number;
  alive: boolean;
}

/** textura de bolinha macia (círculo com borda que esvanece), feita uma vez em um canvas */
export function softTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (x) {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  }
  return Texture.from(c);
}

class Layer {
  readonly view = new Container();
  private readonly pool: P[] = [];
  private cursor = 0;

  constructor(tex: Texture, count: number, add: boolean) {
    for (let i = 0; i < count; i++) {
      const spr = new Sprite(tex);
      spr.anchor.set(0.5);
      spr.visible = false;
      if (add) spr.blendMode = 'add';
      this.view.addChild(spr);
      this.pool.push({ spr, t: 0, alive: false, x: 0, y: 0, vx: 0, vy: 0, size: 1, life: 1, color: 0xffffff });
    }
  }

  spawn(s: PSpec): void {
    // procura uma livre a partir do cursor; se estiver tudo ocupado, a nova ignora (partículas de enfeite nunca atrasam)
    for (let k = 0; k < this.pool.length; k++) {
      const p = this.pool[(this.cursor + k) % this.pool.length];
      if (p.alive) continue;
      this.cursor = (this.cursor + k + 1) % this.pool.length;
      Object.assign(p, s, { t: 0, alive: true });
      p.spr.visible = true;
      p.spr.tint = s.color;
      p.spr.alpha = 0;
      p.spr.width = p.spr.height = s.size;
      return;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.t += dt;
      if (p.t >= p.life) {
        p.alive = false;
        p.spr.visible = false;
        continue;
      }
      const k = Math.exp(-(p.drag ?? 0) * dt);
      p.vx = (p.vx + (p.ax ?? 0) * dt) * k;
      p.vy = (p.vy + (p.ay ?? 0) * dt) * k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const u = p.t / p.life;
      p.spr.position.set(p.x, p.y);
      const sz = p.size * (1 + ((p.growTo ?? 1) - 1) * u);
      p.spr.width = p.spr.height = sz;
      p.spr.alpha = (p.alpha ?? 1) * Math.min(1, u / 0.12) * (1 - u) * (1 - u * 0.2);
      if (p.to !== undefined) p.spr.tint = mix(p.color, p.to, u);
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.alive = false;
      p.spr.visible = false;
    }
  }

  get active(): number {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }
}

export class Particles {
  readonly glow: Layer;
  readonly smoke: Layer;

  constructor(tex: Texture = softTexture(), glowMax = 220, smokeMax = 80) {
    this.glow = new Layer(tex, glowMax, true);
    this.smoke = new Layer(tex, smokeMax, false);
  }

  update(dt: number): void {
    this.glow.update(dt);
    this.smoke.update(dt);
  }

  clear(): void {
    this.glow.clear();
    this.smoke.clear();
  }

  get active(): number {
    return this.glow.active + this.smoke.active;
  }
}
