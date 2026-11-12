// Interior da base como cena à parte (docs/adr/0006-interior-da-base-como-camada-isolada.md).
// A base continua no mesmo lugar do mundo, mas com o astronauta dentro a câmera passa a desenhar outra cena: a de
// dentro. Nela ficam só a base, o astronauta, as partículas e a luz de dentro (luz própria, com sombra). A cena de
// fora não é desenhada, então terreno, pedras, céu, módulo de pouso e meteoros não custam nada lá dentro.
// Ao trocar, as raízes listadas são movidas de uma cena para a outra (na hora, atrás das portas de bloqueio).
// A neblina é a mesma nas duas cenas (o Game só a empurra para longe): assim o shader não recompila.
import * as THREE from 'three';
import { Lights } from './lights';

/** camada do three.js que a câmera vê dentro da base (a 0 é a do mundo) */
export const INTERIOR_LAYER = 1;

/** Põe o objeto e tudo dentro dele na camada do interior (continua na do mundo também). */
export function showIndoors(obj: THREE.Object3D): void {
  if (obj.userData.exteriorOnly) return; // o grupo inteiro fica de fora, inclusive o que for posto nele depois
  if (obj.userData.interiorOnly) {
    obj.traverse((o) => o.layers.set(INTERIOR_LAYER));
    return;
  }
  obj.layers.enable(INTERIOR_LAYER);
  for (const c of obj.children) showIndoors(c);
}

/**
 * Marca uma parte que só a câmera de dentro vê (some da camada do mundo). Com o casco do Blender, as paredes montadas em
 * código são só o forro de dentro: de fora quem aparece é o casco.
 */
export function interiorOnly<T extends THREE.Object3D>(obj: T): T {
  obj.userData.interiorOnly = true;
  return obj;
}

/** Marca uma parte que só existe do lado de fora (pernas, degrau, círculo da porta, telhado). */
export function exteriorOnly<T extends THREE.Object3D>(obj: T): T {
  obj.userData.exteriorOnly = true;
  return obj;
}

/** Luz de dentro: teto claro e frio, chão quente, sol só como luz de teto (dá as sombras). */
const INSIDE = { hemiSky: new THREE.Color('#dfe8ff'), hemiGround: new THREE.Color('#6e5a4c'), hemi: 1.15, sun: 1.6 };
/** tamanho da sombra do sol de dentro: a base inteira cabe com folga */
const INSIDE_SHADOW = { size: 1024, extent: 9 };

export class IndoorView {
  /** true = câmera vendo a cena de dentro */
  on = false;
  /** a cena de dentro: só o que está na base e a luz de dentro */
  readonly interior = new THREE.Scene();
  /** luz de dentro, separada da de fora (a de fora não é desenhada enquanto se está na base) */
  private readonly lights: Lights;

  /**
   * @param outside a cena do mundo, onde as raízes `moved` começam
   * @param moved o que vai junto para dentro (base, astronauta, partículas)
   */
  constructor(
    private readonly outside: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly moved: THREE.Object3D[],
    fog: THREE.Fog,
  ) {
    this.interior.background = backgroundTexture();
    this.interior.fog = fog;
    this.lights = new Lights(this.interior);
    this.lights.hemi.color.copy(INSIDE.hemiSky);
    this.lights.hemi.groundColor.copy(INSIDE.hemiGround);
    this.lights.hemi.intensity = INSIDE.hemi;
    this.lights.sun.intensity = INSIDE.sun;
    this.lights.setShadowSize(INSIDE_SHADOW.size, INSIDE_SHADOW.extent);
    // o three.js só usa luz que cai numa camada que a câmera vê: a luz de dentro tem de estar na do interior
    this.lights.hemi.layers.enable(INTERIOR_LAYER);
    this.lights.sun.layers.enable(INTERIOR_LAYER);
  }

  /** a cena que deve ser desenhada agora */
  get scene(): THREE.Scene {
    return this.on ? this.interior : this.outside;
  }

  /** Troca de ambiente na hora (acontece atrás das portas da câmara de pressurização). */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const from = on ? this.outside : this.interior;
    const to = on ? this.interior : this.outside;
    for (const o of this.moved) {
      from.remove(o);
      to.add(o);
    }
    this.camera.layers.set(on ? INTERIOR_LAYER : 0);
  }

  /** por quadro, dentro: a sombra do sol de dentro acompanha o astronauta */
  update(target: THREE.Vector3): void {
    if (this.on) this.lights.follow(target);
  }
}

/** fundo de dentro: azul-noite quase preto, com um halo suave no centro (onde fica a sala) */
function backgroundTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(128, 118, 10, 128, 128, 180);
  g.addColorStop(0, '#1b2140');
  g.addColorStop(0.55, '#0d1024');
  g.addColorStop(1, '#05060d');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
