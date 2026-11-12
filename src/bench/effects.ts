// Liga e desliga efeitos SÓ DENTRO DO TESTE, na memória, para medir o custo de cada um. Nenhum efeito é removido do
// jogo e nenhum arquivo de shader é tocado: o texto do shader de correção de cor é alterado em tempo de execução
// (nesta cópia, na memória) e o jogo recarrega depois do teste. Ver docs/design/BENCHMARK.md.
import * as THREE from 'three';
import type { EffectId } from '../data/bench';
import type { Post, QualityPreset } from '../render/post';

/** Trechos do shader de correção de cor (src/render/post.ts) e o que os substitui quando o efeito é desligado. */
export const GRADE_PATCHES: Record<'chromatic' | 'vignette' | 'noise', { find: string; replace: string }[]> = {
  chromatic: [
    {
      find: 'vec3 c = vec3(scene(vUv + dir * ca).r, scene(vUv).g, scene(vUv - dir * ca).b);',
      replace: 'vec3 c = scene(vUv);',
    },
  ],
  vignette: [{ find: 'c *= mix(0.74, 1.0, smoothstep(1.0, 0.3, length(d)));', replace: '' }],
  noise: [{ find: 'c += (n - 0.5) * 0.022;', replace: '' }],
};

export type GradeEffect = keyof typeof GRADE_PATCHES;

/** Devolve o shader sem os efeitos pedidos. Um trecho que não existe mais no shader é erro (o teste não mede às cegas). */
export function patchGrade(source: string, off: readonly GradeEffect[]): string {
  let out = source;
  for (const id of off) {
    for (const p of GRADE_PATCHES[id]) {
      if (!out.includes(p.find)) throw new Error(`teste de desempenho: trecho do efeito "${id}" não encontrado no shader`);
      out = out.replace(p.find, p.replace);
    }
  }
  return out;
}

export interface EffectDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  post: Post;
  particles: { mesh: THREE.Object3D };
  /** materiais com brilho de cristal (USE_GLOW) */
  glowMaterials: THREE.Material[];
}

/** Valores dos efeitos que o preset de qualidade em uso pede (para saber o que está ligado no jogo agora). */
export function presetHas(id: EffectId, q: QualityPreset): boolean | null {
  if (id === 'bloom') return q.bloom;
  if (id === 'msaa') return q.samples > 0;
  return null;
}

export class EffectToggles {
  private readonly gradeSource: string;
  private readonly fog: THREE.FogBase | null;
  private readonly shadowLights: THREE.Light[] = [];
  private readonly off = new Set<GradeEffect>();

  constructor(private readonly d: EffectDeps) {
    this.gradeSource = d.post.gradeMaterial.fragmentShader;
    this.fog = d.scene.fog;
    d.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && l.castShadow) this.shadowLights.push(l);
    });
  }

  /** O efeito está ligado no jogo agora? (estado de partida) */
  activeNow(id: EffectId, q: QualityPreset): boolean {
    switch (id) {
      case 'bloom':
      case 'msaa':
        return presetHas(id, q) as boolean;
      case 'chromatic':
        return q.chromatic;
      case 'vignette':
        return q.vignette;
      case 'noise':
        return q.noise;
      case 'shadow':
        return this.shadowLights.length > 0;
      case 'fog':
        return this.fog !== null;
      case 'glow':
        return this.d.glowMaterials.some((m) => m.defines && 'USE_GLOW' in m.defines);
      default:
        return true;
    }
  }

  /** Liga ou desliga um efeito. Troque um por vez e chame `restore()` ao terminar. */
  set(id: EffectId, on: boolean): void {
    const { d } = this;
    switch (id) {
      case 'bloom':
        d.post.benchSet({ bloom: on }, this.scale);
        break;
      case 'msaa':
        d.post.benchSet({ samples: on ? d.post.gameSamples || 4 : 0 }, this.scale);
        break;
      case 'shadow':
        for (const l of this.shadowLights) l.castShadow = on;
        break;
      case 'chromatic':
      case 'vignette':
      case 'noise':
        if (on) this.off.delete(id);
        else this.off.add(id);
        d.post.gradeMaterial.fragmentShader = patchGrade(this.gradeSource, [...this.off]);
        d.post.gradeMaterial.needsUpdate = true;
        break;
      case 'fog':
        d.scene.fog = on ? this.fog : null;
        break;
      case 'glow':
        for (const m of d.glowMaterials) {
          const defs = (m.defines ??= {}) as Record<string, string>;
          if (on) defs.USE_GLOW = '';
          else delete defs.USE_GLOW;
          m.needsUpdate = true;
        }
        break;
      case 'particles':
        d.particles.mesh.visible = on;
        break;
    }
    this.precompile();
  }

  /** escala de resolução em uso (mantida ao trocar bloom/MSAA) */
  scale = 1;

  /** Muda a resolução do desenho (multiplica o pixel ratio do jogo). Devolve false se o aparelho não comporta. */
  setScale(k: number, maxTexture: number): boolean {
    const { d } = this;
    const size = d.renderer.getSize(new THREE.Vector2());
    const pr = d.renderer.getPixelRatio() / this.scale;
    if (Math.max(size.x, size.y) * pr * k > maxTexture) return false;
    this.scale = k;
    d.post.benchSet(null, k);
    return true;
  }

  /** Volta tudo ao que o jogo pediu. */
  restore(): void {
    const { d } = this;
    for (const l of this.shadowLights) l.castShadow = true;
    d.scene.fog = this.fog;
    for (const m of d.glowMaterials) {
      (m.defines as Record<string, string>).USE_GLOW = '';
      m.needsUpdate = true;
    }
    d.particles.mesh.visible = true;
    this.off.clear();
    d.post.gradeMaterial.fragmentShader = this.gradeSource;
    d.post.gradeMaterial.needsUpdate = true;
    this.scale = 1;
    d.post.benchSet(null, 1);
    this.precompile();
  }

  /** Recompila já, fora da medição, os shaders que o ajuste invalidou (senão o primeiro quadro medido paga isso). */
  private precompile(): void {
    try {
      this.d.renderer.compile(this.d.scene, this.d.camera);
    } catch {
      // a medição segue: o aquecimento do passo absorve a compilação
    }
  }
}
