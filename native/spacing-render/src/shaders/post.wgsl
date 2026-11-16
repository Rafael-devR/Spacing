// Pós-processamento (porte de src/render/post.ts): bloom (só o que passa de 1 de brilho) e uma passada final que soma o bloom,
// aplica os tons ACES do Three.js, converte para sRGB e faz a correção de cor, a aberração cromática, a vinheta, o vazamento de
// luz do canto do sol e o ruído.
struct Post {
  res: vec4<f32>,      // largura, altura, tempo, exposição
  fx: vec4<f32>,       // bloom, cromática, vinheta, ruído (1/0)
  screen: vec4<f32>,   // perde a cor, dano, escurece, clarão
  bloom: vec4<f32>,    // força, limite, 1/largura da fonte, 1/altura da fonte
  shock_n: vec4<f32>,  // x = quantas ondas de choque
  shock_a: array<vec4<f32>, 4>, // centro (0..1, y para cima), raio, força
  shock_b: array<vec4<f32>, 4>, // espessura, brilho da borda, cor separada
};
@group(0) @binding(0) var<uniform> U: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var bloom_tex: texture_2d<f32>;

struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.clip = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  o.uv = vec2<f32>(x, y);
  return o;
}

fn lum(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// 1. só o que passa do limite de brilho (LuminosityHighPassShader), já reduzindo pela metade com 4 amostras
@fragment
fn bright(i: VOut) -> @location(0) vec4<f32> {
  let t = U.bloom.zw;
  var c = vec3<f32>(0.0);
  for (var k = 0; k < 4; k++) {
    let o = vec2<f32>(f32(k & 1) - 0.5, f32(k >> 1) - 0.5) * t;
    let s = textureSampleLevel(src, samp, i.uv + o, 0.0).rgb;
    c += s * smoothstep(U.bloom.y, U.bloom.y + 0.01, lum(s));
  }
  return vec4<f32>(c * 0.25, 1.0);
}

// 2. desce a cadeia (filtro de 13 amostras, o "dual filter" de jogos de celular)
@fragment
fn down(i: VOut) -> @location(0) vec4<f32> {
  let t = U.bloom.zw;
  let uv = i.uv;
  var c = textureSampleLevel(src, samp, uv, 0.0).rgb * 4.0;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(-t.x, -t.y), 0.0).rgb;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(t.x, -t.y), 0.0).rgb;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(-t.x, t.y), 0.0).rgb;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(t.x, t.y), 0.0).rgb;
  return vec4<f32>(c / 8.0, 1.0);
}

// 3. sobe somando (filtro em tenda); quem soma é a mistura aditiva da passada
@fragment
fn up(i: VOut) -> @location(0) vec4<f32> {
  let t = U.bloom.zw;
  let uv = i.uv;
  var c = textureSampleLevel(src, samp, uv + vec2<f32>(-t.x * 2.0, 0.0), 0.0).rgb;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(-t.x, t.y), 0.0).rgb * 2.0;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(0.0, t.y * 2.0), 0.0).rgb;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(t.x, t.y), 0.0).rgb * 2.0;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(t.x * 2.0, 0.0), 0.0).rgb;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(t.x, -t.y), 0.0).rgb * 2.0;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(0.0, -t.y * 2.0), 0.0).rgb;
  c += textureSampleLevel(src, samp, uv + vec2<f32>(-t.x, -t.y), 0.0).rgb * 2.0;
  return vec4<f32>(c / 12.0, 1.0);
}

// tons do Three.js (ACESFilmicToneMapping, r160)
fn aces(color_in: vec3<f32>) -> vec3<f32> {
  let inm = mat3x3<f32>(vec3<f32>(0.59719, 0.07600, 0.02840), vec3<f32>(0.35458, 0.90834, 0.13383), vec3<f32>(0.04823, 0.01566, 0.83777));
  let outm = mat3x3<f32>(vec3<f32>(1.60475, -0.10208, -0.00327), vec3<f32>(-0.53108, 1.10813, -0.07276), vec3<f32>(-0.07367, -0.00605, 1.07602));
  var c = color_in * (U.res.w / 0.6);
  c = inm * c;
  let a = c * (c + 0.0245786) - 0.000090537;
  let b = c * (0.983729 * c + 0.4329510) + 0.238081;
  c = outm * (a / b);
  return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn to_srgb(c: vec3<f32>) -> vec3<f32> {
  return select(pow(c, vec3<f32>(0.41666)) * 1.055 - vec3<f32>(0.055), c * 12.92, c <= vec3<f32>(0.0031308));
}

fn to_linear(c: vec3<f32>) -> vec3<f32> {
  return select(pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)), c / 12.92, c <= vec3<f32>(0.04045));
}

