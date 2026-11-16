// Fundo (porte de src/render/sky.ts): gradiente do céu e estrelas que cintilam (Lua) ou as duas luas pálidas (Marte).
struct VOut {
  @builtin(position) clip: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let x = f32((i << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(i & 2u) * 2.0 - 1.0;
  o.clip = vec4<f32>(x, y, 1.0, 1.0);
  return o;
}

fn h(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(41.3, 289.1))) * 43758.5453);
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
  let frag = i.clip;
  let uvy = 1.0 - frag.y / G.fog.w;
  let t = G.cam_pos.w;
  var c = mix(G.bg_bot.rgb, G.bg_top.rgb, smoothstep(0.0, 1.0, uvy));
  if (G.bg_bot.w > 0.5) {
    let cell = floor(vec2<f32>(frag.x, G.fog.w - frag.y) / 3.0);
    let s = h(cell);
    if (s > 0.9965) {
      let tw = 0.55 + 0.45 * sin(t * (1.5 + h(cell + 7.0) * 3.0) + s * 60.0);
      c += vec3<f32>(0.9, 0.85, 1.0) * tw * smoothstep(0.25, 1.0, uvy) * 0.9;
    }
  } else {
    let asp = G.fog.z / G.fog.w;
    let q = vec2<f32>(frag.x / G.fog.z * asp, uvy);
    let phobos = vec2<f32>(fract(0.15 + t * 0.004) * (asp + 0.2) - 0.1, 0.86 + 0.05 * sin(t * 0.02));
    let deimos = vec2<f32>(asp * 0.72 + 0.02 * sin(t * 0.003), 0.93);
    let mp = 1.0 - smoothstep(0.010, 0.014, length((q - phobos) * vec2<f32>(0.8, 1.0)));
    let md = 1.0 - smoothstep(0.004, 0.0065, length(q - deimos));
    c = mix(c, vec3<f32>(0.93, 0.86, 0.80), (mp * 0.55 + md * 0.45) * smoothstep(0.55, 0.9, uvy));
    c = mix(c, vec3<f32>(0.62, 0.74, 0.86), smoothstep(0.75, 0.0, length(q - vec2<f32>(0.0, 1.05))) * 0.28);
  }
  return vec4<f32>(c, 1.0);
}
