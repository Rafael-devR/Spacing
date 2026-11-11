// Renderização: materiais com shader customizado, céu, luzes, pós-processamento e partículas.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Paleta do céu/neblina (compartilhada entre fundo e neblina)
export const SKY = {
  top: new THREE.Color('#1a1636'),
  bottom: new THREE.Color('#5d4f86'),
  res: new THREE.Vector2(1, 1),
  time: { value: 0 },
};
export const U = {
  uBgTop: { value: SKY.top },
  uBgBot: { value: SKY.bottom },
  uRes: { value: SKY.res },
  uTime: SKY.time,
  uMistY: { value: 10 },
  uMistColor: { value: new THREE.Color('#8b8fd8') },
};

// Injeta no material Lambert:
// - brilho nas bordas dos blocos e granulado em espaço de mundo
// - "contas de vidro" do regolito que cintilam conforme a câmera se move
// - brilho próprio pulsante para cores muito claras (cristais)
// - névoa baixa nas crateras e neblina que se mistura ao gradiente do céu
export function patchMaterial(mat, { edge = false, grain = false, glow = false, name }) {
  mat.defines = mat.defines || {};
  if (edge) mat.defines.USE_EDGE = '';
  if (grain) mat.defines.USE_GRAIN = '';
  if (glow) mat.defines.USE_GLOW = '';
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
  };
  return mat;
}

export function createMaterials() {
  const terrain = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { edge: true, grain: true, glow: true, name: 'terrain' });
  const props = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { glow: true, name: 'props' });
  const debris = patchMaterial(new THREE.MeshLambertMaterial({ flatShading: true }), { name: 'debris' });
  return { terrain, props, debris };
}

// Fundo: gradiente + estrelas cintilando (desenhado atrás de tudo)
export function createBackdrop() {
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

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight('#a39ae6', '#5b4a44', 1.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0dc', 3.3);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const offset = new THREE.Vector3(-14, 26, 9);
  return {
    hemi,
    sun,
    setShadowSize(size, extent) {
      const cam = sun.shadow.camera;
      cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent;
      cam.near = 1; cam.far = 90;
      cam.updateProjectionMatrix();
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      this.texel = (extent * 2) / size;
      this.extent = extent;
    },
    follow(target) {
      const t = this.texel || 0.05;
      const x = Math.round(target.x / t) * t, z = Math.round(target.z / t) * t;
      sun.target.position.set(x, target.y, z);
      sun.position.set(x + offset.x, target.y + offset.y, z + offset.z);
    },
  };
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
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
      float n = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.022;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export const QUALITY = {
  baixo: { pixelRatio: 1, shadow: 1024, samples: 0, bloom: false, radius: 3 },
  medio: { pixelRatio: 1.5, shadow: 2048, samples: 4, bloom: false, radius: 3 },
  alto: { pixelRatio: 2, shadow: 2048, samples: 4, bloom: true, radius: 4 },
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.grade = new ShaderPass(GradeShader);
  }
  build(q, w, h) {
    const r = this.renderer;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
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
  resize(w, h, pr = this.renderer.getPixelRatio()) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    SKY.res.set(w * pr, h * pr);
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
  }
  render(t) {
    this.grade.uniforms.uTime.value = t;
    SKY.time.value = t;
    this.composer.render();
  }
}

// ---------- Partículas (detritos e poeira) ----------
export class Particles {
  constructor(scene, max = 320) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.p = [];
    this.free = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, white);
      this.p.push({ life: 0 });
      this.free.push(i);
    }
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
  }
  spawn(x, y, z, vx, vy, vz, size, rgb, life = 1, gravity = 7, grow = false) {
    const i = this.free.pop();
    if (i === undefined) return;
    const p = this.p[i];
    Object.assign(p, { x, y, z, vx, vy, vz, size, life, max: life, gravity, grow, rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 10 });
    this.c.setRGB(rgb[0], rgb[1], rgb[2]);
    this.mesh.setColorAt(i, this.c);
    this.mesh.instanceColor.needsUpdate = true;
  }
  burst(x, y, z, rgb, n = 10, power = 3) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random()) * power;
      const shade = 0.8 + Math.random() * 0.35;
      this.spawn(x, y, z, Math.cos(a) * sp, 1.5 + Math.random() * power, Math.sin(a) * sp,
        0.09 + Math.random() * 0.12, [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade], 0.9 + Math.random() * 0.7);
    }
  }
  dust(x, y, z, n = 3, spread = 0.25) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(x + Math.cos(a) * spread, y + 0.05, z + Math.sin(a) * spread,
        Math.cos(a) * 0.8, 0.4 + Math.random() * 0.6, Math.sin(a) * 0.8, 0.12 + Math.random() * 0.1,
        [0.62, 0.58, 0.56], 0.6 + Math.random() * 0.4, -0.2, true);
    }
  }
  update(dt) {
    let changed = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      changed = true;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        this.free.push(i);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.vx *= 1 - dt * 1.2; p.vz *= 1 - dt * 1.2;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.spin * dt; p.ry += p.spin * dt;
      const t = p.life / p.max;
      const sc = p.grow ? p.size * (1 + (1 - t) * 1.6) * Math.min(1, t * 3) : p.size * Math.min(1, t * 2.5);
      this.q.setFromEuler(this.e.set(p.rx, p.ry, 0));
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m);
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Poeira flutuando perto da câmera
export function createMotes(scene) {
  const n = 140;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 40;
    pos[i * 3 + 1] = Math.random() * 10;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({
    size: 0.16, map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.55,
    depthWrite: false, color: '#ffe9c8', fog: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return {
    update(dt, center, t) {
      const a = geo.attributes.position.array;
      for (let i = 0; i < n; i++) {
        let x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
        x += Math.sin(t * 0.3 + i) * dt * 0.25;
        y += dt * 0.12;
        z += Math.cos(t * 0.27 + i * 1.7) * dt * 0.25;
        if (x - center.x > 20) x -= 40; else if (x - center.x < -20) x += 40;
        if (z - center.z > 20) z -= 40; else if (z - center.z < -20) z += 40;
        if (y - center.y > 9) y -= 11; else if (y - center.y < -2) y += 11;
        a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// Renderiza um objeto 3D em uma imagem (ícones do inventário)
export function renderIcon(renderer, object, size = 192) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#c9c3ff', '#6b5a50', 2.2));
  const d = new THREE.DirectionalLight('#fff3e2', 3.4);
  d.position.set(-2, 4, 3);
  scene.add(d);
  const box = new THREE.Box3().setFromObject(object);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const k = 1.25 / Math.max(s.x, s.y, s.z);
  object.scale.multiplyScalar(k);
  object.position.sub(c.multiplyScalar(k));
  scene.add(object);
  const cam = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 20);
  cam.position.set(3, 2.6, 3);
  cam.lookAt(0, 0, 0);
  const rt = new THREE.WebGLRenderTarget(size, size);
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lut[i] = 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = ((size - 1 - y) * size + x) * 4, di = (y * size + x) * 4;
      img.data[di] = lut[buf[si]];
      img.data[di + 1] = lut[buf[si + 1]];
      img.data[di + 2] = lut[buf[si + 2]];
      img.data[di + 3] = buf[si + 3];
    }
  }
  g.putImageData(img, 0, 0);
  return cv.toDataURL();
}
