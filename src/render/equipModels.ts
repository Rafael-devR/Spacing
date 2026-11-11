// Modelos dos equipamentos (ícone na mochila e peça impressa na bancada).
import * as THREE from 'three';
import { DRILLS } from '../data/drills';
import { EQUIPMENT, type EquipId } from '../data/equipment';

const lam = (
  hex: THREE.ColorRepresentation,
  extra: THREE.MeshLambertMaterialParameters = {},
): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra });

let mapTex: THREE.CanvasTexture | null = null;

/** tela do tablet no ícone: um mapa simples (grade, curvas de nível, marcadores) bem visível em tamanho pequeno */
function mapTexture(): THREE.CanvasTexture {
  if (mapTex) return mapTex;
  const c = document.createElement('canvas');
  c.width = 288;
  c.height = 192;
  const x = c.getContext('2d')!;
  const bg = x.createRadialGradient(144, 96, 10, 144, 96, 170);
  bg.addColorStop(0, '#0d3a5c');
  bg.addColorStop(1, '#04121f');
  x.fillStyle = bg;
  x.fillRect(0, 0, 288, 192);
  x.strokeStyle = 'rgba(127,231,255,0.18)';
  x.lineWidth = 1;
  for (let i = 0; i <= 288; i += 24) {
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i, 192);
    x.stroke();
  }
  for (let j = 0; j <= 192; j += 24) {
    x.beginPath();
    x.moveTo(0, j);
    x.lineTo(288, j);
    x.stroke();
  }
  x.strokeStyle = 'rgba(127,231,255,0.95)';
  x.lineWidth = 3;
  for (let r = 14; r < 120; r += 18) {
    x.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.15) {
      const rr = r + Math.sin(a * 3 + r) * 5;
      x.lineTo(126 + Math.cos(a) * rr * 1.25, 100 + Math.sin(a) * rr * 0.8);
    }
    x.stroke();
  }
  // base (quadrado) e você (pino laranja)
  x.fillStyle = '#f4f0e8';
  x.fillRect(196, 120, 22, 16);
  x.fillStyle = '#ff7a2f';
  x.beginPath();
  x.arc(206, 54, 13, Math.PI, 0);
  x.lineTo(206, 82);
  x.closePath();
  x.fill();
  x.fillStyle = '#04121f';
  x.beginPath();
  x.arc(206, 54, 5, 0, Math.PI * 2);
  x.fill();
  mapTex = new THREE.CanvasTexture(c);
  mapTex.colorSpace = THREE.SRGBColorSpace;
  return mapTex;
}

/** largura ÷ altura da tela do tablet do ícone */
export const TABLET_ASPECT = 1.5;

/**
 * Tablet do traje: moldura escura grossa, tela, câmera frontal e botão lateral, de frente para +z.
 * A tela mede `aspect` × 1 e fica no centro; a moldura sobra `bezel` de cada lado. Também usado na transição do mapa
 * (app/MapDirector.ts), com a tela mostrando o mapa ao vivo.
 */
export function buildTablet(screen: THREE.Material, aspect = TABLET_ASPECT, bezel = 0.09, lit = true): THREE.Group {
  const g = new THREE.Group();
  const mat = (hex: string): THREE.Material =>
    lit ? new THREE.MeshLambertMaterial({ color: hex, flatShading: true }) : new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const W = aspect + bezel * 2, H = 1 + bezel * 2.4;
  add(new THREE.BoxGeometry(W, H, 0.07), mat('#1d2340'), 0, 0, 0);
  // aro laranja em volta (a cor do traje): deixa claro que é um aparelho, não uma placa
  add(new THREE.BoxGeometry(W + 0.035, H + 0.035, 0.035), mat('#ff7a2f'), 0, 0, -0.012);
  const s = add(new THREE.PlaneGeometry(aspect, 1), screen, 0, -bezel * 0.2, 0.0365);
  s.name = 'screen';
  add(new THREE.CircleGeometry(0.022, 10), mat('#5b6488'), 0, H / 2 - bezel * 0.62, 0.0362); // câmera frontal
  add(new THREE.BoxGeometry(0.035, 0.16, 0.05), mat('#4b4f60'), W / 2 + 0.02, H * 0.22, 0); // botão lateral
  add(new THREE.BoxGeometry(0.12, 0.022, 0.012), mat('#5b6488'), 0, -H / 2 + bezel * 0.5, 0.036); // botão de início
  return g;
}

/** Modelo novo de um equipamento, centrado na origem. */
export function createEquipModel(id: EquipId): THREE.Group {
  const g = new THREE.Group();
  if (id === 'map') {
    // tablet em pé, virado para a câmera dos ícones, com a tela brilhando
    const t = buildTablet(new THREE.MeshBasicMaterial({ map: mapTexture(), toneMapped: false }), TABLET_ASPECT, 0.09);
    t.scale.setScalar(0.62);
    t.rotation.set(-0.28, Math.PI / 4, 0);
    t.traverse((o) => (o.castShadow = true));
    g.add(t);
  }
  const drillId = EQUIPMENT[id].drill;
  if (drillId) {
    // broca de mão: cabo, motor e ponta em cone (a cor e o brilho vêm de data/drills.ts), deitada apontando para +z
    const d = DRILLS[drillId];
    const body = new THREE.Group();
    g.add(body);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      body.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.2, 0.22, 0.5), lam('#283157'), 0, 0, -0.1);
    add(new THREE.BoxGeometry(0.22, 0.05, 0.3), lam('#ff7a2f'), 0, 0.13, -0.08);
    add(new THREE.BoxGeometry(0.1, 0.3, 0.12), lam('#4b4f60'), 0, -0.24, -0.2);
    add(new THREE.CylinderGeometry(0.075, 0.09, 0.18, 8), lam('#8c90a0'), 0, 0, 0.24).rotation.x = Math.PI / 2;
    const bit = add(
      new THREE.ConeGeometry(0.09, 0.5, d.tier >= 2 ? 5 : 6),
      lam(d.bit, d.glow ? { emissive: new THREE.Color(d.glow) } : {}),
      0, 0, 0.58,
    );
    bit.rotation.x = Math.PI / 2;
    // anéis na ponta: mais brocas, mais anéis
    for (let k = 0; k < d.tier; k++) {
      const ring = add(new THREE.TorusGeometry(0.085 - k * 0.02, 0.012, 5, 10), lam('#ff7a2f'), 0, 0, 0.4 + k * 0.1);
      ring.castShadow = false;
    }
    body.rotation.y = -0.6;
  }
  return g;
}
