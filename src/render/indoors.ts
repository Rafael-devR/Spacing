// Interior da base como ambiente à parte (docs/adr/0006-interior-da-base-como-camada-isolada.md).
// A base continua no mesmo lugar do mundo, mas, com o astronauta dentro, a câmera passa a ver só a camada
// do interior: a base, o astronauta, as faíscas e as luzes. Terreno, pedras, céu, módulo de pouso, meteoros
// e marcadores somem; o fundo vira o escuro da base e a luz troca para a de dentro.
// A neblina não é desligada (isso recompilaria os shaders): o Game só a empurra para longe.
import * as THREE from 'three';
import type { Lights } from './lights';

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

export class IndoorView {
  /** true = câmera vendo só o interior */
  on = false;
  private readonly background: THREE.Texture;
  private readonly outside: { hemiSky: THREE.Color; hemiGround: THREE.Color; hemi: number; sun: number };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly lights: Lights,
  ) {
    this.background = backgroundTexture();
    const { hemi, sun } = lights;
    this.outside = { hemiSky: hemi.color.clone(), hemiGround: hemi.groundColor.clone(), hemi: hemi.intensity, sun: sun.intensity };
    // as luzes valem nas duas camadas; sem isso o número de luzes mudaria e os shaders recompilariam
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) o.layers.enable(INTERIOR_LAYER);
    });
  }

  /** Troca de ambiente na hora (acontece atrás das portas da câmara de pressurização). */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const { scene, camera, lights } = this;
    if (on) {
      camera.layers.set(INTERIOR_LAYER);
      scene.background = this.background;
    } else {
      camera.layers.set(0);
      scene.background = null;
    }
    const l = on ? INSIDE : this.outside;
    lights.hemi.color.copy(l.hemiSky);
    lights.hemi.groundColor.copy(l.hemiGround);
    lights.hemi.intensity = l.hemi;
    lights.sun.intensity = l.sun;
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
