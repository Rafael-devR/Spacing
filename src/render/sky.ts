// Fundo: gradiente do céu com estrelas cintilando, desenhado atrás de tudo.
import * as THREE from 'three';
import { SKY, U } from './materials';

export function createBackdrop(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uTime: SKY.time },
    depthWrite: false,
    depthTest: false,
    vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: `
      uniform vec3 uBgTop; uniform vec3 uBgBot; uniform vec2 uRes; uniform float uTime;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      void main(){
        vec2 uv = gl_FragCoord.xy / uRes;
        vec3 c = mix(uBgBot, uBgTop, smoothstep(0.0, 1.0, uv.y));
        vec2 cell = floor(gl_FragCoord.xy / 3.0);
        float s = h(cell);
        if (s > 0.9965) {
          float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h(cell + 7.0) * 3.0) + s * 60.0);
          c += vec3(0.9, 0.85, 1.0) * tw * smoothstep(0.25, 1.0, uv.y) * 0.9;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -1000;
  return m;
}
