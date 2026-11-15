// Pedras e minérios soltos (render/models.ts, PropFactory): uma chamada por tipo e variação, com instâncias (posição, giro em
// y, escala). Lambert facetado com cor por vértice; o que passa de 1,1 brilha (cristais, fendas do meteorito).
struct VIn {
  @location(0) pos: vec3<f32>,
  @location(1) color: vec4<f32>,
  @location(2) inst: vec4<f32>, // x, y, z, giro
  @location(3) scale: vec4<f32>,
  @location(4) tint: vec4<f32>,
};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) wp: vec3<f32>,
  @location(1) color: vec3<f32>,
};

fn place_prop(pos: vec3<f32>, inst: vec4<f32>, scale: vec4<f32>) -> vec3<f32> {
  // giro em z, depois em x, depois em y (os pedaços rolam; as pedras só giram em y)
  var p = pos * scale.x;
  let cz = cos(scale.z);
  let sz = sin(scale.z);
  p = vec3<f32>(cz * p.x - sz * p.y, sz * p.x + cz * p.y, p.z);
  let cx = cos(scale.y);
  let sx = sin(scale.y);
  p = vec3<f32>(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
  let c = cos(inst.w);
  let s = sin(inst.w);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + inst.xyz;
}

@vertex
fn vs(v: VIn) -> VOut {
  var o: VOut;
  let w = place_prop(v.pos, v.inst, v.scale);
  o.clip = G.view_proj * vec4<f32>(w, 1.0);
  o.wp = w;
  o.color = v.color.rgb * v.tint.rgb;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
  let frag = i.clip;
  let nn = -normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  let sky_k = mix(1.0, CAVE_AMBIENT * 3.0, G.sun_dir.w);
  var c = lambert(i.color, nn, i.wp) * sky_k + lamp_light(i.color, i.wp, nn);
  let gm = max(i.color.r, max(i.color.g, i.color.b));
  if (gm > 1.1) {
    c += i.color * 0.26 * (0.65 + 0.35 * sin(G.cam_pos.w * 2.2 + i.wp.x * 0.7 + i.wp.z * 0.5));
  }
  c = fog(c, i.wp, frag, 1.0);
  return vec4<f32>(c, 1.0);
}
