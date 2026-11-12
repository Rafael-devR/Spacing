// Pós-processamento (bloom, correção de cor) e presets de qualidade.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { SKY } from './materials';

/**
 * Uma única passada de tela cheia no fim: soma o bloom, aplica o mapeamento de tons e a conversão para sRGB (o que o
 * OutputPass fazia numa passada separada) e depois a correção de cor, a vinheta, o ruído e a aberração cromática.
 * Cada leitura da aberração passa por `scene()`, então o resultado é o mesmo de quando eram passadas em sequência.
 * `toneMapping()` e `linearToOutputTexel()` vêm do prefixo que o Three.js põe em todo ShaderMaterial.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, tBloom: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uDesat: { value: 0 }, uHurt: { value: 0 }, uDark: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tBloom; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    uniform float uDesat; uniform float uHurt; uniform float uDark;
    vec3 scene(vec2 uv){
      vec3 c = texture2D(tDiffuse, uv).rgb;
      #ifdef USE_BLOOM
      vec4 b = texture2D(tBloom, uv);
      c += b.rgb * b.a;
      #endif
      #ifdef TONE_MAPPING
      c = toneMapping(c);
      #endif
      return linearToOutputTexel(vec4(c, 1.0)).rgb;
    }
    void main(){
      vec2 dir = vUv - 0.5;
      float ca = dot(dir, dir) * 0.009;
      #ifdef FX_CHROMA
      vec3 c = vec3(scene(vUv + dir * ca).r, scene(vUv).g, scene(vUv - dir * ca).b);
      #else
      vec3 c = scene(vUv);
      #endif
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
      #ifdef FX_VIGNETTE
      c *= mix(0.74, 1.0, smoothstep(1.0, 0.3, length(d)));
      #endif
      // sobrevivência: perde a cor (asfixia), borda vermelha (dano), escurece (morte)
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(lum), uDesat);
      float edge = smoothstep(0.3, 0.95, length(d));
      c = mix(c, vec3(0.85, 0.07, 0.05), uHurt * edge * 0.8);
      c *= 1.0 - uDark;
      #ifdef FX_NOISE
      float n = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.022;
      #endif
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Bloom que NÃO soma o resultado por cima da imagem: ele para depois de misturar as faixas e deixa o brilho pronto
 * em `bloomTexture`. Quem soma é a passada final (GradeShader), que já lê a imagem de qualquer jeito. Isso poupa uma
 * passada de tela cheia sobre o alvo com MSAA. A cadeia de desfoque continua a mesma do UnrealBloomPass, que já
 * começa na METADE da resolução do desenho (e vai caindo pela metade a cada faixa).
 */
const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

class BloomOnlyPass extends UnrealBloomPass {
  get bloomTexture(): THREE.Texture {
    return this.renderTargetsHorizontal[0].texture;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const oldClear = new THREE.Color();
    renderer.getClearColor(oldClear);
    const oldAlpha = renderer.getClearAlpha();
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    // 1. só o que passa do limite de brilho, na metade da resolução
    (this.highPassUniforms as Record<string, { value: unknown }>).tDiffuse.value = readBuffer.texture;
    (this.highPassUniforms as Record<string, { value: unknown }>).luminosityThreshold.value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.fsQuad.render(renderer);

    // 2. desfoca cada faixa (horizontal e vertical), cada uma com metade do tamanho da anterior
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const mat = this.separableBlurMaterials[i];
      this.fsQuad.material = mat;
      mat.uniforms.colorTexture.value = input.texture;
      mat.uniforms.direction.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      mat.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      mat.uniforms.direction.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    // 3. mistura as faixas na primeira (renderTargetsHorizontal[0]); a soma sobre a imagem fica com a passada final
    this.fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    renderer.setClearColor(oldClear, oldAlpha);
    renderer.autoClear = oldAuto;
  }
}

export type QualityName = 'baixo' | 'medio' | 'alto';

export interface QualityPreset {
  pixelRatio: number;
  /** tamanho do mapa de sombras; 0 = sem sombra */
  shadow: number;
  samples: number;
  bloom: boolean;
  radius: number;
  /** efeitos da passada final (cada um custa um pouco por pixel) */
  chromatic: boolean;
  vignette: boolean;
  noise: boolean;
}

