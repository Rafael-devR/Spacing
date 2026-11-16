//! Paridade com o jogo em TypeScript (docs/design/PORTE_RUST.md): os vetores em `native/golden/*.json` saem do código TS
//! (`npm run golden`) e o Rust precisa dar o mesmo.
use serde_json::Value;
use spacing_core::anim::{AnimState, Animator, Gesture};
use spacing_core::chunk_mesher::{ChunkMesher, ChunkSource};
use spacing_core::mars::MarsTerrain;
use spacing_core::noise::{hash2, hash3, Mulberry32, Noise2, Noise3};
use spacing_core::terrain::{Terrain, TerrainGen, CHUNK_LEN, CS};

fn golden(name: &str) -> Value {
    let p = format!("{}/../golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap_or_else(|_| panic!("falta {p}: rode `npm run golden`"))).unwrap()
}

fn fnv(b: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &x in b {
        h ^= x as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn f(v: &Value) -> f64 {
    v.as_f64().unwrap()
}

#[test]
fn ruido_igual() {
    let g = golden("noise.json");
    let mut r = Mulberry32::new(42);
    for v in g["rand"].as_array().unwrap() {
        assert_eq!(r.next_f64(), f(v));
    }
    let n2 = Noise2::new(&mut Mulberry32::new(7));
    let n3 = Noise3::new(&mut Mulberry32::new(7));
    for i in 0..40 {
        let pt = &g["pts"][i as usize];
        let (x, y, z) = (f(&pt[0]), f(&pt[1]), f(&pt[2]));
        assert_eq!(hash2(x.floor() as i32, y.floor() as i32, i * 31), f(&g["hash2"][i as usize]), "hash2 {i}");
        assert_eq!(hash3(x.floor() as i32, y.floor() as i32, z.floor() as i32, i * 17 - 200), f(&g["hash3"][i as usize]), "hash3 {i}");
        assert_eq!(n2.get(x, y), f(&g["noise2"][i as usize]), "noise2 {i}");
        assert_eq!(n3.get(x, y, z), f(&g["noise3"][i as usize]), "noise3 {i}");
    }
}

fn check_chunks(name: &str, gen: &mut dyn TerrainGen, want: &Value, fails: &mut Vec<String>) {
    for c in want["columns"].as_array().unwrap() {
        let (x, z) = (f(&c[0]), f(&c[1]));
        let (h, mare) = gen.column(x, z);
        if h != f(&c[2]) || (mare - f(&c[3])).abs() > 1e-8 {
            fails.push(format!("{name} coluna ({x},{z}): {h} {mare} x {} {}", c[2], c[3]));
        }
    }
    for c in want["chunks"].as_array().unwrap() {
        let (cx, cz) = (c["cx"].as_i64().unwrap() as i32, c["cz"].as_i64().unwrap() as i32);
        let g = gen.generate(cx, cz);
        if fnv(&g.data) as u64 != c["fnv"].as_u64().unwrap() || g.max_y as u64 != c["maxY"].as_u64().unwrap() {
            fails.push(format!("{name} chunk ({cx},{cz}): blocos diferentes (maxY {} x {})", g.max_y, c["maxY"]));
        }
        let props = c["props"].as_array().unwrap();
        if props.len() != g.props.len() {
            fails.push(format!("{name} chunk ({cx},{cz}): {} objetos x {}", g.props.len(), props.len()));
            continue;
        }
        for (p, w) in g.props.iter().zip(props) {
            let ok = p.wx as f64 == f(&w[0])
                && p.wz as f64 == f(&w[1])
                && p.y as f64 == f(&w[2])
                && p.kind == w[3].as_str().unwrap()
                && p.variant as f64 == f(&w[4])
                && (p.rot - f(&w[5])).abs() < 1e-8
                && (p.scale - f(&w[6])).abs() < 1e-8;
            if !ok {
                fails.push(format!("{name} objeto {:?} x {w}", p));
            }
        }
    }
}

#[test]
fn mundo_igual() {
    let g = golden("terrain.json");
    assert_eq!(g["CS"].as_u64().unwrap() as usize, CS);
    let mut fails = Vec::new();
    for w in g["lua"].as_array().unwrap() {
        let seed = w["seed"].as_u64().unwrap() as u32;
        let mut t = Terrain::new(seed);
        assert_eq!(t.caves.home_x, f(&w["home"][0]), "entrada da caverna");
        assert_eq!(t.relief.home_crater.0, f(&w["homeCrater"]["x"]), "cratera de gelo");
        check_chunks(&format!("lua {seed}"), &mut t, w, &mut fails);
    }
    for w in g["marte"].as_array().unwrap() {
        let seed = w["seed"].as_u64().unwrap() as u32;
        let mut t = MarsTerrain::new(seed);
        assert_eq!(t.spawn_h(), f(&w["spawnH"]));
        check_chunks(&format!("marte {seed}"), &mut t, w, &mut fails);
    }
    assert!(fails.is_empty(), "{} diferenças:\n{}", fails.len(), fails.join("\n"));
}

#[test]
fn malha_e_luz_iguais() {
    let g = golden("mesh.json");
    for m in g.as_array().unwrap() {
        let planet = m["planet"].as_str().unwrap();
        let (cx, cz) = (m["cx"].as_i64().unwrap() as i32, m["cz"].as_i64().unwrap() as i32);
        let mut gen: Box<dyn TerrainGen> = if planet == "lua" { Box::new(Terrain::new(12345)) } else { Box::new(MarsTerrain::new(12345)) };
        let mut chunks = Vec::new();
        for dz in -1..=1 {
            for dx in -1..=1 {
                chunks.push(gen.generate(cx + dx, cz + dz));
            }
        }
        let nb: [ChunkSource; 9] = std::array::from_fn(|i| ChunkSource { data: &chunks[i].data, max_y: chunks[i].max_y });
        let mut light = vec![0u8; CHUNK_LEN];
        let mut verts = Vec::new();
        ChunkMesher::new().build(&nb, cx * CS as i32, cz * CS as i32, &mut light, &mut verts);
        let tag = format!("{planet} ({cx},{cz})");
        assert_eq!(fnv(&light) as u64, m["lightFnv"].as_u64().unwrap(), "luz {tag}");
        assert_eq!(verts.len() as u64, m["verts"].as_u64().unwrap(), "vértices {tag}");
        let sum = |get: &dyn Fn(&spacing_core::mesher::Vertex) -> Vec<f32>| {
            let mut s = 0.0f64;
            let mut i = 0usize;
            for v in &verts {
                for x in get(v) {
                    s += x as f64 * ((i % 7) + 1) as f64;
                    i += 1;
                }
            }
            s
        };
        let close = |a: f64, b: f64, what: &str| assert!((a - b).abs() <= 1e-6 * b.abs().max(1.0), "{what} {tag}: {a} x {b}");
        close(sum(&|v| v.pos.to_vec()), f(&m["pos"]), "posições");
        close(sum(&|v| v.normal.to_vec()), f(&m["nor"]), "normais");
        close(sum(&|v| v.color.to_vec()), f(&m["col"]), "cores");
        close(sum(&|v| v.edge.to_vec()), f(&m["edge"]), "bordas");
        close(sum(&|v| vec![v.sky]), f(&m["sky"]), "céu");
    }
}

#[test]
fn animacao_igual() {
    let g = golden("anim.json");
    let mut a = Animator::new();
    let dt = 1.0 / 60.0;
    let frames = g["frames"].as_array().unwrap();
    let mut k = 0;
    for fr in 0..600 {
        let t = fr as f64 * dt;
        let air = (330..370).contains(&fr);
        let s = AnimState {
            speed: if fr < 120 {
                0.0
            } else if fr < 300 {
                4.6f64.min((fr - 120) as f64 * 0.05)
            } else if fr < 420 {
                1.5
            } else {
                0.0
            },
            max_speed: 4.6,
            on_ground: !air,
            vy: if air { 7.4 - (fr - 330) as f64 * 0.25 } else { 0.0 },
            turn: t.sin() * 2.0,
            mining: (450..520).contains(&fr),
            holding: fr > 200,
            dead: fr >= 580,
        };
        if fr == 330 {
            a.jump();
        }
        if fr == 370 {
            a.landed(0.6);
        }
        if fr == 430 {
            a.play(Gesture::Place);
        }
        if fr == 540 {
            a.play(Gesture::Eat);
        }
        let p = a.update(dt, &s).clone();
        if fr % 10 == 9 {
            let w = &frames[k];
            k += 1;
            let close = |a: f64, b: &Value, what: &str| assert!((a - f(b)).abs() < 1e-9, "quadro {fr} {what}: {a} x {b}");
            close(p.hip_y, &w["hipY"], "quadril");
            close(p.stretch, &w["stretch"], "esticada");
            for (i, j) in p.j.iter().enumerate() {
                close(j.x, &w["j"][i][0], spacing_core::anim::JOINTS[i]);
                close(j.y, &w["j"][i][1], spacing_core::anim::JOINTS[i]);
                close(j.z, &w["j"][i][2], spacing_core::anim::JOINTS[i]);
            }
        }
    }
}
