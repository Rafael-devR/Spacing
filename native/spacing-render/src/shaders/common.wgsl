// Uniformes e luz comuns a todos os materiais (porte de src/render/materials.ts e lights.ts; Three.js 0.160 como referência:
// Lambert com luz de hemisfério + sol, divididos por PI, neblina para o gradiente do céu e tons ACES na saída).
struct Globals {
  view_proj: mat4x4<f32>,
  cam_pos: vec4<f32>,      // w = tempo (s)
  cam_fwd: vec4<f32>,      // w = exposição
  sun_dir: vec4<f32>,      // xyz para o sol; w = escuro da caverna (0..1)
  sun_col: vec4<f32>,      // cor * força; w = cintilação do regolito ligada (1/0)
  hemi_sky: vec4<f32>,     // cor * força
  hemi_ground: vec4<f32>,
  bg_top: vec4<f32>,
  bg_bot: vec4<f32>,       // w = estrelas (1/0)
  mist: vec4<f32>,         // rgb da névoa baixa, w = altura dela
  fog: vec4<f32>,          // perto, longe, largura, altura da tela
  lamp: vec4<f32>,         // lanterna do capacete: posição, força
};
@group(0) @binding(0) var<uniform> G: Globals;

const RECIPROCAL_PI: f32 = 0.3183098861837907;
const CAVE_AMBIENT: f32 = 0.05;

fn lambert(albedo: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let w = 0.5 * n.y + 0.5;
  let hemi = mix(G.hemi_ground.rgb, G.hemi_sky.rgb, w);
  let direct = G.sun_col.rgb * max(dot(n, G.sun_dir.xyz), 0.0);
  return (direct + hemi) * albedo * RECIPROCAL_PI;
}

fn lamp_light(albedo: vec3<f32>, wp: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let v = G.lamp.xyz - wp;
  let d = length(v);
  let k = G.lamp.w * (1.0 - smoothstep(1.5, 13.0, d)) * (0.3 + 0.7 * max(dot(n, v / max(d, 0.001)), 0.0));
  return albedo * vec3<f32>(1.0, 0.94, 0.84) * k * 2.0;
}

fn background(frag: vec4<f32>) -> vec3<f32> {
  let uvy = 1.0 - frag.y / G.fog.w;
  return mix(G.bg_bot.rgb, G.bg_top.rgb, smoothstep(0.0, 1.0, uvy));
}

// névoa baixa nas crateras e neblina que vira o gradiente do céu ao longe
fn fog(c: vec3<f32>, wp: vec3<f32>, frag: vec4<f32>, sky: f32) -> vec3<f32> {
  let t = G.cam_pos.w;
  let dark = G.sun_dir.w;
  var mist = (1.0 - smoothstep(G.mist.w - 2.5, G.mist.w + 1.8, wp.y)) * 0.42;
  mist *= 0.75 + 0.25 * sin(wp.x * 0.35 + t * 0.4) * sin(wp.z * 0.3 - t * 0.3);
  mist *= sky;
  var o = mix(c, G.mist.rgb, mist * (1.0 - dark));
  let depth = dot(wp - G.cam_pos.xyz, G.cam_fwd.xyz);
  let f = smoothstep(G.fog.x, G.fog.y, depth);
  let bg = mix(background(frag), vec3<f32>(0.006, 0.006, 0.012), dark);
  return mix(o, bg, f);
}

// tons do Three.js (ACESFilmicToneMapping, r160)
fn aces(color_in: vec3<f32>) -> vec3<f32> {
  let inm = mat3x3<f32>(vec3<f32>(0.59719, 0.07600, 0.02840), vec3<f32>(0.35458, 0.90834, 0.13383), vec3<f32>(0.04823, 0.01566, 0.83777));
  let outm = mat3x3<f32>(vec3<f32>(1.60475, -0.10208, -0.00327), vec3<f32>(-0.53108, 1.10813, -0.07276), vec3<f32>(-0.07367, -0.00605, 1.07602));
  var c = color_in * (G.cam_fwd.w / 0.6);
  c = inm * c;
  let a = c * (c + 0.0245786) - 0.000090537;
  let b = c * (0.983729 * c + 0.4329510) + 0.238081;
  c = outm * (a / b);
  return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}
