//! Câmera isométrica em perspectiva estreita (porte de `src/render/IsoRig.ts`): segue o jogador, gira de 90° em 90°, tem
//! zoom, chega mais perto dentro de caverna e treme com impactos. Só a conta; quem desenha monta a matriz com `eye`/`target`.

#[derive(Clone, Debug)]
pub struct IsoRig {
    pub yaw: f64,
    pub yaw_target: f64,
    pub pitch: f64,
    /// 0 ao ar livre, 1 dentro de caverna
    pub cave: f64,
    pub cave_target: f64,
    /// distância real neste quadro
    pub eye_dist: f64,
    pub dist: f64,
    pub dist_target: f64,
    pub min: f64,
    pub max: f64,
    pub target: [f64; 3],
    /// posição da câmera neste quadro
    pub eye: [f64; 3],
    /// rolagem do tremor (rad)
    pub roll: f64,
    pub shake_scale: f64,
    trauma: f64,
    time: f64,
    punch_x: f64,
    punch_v: f64,
}

pub const CAVE_ZOOM: f64 = 0.5;
pub const CAVE_MIN: f64 = 12.0;
pub const CAVE_MAX: f64 = 20.0;
const PUNCH_K: f64 = 120.0;
const PUNCH_C: f64 = 10.0;

impl Default for IsoRig {
    fn default() -> Self {
        let yaw = std::f64::consts::PI / 4.0;
        Self {
            yaw,
            yaw_target: yaw,
            pitch: 0.76,
            cave: 0.0,
            cave_target: 0.0,
            eye_dist: 30.0,
            dist: 30.0,
            dist_target: 30.0,
            min: 16.0,
            max: 46.0,
            target: [0.0; 3],
            eye: [0.0; 3],
            roll: 0.0,
            shake_scale: 1.0,
            trauma: 0.0,
            time: 0.0,
            punch_x: 0.0,
            punch_v: 0.0,
        }
    }
}

impl IsoRig {
    pub fn rotate(&mut self, dir: f64) {
        self.yaw_target += dir * std::f64::consts::PI / 2.0;
    }

    pub fn zoom(&mut self, factor: f64) {
        self.dist_target = (self.dist_target * factor).clamp(self.min, self.max);
    }

    /// tremor (0..1, soma)
    pub fn shake(&mut self, amount: f64) {
        self.trauma = (self.trauma + amount).min(1.0);
    }

    /// soco de zoom (impacto)
    pub fn punch(&mut self, blocks: f64) {
        self.punch_v += blocks * 14.0;
    }

    pub fn snap(&mut self, focus: [f64; 3]) {
        self.target = focus;
        self.update(0.0, focus, true);
    }

    pub fn update(&mut self, dt: f64, focus: [f64; 3], instant: bool) {
        let ease = |rate: f64| if instant { 1.0 } else { 1.0 - (-rate * dt).exp() };
        let k = ease(7.0);
        for (t, f) in self.target.iter_mut().zip(focus) {
            *t += (f - *t) * k;
        }
        self.yaw += (self.yaw_target - self.yaw) * ease(9.0);
        self.dist += (self.dist_target - self.dist) * ease(8.0);
        self.cave += (self.cave_target - self.cave) * ease(3.2);
        let near = (self.dist_target * CAVE_ZOOM).clamp(CAVE_MIN, CAVE_MAX);
        self.eye_dist = self.dist + (self.dist.min(near) - self.dist) * self.cave;
        if self.punch_x != 0.0 || self.punch_v != 0.0 {
            self.punch_v += (-PUNCH_K * self.punch_x - PUNCH_C * self.punch_v) * dt;
            self.punch_x += self.punch_v * dt;
            if self.punch_x.abs() < 1e-3 && self.punch_v.abs() < 1e-2 {
                self.punch_x = 0.0;
                self.punch_v = 0.0;
            }
        }
        let eye = self.eye_dist - self.punch_x * self.shake_scale;
        let c = self.pitch.cos();
        let t = self.target;
        self.eye = [t[0] + self.yaw.sin() * c * eye, t[1] + self.pitch.sin() * eye, t[2] + self.yaw.cos() * c * eye];
        self.roll = 0.0;
        if self.trauma > 0.0 {
            self.time += dt;
            let s = self.trauma * self.trauma * 0.9 * self.shake_scale;
            let tt = self.time * 28.0;
            self.eye[0] += (tt * 1.1).sin() * (tt * 0.37).sin() * s;
            self.eye[1] += (tt * 1.3 + 2.0).sin() * (tt * 0.51).sin() * s;
            self.eye[2] += (tt * 0.9 + 4.0).sin() * (tt * 0.43).sin() * s;
            self.roll = (tt * 0.7).sin() * s * 0.03;
            self.trauma = (self.trauma - dt * 1.4).max(0.0);
        }
    }

    /// para onde é "frente" no chão (relativo à câmera)
    pub fn forward(&self) -> [f64; 3] {
        [-self.yaw.sin(), 0.0, -self.yaw.cos()]
    }

    pub fn right(&self) -> [f64; 3] {
        [self.yaw.cos(), 0.0, -self.yaw.sin()]
    }

    /// raio de chunks que a câmera enxerga (igual ao Game.ts)
    pub fn chunk_radius(&self) -> i32 {
        (((1.05 * self.dist_target + 10.0) / 16.0).ceil() as i32).clamp(2, 5)
    }
}

/// Lente da câmera (graus): 30 na horizontal; em pé, abre para caber o mesmo pedaço do mundo (Game.ts).
pub fn base_fov(aspect: f64) -> f64 {
    if aspect >= 1.0 {
        30.0
    } else {
        (2.0 * ((15f64.to_radians().tan() / aspect) * 0.72).atan()).to_degrees().min(50.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn olha_de_cima_na_diagonal() {
        let mut r = IsoRig::default();
        r.snap([0.0, 40.0, 0.0]);
        assert!(r.eye[1] > 40.0 + 15.0);
        assert!(r.eye[0] > 0.0 && r.eye[2] > 0.0);
        let f = r.forward();
        // a frente aponta para longe da câmera
        assert!(f[0] < 0.0 && f[2] < 0.0);
    }
    #[test]
    fn zoom_tem_limite() {
        let mut r = IsoRig::default();
        r.zoom(100.0);
        assert_eq!(r.dist_target, 46.0);
        r.zoom(0.0001);
        assert_eq!(r.dist_target, 16.0);
    }
}
