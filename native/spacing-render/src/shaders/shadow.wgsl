// Mapa de sombra do sol: só a profundidade, vista do sol (câmera ortográfica que segue o jogador, lights.ts).
struct Sun {
  vp: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> S: Sun;

struct Part {
  model: mat4x4<f32>,
  tint: vec4<f32>,
  emissive: vec4<f32>,
};
@group(1) @binding(0) var<uniform> P: Part;

@vertex
fn terrain(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return S.vp * vec4<f32>(pos, 1.0);
}

@vertex
fn model(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return S.vp * (P.model * vec4<f32>(pos, 1.0));
}

@vertex
fn prop(@location(0) pos: vec3<f32>, @location(2) inst: vec4<f32>, @location(3) scale: vec4<f32>) -> @builtin(position) vec4<f32> {
  let c = cos(inst.w);
  let s = sin(inst.w);
  let p = pos * scale.x;
  return S.vp * vec4<f32>(vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + inst.xyz, 1.0);
}
