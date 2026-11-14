// Sprites (porte de puffs.ts, lamps.ts, particles.ts e Footprints.ts): quadrados virados para a câmera (ou deitados no chão,
// as pegadas), um desenho por modo de mistura. O formato sai do shader: nuvem macia com ruído, halo radial, disco, sola de bota.
struct VIn {
  @builtin(vertex_index) vi: u32,
  @location(0) center: vec4<f32>, // xyz, diâmetro
  @location(1) color: vec4<f32>,
  @location(2) extra: vec4<f32>,  // giro, semente, tipo
};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) @interpolate(flat) kind: u32,
  @location(3) seed: f32,
};

@vertex
fn vs(v: VIn) -> VOut {
  var o: VOut;
  let corners = array<vec2<f32>, 6>(vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(0.5, 0.5), vec2(-0.5, -0.5), vec2(0.5, 0.5), vec2(-0.5, 0.5));
  let c = corners[v.vi];
  let kind = u32(v.extra.z + 0.5);
  let cs = cos(v.extra.x);
  let sn = sin(v.extra.x);
  var w: vec3<f32>;
  if (kind == 4u) {
    // pegada: deitada no chão, 0,2 × 0,32, girada para onde o pé aponta
    let p = vec2<f32>(c.x * 0.2, c.y * 0.32);
    w = v.center.xyz + vec3<f32>(cs * p.x + sn * p.y, 0.0, -sn * p.x + cs * p.y);
  } else {
    let f = G.cam_fwd.xyz;
    let right = normalize(cross(f, vec3<f32>(0.0, 1.0, 0.0)));
    let up = cross(right, f);
    let p = vec2<f32>(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * v.center.w;
    w = v.center.xyz + right * p.x + up * p.y;
  }
  o.clip = G.view_proj * vec4<f32>(w, 1.0);
  o.uv = c + 0.5;
  o.color = v.color;
  o.kind = kind;
  o.seed = v.extra.y;
  return o;
}

fn hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

fn ell(p: vec2<f32>, c: vec2<f32>, r: vec2<f32>) -> f32 {
  return 1.0 - smoothstep(0.75, 1.0, length((p - c) / r));
}

fn shape(i: VOut) -> f32 {
  let q = i.uv - 0.5;
  let d = length(q) * 2.0;
  switch i.kind {
    case 0u, 1u: {
      let cloud = vnoise(q * 3.2 + i.seed) * 0.6 + vnoise(q * 7.5 + i.seed * 1.7) * 0.4;
      var a = smoothstep(1.0, 0.2, d + (cloud - 0.5) * 0.6);
      return a * a * (3.0 - 2.0 * a);
    }
    case 2u: {
      // degradê do halo (lamps.ts): 0,9 no centro, 0,35 a um terço, 0 na borda; o núcleo (semente 1) é mais firme
      if (i.seed > 0.5) {
        return 1.0 - smoothstep(0.55, 1.0, d);
      }
      return select(mix(0.35, 0.0, (d - 0.35) / 0.65), mix(0.9, 0.35, d / 0.35), d < 0.35) * step(d, 1.0);
    }
    case 3u: {
      return 1.0 - smoothstep(0.7, 1.0, d);
    }
    default: {
      let sole = max(ell(i.uv, vec2(0.5, 0.67), vec2(0.4, 0.3)), ell(i.uv, vec2(0.5, 0.22), vec2(0.34, 0.2)));
      let tread = step(0.45, fract(i.uv.y * 8.0));
      return sole * (0.5 + 0.5 * tread) * 0.45;
    }
  }
}

// mistura normal (poeira, fumaça, pedrinhas, pegadas)
@fragment
fn fs_alpha(i: VOut) -> @location(0) vec4<f32> {
  let a = i.color.a * shape(i);
  if (a < 0.01) {
    discard;
  }
  return vec4<f32>(i.color.rgb, a);
}

// soma luz (fogo, lâmpadas): cor já multiplicada pela opacidade
@fragment
fn fs_add(i: VOut) -> @location(0) vec4<f32> {
  let a = i.color.a * shape(i);
  return vec4<f32>(i.color.rgb * a, 1.0);
}
