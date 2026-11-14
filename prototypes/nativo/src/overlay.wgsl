// Os números na tela: quadradinhos já em coordenadas de tela (-1..1), uma cor por vértice.
struct VOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) col: vec4<f32>,
};

@vertex
fn vs(@location(0) p: vec2<f32>, @location(1) c: vec4<f32>) -> VOut {
    var o: VOut;
    o.pos = vec4<f32>(p, 0.0, 1.0);
    o.col = c;
    return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
    return i.col;
}