fn scene(uv: vec2<f32>) -> vec3<f32> {
  var c = textureSampleLevel(src, samp, uv, 0.0).rgb;
  if (U.fx.x > 0.5) {
    c += textureSampleLevel(bloom_tex, samp, uv, 0.0).rgb * U.bloom.x;
  }
  return to_srgb(aces(c));
}

@fragment
fn grade(i: VOut) -> @location(0) vec4<f32> {
  let uv = i.uv;
  let asp = U.res.x / U.res.y;
  // ondas de choque (shockwave.ts, ADR 0014): cada onda empurra o ponto lido para dentro ou para fora do anel dela.
  // As contas são em y para cima, como no TS; o uv do wgpu tem y para baixo.
  let up = vec2<f32>(uv.x, 1.0 - uv.y);
  var uvs = up;
  var split = vec2<f32>(0.0);
  var rim = 0.0;
  let n = i32(U.shock_n.x);
  for (var k = 0; k < 4; k++) {
    if (k >= n) {
      break;
    }
    let A = U.shock_a[k];
    let B = U.shock_b[k];
    let d = (up - A.xy) * vec2<f32>(asp, 1.0);
    let dist = length(d);
    let x = (dist - A.z) / max(B.x, 0.0001);
    let t = select(1.0 - smoothstep(0.0, 0.3, x), smoothstep(-1.0, 0.0, x), x < 0.0);
    let lens = t * t * (3.0 - 2.0 * t);
    let push = vec2<f32>(d.x / asp, d.y) / max(dist, 0.0001) * lens * A.w;
    uvs -= push;
    split -= push * B.z * 0.6;
    rim += B.y * exp(-x * x * 18.0);
  }
  let base = vec2<f32>(uvs.x, 1.0 - uvs.y);
  let sp = vec2<f32>(split.x, -split.y);
  let dir = uv - 0.5;
  let ca = dot(dir, dir) * 0.009;
  var c: vec3<f32>;
  if (U.fx.y > 0.5) {
    c = vec3<f32>(scene(base + dir * ca + sp).r, scene(base).g, scene(base - dir * ca - sp).b);
  } else {
    c = scene(base);
  }
  // luz vazando do canto do sol (em cima à esquerda; o uv do wgpu tem y para baixo)
  let lp = (vec2<f32>(uv.x, 1.0 - uv.y) - vec2<f32>(0.0, 1.0)) * vec2<f32>(asp, 1.0);
  let leak = smoothstep(1.2, 0.0, length(lp));
  c += vec3<f32>(1.0, 0.72, 0.48) * leak * leak * 0.08;
  let l = lum(c);
  c = mix(vec3<f32>(l), c, 1.16);
  c += (1.0 - smoothstep(0.0, 0.5, l)) * vec3<f32>(-0.008, -0.004, 0.03);
  c += smoothstep(0.55, 1.0, l) * vec3<f32>(0.03, 0.012, -0.018);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.16);
  var d = dir;
  d.x *= asp;
  if (U.fx.z > 0.5) {
    c *= mix(0.74, 1.0, smoothstep(1.0, 0.3, length(d)));
  }
  let lm = lum(c);
  c = mix(c, vec3<f32>(lm), U.screen.x);
  let edge = smoothstep(0.3, 0.95, length(d));
  c = mix(c, vec3<f32>(0.85, 0.07, 0.05), U.screen.y * edge * 0.8);
  c *= 1.0 - U.screen.z;
  // a linha clara da frente da onda e o clarão da explosão
  c += vec3<f32>(1.0, 0.82, 0.62) * rim * 0.35;
  c = mix(c, vec3<f32>(1.0, 0.93, 0.82), U.screen.w);
  if (U.fx.w > 0.5) {
    let n = fract(sin(dot(uv * U.res.xy + fract(U.res.z) * 91.7, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) * 0.022;
  }
  // a tela é sRGB: o hardware converte de novo, então devolve em linear
  return vec4<f32>(to_linear(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}
