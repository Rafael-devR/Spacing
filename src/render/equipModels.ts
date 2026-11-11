// Modelos dos equipamentos (ícone na mochila e peça impressa na bancada).
import * as THREE from 'three';
import type { EquipId } from '../data/equipment';

const lam = (
  hex: THREE.ColorRepresentation,
  extra: THREE.MeshLambertMaterialParameters = {},
): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra });

let mapTex: THREE.CanvasTexture | null = null;

/** tela do mapa: curvas de nível da cratera e um ponto "você está aqui" */
function mapTexture(): THREE.CanvasTexture {
  if (mapTex) return mapTex;
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#0c1a3a';
  x.fillRect(0, 0, 192, 128);
  x.strokeStyle = 'rgba(127,231,255,0.85)';
  x.lineWidth = 2;
  for (let r = 10; r < 90; r += 13) {
    x.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.2) {
      const rr = r + Math.sin(a * 3 + r) * 4;
      x.lineTo(84 + Math.cos(a) * rr * 1.2, 66 + Math.sin(a) * rr * 0.8);
    }
    x.stroke();
  }
  x.fillStyle = '#ff7a2f';
  x.beginPath();
  x.arc(130, 44, 6, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#ff7a2f';
  x.lineWidth = 2;
  x.beginPath();
  x.arc(130, 44, 11, 0, Math.PI * 2);
  x.stroke();
  mapTex = new THREE.CanvasTexture(c);
  mapTex.colorSpace = THREE.SRGBColorSpace;
  return mapTex;
}

/** Modelo novo de um equipamento, centrado na origem. */
export function createEquipModel(id: EquipId): THREE.Group {
  const g = new THREE.Group();
  if (id === 'map') {
    // mapa de pulso: tablet com tela de curvas de nível, inclinado para mostrar a tela
    const body = new THREE.Group();
    body.rotation.x = 0.95; // tela virada para a frente (+z) e para cima
    g.add(body);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      body.add(m);
    };
    add(new THREE.BoxGeometry(0.62, 0.07, 0.44), lam('#283157'), 0, 0, 0);
    add(new THREE.BoxGeometry(0.66, 0.05, 0.12), lam('#ff7a2f'), 0, -0.01, -0.25);
    add(new THREE.BoxGeometry(0.66, 0.05, 0.12), lam('#ff7a2f'), 0, -0.01, 0.25);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.34),
      new THREE.MeshBasicMaterial({ map: mapTexture(), toneMapped: false }),
    );
    screen.rotation.x = -Math.PI / 2;
    screen.position.y = 0.036;
    body.add(screen);
    add(
      new THREE.BoxGeometry(0.06, 0.03, 0.06),
      lam('#7fe7ff', { emissive: new THREE.Color('#2a7f99') }),
      0.27,
      0.04,
      -0.17,
    );
  }
  return g;
}
