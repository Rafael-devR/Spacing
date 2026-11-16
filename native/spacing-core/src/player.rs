//! Jogador (porte da física de `src/entities/Player.ts`): gravidade do planeta, colisão com voxels, subida automática de
//! degraus, empurrão do módulo de pouso. `step` roda em passo fixo; `animate` a cada quadro (interpola e anima).
use crate::anim::{AnimState, Animator, Gesture};
use crate::planet::Physics;
use crate::terrain::{LANDER, SPAWN};
use crate::world::World;

/// meia largura
pub const HW: f64 = 0.3;
pub const HEIGHT: f64 = 1.5;
pub const SPEED: f64 = 4.6;

#[derive(Clone, Copy, Debug, Default)]
pub struct MoveInput {
    /// -1..1, relativo à câmera
    pub move_x: f64,
    pub move_y: f64,
    /// pedido de pulo; consumido no próximo passo
    pub jump: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PlayerEvent {
    Step([f64; 3]),
    Jump([f64; 3]),
    Land([f64; 3], f64),
}

pub struct Player {
    pub physics: Physics,
    pub pos: [f64; 3],
    pub prev_pos: [f64; 3],
    pub vel: [f64; 3],
    /// empurrão de fora (vento de Marte)
    pub push: [f64; 3],
    pub on_ground: bool,
    pub facing: f64,
    pub face_target: Option<f64>,
    pub mining: bool,
    pub dead: bool,
    pub frozen: bool,
    pub holding: bool,
    pub anim: Animator,
    pub events: Vec<PlayerEvent>,
    /// deslocamento visual ao subir um degrau (some depressa)
    pub step_offset: f64,
    step_timer: f64,
    time: f64,
}

impl Player {
    pub fn new(physics: Physics) -> Self {
        Self {
            physics,
            pos: [0.5, 30.0, 0.5],
            prev_pos: [0.5, 30.0, 0.5],
            vel: [0.0; 3],
            push: [0.0; 3],
            on_ground: false,
            facing: 0.0,
            face_target: None,
            mining: false,
            dead: false,
            frozen: false,
            holding: false,
            anim: Animator::new(),
            events: Vec::new(),
            step_offset: 0.0,
            step_timer: 0.0,
            time: 0.0,
        }
    }

    pub fn spawn(&mut self, world: &mut World, x: f64, z: f64) {
        self.pos = [x, world.top_y(x.floor() as i32, z.floor() as i32) as f64 + 1.05, z];
        self.prev_pos = self.pos;
        self.vel = [0.0; 3];
    }

    pub fn collides(world: &mut World, px: f64, py: f64, pz: f64) -> bool {
        let (x0, x1) = ((px - HW).floor() as i32, (px + HW).floor() as i32);
        let (y0, y1) = (py.floor() as i32, (py + HEIGHT).floor() as i32);
        let (z0, z1) = ((pz - HW).floor() as i32, (pz + HW).floor() as i32);
        for y in y0..=y1 {
            for z in z0..=z1 {
                for x in x0..=x1 {
                    if world.is_solid(x, y, z) {
                        return true;
                    }
                }
            }
        }
        false
    }

    fn move_axis(&mut self, world: &mut World, axis: usize, amount: f64) -> bool {
        let steps = ((amount.abs() / 0.3).ceil() as i32).max(1);
        let d = amount / steps as f64;
        for _ in 0..steps {
            self.pos[axis] += d;
            let p = self.pos;
            if !Self::collides(world, p[0], p[1], p[2]) {
                continue;
            }
            let p = &mut self.pos;
            if axis == 1 {
                p[1] = if d < 0.0 { p[1].floor() + 1.0 } else { (p[1] + HEIGHT).floor() - HEIGHT - 0.001 };
            } else if d > 0.0 {
                p[axis] = (p[axis] + HW).floor() - HW - 0.001;
            } else {
                p[axis] = (p[axis] - HW).floor() + 1.0 + HW + 0.001;
            }
            return true;
        }
        false
    }

    fn try_step(&mut self, world: &mut World, axis: usize, amount: f64) -> bool {
        if !self.on_ground {
            return false;
        }
        let p = self.pos;
        let nx = if axis == 0 { p[0] + amount } else { p[0] };
        let nz = if axis == 2 { p[2] + amount } else { p[2] };
        let ny = (p[1] + 0.01).floor() + 1.0;
        if ny - p[1] > 1.05 {
            return false;
        }
        if Self::collides(world, nx, ny + 0.001, nz) {
            return false;
        }
        self.step_offset -= ny - p[1];
        self.pos = [nx, ny + 0.001, nz];
        true
    }

