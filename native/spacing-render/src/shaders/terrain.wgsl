// Blocos do mundo (porte do material do terreno em src/render/materials.ts): borda clara, granulado, contas de vidro que
// cintilam no regolito, brilho próprio dos blocos muito claros (lava, cristal) e a luz do céu por vértice.
struct VIn {
  @location(0) pos: vec3<f32>,
  @location(1) normal: vec4<f32>,
  @location(2) color: vec4<f32>,
  @location(3) ext: vec4<f32>, // borda x, borda y, céu
};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) wp: vec3<f32>,
  @location(1) n: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) ext: vec3<f32>,
};

@vertex
fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.clip = G.view_proj * vec4<f32>(v.pos, 1.0);
  o.wp = v.pos;
  o.n = v.normal.xyz;
  o.color = v.color.rgb;
  o.ext = v.ext.xyz;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
  let frag = i.clip;
  let n = normalize(i.n);
  let t = G.cam_pos.w;
  var albedo = i.color;
  let e = i.ext.xy;
  let ed = min(min(e.x, 1.0 - e.x), min(e.y, 1.0 - e.y));
  albedo *= 1.0 + 0.11 * (1.0 - smoothstep(0.0, 0.07, ed));
  let gp = floor(i.wp * 5.0 + 0.001);
  let gh = fract(sin(dot(gp, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
  albedo *= 0.96 + 0.08 * gh;
  var emissive = vec3<f32>(0.0);
  if (G.sun_col.w > 0.5 && n.y > 0.5) {
    let gc = floor(i.wp * 11.0);
    let gr = fract(sin(dot(gc, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
    if (gr > 0.982) {
      let vd = normalize(G.cam_pos.xyz - i.wp);
      let tw = sin(t * 2.5 + gr * 400.0 + (vd.x + vd.z) * 30.0);
      emissive += vec3<f32>(1.0, 0.95, 0.85) * smoothstep(0.75, 1.0, tw) * 0.9 * i.ext.z;
    }
  }
  let gm = max(i.color.r, max(i.color.g, i.color.b));
  if (gm > 1.1) {
    emissive += i.color * 0.26 * (0.65 + 0.35 * sin(t * 2.2 + i.wp.x * 0.7 + i.wp.z * 0.5));
  }
  let sky_k = max(i.ext.z, CAVE_AMBIENT);
  var c = lambert(albedo, n) * sky_k + emissive + lamp_light(albedo, i.wp, n);
  c = fog(c, i.wp, frag, i.ext.z);
  return vec4<f32>(aces(c), 1.0);
}
