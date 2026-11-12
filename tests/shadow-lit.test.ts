import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHADOW_LINE, litOnlyShadows } from '../src/render/materials';

describe('sombra só nas faces voltadas para o sol', () => {
  it('o trecho do Three.js que a troca procura existe (se o Three.js mudar, este teste avisa)', () => {
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain(SHADOW_LINE);
  });

  it('troca o include por um texto que só lê a sombra quando a face recebe luz', () => {
    const out = litOnlyShadows('void main(){\n#include <lights_fragment_begin>\n}');
    expect(out).not.toContain('#include <lights_fragment_begin>');
    expect(out).not.toContain(SHADOW_LINE);
    expect(out).toContain('dot( geometryNormal, directLight.direction ) > 0.0 ) directLight.color *= getShadow(');
    // o resto do trecho (luz ambiente, outras luzes) continua igual
    const rest = THREE.ShaderChunk.lights_fragment_begin.split(SHADOW_LINE);
    for (const part of rest) expect(out).toContain(part.trim().slice(0, 200));
  });
});
