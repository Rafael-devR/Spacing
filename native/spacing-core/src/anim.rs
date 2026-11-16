//! Animação procedural do astronauta (porte de `src/render/astronautAnim.ts`, ADR 0017). Recebe o estado do jogador e
//! devolve o ângulo de cada junta (Euler XYZ local, radianos). Mesmas convenções do TS.

pub const JOINTS: [&str; 16] = [
    "hips", "torso", "head", "pack", "armL", "foreL", "handL", "armR", "foreR", "handR", "legL", "shinL", "footL", "legR", "shinR", "footR",
];
pub const HIPS: usize = 0;
pub const TORSO: usize = 1;
pub const HEAD: usize = 2;
pub const PACK: usize = 3;
pub const ARM_L: usize = 4;
pub const FORE_L: usize = 5;
pub const HAND_L: usize = 6;
pub const ARM_R: usize = 7;
pub const FORE_R: usize = 8;
pub const HAND_R: usize = 9;
pub const LEG_L: usize = 10;
pub const SHIN_L: usize = 11;
pub const FOOT_L: usize = 12;
pub const LEG_R: usize = 13;
pub const SHIN_R: usize = 14;
pub const FOOT_R: usize = 15;

#[derive(Clone, Copy, Debug, Default)]
pub struct Angles {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Debug)]
pub struct Pose {
    pub j: [Angles; 16],
    pub hip_y: f64,
    pub stretch: f64,
}

