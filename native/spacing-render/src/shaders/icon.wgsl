// Ícones dos itens (items.rs, Renderer::render_icons): a posição já vem pronta na tela e a cor já vem acesa (a luz é calculada
// na CPU, uma vez). Só pinta.
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs(@location(0) pos: vec3<f32>, @location(1) color: vec4<f32>) -> VOut {
  var o: VOut;
  o.clip = vec4<f32>(pos, 1.0);
  o.color = color;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
  return i.color;
}
