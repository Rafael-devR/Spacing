// Modelos do Blender (astronauta, módulo de pouso): Lambert com sombreamento facetado (normal da face pela derivada) e cor
// por vértice, como os materiais `flatShading` do jogo web.
struct Part {
  model: mat4x4<f32>,
  tint: vec4<f32>,     // multiplica a cor
  emissive: vec4<f32>, // soma à luz; w = 1 usa a cor do vértice como brilho
};
@group(1) @binding(0) var<uniform> P: Part;

struct VIn {
  @location(0) pos: vec3<f32>,
  @location(1) color: vec4<f32>,
};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) wp: vec3<f32>,
  @location(1) color: vec3<f32>,
};

@vertex
fn vs(v: VIn) -> VOut {
  var o: VOut;
  let w = P.model * vec4<f32>(v.pos, 1.0);
  o.clip = G.view_proj * w;
  o.wp = w.xyz;
  o.color = v.color.rgb;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
  let frag = i.clip;
  let n = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  // a derivada em y da tela aponta para baixo no wgpu: a normal sai ao contrário
  let nn = -n;
  var albedo = i.color * P.tint.rgb;
  if (P.tint.w > 0.5) {
    albedo = P.tint.rgb;
  }
  if (P.emissive.w > 0.5) {
    // lâmpada: cor própria, sem luz nem neblina
    return vec4<f32>(aces(albedo), 1.0);
  }
  let dark = G.sun_dir.w;
  let sky_k = mix(1.0, CAVE_AMBIENT * 3.0, dark);
  var c = lambert(albedo, nn) * sky_k + P.emissive.rgb + lamp_light(albedo, i.wp, nn);
  let gm = max(i.color.r, max(i.color.g, i.color.b));
  if (gm > 1.1) {
    c += i.color * 0.26;
  }
  c = fog(c, i.wp, frag, 1.0);
  return vec4<f32>(aces(c), 1.0);
}
