// Exporta para o jogo nativo (native/assets/) malhas que o jogo web gera em código, para os dois desenharem a mesma coisa sem
// reimplementar os geradores do Three.js: as pedras e minérios soltos (render/models.ts, PropFactory). `npm run golden`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { test } from 'vitest';
import { PROP_TYPES } from '../../src/data/props';
import { PropFactory } from '../../src/render/models';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../native/assets');

/**
 * props.bin: para cada tipo (na ordem de PROP_TYPES) e cada uma das 3 variações: u32 número de vértices, depois os vértices
 * (posição xyz e cor rgb, f32, little-endian; triângulos soltos, 3 vértices por triângulo).
 */
test('pedras e minérios soltos', () => {
  const f = new PropFactory(new THREE.MeshLambertMaterial());
  const chunks: Buffer[] = [];
  for (const t of PROP_TYPES) {
    for (const g of f.geos[t]) {
      const geo = g.index ? g.toNonIndexed() : g;
      const p = geo.attributes.position, c = geo.attributes.color;
      const n = p.count;
      const buf = Buffer.alloc(4 + n * 24);
      buf.writeUInt32LE(n, 0);
      for (let i = 0; i < n; i++) {
        const o = 4 + i * 24;
        buf.writeFloatLE(p.getX(i), o);
        buf.writeFloatLE(p.getY(i), o + 4);
        buf.writeFloatLE(p.getZ(i), o + 8);
        buf.writeFloatLE(c.getX(i), o + 12);
        buf.writeFloatLE(c.getY(i), o + 16);
        buf.writeFloatLE(c.getZ(i), o + 20);
      }
      chunks.push(buf);
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'props.bin'), Buffer.concat(chunks));
  writeFileSync(join(OUT, 'props.json'), JSON.stringify({ types: PROP_TYPES, variants: 3 }) + '\n');
});
