//! Contas do áudio posicional, sem placa de som (porte de `src/audio/spatial.ts`, branch `web`).
//! Na Lua não há ar: o traje capta a vibração que chega pelo chão e reconstrói o som no capacete.
//! Por isso, quanto mais longe, mais baixo e mais grave (o chão leva bem os graves), com mais eco da cratera.

/// Um ponto do mundo (blocos).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    /// de um ponto do jogo (que usa `f64`)
    pub fn de(p: [f64; 3]) -> Self {
        Self { x: p[0] as f32, y: p[1] as f32, z: p[2] as f32 }
    }

    pub fn dist(self, o: Vec3) -> f32 {
        ((self.x - o.x).powi(2) + (self.y - o.y).powi(2) + (self.z - o.z).powi(2)).sqrt()
    }
}

/// Como o volume, o filtro e o eco mudam com a distância.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Perfil {
    /// até essa distância (blocos) o som fica no volume cheio
    pub ref_: f32,
    /// além dessa distância o som não toca
    pub max: f32,
    /// quanto o som perde volume com a distância (maior = some mais rápido)
    pub rolloff: f32,
}

/// sons pequenos: passos, destroços, golpes
pub const NEAR: Perfil = Perfil { ref_: 3.0, max: 28.0, rolloff: 0.9 };
/// sons grandes: meteoro, explosão
pub const FAR: Perfil = Perfil { ref_: 8.0, max: 120.0, rolloff: 0.35 };
/// zumbido do módulo de pouso
pub const HUM: Perfil = Perfil { ref_: 2.5, max: 24.0, rolloff: 1.2 };

/// quanto o ouvinte fica atrás do astronauta, na direção da câmera
pub const LISTENER_BACK: f32 = 6.0;

/// Volume (0..1) pela distância: cheio até `ref_`, cai como 1/d e some suave perto de `max`.
pub fn distance_gain(d: f32, p: Perfil) -> f32 {
    if d >= p.max {
        return 0.0;
    }
    let base = if d <= p.ref_ { 1.0 } else { p.ref_ / (p.ref_ + p.rolloff * (d - p.ref_)) };
    let fade_start = p.max * 0.75;
    let fade = if d <= fade_start { 1.0 } else { 1.0 - (d - fade_start) / (p.max - fade_start) };
    base * fade * fade
}

/// Frequência de corte (Hz) do filtro: perto soa limpo, longe só passam os graves.
pub fn distance_cutoff(d: f32, p: Perfil) -> f32 {
    let k = (d - p.ref_).max(0.0) / (p.max - p.ref_);
    18000.0 * (350.0f32 / 18000.0).powf(k.sqrt().min(1.0))
}

/// Quanto do som vai para o eco (0..1): longe tem mais eco que som direto.
pub fn reverb_send(d: f32, p: Perfil) -> f32 {
    0.06 + 0.5 * (d / p.max).min(1.0)
}

/// Posição do ouvinte: um pouco atrás do astronauta, do lado da câmera. Assim o lado esquerdo e o direito do som batem
/// com os lados da tela, e um som no próprio astronauta fica no centro. `forward` é a direção da câmera no chão.
pub fn listener_position(player: Vec3, forward: (f32, f32)) -> Vec3 {
    Vec3 { x: player.x - forward.0 * LISTENER_BACK, y: player.y + 1.0, z: player.z - forward.1 * LISTENER_BACK }
}

/// Lado do som, de -1 (esquerda) a 1 (direita), visto pelo ouvinte. Direita da câmera = `(-forward.z, forward.x)`
/// (o `IsoRig.right()` do TS).
pub fn pan(listener: Vec3, forward: (f32, f32), src: Vec3) -> f32 {
    let (dx, dz) = (src.x - listener.x, src.z - listener.z);
    let len = dx.hypot(dz);
    if len < 1e-6 {
        return 0.0;
    }
    let (rx, rz) = (-forward.1, forward.0);
    ((dx * rx + dz * rz) / len).clamp(-1.0, 1.0)
}

/// Os dois ganhos do panner `equalpower` do WebAudio para um som mono: azimute dobrado para a frente (-90° a 90°),
/// `x = (azimute + 90°) / 180°`, `esq = cos(x·π/2)`, `dir = sin(x·π/2)`. No centro cada lado fica com 0,707.
pub fn equal_power(pan: f32) -> (f32, f32) {
    let azimuth = pan.clamp(-1.0, 1.0).asin();
    let x = (azimuth + std::f32::consts::FRAC_PI_2) / std::f32::consts::PI;
    let a = x * std::f32::consts::FRAC_PI_2;
    (a.cos(), a.sin())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perto_fica_no_volume_cheio_longe_some_e_passa_do_limite_nao_toca() {
        assert_eq!(distance_gain(0.0, NEAR), 1.0);
        assert_eq!(distance_gain(NEAR.ref_, NEAR), 1.0);
        assert!(distance_gain(12.0, NEAR) < distance_gain(6.0, NEAR));
        assert_eq!(distance_gain(NEAR.max, NEAR), 0.0);
        assert!(distance_gain(NEAR.max * 0.99, NEAR) < 0.01);
    }

    #[test]
    fn meteoro_e_ouvido_bem_mais_longe_que_um_passo() {
        assert!(distance_gain(40.0, FAR) > 0.1);
        assert_eq!(distance_gain(40.0, NEAR), 0.0);
    }

    #[test]
    fn longe_soa_mais_grave_e_com_mais_eco() {
        assert!((distance_cutoff(0.0, NEAR) - 18000.0).abs() < 1e-3);
        assert!(distance_cutoff(20.0, NEAR) < 3000.0);
        assert!((distance_cutoff(NEAR.max, NEAR) - 350.0).abs() < 0.5);
        assert!(reverb_send(20.0, NEAR) > reverb_send(1.0, NEAR));
    }

    #[test]
    fn o_lado_do_som_bate_com_o_lado_da_tela_em_qualquer_giro_da_camera() {
        use std::f32::consts::PI;
        let player = Vec3::new(10.0, 20.0, -4.0);
        for yaw in [PI / 4.0, 3.0 * PI / 4.0, -PI / 4.0, PI] {
            let forward = (-yaw.sin(), -yaw.cos());
            let right = (yaw.cos(), -yaw.sin()); // IsoRig.right()
            let l = listener_position(player, forward);
            assert!(pan(l, forward, player).abs() < 1e-3, "no astronauta: centro");
            assert!(pan(l, forward, Vec3::new(player.x + right.0 * 5.0, 0.0, player.z + right.1 * 5.0)) > 0.5);
            assert!(pan(l, forward, Vec3::new(player.x - right.0 * 5.0, 0.0, player.z - right.1 * 5.0)) < -0.5);
        }
    }

    #[test]
    fn panner_equalpower_bate_com_o_do_webaudio() {
        let (l, r) = equal_power(0.0);
        assert!((l - 0.70710677).abs() < 1e-5 && (r - 0.70710677).abs() < 1e-5);
        let (l, r) = equal_power(1.0);
        assert!(l.abs() < 1e-5 && (r - 1.0).abs() < 1e-5);
        let (l, r) = equal_power(-1.0);
        assert!((l - 1.0).abs() < 1e-5 && r.abs() < 1e-5);
        // a potência total fica constante
        for p in [-0.8f32, -0.3, 0.2, 0.9] {
            let (l, r) = equal_power(p);
            assert!((l * l + r * r - 1.0).abs() < 1e-5);
        }
    }
}
