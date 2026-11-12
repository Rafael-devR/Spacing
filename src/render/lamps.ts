// Luzes de sinalização sem PointLight (docs/design/MODELOS.md): um núcleo pequeno muito claro (o bloom faz o brilho) e dois
// halos aditivos virados para a câmera, um apertado e um largo. Parecem acesas e "vazam" luz em volta, mas não entram na
// conta de luzes dos shaders: não recompilam nada e quase não custam (dois sprites). Não iluminam o chão de verdade.
import * as THREE from 'three';

let haloTexture: THREE.Texture | null = null;

/** degradê radial branco (compartilhado com os itens caídos) */
export function getHaloTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null; // testes sem navegador
  if (haloTexture) return haloTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  haloTexture = new THREE.CanvasTexture(cv);
  return haloTexture;
}

export interface LampOptions {
  /** raio do núcleo */
  size?: number;
  /** diâmetro do halo largo */
  halo?: number;
  /** cor em HDR linear (acima de 1 o bloom pega) */
  color?: THREE.ColorRepresentation;
}

export class SignalLamp {
  readonly group = new THREE.Group();
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly innerMat: THREE.SpriteMaterial;
  private readonly outerMat: THREE.SpriteMaterial;
  private readonly inner: THREE.Sprite;
  private readonly outer: THREE.Sprite;
  private readonly haloSize: number;
  private readonly color = new THREE.Color();

  constructor({ size = 0.08, halo = 1.1, color = new THREE.Color(2.2, 0.25, 0.15) }: LampOptions = {}) {
    this.group.name = 'lamp';
    this.haloSize = halo;
    this.coreMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), this.coreMat);
    core.name = 'lamp_core';
    const sprite = (): THREE.SpriteMaterial =>
      new THREE.SpriteMaterial({
        map: getHaloTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      });
    this.innerMat = sprite();
    this.outerMat = sprite();
    this.inner = new THREE.Sprite(this.innerMat);
    this.outer = new THREE.Sprite(this.outerMat);
    this.inner.renderOrder = this.outer.renderOrder = 2;
    this.group.add(core, this.inner, this.outer);
    this.setColor(color);
    this.set(1);
  }

  setColor(c: THREE.ColorRepresentation): void {
    this.color.set(c);
    this.coreMat.color.copy(this.color);
    this.apply();
  }

  private level = 1;

  /** 0 = apagada, 1 = acesa (valores no meio servem para pulsar) */
  set(level: number): void {
    this.level = Math.max(0, level);
    this.apply();
  }

  private apply(): void {
    const l = this.level;
    this.group.visible = l > 0.02;
    // o núcleo vai do apagado (cor escura) ao aceso
    this.coreMat.color.copy(this.color).multiplyScalar(0.15 + 0.85 * Math.min(1, l));
    // o halo usa a cor sem o excesso do HDR (aditivo sobre a cena já fica forte)
    const max = Math.max(this.color.r, this.color.g, this.color.b, 1);
    this.innerMat.color.copy(this.color).multiplyScalar(1 / max);
    this.outerMat.color.copy(this.innerMat.color);
    this.innerMat.opacity = Math.min(1, l);
    this.outerMat.opacity = 0.45 * l;
    this.inner.scale.setScalar(this.haloSize * 0.4 * (0.8 + 0.2 * l));
    this.outer.scale.setScalar(this.haloSize * (0.7 + 0.3 * l));
  }
}
