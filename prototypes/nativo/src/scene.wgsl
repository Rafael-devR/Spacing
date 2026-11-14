// A cena: luz de um sol e um pouco de luz ambiente; cada pedaço tem uma cor tirada da posição dele (como web/three.ts).
struct Cam {
    view_proj: mat4x4<f32>,
    light: vec4<f32>,
};
@group(0) @binding(0) var<uniform> cam: Cam;

struct Obj {
    offset: vec4<f32>,
};
@group(1) @binding(0) var<uniform> obj: Obj;

struct VOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) n: vec3<f32>,
    @location(1) tint: vec3<f32>,
};

@vertex
fn vs(@location(0) p: vec3<f32>, @location(1) n: vec4<f32>) -> VOut {
    var o: VOut;
    o.pos = cam.view_proj * vec4<f32>(p + obj.offset.xyz, 1.0);
    o.n = n.xyz;
    let k = fract(sin(dot(obj.offset.xz, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    o.tint = mix(vec3<f32>(0.72, 0.68, 0.62), vec3<f32>(0.85, 0.45, 0.28), k);
    return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
    let l = max(dot(normalize(i.n), cam.light.xyz), 0.0);
    return vec4<f32>(i.tint * (0.25 + 0.75 * l), 1.0);
}
