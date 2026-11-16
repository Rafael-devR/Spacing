//! O mixer inteiro sem placa de som: o `Sfx` pede, o `Renderer` toca, e os testes medem o que saiu.
//! (O equivalente de `tools/visual-check/audio.mjs` do jogo web, mais rápido e sem navegador.)
use super::*;

const SR: f32 = 48_000.0;

fn novo() -> (Sfx, Renderer) {
    let (sfx, r) = Sfx::offline(SR);
    // astronauta na origem, câmera olhando para -z (a direita da tela é +x)
    sfx.set_listener([0.0, 0.0, 0.0], (0.0, -1.0));
    sfx.set_world(true);
    (sfx, r)
}

/// toca `seg` segundos e devolve os canais separados
fn toca(r: &mut Renderer, seg: f32) -> (Vec<f32>, Vec<f32>) {
    let n = (SR * seg) as usize;
    let mut buf = vec![0.0f32; n * 2];
    // em pedaços de tamanho irregular, como a placa faz
    let mut i = 0;
    let mut k = 0;
    while i < buf.len() {
        let t = [480usize, 1024, 333, 2048][k % 4].min((buf.len() - i) / 2) * 2;
        r.render(&mut buf[i..i + t]);
        i += t;
        k += 1;
    }
    (buf.iter().step_by(2).copied().collect(), buf.iter().skip(1).step_by(2).copied().collect())
}