    /// Física de um passo fixo. `yaw` é o da câmera (o movimento é relativo a ela).
    pub fn step(&mut self, world: &mut World, dt: f64, input: &mut MoveInput, yaw: f64) {
        self.prev_pos = self.pos;
        if self.frozen {
            input.jump = false;
            self.on_ground = true;
            self.vel = [0.0; 3];
            return;
        }
        let (fx, fz) = (-yaw.sin(), -yaw.cos());
        let (rx, rz) = (yaw.cos(), -yaw.sin());
        let (mx, my) = if self.dead { (0.0, 0.0) } else { (input.move_x, input.move_y) };
        let mut dx = rx * mx + fx * my;
        let mut dz = rz * mx + fz * my;
        let len = crate::js::hypot(dx, dz);
        if len > 1.0 {
            dx /= len;
            dz /= len;
        }
        let accel = if self.on_ground { 14.0 } else { 5.0 };
        let k = 1.0 - (-accel * dt).exp();
        self.vel[0] += (dx * SPEED - self.vel[0]) * k;
        self.vel[2] += (dz * SPEED - self.vel[2]) * k;

        if input.jump && self.on_ground && !self.dead {
            self.vel[1] = self.physics.jump;
            self.on_ground = false;
            self.anim.jump();
            self.events.push(PlayerEvent::Jump(self.pos));
        }
        input.jump = false;
        self.vel[1] -= self.physics.gravity * dt;
        if self.vel[1] < -30.0 {
            self.vel[1] = -30.0;
        }

        let ax = (self.vel[0] + self.push[0]) * dt;
        let az = (self.vel[2] + self.push[2]) * dt;
        if self.move_axis(world, 0, ax) && !self.try_step(world, 0, ax) {
            self.vel[0] = 0.0;
        }
        if self.move_axis(world, 2, az) && !self.try_step(world, 2, az) {
            self.vel[2] = 0.0;
        }

        let vy = self.vel[1];
        let was_ground = self.on_ground;
        self.on_ground = false;
        if self.move_axis(world, 1, vy * dt) {
            if vy < 0.0 {
                self.on_ground = true;
                if !was_ground && vy < -2.5 {
                    self.anim.landed(((-vy - 2.5) / 12.0).min(1.0));
                }
                if !was_ground && vy < -7.0 {
                    self.events.push(PlayerEvent::Land(self.pos, -vy));
                }
            }
            self.vel[1] = 0.0;
        }

        let p = &mut self.pos;
        let (ldx, ldz) = (p[0] - (LANDER.0 + 0.5), p[2] - (LANDER.1 + 0.5));
        let ld = crate::js::hypot(ldx, ldz);
        if ld < LANDER.2 && p[1] < world.terrain.spawn_h() + 4.0 {
            let l = if ld != 0.0 { ld } else { 1.0 };
            p[0] += (ldx / l) * (LANDER.2 - ld);
            p[2] += (ldz / l) * (LANDER.2 - ld);
        }

        if self.pos[1] < -10.0 {
            self.spawn(world, SPAWN.0, SPAWN.1);
        }

        let speed = crate::js::hypot(self.vel[0], self.vel[2]);
        if self.on_ground && speed > 1.0 {
            self.step_timer -= dt;
            if self.step_timer <= 0.0 {
                self.events.push(PlayerEvent::Step(self.pos));
                self.step_timer = 0.34;
            }
        }
    }

    /// Animação por quadro. `alpha` é a fração entre o passo anterior e o atual. Devolve a posição para desenhar.
    pub fn animate(&mut self, dt: f64, alpha: f64) -> [f64; 3] {
        self.time += dt;
        let speed = crate::js::hypot(self.vel[0], self.vel[2]);
        let before = self.facing;
        if speed > 0.3 {
            self.facing = lerp_angle(self.facing, self.vel[0].atan2(self.vel[2]), 1.0 - (-12.0 * dt).exp());
        }
        if let Some(t) = self.face_target {
            self.facing = lerp_angle(self.facing, t, 1.0 - (-14.0 * dt).exp());
        }
        let turn = if dt > 0.0 { angle_diff(self.facing, before) / dt } else { 0.0 };
        self.step_offset *= (-14.0 * dt).exp();
        let s = AnimState {
            speed,
            max_speed: SPEED,
            on_ground: self.on_ground || self.frozen,
            vy: self.vel[1],
            turn,
            mining: self.mining,
            holding: self.holding,
            dead: self.dead,
        };
        self.anim.update(dt, &s);
        let (a, b) = (self.prev_pos, self.pos);
        [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha + self.step_offset, a[2] + (b[2] - a[2]) * alpha]
    }

