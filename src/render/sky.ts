// Fundo: gradiente do céu com estrelas cintilando, desenhado atrás de tudo.
import * as THREE from 'three';
import { PLANET } from '../core/planet';
import { SKY, U } from './materials';

export function createBackdrop(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uTime: SKY.time },
    defines: { ...(PLANET.sky.stars ? { STARS: '' } : {}), ...(PLANET.sky.moons ? { MOONS: '' } : {}) },
    depthWrite: false,
    depthTest: false,
    vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: `
      uniform vec3 uBgTop; uniform vec3 uBgBot; uniform vec2 uRes; uniform float uTime;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      void main(){
        vec2 uv = gl_FragCoord.xy / uRes;
        vec3 c = mix(uBgBot, uBgTop, smoothstep(0.0, 1.0, uv.y));
        #ifdef STARS
        vec2 cell = floor(gl_FragCoord.xy / 3.0);
        float s = h(cell);
        if (s > 0.9965) {
          float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h(cell + 7.0) * 3.0) + s * 60.0);
          c += vec3(0.9, 0.85, 1.0) * tw * smoothstep(0.25, 1.0, uv.y) * 0.9;
        }
        #endif
        #ifdef MOONS
        // Fobos (maior, cruza o céu depressa) e Deimos (um ponto que quase não anda), pálidos no céu de dia
        float asp = uRes.x / uRes.y;
        vec2 q = vec2(uv.x * asp, uv.y);
        vec2 phobos = vec2(fract(0.15 + uTime * 0.004) * (asp + 0.2) - 0.1, 0.86 + 0.05 * sin(uTime * 0.02));
        vec2 deimos = vec2(asp * 0.72 + 0.02 * sin(uTime * 0.003), 0.93);
        float mp = 1.0 - smoothstep(0.010, 0.014, length((q - phobos) * vec2(0.8, 1.0)));
        float md = 1.0 - smoothstep(0.004, 0.0065, length(q - deimos));
        c = mix(c, vec3(0.93, 0.86, 0.80), (mp * 0.55 + md * 0.45) * smoothstep(0.55, 0.9, uv.y));
        // halo azulado no lado do sol (a poeira de Marte espalha o azul para perto do sol)
        c = mix(c, vec3(0.62, 0.74, 0.86), smoothstep(0.75, 0.0, length(q - vec2(0.0, 1.05))) * 0.28);
        #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -1000;
  return m;
}
