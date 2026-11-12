// Materiais do jogo: MeshLambertMaterial com GLSL injetado (onBeforeCompile).
// Depende dos nomes internos dos shaders do Three.js 0.160.0 (ver ADR 0001).
import * as THREE from 'three';

/** Paleta do céu e da neblina, compartilhada entre o fundo e todos os materiais. */
export const SKY = {
  top: new THREE.Color('#1a1636'),
  bottom: new THREE.Color('#5d4f86'),
  res: new THREE.Vector2(1, 1),
  time: { value: 0 },
};

/** Uniforms compartilhados por todos os materiais modificados. */
export const U = {
  uBgTop: { value: SKY.top },
  uBgBot: { value: SKY.bottom },
  uRes: { value: SKY.res },
  uTime: SKY.time,
  uMistY: { value: 10 },
  uMistColor: { value: new THREE.Color('#8b8fd8') },
};

/** linha do Three.js 0.160.0 (lights_fragment_begin) que aplica a sombra do sol a cada pixel */
export const SHADOW_LINE =
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';

/**
 * Só consulta a sombra do sol nas faces voltadas para ele. Numa face de costas a luz direta já é zero (Lambert:
 * dot(normal, sol) ≤ 0), então a sombra não muda nada ali, mas custava 16 leituras do mapa de sombra por pixel.
 * A imagem fica idêntica. Troque `#include <lights_fragment_begin>` pelo texto devolvido.
 */
export function litOnlyShadows(fragmentShader: string): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (!chunk.includes(SHADOW_LINE)) throw new Error('sombra: o trecho do Three.js mudou (ver src/render/materials.ts)');
  const fast = chunk.replace(
    SHADOW_LINE,
    SHADOW_LINE.replace('directLight.color *= ( directLight.visible && receiveShadow ) ? ', 'if ( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.0 ) directLight.color *= ').replace(' : 1.0;', ';'),
  );
  return fragmentShader.replace('#include <lights_fragment_begin>', fast);
}

export interface PatchOptions {
  /** brilho nas bordas dos blocos (precisa do atributo aEdge) */
  edge?: boolean;
  /** granulado e contas de vidro cintilantes no topo */
  grain?: boolean;
  /** brilho próprio pulsante para cores de vértice acima de 1.1 */
  glow?: boolean;
  /** nome único do programa (cache de shader) */
  name: string;
}

// Injeta no material Lambert:
// - brilho nas bordas dos blocos e granulado em espaço de mundo
// - "contas de vidro" do regolito que cintilam conforme a câmera se move
// - brilho próprio pulsante para cores muito claras (cristais)
// - névoa baixa nas crateras e neblina que se mistura ao gradiente do céu
export function patchMaterial<M extends THREE.Material>(mat: M, { edge = false, grain = false, glow = false, name }: PatchOptions): M {
  const defines: Record<string, string> = (mat.defines as Record<string, string> | undefined) ?? {};
  if (edge) defines.USE_EDGE = '';
  if (grain) defines.USE_GRAIN = '';
  if (glow) defines.USE_GLOW = '';
  mat.defines = defines;
  mat.customProgramCacheKey = () => 'spacing-' + name;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader =
      '#ifdef USE_EDGE\nattribute vec2 aEdge;\nvarying vec2 vEdge;\n#endif\nvarying vec3 vWP;\nvarying vec3 vWN;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_EDGE
        vEdge = aEdge;
#endif
#ifdef USE_INSTANCING
        vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
        vWN = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader =
      '#ifdef USE_EDGE\nvarying vec2 vEdge;\n#endif\nvarying vec3 vWP;\nvarying vec3 vWN;\nuniform vec3 uBgTop;\nuniform vec3 uBgBot;\nuniform vec2 uRes;\nuniform float uTime;\nuniform float uMistY;\nuniform vec3 uMistColor;\n' +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
#ifdef USE_EDGE
          float ed = min(min(vEdge.x, 1.0 - vEdge.x), min(vEdge.y, 1.0 - vEdge.y));
          diffuseColor.rgb *= 1.0 + 0.11 * (1.0 - smoothstep(0.0, 0.07, ed));
#endif
#ifdef USE_GRAIN
          vec3 gp = floor(vWP * 5.0 + 0.001);
          float gh = fract(sin(dot(gp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          diffuseColor.rgb *= 0.96 + 0.08 * gh;
          if (vWN.y > 0.5) {
            vec3 gc = floor(vWP * 11.0);
            float gr = fract(sin(dot(gc, vec3(127.1, 311.7, 74.7))) * 43758.5453);
            if (gr > 0.982) {
              vec3 vd = normalize(cameraPosition - vWP);
              float tw = sin(uTime * 2.5 + gr * 400.0 + (vd.x + vd.z) * 30.0);
              totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * smoothstep(0.75, 1.0, tw) * 0.9;
            }
          }
#endif`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
#if defined(USE_COLOR) && defined(USE_GLOW)
          float gm = max(vColor.r, max(vColor.g, vColor.b));
          if (gm > 1.1) totalEmissiveRadiance += vColor.rgb * 0.26 * (0.65 + 0.35 * sin(uTime * 2.2 + vWP.x * 0.7 + vWP.z * 0.5));
#endif`,
        )
        .replace(
          '#include <fog_fragment>',
          `#ifdef USE_FOG
          float mist = (1.0 - smoothstep(uMistY - 2.5, uMistY + 1.8, vWP.y)) * 0.42;
          mist *= 0.75 + 0.25 * sin(vWP.x * 0.35 + uTime * 0.4) * sin(vWP.z * 0.3 - uTime * 0.3);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, mist);
          float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
          vec2 suv = gl_FragCoord.xy / uRes;
          vec3 bgc = mix(uBgBot, uBgTop, smoothstep(0.0, 1.0, suv.y));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, bgc, fogFactor);
#endif`,
        );
    shader.fragmentShader = litOnlyShadows(shader.fragmentShader);
  };
  return mat;
}

export interface Materials {
  terrain: THREE.MeshLambertMaterial;
  props: THREE.MeshLambertMaterial;
  debris: THREE.MeshLambertMaterial;
}

export function createMaterials(): Materials {
  const terrain = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {
    edge: true,
    grain: true,
    glow: true,
    name: 'terrain',
  });
  const props = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), {
    glow: true,
    name: 'props',
  });
  const debris = patchMaterial(new THREE.MeshLambertMaterial({ flatShading: true }), { name: 'debris' });
  return { terrain, props, debris };
}
