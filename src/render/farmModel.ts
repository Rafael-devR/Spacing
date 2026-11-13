// Desenho de um canteiro da estufa (docs/design/ESTUFA.md): a caixa, o solo (seco ou molhado), a batata no estágio dela (ou
// murcha, sem água) e uma luzinha que diz o estado. Os modelos vêm do Blender (tools/models/farm.py, um nó por peça); se o
// arquivo não carregar, caixas simples no lugar. Coordenadas: célula 1×1 centrada em x = z = 0, y = 0 no piso da estufa.
import * as THREE from 'three';
import { modelPart } from './gltfModels';

export interface BedLook {
  soil: boolean;
  wet: boolean;
  /** estágio da batata (0..4) ou null sem planta */
  stage: number | null;
  /** sem água: a planta murcha */
  dry: boolean;
  /** a luz: sem solo/semente (apagada), crescendo (verde), com sede (âmbar), pronta (azul) */
  led: 'off' | 'ok' | 'thirsty' | 'ready';
}

const LED: Record<BedLook['led'], THREE.Color> = {
  off: new THREE.Color(0.08, 0.08, 0.1),
  ok: new THREE.Color(0.4, 2.2, 0.6),
  thirsty: new THREE.Color(2.4, 1.3, 0.2),
  ready: new THREE.Color(0.5, 1.6, 2.6),
};

/** troco simples, se o modelo do Blender faltar */
function fallback(name: string): THREE.Object3D {
  const lam = (c: string): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, c: string, y: number): void => {
    const m = new THREE.Mesh(geo, lam(c));
    m.position.y = y;
    g.add(m);
  };
  if (name === 'planter') add(new THREE.BoxGeometry(0.9, 0.42, 0.9), '#c3c7d2', 0.21);
  else if (name === 'soil_dry' || name === 'soil_wet') add(new THREE.BoxGeometry(0.8, 0.04, 0.8), name === 'soil_dry' ? '#8a6446' : '#4f3424', 0.4);
  else if (name.startsWith('potato')) {
    const k = name === 'potato_dry' ? 0.6 : Number(name.slice(-1)) / 4 + 0.15;
    add(new THREE.ConeGeometry(0.3 * k + 0.05, 0.6 * k, 6), name === 'potato_dry' ? '#9a8a40' : '#5aa04a', 0.42 + 0.3 * k);
  }
  return g;
}

const part = (name: string): THREE.Object3D => modelPart('farm', name) ?? fallback(name);

export class BedView {
  readonly group = new THREE.Group();
  private readonly soilDry = part('soil_dry');
  private readonly soilWet = part('soil_wet');
  private readonly stages: THREE.Object3D[] = [0, 1, 2, 3, 4].map((i) => part(`potato_${i}`));
  private readonly dry = part('potato_dry');
  private readonly led: THREE.MeshBasicMaterial;
  private key = '';

  constructor(x: number, y: number, z: number) {
    const box = part('planter');
    this.group.add(box, this.soilDry, this.soilWet, ...this.stages, this.dry);
    this.group.position.set(x + 0.5, y, z + 0.5);
    // a luz de cada canteiro tem a própria cor
    this.led = new THREE.MeshBasicMaterial({ color: LED.off, toneMapped: false });
    box.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && /^fx_led/.test(o.name)) (o as THREE.Mesh).material = this.led;
    });
    this.set({ soil: false, wet: false, stage: null, dry: false, led: 'off' });
  }

  set(l: BedLook): void {
    const key = JSON.stringify(l);
    if (key === this.key) return;
    this.key = key;
    this.soilDry.visible = l.soil && !l.wet;
    this.soilWet.visible = l.soil && l.wet;
    // murcha só depois de brotar (a semente enterrada não muda)
    const wilted = l.dry && l.stage !== null && l.stage >= 1 && l.stage < 4;
    this.stages.forEach((s, i) => (s.visible = l.stage === i && !wilted));
    this.dry.visible = wilted;
    this.led.color.copy(LED[l.led]);
  }

  dispose(): void {
    this.led.dispose();
  }
}
