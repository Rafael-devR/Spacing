// Luz ambiente e sol com sombra que segue o jogador.
import * as THREE from 'three';
import { PLANET } from '../core/planet';
import { SUN_DIRECTION } from '../data/power';

const SUN_OFFSET = new THREE.Vector3(...SUN_DIRECTION);

export class Lights {
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  /** tamanho de um texel da sombra em unidades do mundo (evita tremulação ao andar) */
  private texel = 0.05;
  /** meia largura da área com sombra; 0 força recalcular */
  extent = 0;

  constructor(scene: THREE.Scene) {
    const L = PLANET.light;
    this.hemi = new THREE.HemisphereLight(L.sky, L.ground, L.hemi);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(L.sun, L.sunPower);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
  }

  setShadowSize(size: number, extent: number): void {
    const sun = this.sun;
    const cam = sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 90;
    cam.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        (sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
      }
    }
    this.texel = (extent * 2) / size;
    this.extent = extent;
  }

  follow(target: THREE.Vector3): void {
    const t = this.texel;
    const x = Math.round(target.x / t) * t;
    const z = Math.round(target.z / t) * t;
    this.sun.target.position.set(x, target.y, z);
    this.sun.position.set(x + SUN_OFFSET.x, target.y + SUN_OFFSET.y, z + SUN_OFFSET.z);
  }
}
