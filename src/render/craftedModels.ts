// Formas dos itens fabricados (barra, tijolo, vidro, carretel, cilindro, pó, pastilha, chip): geometria low poly
// com cor por vértice, no mesmo material das pedras soltas (ícones e itens no chão). Ver data/items.ts (`icon.model`).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CraftedModel } from '../data/items';

/** prepara uma parte: sem índice, sem uv, normais planas e uma cor (com leve variação por face) */
function part(geo: THREE.BufferGeometry, hex: THREE.ColorRepresentation, x = 0, y = 0, z = 0, vary = 0.08): THREE.BufferGeometry {
  geo.translate(x, y, z);
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < n; i += 3) {
    const f = 1 - vary / 2 + (((i * 7919) % 97) / 97) * vary;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = c.r * f;
      colors[(i + k) * 3 + 1] = c.g * f;
      colors[(i + k) * 3 + 2] = c.b * f;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** barra trapezoidal (lingote) */
function ingot(color: string): THREE.BufferGeometry[] {
  const g = new THREE.CylinderGeometry(0.5, 0.62, 0.32, 4, 1);
  g.rotateY(Math.PI / 4);
  g.scale(1.25, 1, 0.62);
  const light = new THREE.Color(color).offsetHSL(0, 0, 0.12);
  const top = new THREE.BoxGeometry(0.62, 0.02, 0.24);
  return [part(g, color, 0, 0.16), part(top, light, 0, 0.33)];
}

function brick(color: string): THREE.BufferGeometry[] {
  const dark = new THREE.Color(color).offsetHSL(0, 0, -0.12);
  return [
    part(new THREE.BoxGeometry(0.9, 0.36, 0.48), color, 0, 0.18, 0, 0.18),
    part(new THREE.BoxGeometry(0.2, 0.04, 0.2), dark, -0.22, 0.37, 0),
    part(new THREE.BoxGeometry(0.2, 0.04, 0.2), dark, 0.22, 0.37, 0),
  ];
}

/** placa de vidro em pé num suporte */
function pane(color: string): THREE.BufferGeometry[] {
  const frame = '#7d8494';
  return [
    part(new THREE.BoxGeometry(0.78, 0.7, 0.06), color, 0, 0.45, 0, 0.02),
    part(new THREE.BoxGeometry(0.86, 0.1, 0.22), frame, 0, 0.05, 0),
    part(new THREE.BoxGeometry(0.3, 0.06, 0.07), '#ffffff', -0.15, 0.62, 0.02, 0),
  ];
}

/** carretel de fibra */
function spool(color: string): THREE.BufferGeometry[] {
  const flange = '#c3c7d2';
  const a = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10);
  const b = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10);
  const core = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 10);
  for (const g of [a, b, core]) g.rotateZ(Math.PI / 2);
  return [part(a, flange, -0.28, 0.42), part(b, flange, 0.28, 0.42), part(core, color, 0, 0.42, 0, 0.2)];
}

/** cilindro de gás com faixa e válvula */
function tank(color: string): THREE.BufferGeometry[] {
  const body = '#e9ebf0';
  return [
    part(new THREE.CylinderGeometry(0.26, 0.26, 0.8, 8), body, 0, 0.4),
    part(new THREE.SphereGeometry(0.26, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), color, 0, 0.8),
    part(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 8), color, 0, 0.45),
    part(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 6), '#5b6070', 0, 1.1),
  ];
}

/** montinho de pó numa bandeja */
function powder(color: string): THREE.BufferGeometry[] {
  return [
    part(new THREE.CylinderGeometry(0.5, 0.44, 0.1, 8), '#7d8494', 0, 0.05),
    part(new THREE.ConeGeometry(0.38, 0.36, 7), color, 0, 0.28, 0, 0.1),
  ];
}

/** pastilha de silício (disco fino com brilho de grade) */
function wafer(color: string): THREE.BufferGeometry[] {
  const light = new THREE.Color(color).offsetHSL(0.02, 0.1, 0.16);
  return [
    part(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 12), color, 0, 0.03, 0, 0.02),
    part(new THREE.BoxGeometry(0.5, 0.02, 0.5), light, 0, 0.07),
  ];
}

/** placa verde com chip preto e contatos dourados */
function chip(color: string): THREE.BufferGeometry[] {
  const out = [
    part(new THREE.BoxGeometry(0.9, 0.06, 0.62), color, 0, 0.03),
    part(new THREE.BoxGeometry(0.34, 0.08, 0.34), '#1c1d24', 0.08, 0.1, 0),
  ];
  for (let i = 0; i < 4; i++) out.push(part(new THREE.BoxGeometry(0.08, 0.03, 0.12), '#ffc23a', -0.38 + i * 0.1, 0.07, 0.27, 0));
  out.push(part(new THREE.BoxGeometry(0.12, 0.05, 0.12), '#9fb4dc', -0.26, 0.08, -0.12));
  return out;
}

/** prancheta: folha azul de projeto com linhas claras e um ponto de holograma */
function plan(color: string): THREE.BufferGeometry[] {
  const line = '#d7f0f5';
  return [
    part(new THREE.BoxGeometry(0.9, 0.05, 0.66), color, 0, 0.025, 0, 0.04),
    part(new THREE.BoxGeometry(0.62, 0.02, 0.04), line, 0, 0.06, -0.14, 0),
    part(new THREE.BoxGeometry(0.62, 0.02, 0.04), line, 0, 0.06, 0.02, 0),
    part(new THREE.BoxGeometry(0.4, 0.02, 0.04), line, -0.11, 0.06, 0.18, 0),
    part(new THREE.BoxGeometry(0.1, 0.03, 0.1), '#4fd1e8', 0.3, 0.07, 0.2, 0),
  ];
}

const BUILDERS: Record<CraftedModel, (color: string) => THREE.BufferGeometry[]> = {
  ingot, brick, pane, spool, tank, powder, wafer, chip, plan,
};

/** geometria inteira do item (centrada em x e z, apoiada em y = 0) */
export function craftedGeometry(model: CraftedModel, color: string): THREE.BufferGeometry {
  const parts = BUILDERS[model](color);
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g ?? new THREE.BoxGeometry(0.5, 0.5, 0.5);
}
