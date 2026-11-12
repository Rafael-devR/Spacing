// Pós-processamento (bloom, correção de cor) e presets de qualidade.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { SKY } from './materials';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uDesat: { value: 0 }, uHurt: { value: 0 }, uDark: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    uniform float uDesat; uniform float uHurt; uniform float uDark;
    void main(){
      vec2 dir = vUv - 0.5;
      float ca = dot(dir, dir) * 0.009;
      vec3 c = vec3(texture2D(tDiffuse, vUv + dir * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - dir * ca).b);
      // luz vazando do canto do sol
      vec2 lp = (vUv - vec2(0.0, 1.0)) * vec2(uRes.x / uRes.y, 1.0);
      float leak = smoothstep(1.2, 0.0, length(lp));
      c += vec3(1.0, 0.72, 0.48) * leak * leak * 0.08;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.16);
      c += (1.0 - smoothstep(0.0, 0.5, l)) * vec3(-0.008, -0.004, 0.03);
      c += smoothstep(0.55, 1.0, l) * vec3(0.03, 0.012, -0.018);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.16);
      vec2 d = vUv - 0.5; d.x *= uRes.x / uRes.y;
      c *= mix(0.74, 1.0, smoothstep(1.0, 0.3, length(d)));
      // sobrevivência: perde a cor (asfixia), borda vermelha (dano), escurece (morte)
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(lum), uDesat);
      float edge = smoothstep(0.3, 0.95, length(d));
      c = mix(c, vec3(0.85, 0.07, 0.05), uHurt * edge * 0.8);
      c *= 1.0 - uDark;
      float n = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.022;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export type QualityName = 'baixo' | 'medio' | 'alto';

export interface QualityPreset {
  pixelRatio: number;
  shadow: number;
  samples: number;
  bloom: boolean;
  radius: number;
}

export const QUALITY: Record<QualityName, QualityPreset> = {
  baixo: { pixelRatio: 1, shadow: 1024, samples: 0, bloom: false, radius: 3 },
  medio: { pixelRatio: 1.5, shadow: 2048, samples: 4, bloom: false, radius: 3 },
  alto: { pixelRatio: 2, shadow: 2048, samples: 4, bloom: true, radius: 4 },
};

export const QUALITY_ORDER: QualityName[] = ['baixo', 'medio', 'alto'];

export function isQualityName(v: unknown): v is QualityName {
  return typeof v === 'string' && v in QUALITY;
}

export class Post {
  /**
   * Cena por cima de tudo (o tablet do mapa). É desenhada numa passada própria depois do mundo, com a profundidade
   * limpa: nada do mundo (telhado da base, partículas, névoa, objetos transparentes) consegue cobri-la.
   */
  readonly overlay = new THREE.Scene();
  private overlayPass: RenderPass | null = null;
  private overlayOn = false;
  private composer: EffectComposer | null = null;
  private readonly grade = new ShaderPass(GradeShader);
  bloom: UnrealBloomPass | null = null;
  /** última construção pedida pelo jogo (o teste de desempenho refaz a partir dela e depois volta a ela) */
  private base: { q: QualityPreset; w: number; h: number } | null = null;
  /** só no teste de desempenho: o que sobrepor ao preset e a escala da resolução (1 = a do jogo) */
  private bench: { over: Partial<QualityPreset> | null; scale: number } = { over: null, scale: 1 };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  build(q: QualityPreset, w: number, h: number): void {
    this.base = { q, w, h };
    this.construct();
  }

  private construct(): void {
    const { w, h } = this.base as { q: QualityPreset; w: number; h: number };
    const q = { ...(this.base as { q: QualityPreset }).q, ...this.bench.over };
    const r = this.renderer;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio) * this.bench.scale;
    r.setPixelRatio(pr);
    r.setSize(w, h, false);
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: q.samples });
    const c = new EffectComposer(r, rt);
    c.setPixelRatio(pr);
    c.setSize(w, h);
    c.addPass(new RenderPass(this.scene, this.camera));
    const ov = new RenderPass(this.overlay, this.camera);
    ov.clear = false;
    ov.clearDepth = true;
    ov.enabled = this.overlayOn;
    this.overlayPass = ov;
    c.addPass(ov);
    this.bloom = null;
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.42, 0.55, 1.0);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    c.addPass(this.grade);
    this.composer = c;
    this.resize(w, h, pr);
  }

  resize(w: number, h: number, pr = this.renderer.getPixelRatio()): void {
    if (this.base) {
      this.base.w = w;
      this.base.h = h;
    }
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    SKY.res.set(w * pr, h * pr);
    (this.grade.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
  }

  /** Liga a passada do overlay (só enquanto há algo nele: não custa nada com o mapa fechado). */
  setOverlay(on: boolean): void {
    this.overlayOn = on;
    if (this.overlayPass) this.overlayPass.enabled = on;
  }

  /** Efeitos de tela da sobrevivência, cada um de 0 a 1. */
  setEffects(desat: number, hurt: number, dark: number): void {
    this.grade.uniforms.uDesat.value = desat;
    this.grade.uniforms.uHurt.value = hurt;
    this.grade.uniforms.uDark.value = dark;
  }

  /** as passadas do pós-processamento, na ordem (o teste de desempenho mede cada uma) */
  get passes(): readonly Pass[] {
    return this.composer?.passes ?? [];
  }

  /** material da passada de correção de cor (o teste de desempenho liga e desliga trechos dele, só na memória) */
  get gradeMaterial(): THREE.ShaderMaterial {
    return this.grade.material as THREE.ShaderMaterial;
  }

  /**
   * SÓ PARA O TESTE DE DESEMPENHO: refaz o pós-processamento com partes do preset trocadas (bloom, MSAA) e/ou a
   * resolução multiplicada. `null` e escala 1 voltam ao que o jogo pediu. Não mexe nos shaders nem nas preferências.
   */
  benchSet(over: Partial<QualityPreset> | null, scale = 1): void {
    if (!this.base) return;
    this.bench = { over, scale };
    this.bloom?.dispose();
    this.construct();
  }

  render(t: number): void {
    this.grade.uniforms.uTime.value = t;
    SKY.time.value = t;
    this.composer?.render();
  }
}
