// Uniformes e luz comuns a todos os materiais (porte de src/render/materials.ts e lights.ts; Three.js 0.160 como referência:
// Lambert com luz de hemisfério + sol com sombra, divididos por PI, neblina para o gradiente do céu). A saída é linear (HDR);
// os tons, o bloom e a correção de cor ficam na passada final (post.wgsl), como no post.ts.
struct Globals {
  view_proj: mat4x4<f32>,
  shadow_vp: mat4x4<f32>,
  cam_pos: vec4<f32>,      // w = tempo (s)
  cam_fwd: vec4<f32>,      // w = tamanho do mapa de sombra (texels)
  sun_dir: vec4<f32>,      // xyz para o sol; w = escuro da caverna (0..1)
  sun_col: vec4<f32>,      // cor * força; w = cintilação do regolito ligada (1/0)
  hemi_sky: vec4<f32>,     // cor * força; w = sombra ligada (1/0)
  hemi_ground: vec4<f32>,  // w = viés da sombra (profundidade)
  bg_top: vec4<f32>,       // w = viés na normal da sombra (blocos)
  bg_bot: vec4<f32>,       // w = estrelas (1/0)
  mist: vec4<f32>,         // rgb da névoa baixa, w = altura dela
  fog: vec4<f32>,          // perto, longe, largura, altura da tela
  lamp: vec4<f32>,         // lanterna do capacete: posição, força
};
@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var shadow_map: texture_depth_2d;
@group(0) @binding(2) var shadow_cmp: sampler_comparison;

const RECIPROCAL_PI: f32 = 0.3183098861837907;
const CAVE_AMBIENT: f32 = 0.05;

// sombra do sol com PCF de 5 amostras (cada uma já filtra 2x2 no hardware)
fn sun_shadow(wp: vec3<f32>, n: vec3<f32>) -> f32 {
  let p = G.shadow_vp * vec4<f32>(wp + n * G.bg_top.w, 1.0);
  let uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  let z = p.z + G.hemi_ground.w;
  let t = 1.0 / G.cam_fwd.w;
  var s = textureSampleCompareLevel(shadow_map, shadow_cmp, uv, z);
  s += textureSampleCompareLevel(shadow_map, shadow_cmp, uv + vec2<f32>(t, t), z);
  s += textureSampleCompareLevel(shadow_map, shadow_cmp, uv + vec2<f32>(-t, t), z);
  s += textureSampleCompareLevel(shadow_map, shadow_cmp, uv + vec2<f32>(t, -t), z);
  s += textureSampleCompareLevel(shadow_map, shadow_cmp, uv + vec2<f32>(-t, -t), z);
  let inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && p.z < 1.0;
  return select(1.0, s / 5.0, inside && G.hemi_sky.w > 0.5);
}

// só consulta a sombra nas faces voltadas para o sol (materials.ts: nas outras a luz direta já é zero)
fn lambert(albedo: vec3<f32>, n: vec3<f32>, wp: vec3<f32>) -> vec3<f32> {
  let w = 0.5 * n.y + 0.5;
  let hemi = mix(G.hemi_ground.rgb, G.hemi_sky.rgb, w);
  let nl = max(dot(n, G.sun_dir.xyz), 0.0);
  var direct = vec3<f32>(0.0);
  if (nl > 0.0) {
    direct = G.sun_col.rgb * nl * sun_shadow(wp, n);
  }
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
  let o = mix(c, G.mist.rgb, mist * (1.0 - dark));
  let depth = dot(wp - G.cam_pos.xyz, G.cam_fwd.xyz);
  let f = smoothstep(G.fog.x, G.fog.y, depth);
  let bg = mix(background(frag), vec3<f32>(0.006, 0.006, 0.012), dark);
  return mix(o, bg, f);
}