    pub fn gesture(&mut self, g: Gesture) {
        if !self.dead {
            self.anim.play(g);
        }
    }

    pub fn center(&self) -> [f64; 3] {
        [self.pos[0], self.pos[1] + 0.9, self.pos[2]]
    }

    pub fn intersects_block(&self, x: i32, y: i32, z: i32) -> bool {
        let p = self.pos;
        let (x, y, z) = (x as f64, y as f64, z as f64);
        x + 1.0 > p[0] - HW && x < p[0] + HW && y + 1.0 > p[1] && y < p[1] + HEIGHT && z + 1.0 > p[2] - HW && z < p[2] + HW
    }
}

/// diferença a - b pelo caminho mais curto
pub fn angle_diff(a: f64, b: f64) -> f64 {
    use std::f64::consts::PI;
    let mut d = (a - b) % (PI * 2.0);
    if d > PI {
        d -= PI * 2.0;
    }
    if d < -PI {
        d += PI * 2.0;
    }
    d
}

pub fn lerp_angle(a: f64, b: f64, t: f64) -> f64 {
    use std::f64::consts::PI;
    let mut d = ((b - a + PI) % (PI * 2.0)) - PI;
    if d < -PI {
        d += PI * 2.0;
    }
    a + d * t
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planet::{PlanetId, LUA};

    #[test]
    fn cai_e_para_no_chao() {
        let mut w = World::new(PlanetId::Lua, 12345);
        let mut p = Player::new(LUA.physics);
        p.spawn(&mut w, SPAWN.0, SPAWN.1);
        p.pos[1] += 5.0;
        let mut inp = MoveInput::default();
        for _ in 0..240 {
            p.step(&mut w, 1.0 / 60.0, &mut inp, 0.0);
        }
        assert!(p.on_ground);
        let top = w.top_y(SPAWN.0.floor() as i32, SPAWN.1.floor() as i32) as f64;
        assert!((p.pos[1] - (top + 1.0)).abs() < 0.01, "pé no topo: {} x {}", p.pos[1], top + 1.0);
    }

    #[test]
    fn anda_para_a_frente_da_camera() {
        let mut w = World::new(PlanetId::Lua, 12345);
        let mut p = Player::new(LUA.physics);
        p.spawn(&mut w, SPAWN.0, SPAWN.1);
        let mut inp = MoveInput { move_x: 0.0, move_y: 1.0, jump: false };
        let z0 = p.pos[2];
        for _ in 0..30 {
            p.step(&mut w, 1.0 / 60.0, &mut inp, 0.0);
        }
        // yaw 0: frente = -z
        assert!(p.pos[2] < z0 - 0.5, "andou {}", z0 - p.pos[2]);
    }

    #[test]
    fn pula() {
        let mut w = World::new(PlanetId::Lua, 12345);
        let mut p = Player::new(LUA.physics);
        p.spawn(&mut w, SPAWN.0, SPAWN.1);
        let mut inp = MoveInput::default();
        for _ in 0..30 {
            p.step(&mut w, 1.0 / 60.0, &mut inp, 0.0);
        }
        let y0 = p.pos[1];
        inp.jump = true;
        let mut top = y0;
        for _ in 0..30 {
            p.step(&mut w, 1.0 / 60.0, &mut inp, 0.0);
            top = top.max(p.pos[1]);
        }
        // v²/2g = 7,4²/30 ≈ 1,8 blocos
        assert!(top - y0 > 1.5, "altura do pulo {}", top - y0);
    }

    #[test]
    fn angulos() {
        assert!((lerp_angle(3.0, -3.0, 1.0) - (-3.0 + std::f64::consts::PI * 2.0)).abs() < 1e-9);
        assert!(angle_diff(0.1, -0.1) > 0.0);
    }
}