export const QUALITY: Record<QualityName, QualityPreset> = {
  baixo: { pixelRatio: 1, shadow: 1024, samples: 0, bloom: false, radius: 3, chromatic: true, vignette: true, noise: true },
  // MSAA 2× (era 4×) na Média e na Alta: com a resolução alta as bordas já saem finas, e o MSAA era o efeito mais caro
  medio: { pixelRatio: 1.5, shadow: 2048, samples: 2, bloom: false, radius: 3, chromatic: true, vignette: true, noise: true },
  alto: { pixelRatio: 2, shadow: 2048, samples: 2, bloom: true, radius: 4, chromatic: true, vignette: true, noise: true },
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
  /** escala da resolução dinâmica (1 = a que o jogador escolheu) */
  private dyn = 1;
  /** só no teste de desempenho: o que sobrepor ao preset e a escala da resolução (1 = a do jogo) */
  private bench: { over: Partial<QualityPreset> | null; scale: number } = { over: null, scale: 1 };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  build(q: QualityPreset, w: number, h: number): void {
    this.base = { q, w, h };
    this.dyn = 1; // a resolução dinâmica recomeça do máximo (quem chama zera o ResolutionScaler junto)
    this.construct();
  }

  private construct(): void {
    const { w, h } = this.base as { q: QualityPreset; w: number; h: number };
    const q = { ...(this.base as { q: QualityPreset }).q, ...this.bench.over };
    const r = this.renderer;
    const pr = this.ratio(q.pixelRatio, w, h);
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
      const bloom = new BloomOnlyPass(new THREE.Vector2(w / 2, h / 2), 0.42, 0.55, 1.0);
      this.bloom = bloom;
      c.addPass(bloom);
      this.grade.uniforms.tBloom.value = bloom.bloomTexture;
    }
    // o bloom (se houver) é somado dentro da passada final, junto com o mapeamento de tons e a correção de cor
    this.setGradeDefine('USE_BLOOM', q.bloom);
    this.setGradeDefine('FX_CHROMA', q.chromatic);
    this.setGradeDefine('FX_VIGNETTE', q.vignette);
    this.setGradeDefine('FX_NOISE', q.noise);
    c.addPass(this.grade);
    this.composer = c;
    this.resize(w, h, pr);
  }

  /** A resolução nunca passa da densidade real da tela nem do que a placa aceita numa textura. */
  private ratio(preset: number, w: number, h: number): number {
    const maxPr = this.renderer.capabilities.maxTextureSize / Math.max(w, h);
    return Math.min(Math.min(window.devicePixelRatio || 1, preset) * this.bench.scale * this.dyn, maxPr);
  }

  /**
   * Resolução dinâmica (render/scaler.ts): multiplica a resolução por `k` (0,6 a 1) sem refazer os passes. Redimensiona só
   * os alvos de desenho, o que custa um quadro mais lento uma vez por degrau.
   */
  setScale(k: number): void {
    if (k === this.dyn) return;
    this.dyn = k;
    if (!this.base || !this.composer) return;
    const { q, w, h } = this.base;
    const pr = this.ratio({ ...q, ...this.bench.over }.pixelRatio, w, h);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.resize(w, h, pr);
  }

  private setGradeDefine(name: string, on: boolean): void {
    const defines = this.gradeMaterial.defines as Record<string, string>;
    if (on === (name in defines)) return;
    if (on) defines[name] = '';
    else delete defines[name];
    this.gradeMaterial.needsUpdate = true;
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

  /** amostras de MSAA que o jogo pediu (o teste de desempenho liga o MSAA com esse valor) */
  get gameSamples(): number {
    return this.base?.q.samples ?? 0;
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
    this.dyn = 1; // o teste mede na resolução escolhida, sem a escala dinâmica de antes
    this.bloom?.dispose();
    this.construct();
  }

  render(t: number): void {
    this.grade.uniforms.uTime.value = t;
    SKY.time.value = t;
    this.composer?.render();
  }
}