impl Default for Pose {
    fn default() -> Self {
        Self { j: [Angles::default(); 16], hip_y: 0.0, stretch: 1.0 }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct AnimState {
    pub speed: f64,
    pub max_speed: f64,
    pub on_ground: bool,
    pub vy: f64,
    pub turn: f64,
    pub mining: bool,
    pub holding: bool,
    pub dead: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gesture {
    Place,
    Eat,
    Hurt,
    Pickup,
}

impl Gesture {
    pub fn time(self) -> f64 {
        match self {
            Gesture::Place => 0.38,
            Gesture::Eat => 1.1,
            Gesture::Hurt => 0.45,
            Gesture::Pickup => 0.45,
        }
    }
}

const STRIDE_WALK: f64 = 2.5;
const STRIDE_RUN: f64 = 2.25;
const RUN_FROM: f64 = 2.2;
const RUN_FULL: f64 = 4.0;
const IDLE_FIDGET: f64 = 6.0;

#[inline]
fn clamp(v: f64, a: f64, b: f64) -> f64 {
    if v < a {
        a
    } else if v > b {
        b
    } else {
        v
    }
}
#[inline]
fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let t = clamp((v - a) / (b - a), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
#[inline]
fn approach(cur: f64, to: f64, rate: f64, dt: f64) -> f64 {
    cur + (to - cur) * (1.0 - (-rate * dt).exp())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Fidget {
    Look,
    Stretch,
    Tap,
}

#[derive(Default)]
pub struct Animator {
    pub pose: Pose,
    phase: f64,
    time: f64,
    w_move: f64,
    w_run: f64,
    w_air: f64,
    w_fall: f64,
    w_mine: f64,
    w_hold: f64,
    w_dead: f64,
    turn_lean: f64,
    air_time: f64,
    land: f64,
    land_v: f64,
    jump_stretch: f64,
    pack: f64,
    pack_v: f64,
    last_hip_y: f64,
    gesture: Option<Gesture>,
    gesture_t: f64,
    idle_t: f64,
    fidget: Option<Fidget>,
    fidget_t: f64,
    fidget_n: usize,
}

impl Animator {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn jump(&mut self) {
        self.jump_stretch = 1.0;
    }
    pub fn landed(&mut self, impact: f64) {
        self.land_v += 3.0 + clamp(impact, 0.0, 1.0) * 12.0;
    }
    pub fn play(&mut self, g: Gesture) {
        self.gesture = Some(g);
        self.gesture_t = 0.0;
    }
    pub fn current_gesture(&self) -> Option<Gesture> {
        self.gesture
    }

    pub fn update(&mut self, dt: f64, s: &AnimState) -> &Pose {
        let dt = dt.min(0.1);
        self.time += dt;
        let t = self.time;
        let sp = if s.dead { 0.0 } else { s.speed };

        self.w_move = approach(self.w_move, smooth(0.15, 1.2, sp), 10.0, dt);
        self.w_run = approach(self.w_run, smooth(RUN_FROM, RUN_FULL, sp), 6.0, dt);
        let air = !s.on_ground && !s.dead;
        self.w_air = approach(self.w_air, if air { 1.0 } else { 0.0 }, if air { 9.0 } else { 16.0 }, dt);
        self.w_fall = approach(self.w_fall, smooth(1.5, -3.5, s.vy), 6.0, dt);
        self.air_time = if air { self.air_time + dt } else { 0.0 };
        self.w_mine = approach(self.w_mine, if s.mining && !s.dead { 1.0 } else { 0.0 }, 12.0, dt);
        self.w_hold = approach(self.w_hold, if s.holding && !s.dead { 1.0 } else { 0.0 }, 8.0, dt);
        self.w_dead = approach(self.w_dead, if s.dead { 1.0 } else { 0.0 }, 5.0, dt);
        self.turn_lean = approach(self.turn_lean, clamp(s.turn, -6.0, 6.0) * clamp(sp / s.max_speed, 0.0, 1.0), 8.0, dt);

        if s.on_ground && sp > 0.05 {
            let k = STRIDE_WALK + (STRIDE_RUN - STRIDE_WALK) * self.w_run;
            self.phase += sp * dt * k;
        }

        self.land_v += (-140.0 * self.land - 13.0 * self.land_v) * dt;
        self.land += self.land_v * dt;
        self.jump_stretch = (self.jump_stretch - dt * 4.0).max(0.0);

        let still = !air && !s.dead && !s.mining && sp < 0.2 && self.gesture.is_none();
        self.idle_t = if still { self.idle_t + dt } else { 0.0 };
        if self.fidget.is_some() {
            self.fidget_t += dt;
            if !still || self.fidget_t > 2.6 {
                self.fidget = None;
            }
        } else if self.idle_t > IDLE_FIDGET {
            const ORDER: [Fidget; 4] = [Fidget::Look, Fidget::Tap, Fidget::Stretch, Fidget::Look];
            self.fidget = Some(ORDER[self.fidget_n % 4]);
            self.fidget_n += 1;
            self.fidget_t = 0.0;
            self.idle_t = IDLE_FIDGET - 4.0 - (self.fidget_n % 3) as f64;
        }

        if let Some(g) = self.gesture {
            self.gesture_t += dt;
            if self.gesture_t >= g.time() {
                self.gesture = None;
            }
        }

        for a in self.pose.j.iter_mut() {
            *a = Angles::default();
        }
        self.pose.hip_y = 0.0;

        self.idle(t, 1.0 - self.w_move);
        self.locomotion(self.w_move * (1.0 - self.w_air));
        self.airborne(t, self.w_air);
        self.landing();
        self.lean();
        self.hold_item(t, self.w_hold * (1.0 - self.w_mine));
        self.mine(t, self.w_mine);
        if let Some(g) = self.gesture {
            self.gesture_layer(g, self.gesture_t / g.time());
        }
        self.dead_layer(self.w_dead);

        let p = &mut self.pose;
        let hip_vel = (p.hip_y - self.last_hip_y) / dt.max(1e-4);
        self.last_hip_y = p.hip_y;
        self.pack_v += (-90.0 * self.pack - 9.0 * self.pack_v - clamp(hip_vel, -3.0, 3.0) * 4.0) * dt;
        self.pack += self.pack_v * dt;
        p.j[PACK].x += clamp(self.pack, -0.35, 0.35) + self.w_air * (self.w_fall - 0.5) * 0.25;
        p.stretch = 1.0 - clamp(self.land, -0.12, 0.35) * 0.35 + self.jump_stretch * self.jump_stretch * 0.1 * (1.0 - self.w_dead);
        &self.pose
    }

    fn idle(&mut self, t: f64, w: f64) {
        if w <= 0.001 {
            return;
        }
        let fidget = self.fidget;
        let ft = self.fidget_t;
        let p = &mut self.pose;
        let j = &mut p.j;
        let br = (t * 2.1).sin();
        j[TORSO].x += -0.03 * br * w;
        j[HEAD].x += 0.03 * (t * 2.1 - 0.6).sin() * w;
        j[HEAD].z += 0.04 * (t * 0.7).sin() * w;
        j[ARM_L].z += (-0.12 - 0.03 * br) * w;
        j[ARM_R].z += (0.12 + 0.03 * br) * w;
        j[FORE_L].x += -0.18 * w;
        j[FORE_R].x += -0.18 * w;
        j[LEG_L].z += -0.05 * w;
        j[LEG_R].z += 0.05 * w;
        p.hip_y += -0.008 * (br + 1.0) * w;
        let sway = (t * 0.45).sin() * 0.035 * w;
        let j = &mut p.j;
        j[HIPS].z += sway;
        j[TORSO].z -= sway * 0.8;
        j[LEG_L].z -= sway;
        j[LEG_R].z -= sway;

        let Some(f) = fidget else { return };
        let u = ft / 2.6;
        let env = smooth(0.0, 0.15, u) * (1.0 - smooth(0.82, 1.0, u)) * w;
        match f {
            Fidget::Look => {
                let y = if u < 0.5 { 0.75 * smooth(0.05, 0.3, u) } else { 0.75 - 1.5 * smooth(0.45, 0.7, u) };
                j[HEAD].y += y * env;
                j[HEAD].x += -0.12 * env;
                j[TORSO].y += y * 0.25 * env;
            }
            Fidget::Stretch => {
                j[ARM_L].z += -2.4 * env;
                j[ARM_R].z += 2.4 * env;
                j[FORE_L].x += 0.18 * env;
                j[FORE_R].x += 0.18 * env;
                j[TORSO].x += -0.18 * env;
                j[HEAD].x += -0.3 * env;
                p.hip_y += 0.02 * env;
            }
            Fidget::Tap => {
                let tap = (ft * 11.0).sin().max(0.0);
                j[LEG_R].x += -0.25 * env;
                j[SHIN_R].x += 0.15 * env;
                j[FOOT_R].x += -0.5 * tap * env;
                j[ARM_L].z += -0.55 * env;
                j[ARM_R].z += 0.55 * env;
                j[FORE_L].x += -1.2 * env;
                j[FORE_R].x += -1.2 * env;
                j[FORE_L].y += 0.9 * env;
                j[FORE_R].y += -0.9 * env;
                j[HEAD].z += 0.1 * (ft * 5.5).sin() * env;
            }
        }
    }

    fn locomotion(&mut self, w: f64) {
        if w <= 0.001 {
            return;
        }
        let r = self.w_run;
        let ph = self.phase;
        let p = &mut self.pose;
        let j = &mut p.j;
        let (s, c) = (ph.sin(), ph.cos());
        let thigh = 0.5 + 0.35 * r;
        let lift = |x: f64| x.max(0.0).powf(1.5);
        let knee = 0.7 + 0.8 * r;
        j[LEG_L].x += -s * thigh * w;
        j[LEG_R].x += s * thigh * w;
        j[SHIN_L].x += (0.1 + lift(c) * knee) * w;
        j[SHIN_R].x += (0.1 + lift(-c) * knee) * w;
        j[FOOT_L].x += (s * 0.35 - lift(c) * 0.3) * w;
        j[FOOT_R].x += (-s * 0.35 - lift(-c) * 0.3) * w;
        let arm = 0.55 + 0.3 * r;
        j[ARM_L].x += s * arm * w;
        j[ARM_R].x += -s * arm * w;
        j[ARM_L].z += -(0.12 + 0.1 * r) * w;
        j[ARM_R].z += (0.12 + 0.1 * r) * w;
        j[FORE_L].x += (-0.25 - 0.95 * r + 0.2 * r * s) * w;
        j[FORE_R].x += (-0.25 - 0.95 * r - 0.2 * r * s) * w;
        j[TORSO].x += (0.05 + 0.2 * r) * w;
        j[TORSO].y += -s * (0.1 + 0.08 * r) * w;
        j[HIPS].y += s * (0.12 + 0.05 * r) * w;
        j[HIPS].z += c * 0.04 * w;
        j[HEAD].x += -(0.03 + 0.14 * r) * w;
        j[HEAD].y += s * 0.06 * w;
        let bob = 0.025 + 0.055 * r;
        p.hip_y += ((2.0 * ph).cos() * 0.5 + 0.5) * bob * w - 0.015 * r * w;
    }

    fn airborne(&mut self, t: f64, w: f64) {
        if w <= 0.001 {
            return;
        }
        let f = self.w_fall;
        let air_time = self.air_time;
        let j = &mut self.pose.j;
        let rise = (1.0 - f) * w;
        j[LEG_L].x += -0.7 * rise;
        j[SHIN_L].x += 1.1 * rise;
        j[FOOT_L].x += 0.2 * rise;
        j[LEG_R].x += 0.25 * rise;
        j[SHIN_R].x += 0.45 * rise;
        j[FOOT_R].x += 0.35 * rise;
        j[ARM_L].x += 0.35 * rise;
        j[ARM_R].x += -0.55 * rise;
        j[ARM_L].z += -0.75 * rise;
        j[ARM_R].z += 0.75 * rise;
        j[FORE_L].x += -0.45 * rise;
        j[FORE_R].x += -0.45 * rise;
        j[HEAD].x += -0.12 * rise;
        j[TORSO].x += -0.06 * rise;
        let fall = f * w;
        let panic = 0.45 + 0.55 * smooth(0.25, 1.1, air_time);
        let (fl, fl2) = ((t * 13.0).sin(), (t * 11.0 + 1.3).sin());
        j[ARM_L].z += (-1.9 - 0.35 * fl * panic) * fall;
        j[ARM_R].z += (1.9 + 0.35 * fl2 * panic) * fall;
        j[ARM_L].x += 0.35 * fl2 * panic * fall;
        j[ARM_R].x += -0.35 * fl * panic * fall;
        j[FORE_L].x += (-0.3 - 0.25 * fl * panic) * fall;
        j[FORE_R].x += (-0.3 - 0.25 * fl2 * panic) * fall;
        let s9 = (t * 9.0).sin();
        j[LEG_L].x += (-0.25 + 0.4 * s9 * panic) * fall;
        j[LEG_R].x += (-0.1 - 0.4 * s9 * panic) * fall;
        j[SHIN_L].x += (0.4 + 0.25 * s9.max(0.0)) * fall;
        j[SHIN_R].x += (0.4 + 0.25 * (-s9).max(0.0)) * fall;
        j[LEG_L].z += -0.15 * fall;
        j[LEG_R].z += 0.15 * fall;
        j[FOOT_L].x += 0.3 * fall;
        j[FOOT_R].x += 0.3 * fall;
        j[HEAD].x += 0.28 * fall;
        j[TORSO].x += 0.06 * fall;
    }

    fn landing(&mut self) {
        let c = clamp(self.land, -0.15, 1.0);
        if c.abs() < 0.002 {
            return;
        }
        let p = &mut self.pose;
        let j = &mut p.j;
        let k = c.max(0.0);
        j[LEG_L].x += -0.55 * k;
        j[LEG_R].x += -0.55 * k;
        j[SHIN_L].x += 1.1 * k;
        j[SHIN_R].x += 1.1 * k;
        j[FOOT_L].x += -0.55 * k;
        j[FOOT_R].x += -0.55 * k;
        j[LEG_L].z += -0.1 * k;
        j[LEG_R].z += 0.1 * k;
        j[TORSO].x += 0.35 * k;
        j[HEAD].x += -0.2 * k;
        j[ARM_L].x += -0.5 * k;
        j[ARM_R].x += -0.5 * k;
        j[ARM_L].z += -0.4 * k;
        j[ARM_R].z += 0.4 * k;
        p.hip_y += -0.3 * (1.0 - (0.55 * k).cos()) * 2.2 - c.min(0.0) * 0.06;
    }

    fn lean(&mut self) {
        let tl = self.turn_lean;
        let j = &mut self.pose.j;
        let l = clamp(tl * 0.05, -0.22, 0.22);
        j[HIPS].z += -l;
        j[HEAD].z += l * 0.5;
        j[HEAD].y += clamp(tl * 0.04, -0.3, 0.3);
    }

    fn hold_item(&mut self, t: f64, w: f64) {
        if w <= 0.001 {
            return;
        }
        let j = &mut self.pose.j;
        j[ARM_R].x = j[ARM_R].x * (1.0 - w * 0.85) + (-0.35 + (t * 2.1).sin() * 0.02) * w;
        j[ARM_R].z = j[ARM_R].z * (1.0 - w) + 0.12 * w;
        j[FORE_R].x = j[FORE_R].x * (1.0 - w) - 1.15 * w;
        j[FORE_R].y += -0.25 * w;
        j[HAND_R].x += 0.25 * w;
    }

    fn mine(&mut self, t: f64, w: f64) {
        if w <= 0.001 {
            return;
        }
        let w_move = self.w_move;
        let p = &mut self.pose;
        let j = &mut p.j;
        let (buzz, buzz2) = ((t * 47.0).sin() * 0.045, (t * 39.0 + 1.0).sin() * 0.035);
        let lerp = |a: &mut Angles, x: f64, y: f64, z: f64| {
            a.x += (x - a.x) * w;
            a.y += (y - a.y) * w;
            a.z += (z - a.z) * w;
        };
        lerp(&mut j[ARM_R], -1.3 + buzz, 0.0, 0.08);
        lerp(&mut j[FORE_R], -0.25 + buzz2, 0.0, 0.0);
        lerp(&mut j[HAND_R], 0.1, 0.0, 0.0);
        lerp(&mut j[ARM_L], -0.9 + buzz2 * 0.5, 0.3, -0.25);
        lerp(&mut j[FORE_L], -0.9, 0.5, 0.0);
        j[TORSO].x += (0.08 + buzz * 0.4) * w;
        j[TORSO].y += -0.15 * w;
        j[HEAD].x += 0.06 * w;
        j[HEAD].y += 0.12 * w;
        let planted = w * (1.0 - w_move);
        j[LEG_L].z += -0.12 * planted;
        j[LEG_R].z += 0.12 * planted;
        j[LEG_L].x += -0.12 * planted;
        j[LEG_R].x += 0.15 * planted;
        j[SHIN_L].x += 0.12 * planted;
        j[SHIN_R].x += 0.15 * planted;
        p.hip_y += (-0.02 + buzz * 0.08) * planted;
    }

    fn gesture_layer(&mut self, g: Gesture, u: f64) {
        use std::f64::consts::PI;
        let p = &mut self.pose;
        let j = &mut p.j;
        let env = smooth(0.0, 0.2, u) * (1.0 - smooth(0.65, 1.0, u));
        match g {
            Gesture::Place => {
                let reach = ((u * 1.4).min(1.0) * PI).sin();
                j[ARM_R].x += (-1.1 * reach - j[ARM_R].x * 0.6) * env;
                j[FORE_R].x += (-0.2 * reach) * env;
                j[TORSO].x += 0.18 * reach * env;
                j[TORSO].y += -0.15 * reach * env;
            }
            Gesture::Pickup => {
                let dip = (u * PI).sin();
                j[TORSO].x += 0.45 * dip;
                j[HEAD].x += 0.2 * dip;
                j[ARM_R].x += -0.7 * dip;
                j[LEG_L].x += -0.3 * dip;
                j[LEG_R].x += -0.3 * dip;
                j[SHIN_L].x += 0.6 * dip;
                j[SHIN_R].x += 0.6 * dip;
                p.hip_y += -0.06 * dip;
            }
            Gesture::Eat => {
                let bite = 0.65 + 0.35 * (u * PI * 3.0).sin().abs();
                j[ARM_R].x += (-1.2 * bite - j[ARM_R].x) * env;
                j[ARM_R].z += (-0.25 - j[ARM_R].z) * env;
                j[FORE_R].x += (-1.6 * bite - j[FORE_R].x) * env;
                j[HEAD].x += -0.12 * env;
                j[HEAD].z += 0.08 * (u * PI * 6.0).sin() * env;
            }
            Gesture::Hurt => {
                let hit = (-u * 5.0).exp() * ((u * 6.0).min(1.0) * PI * 0.5).sin() * 1.4;
                j[TORSO].x += -0.35 * hit;
                j[HEAD].x += -0.4 * hit;
                j[ARM_L].z += 0.25 * hit;
                j[ARM_R].z += -0.25 * hit;
                j[FORE_L].x += -0.7 * hit;
                j[FORE_R].x += -0.7 * hit;
                j[SHIN_L].x += 0.3 * hit;
                j[SHIN_R].x += 0.3 * hit;
                p.hip_y += -0.03 * hit;
            }
        }
    }

    fn dead_layer(&mut self, w: f64) {
        if w <= 0.001 {
            return;
        }
        let p = &mut self.pose;
        let set = |a: &mut Angles, x: f64, y: f64, z: f64| {
            a.x += (x - a.x) * w;
            a.y += (y - a.y) * w;
            a.z += (z - a.z) * w;
        };
        let j = &mut p.j;
        set(&mut j[HIPS], -1.3, 0.0, 0.0);
        set(&mut j[TORSO], 0.15, 0.0, 0.0);
        set(&mut j[HEAD], -0.25, 0.4, 0.1);
        set(&mut j[ARM_L], -0.3, 0.0, -1.2);
        set(&mut j[ARM_R], -0.4, 0.0, 1.0);
        set(&mut j[FORE_L], -0.4, 0.0, 0.0);
        set(&mut j[FORE_R], -0.3, 0.0, 0.0);
        set(&mut j[LEG_L], -0.25, 0.0, -0.3);
        set(&mut j[LEG_R], -0.1, 0.0, 0.25);
        set(&mut j[SHIN_L], 0.35, 0.0, 0.0);
        set(&mut j[SHIN_R], 0.15, 0.0, 0.0);
        set(&mut j[FOOT_L], 0.0, 0.0, 0.0);
        set(&mut j[FOOT_R], 0.0, 0.0, 0.0);
        p.hip_y += (-0.08 - p.hip_y) * w;
    }
}
