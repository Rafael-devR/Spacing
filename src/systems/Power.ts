// Energia da base (docs/design/ENERGIA.md). Nada vem do nada: a eletricidade vem do sol (painéis do telhado e
// painéis colocados no chão, ligados por cabo se estiverem perto), sobra vai para a bateria e falta sai dela. Com a
// bateria vazia e geração menor que o consumo, tudo o que é elétrico anda mais devagar, na proporção do que há.
// O forno não usa a rede: o calor dele é o sol concentrado pelos espelhos (`sun`).
import { POWER } from '../data/power';

export interface PanelInfo {
  key: string;
  x: number;
  z: number;
  /** dentro do alcance do cabo da base */
  linked: boolean;
  /** 0..1 da luz que chega nele (sombra de morro ou de bloco) */
  light: number;
  /** quanto gera agora (kW) */
  kw: number;
}

/** um consumidor ligado agora */
export interface Load {
  id: string;
  kw: number;
}

export interface PowerDeps {
  /** centro da base (alcance do cabo) */
  base: { x: number; z: number };
  /** luz do planeta (Lua 1, Marte 0,43) */
  solar: number;
  /** quanto a sombra deixa passar (0 na Lua, sem ar) */
  shade: number;
  /** painéis colocados no mundo */
  panels(): { key: string; x: number; z: number }[];
  /** 0..1: o painel vê o sol? (null = não dá para saber agora, mantém o último) */
  exposure(x: number, z: number): number | null;
  /** consumidores ligados agora (estações trabalhando, traje recarregando) */
  loads(): Load[];
  /** tempestade de poeira, 0..1 */
  dust?: () => number;
}

export interface PowerSave {
  battery: number;
}

export class Power {
  /** carga da bateria (kJ) */
  battery: number = POWER.batteryKj * POWER.batteryStart;
  /** gerado agora (kW) */
  generation = 0;
  /** pedido agora (kW), com o consumo fixo do habitat */
  demand = 0;
  /** 0..1: quanto do pedido é atendido (1 = tudo anda na velocidade cheia) */
  satisfaction = 1;
  /** 0..1: sol que chega agora (planeta e tempestade) */
  sun = 1;
  /** consumidores do último passo (para a tela de energia) */
  lastLoads: Load[] = [];
  panels: PanelInfo[] = [];
  private readonly light = new Map<string, number>();
  private scanT = 0;

  constructor(
    private readonly d: PowerDeps,
    saved: PowerSave | null = null,
  ) {
    if (saved && Number.isFinite(saved.battery)) this.battery = Math.max(0, Math.min(POWER.batteryKj, saved.battery));
    this.scan();
  }

  get capacity(): number {
    return POWER.batteryKj;
  }

  /** gerado pelos painéis do telhado (kW) */
  get roofKw(): number {
    return POWER.roofPanels * POWER.roofPanelKw * this.sun;
  }

  /** velocidade de quem usa a rede (0..1) */
  get gridSpeed(): number {
    return this.satisfaction;
  }

  /** Revê os painéis (alcance, sombra). Barato: roda a cada segundo. */
  private scan(): void {
    const { base } = this.d;
    this.sun = this.d.solar * (1 - POWER.stormLoss * (this.d.dust?.() ?? 0));
    this.panels = this.d.panels().map((p) => {
      const linked = Math.hypot(p.x + 0.5 - base.x, p.z + 0.5 - base.z) <= POWER.cableReach;
      const seen = this.d.exposure(p.x, p.z);
      if (seen !== null) this.light.set(p.key, seen);
      const lit = this.light.get(p.key) ?? 1;
      const light = this.d.shade + (1 - this.d.shade) * lit;
      return { ...p, linked, light, kw: linked ? POWER.panelKw * light * this.sun : 0 };
    });
  }

  update(dt: number): void {
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 1;
      this.scan();
    }
    this.generation = this.roofKw + this.panels.reduce((s, p) => s + p.kw, 0);
    this.lastLoads = [{ id: 'life', kw: POWER.lifeSupportKw }, ...this.d.loads()];
    this.demand = this.lastLoads.reduce((s, l) => s + l.kw, 0);
    const net = this.generation - this.demand;
    if (net >= 0) {
      this.battery = Math.min(POWER.batteryKj, this.battery + net * dt);
      this.satisfaction = 1;
    } else if (this.battery > 0) {
      this.battery = Math.max(0, this.battery + net * dt);
      this.satisfaction = 1;
    } else this.satisfaction = this.demand > 0 ? Math.max(0, this.generation / this.demand) : 1;
  }

  serialize(): PowerSave {
    return { battery: Math.round(this.battery) };
  }
}