fn rms(v: &[f32]) -> f32 {
    (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt()
}

fn pico(l: &[f32], r: &[f32]) -> f32 {
    l.iter().chain(r).fold(0.0f32, |m, x| m.max(x.abs()))
}

/// Só o que o `pedido` acrescenta ao fundo: toca duas mesas iguais (uma com o pedido, outra sem) e subtrai. O mixer é
/// determinístico, então o fundo (cratera, ventilação, vento) some na conta.
fn so(pedido: impl Fn(&Sfx), seg: f32) -> (Vec<f32>, Vec<f32>) {
    let (a, mut ra) = novo();
    let (_b, mut rb) = novo();
    let (la, rra) = toca(&mut ra, 0.2);
    let (lb, rrb) = toca(&mut rb, 0.2);
    assert_eq!(la, lb, "o fundo é igual nas duas mesas");
    assert_eq!(rra, rrb);
    pedido(&a);
    let (la, rra) = toca(&mut ra, seg);
    let (lb, rrb) = toca(&mut rb, seg);
    (la.iter().zip(&lb).map(|(x, y)| x - y).collect(), rra.iter().zip(&rrb).map(|(x, y)| x - y).collect())
}

/// o fundo (ambiente da cratera) sozinho, para descontar
fn fundo() -> f32 {
    let (_s, mut r) = novo();
    let _ = toca(&mut r, 0.5);
    let (l, rr) = toca(&mut r, 0.5);
    (rms(&l) + rms(&rr)) * 0.5
}

#[test]
fn som_a_direita_sai_mais_no_canal_direito_e_a_esquerda_no_esquerdo() {
    for som in [Sound::Boom, Sound::Hit, Sound::Break] {
        let (l, rr) = so(|s| { let _ = s.play(som, 1.0, Some(Vec3::new(10.0, 0.0, 0.0))); }, 0.6);
        assert!(rms(&rr) > rms(&l) * 2.0, "{som:?} à direita: L {} R {}", rms(&l), rms(&rr));
        let (l, rr) = so(|s| { let _ = s.play(som, 1.0, Some(Vec3::new(-10.0, 0.0, 0.0))); }, 0.6);
        assert!(rms(&l) > rms(&rr) * 2.0, "{som:?} à esquerda: L {} R {}", rms(&l), rms(&rr));
    }
}

#[test]
fn o_lado_acompanha_o_giro_da_camera() {
    // câmera olhando para +x: a direita da tela passa a ser +z? (direita = (-fz, fx) = (0, 1))
    let (l, rr) = so(
        |s| {
            s.set_listener([0.0, 0.0, 0.0], (1.0, 0.0));
            s.play(Sound::Break, 1.0, Some(Vec3::new(0.0, 0.0, 8.0)));
        },
        0.5,
    );
    assert!(rms(&rr) > rms(&l) * 2.0, "direita da tela com a câmera girada: L {} R {}", rms(&l), rms(&rr));
}

#[test]
fn som_no_proprio_astronauta_fica_no_centro() {
    let (l, rr) = so(|s| { let _ = s.play(Sound::Break, 1.0, Some(Vec3::new(0.0, 0.0, 0.0))); }, 0.5);
    let (a, b) = (rms(&l), rms(&rr));
    assert!(a > 0.0 && (a - b).abs() / a < 0.25, "L {a} R {b}");
}

#[test]
fn quanto_mais_longe_mais_baixo_e_alem_do_limite_nao_toca() {
    let nivel = |d: f32| {
        let (l, rr) = so(|s| { let _ = s.play(Sound::Break, 1.0, Some(Vec3::new(d, 0.0, 0.0))); }, 0.5);
        rms(&l).max(rms(&rr))
    };
    let (perto, meio, longe) = (nivel(2.0), nivel(12.0), nivel(24.0));
    assert!(perto > meio * 1.5 && meio > longe * 1.5, "{perto} {meio} {longe}");
    let (sfx, mut r) = novo();
    assert!(sfx.play(Sound::Break, 1.0, Some(Vec3::new(40.0, 0.0, 0.0))).is_none(), "40 blocos: fora do alcance de um golpe");
    let _ = toca(&mut r, 0.1);
    assert_eq!(r.mixer().emissores(), 0);
    // o estrondo se ouve de longe
    assert!(sfx.play(Sound::Boom, 1.0, Some(Vec3::new(90.0, 0.0, 0.0))).is_some());
}

#[test]
fn longe_soa_mais_grave() {
    // proporção de energia nos agudos: o chiado (sizzle, passa-alta 2,6 kHz) quase some de longe
    let nivel = |d: f32| {
        let (l, rr) = so(|s| { let _ = s.play(Sound::Sizzle, 1.0, Some(Vec3::new(d, 0.0, 0.0))); }, 0.45);
        rms(&l).max(rms(&rr))
    };
    assert!(nivel(1.0) > nivel(20.0) * 10.0, "{} {}", nivel(1.0), nivel(20.0));
}

#[test]
fn som_do_capacete_fica_no_centro_e_nao_devolve_voz() {
    let (sfx, mut r) = novo();
    assert!(sfx.play(Sound::Beep, 1.0, None).is_none());
    let (l, rr) = toca(&mut r, 0.2);
    let (a, b) = (rms(&l), rms(&rr));
    assert!(a > 0.005 && (a - b).abs() < a * 0.05, "L {a} R {b}");
    assert_eq!(r.mixer().emissores(), 0);
}

#[test]
fn zumbido_do_modulo_aparece_perto_e_some_de_longe() {
    let base = fundo();
    let nivel = |d: f32| {
        let (l, rr) = so(|s| assert!(s.hum(Vec3::new(d, 0.0, 0.0)).is_some()), 0.8);
        (rms(&l) + rms(&rr)) * 0.5
    };
    let (perto, longe) = (nivel(2.0), nivel(60.0));
    assert!(perto > base * 0.4, "perto {perto} fundo {base}");
    assert!(longe < 1e-4, "longe do módulo não se ouve nada: {longe}");
}

#[test]
fn parar_um_laco_some_e_libera_o_emissor() {
    let (sfx, mut r) = novo();
    let v = sfx.hum(Vec3::new(2.0, 0.0, 0.0)).unwrap();
    let _ = toca(&mut r, 0.2);
    assert_eq!(r.mixer().emissores(), 1);
    sfx.stop(v);
    let _ = toca(&mut r, 0.5);
    assert_eq!(r.mixer().emissores(), 0);
}

#[test]
fn laser_toca_e_para() {
    let (sfx, mut r) = novo();
    let v = sfx.laser(Vec3::new(1.0, 0.0, 0.0)).unwrap();
    let _ = toca(&mut r, 0.4);
    let (l, rr) = toca(&mut r, 0.3);
    assert!(rms(&l).max(rms(&rr)) > 0.002);
    sfx.stop(v);
    let _ = toca(&mut r, 0.4);
    assert_eq!(r.mixer().emissores(), 0);
}

#[test]
fn sons_curtos_liberam_o_emissor_quando_acabam() {
    let (sfx, mut r) = novo();
    sfx.play(Sound::Step, 1.0, Some(Vec3::new(1.0, 0.0, 0.0)));
    let _ = toca(&mut r, 0.02);
    assert_eq!(r.mixer().emissores(), 1);
    let _ = toca(&mut r, 0.3);
    assert_eq!(r.mixer().emissores(), 0);
    // as camadas soltas (do capacete) também
    sfx.play(Sound::Beep, 1.0, None);
    let _ = toca(&mut r, 0.02);
    assert_eq!(r.mixer().vozes_soltas(), 1);
    let _ = toca(&mut r, 0.3);
    assert_eq!(r.mixer().vozes_soltas(), 0);
}

#[test]
fn meteoro_em_voo_se_move_de_um_lado_ao_outro() {
    // duas mesas iguais (uma com o meteoro) para tirar o fundo da conta
    let (a, mut ra) = novo();
    let (_b, mut rb) = novo();
    let v = a.play(Sound::Whoosh, 1.0, Some(Vec3::new(-30.0, 0.0, 0.0))).unwrap();
    let dif = |x: (Vec<f32>, Vec<f32>), y: (Vec<f32>, Vec<f32>)| {
        let d = |p: &[f32], q: &[f32]| p.iter().zip(q).map(|(m, n)| m - n).collect::<Vec<f32>>();
        (d(&x.0, &y.0), d(&x.1, &y.1))
    };
    let _ = (toca(&mut ra, 0.3), toca(&mut rb, 0.3));
    let (l0, r0) = dif(toca(&mut ra, 0.2), toca(&mut rb, 0.2));
    assert!(rms(&l0) > rms(&r0) * 1.5, "começa à esquerda: L {} R {}", rms(&l0), rms(&r0));
    a.move_voice(v, Vec3::new(30.0, 0.0, 0.0));
    let _ = (toca(&mut ra, 0.3), toca(&mut rb, 0.3));
    let (l1, r1) = dif(toca(&mut ra, 0.2), toca(&mut rb, 0.2));
    assert!(rms(&r1) > rms(&l1) * 1.5, "termina à direita: L {} R {}", rms(&l1), rms(&r1));
}

#[test]
fn nunca_passa_de_um_e_nunca_da_nan_com_muita_coisa_ao_mesmo_tempo() {
    let (sfx, mut r) = novo();
    for k in 0..40 {
        for s in Sound::TODOS {
            let p = (k % 5) as f32 * 3.0 - 6.0;
            sfx.play(s, 1.0 + (k % 3) as f32 * 0.2, if k % 2 == 0 { Some(Vec3::new(p, 1.0, p * 0.5)) } else { None });
        }
        sfx.hum(Vec3::new(1.0, 0.0, 1.0));
    }
    let (l, rr) = toca(&mut r, 2.0);
    assert!(l.iter().chain(&rr).all(|x| x.is_finite()), "NaN ou infinito");
    assert!(pico(&l, &rr) <= 1.0, "passou de 1: {}", pico(&l, &rr));
    assert!(pico(&l, &rr) > 0.3, "tocou alto de verdade");
    assert!(r.mixer().emissores() <= 32 && r.mixer().vozes_soltas() <= 64, "limite de vozes");
}

#[test]
fn cada_som_sozinho_toca_sem_estourar() {
    for s in Sound::TODOS {
        let (sfx, mut r) = novo();
        sfx.play(s, 1.0, None);
        let (l, rr) = toca(&mut r, 3.2);
        assert!(l.iter().chain(&rr).all(|x| x.is_finite()), "{s:?}");
        let p = pico(&l, &rr);
        assert!(p > 0.01, "{s:?} mudo (pico {p})");
        assert!(p <= 1.0, "{s:?} pico {p}");
    }
}

#[test]
fn pausa_congela_e_retomar_continua_do_mesmo_ponto() {
    let (sfx, mut r) = novo();
    sfx.play(Sound::Boom, 1.0, Some(Vec3::new(5.0, 0.0, 0.0)));
    let _ = toca(&mut r, 0.3);
    sfx.set_paused(true);
    let _ = toca(&mut r, 0.3); // o fade
    let (l, rr) = toca(&mut r, 0.5);
    assert!(pico(&l, &rr) < 1e-6, "pausado = silêncio");
    assert_eq!(r.mixer().emissores(), 1, "o estrondo continua guardado, congelado");
    sfx.set_paused(false);
    let (l, rr) = toca(&mut r, 0.4);
    assert!(rms(&l).max(rms(&rr)) > 0.01, "voltou a tocar");
}

#[test]
fn mudo_zera_o_volume_e_nao_toca_mais() {
    let (sfx, mut r) = novo();
    sfx.set_muted(true);
    assert!(sfx.play(Sound::Break, 1.0, Some(Vec3::new(1.0, 0.0, 0.0))).is_none());
    assert!(sfx.laser(Vec3::default()).is_none());
    let _ = toca(&mut r, 0.4);
    let (l, rr) = toca(&mut r, 0.3);
    assert!(pico(&l, &rr) < 1e-3, "fundo também some: {}", pico(&l, &rr));
    sfx.set_muted(false);
    sfx.play(Sound::Beep, 1.0, None);
    let (l, rr) = toca(&mut r, 0.3);
    assert!(pico(&l, &rr) > 0.01);
}

#[test]
fn dentro_da_base_o_fundo_grave_some_e_entra_a_ventilacao() {
    let medida = |dentro: bool| {
        let (sfx, mut r) = novo();
        sfx.set_indoors(dentro);
        let _ = toca(&mut r, 3.0);
        let (l, rr) = toca(&mut r, 1.0);
        (rms(&l) + rms(&rr)) * 0.5
    };
    let (fora, dentro) = (medida(false), medida(true));
    assert!(fora > 1e-4 && dentro > 1e-4, "os dois têm fundo: {fora} {dentro}");
    assert!((fora - dentro).abs() / fora > 0.05, "fundo diferente fora e dentro: {fora} {dentro}");
}

#[test]
fn dentro_o_eco_e_mais_curto() {
    // um golpe longe (muito eco): meio segundo depois, lá fora ainda sobra cauda; dentro da base, bem menos
    let cauda = |dentro: bool| {
        let (a, mut ra) = novo();
        let (_b, mut rb) = novo();
        a.set_indoors(dentro);
        _b.set_indoors(dentro);
        let _ = toca(&mut ra, 3.0);
        let _ = toca(&mut rb, 3.0);
        a.play(Sound::Break, 1.0, Some(Vec3::new(20.0, 0.0, 0.0)));
        let _ = toca(&mut ra, 0.6);
        let _ = toca(&mut rb, 0.6);
        let (la, rra) = toca(&mut ra, 0.5);
        let (lb, rrb) = toca(&mut rb, 0.5);
        let d = |x: &[f32], y: &[f32]| rms(&x.iter().zip(y).map(|(p, q)| p - q).collect::<Vec<_>>());
        d(&la, &lb).max(d(&rra, &rrb))
    };
    let (fora, dentro) = (cauda(false), cauda(true));
    assert!(fora > 1e-5, "lá fora sobra eco: {fora}");
    assert!(fora > dentro * 2.0, "eco fora {fora} dentro {dentro}");
}

#[test]
fn abafar_tira_os_agudos() {
    let nivel = |abafo: f32| {
        let (sfx, mut r) = novo();
        sfx.set_muffled(abafo);
        let _ = toca(&mut r, 1.0);
        sfx.play(Sound::Sizzle, 1.0, None);
        let (l, rr) = toca(&mut r, 0.3);
        // os agudos: tira o fundo grave com uma diferença de amostras vizinhas (passa-alta grosseiro)
        let alta = |v: &[f32]| rms(&v.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>());
        alta(&l).max(alta(&rr))
    };
    assert!(nivel(0.0) > nivel(0.85) * 20.0, "{} {}", nivel(0.0), nivel(0.85));
}

#[test]
fn vento_de_marte_so_com_ar_e_sobe_com_a_tempestade() {
    let medida = |ar: bool, vento: f32| {
        let (l, rr) = so(
            |s| {
                s.set_air(ar);
                s.set_wind(vento);
            },
            4.0,
        );
        let n = l.len() / 4;
        (rms(&l[3 * n..]) + rms(&rr[3 * n..])) * 0.5
    };
    let sem_ar = medida(false, 1.0);
    let brisa = medida(true, 0.0);
    let tempestade = medida(true, 1.0);
    assert!(sem_ar < 1e-4, "sem ar não tem vento: {sem_ar}");
    assert!(tempestade > brisa * 3.0, "tempestade {tempestade} brisa {brisa}");
    assert!(brisa > 1e-3, "sempre há uma brisa em Marte: {brisa}");
}

#[test]
fn parar_tudo_ao_trocar_de_jogo() {
    let (sfx, mut r) = novo();
    sfx.hum(Vec3::new(1.0, 0.0, 0.0));
    sfx.laser(Vec3::new(2.0, 0.0, 0.0));
    let _ = toca(&mut r, 0.1);
    assert_eq!(r.mixer().emissores(), 2);
    sfx.stop_all();
    let _ = toca(&mut r, 0.5);
    assert_eq!(r.mixer().emissores(), 0);
}

#[test]
fn registro_guarda_os_pedidos_na_ordem() {
    let sfx = Sfx::recording();
    sfx.set_listener([0.0; 3], (0.0, -1.0));
    sfx.play(Sound::Step, 1.0, Some(Vec3::new(1.0, 0.0, 0.0)));
    sfx.play(Sound::Pop, 1.3, None);
    sfx.play(Sound::Break, 1.0, Some(Vec3::new(500.0, 0.0, 0.0))); // longe demais: nem é pedido
    let v = sfx.take_log();
    assert_eq!(v.len(), 2);
    assert_eq!((v[0].som, v[1].som), (Sound::Step, Sound::Pop));
    assert!((v[1].pitch - 1.3).abs() < 1e-6);
    assert!(sfx.take_log().is_empty(), "o registro esvazia");
    assert!(!sfx.ativo());
}

#[test]
fn sfx_mudo_nao_faz_nada_e_nao_quebra() {
    let s = Sfx::silent();
    assert!(s.play(Sound::Hit, 1.0, None).is_none());
    assert!(s.hum(Vec3::default()).is_none());
    s.set_listener([1.0; 3], (0.0, 1.0));
    s.set_muted(true);
    s.set_paused(true);
    s.stop_all();
    assert!(s.take_log().is_empty());
    assert!(!s.ativo());
}

#[test]
fn fila_nao_trava_quando_a_thread_de_audio_esta_ocupada() {
    // o jogo escreve enquanto o "áudio" segura a trava: nada pode bloquear nem perder comandos
    let (sfx, mut r) = novo();
    for _ in 0..1000 {
        sfx.set_listener([1.0, 0.0, 1.0], (0.0, -1.0));
    }
    // só um Listener pendente (os outros foram substituídos)
    sfx.play(Sound::Beep, 1.0, None);
    let (l, rr) = toca(&mut r, 0.2);
    assert!(pico(&l, &rr) > 0.01);
}

#[test]
fn som_com_atraso_so_comeca_depois() {
    let (l, rr) = so(|s| { let _ = s.play_after(Sound::Beep, 1.0, None, 0.3); }, 0.6);
    let n = (SR * 0.25) as usize;
    assert!(pico(&l[..n], &rr[..n]) < 1e-6, "antes do atraso: silêncio");
    assert!(pico(&l[n..], &rr[n..]) > 0.01, "depois toca");
}

#[test]
fn no_titulo_nao_ha_fundo_so_os_cliques() {
    let (sfx, mut r) = Sfx::offline(SR);
    let _ = toca(&mut r, 1.0);
    let (l, rr) = toca(&mut r, 0.5);
    assert!(pico(&l, &rr) < 1e-6, "sem jogo, silêncio");
    sfx.play(Sound::Ui, 1.0, None);
    let (l, rr) = toca(&mut r, 0.2);
    assert!(pico(&l, &rr) > 0.01, "o clique toca");
    sfx.set_world(true);
    let _ = toca(&mut r, 3.0);
    let (l, rr) = toca(&mut r, 0.5);
    assert!(pico(&l, &rr) > 1e-3, "com jogo, o fundo da cratera");
}

#[cfg(feature = "dispositivo")]
#[test]
fn abrir_a_placa_nunca_quebra_com_ou_sem_placa_de_som() {
    // sem placa (servidor, CI): `None` e o jogo segue mudo. Com placa: toca um bipe curto de verdade.
    match Saida::abrir() {
        None => eprintln!("sem placa de som aqui (ok)"),
        Some(s) => {
            let sfx = s.sfx();
            assert!(sfx.ativo());
            sfx.play(Sound::Beep, 1.0, None);
            std::thread::sleep(std::time::Duration::from_millis(300));
            s.ativa(false);
            s.ativa(true);
        }
    }
}
