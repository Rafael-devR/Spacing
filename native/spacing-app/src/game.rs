//! O jogo do M2 (docs/design/PORTE_RUST.md): andar na Lua (ou em Marte). Mundo em chunks com threads, astronauta com física e
//! animação, câmera isométrica, módulo de pouso. Mesmas regras do `src/app/Game.ts` para o que existe aqui.
use glam::{Mat4, Vec3, Vec4};
use spacing_core::camera::{base_fov, IsoRig};
use spacing_core::planet::{planet, PlanetId};
use spacing_core::fx::{dust_of, signal_lamp, takes_footprint, DustFx, Footprints, Particles, Puffs, Rng, Sprite};
use spacing_core::mars_life::MarsLife;
use spacing_core::meteors::{self, Meteors};
use spacing_core::player::{MoveInput, Player, PlayerEvent};
use spacing_core::terrain::{LANDER, SPAWN};
use spacing_core::world::{World, SYNC_BUDGET};
use spacing_render::astronaut::{Astronaut, StaticModel};
use spacing_render::{camera_matrix, load_glb, prop_mesh, Frame, PartDraw, PropDraw, PropInstance, Renderer, ScreenFx};

use crate::controls::Controls;

/// passo fixo da simulação e limite de passos por quadro (src/app/config.ts)
const FIXED_STEP: f64 = 1.0 / 60.0;
const MAX_STEPS: u32 = 5;

static ASTRONAUT_GLB: &[u8] = include_bytes!("../../../src/assets/models/astronaut.glb");
static LANDER_GLB: &[u8] = include_bytes!("../../../src/assets/models/lander.glb");
static METEOR_GLB: &[u8] = include_bytes!("../../../src/assets/models/meteor.glb");

/// os modelos já na GPU (refeitos quando o Android recria a superfície)
pub struct Models {
    astronaut: Option<Astronaut>,
    lander: Option<StaticModel>,
    /// as três rochas do meteor.glb (rock_a, rock_b, rock_c)
    rocks: Vec<StaticModel>,
}

/// cor das luzes do módulo de pouso avariado (models.ts: vermelho; verde quando reparado)
const LAMP_RED: [f32; 3] = [2.2, 0.25, 0.15];

impl Models {
    pub fn load(r: &mut Renderer) -> Self {
        let astronaut = load_glb(ASTRONAUT_GLB).ok().and_then(|m| {
            let ids = r.upload_model(&m);
            Astronaut::new(&m, &ids)
        });
        let lander = load_glb(LANDER_GLB).ok().map(|m| {
            let ids = r.upload_model(&m);
            StaticModel::new(&m, &ids)
        });
        let rocks = load_glb(METEOR_GLB)
            .ok()
            .map(|m| {
                let ids = r.upload_model(&m);
                ["rock_a", "rock_b", "rock_c"].iter().filter_map(|n| StaticModel::subtree(&m, &ids, n)).collect()
            })
            .unwrap_or_default();
        if astronaut.is_none() {
            log::warn!("astronauta não carregou");
        }
        Self { astronaut, lander, rocks }
    }
}

pub struct Game {
    pub planet: PlanetId,
    pub seed: u32,
    pub world: World,
    pub player: Player,
    pub rig: IsoRig,
    input: MoveInput,
    acc: f64,
    pub time: f64,
    dark: f64,
    cover_t: f64,
    lander_y: f64,
    base_y: f64,
    parts: Vec<PartDraw>,
    props: Vec<PropDraw>,
    sprites: Vec<Sprite>,
    pub puffs: Puffs,
    pub particles: Particles,
    pub footprints: Footprints,
    dust: DustFx,
    rng: Rng,
    step_side: f64,
    /// clima, redemoinhos, lava e vulcão (só em Marte)
    pub mars: Option<MarsLife>,
    pub meteors: Meteors,
    shocks: Vec<([f32; 4], [f32; 4])>,
    /// clarão de tela (0..1), pausa de impacto e câmera lenta (MeteorDirector)
    flash: f64,
    hit_stop: f64,
    slow_mo: (f64, f64),
    draw_pos: [f64; 3],
}

impl Game {
    pub fn new(planet_id: PlanetId, seed: u32, threads: usize) -> Self {
        let mut world = World::new(planet_id, seed);
        world.radius = 3;
        // carregamento inicial: tudo na hora, em volta do pouso (Game.ts faz o mesmo)
        world.update(0.0, 0.0, SYNC_BUDGET);
        world.enable_threads(threads);
        let mut player = Player::new(planet(planet_id).physics);
        player.spawn(&mut world, SPAWN.0, SPAWN.1);
        let lander_y = world.top_y(LANDER.0 as i32, LANDER.1 as i32) as f64 + 1.0;
        let base_y = world.terrain.spawn_h();
        let pd = planet(planet_id);
        let mut rig = IsoRig::default();
        rig.snap(focus(player.pos));
        let draw_pos = player.pos;
        Self {
            planet: planet_id,
            seed,
            world,
            player,
            rig,
            input: MoveInput::default(),
            acc: 0.0,
            time: 0.0,
            dark: 0.0,
            cover_t: 0.0,
            lander_y,
            base_y,
            parts: Vec::new(),
            props: Vec::new(),
            sprites: Vec::new(),
            puffs: Puffs::default(),
            particles: Particles::default(),
            footprints: Footprints::new(pd.footprint_life, pd.footprint_color),
            dust: DustFx { gravity: pd.physics.gravity },
            rng: Rng::new(seed as u64),
            step_side: 1.0,
            mars: (planet_id == spacing_core::planet::PlanetId::Marte).then(MarsLife::new),
            meteors: Meteors::new(seed as u64),
            shocks: Vec::new(),
            flash: 0.0,
            hit_stop: 0.0,
            slow_mo: (0.0, 1.0),
            draw_pos,
        }
    }

    /// Um quadro: entrada, passos fixos de física, câmera, chunks.
    pub fn update(&mut self, real_dt: f64, c: &mut Controls) {
        let real_dt = real_dt.min(0.25);
        // pausa de impacto e câmera lenta do meteoro: o jogo para um instante e corre devagar; a câmera continua
        let dt = if self.hit_stop > 0.0 {
            self.hit_stop -= real_dt;
            0.0
        } else if self.slow_mo.0 > 0.0 {
            self.slow_mo.0 -= real_dt;
            real_dt * self.slow_mo.1
        } else {
            real_dt
        };
        self.time += dt;
        let a = c.take_actions();
        if a.meteor {
            let p = self.player.pos;
            self.meteors.launch_random(&mut self.world, p, self.rig.yaw);
        }
        if a.jump {
            self.input.jump = true;
        }
        if a.rotate != 0.0 {
            self.rig.rotate(a.rotate);
        }
        if a.zoom != 0.0 {
            self.rig.zoom(a.zoom);
        }
        let hz = c.held_zoom(dt);
        if hz != 1.0 {
            self.rig.zoom(hz);
        }
        let (mx, my) = c.move_dir();
        self.input.move_x = mx;
        self.input.move_y = my;

        self.acc += dt;
        let mut n = (self.acc / FIXED_STEP).floor() as u32;
        if n > MAX_STEPS {
            n = MAX_STEPS;
            self.acc = 0.0;
        } else {
            self.acc -= n as f64 * FIXED_STEP;
        }
        for _ in 0..n {
            self.player.step(&mut self.world, FIXED_STEP, &mut self.input, self.rig.yaw);
        }
        self.player_fx();
        let alpha = self.acc / FIXED_STEP;
        self.draw_pos = self.player.animate(dt, alpha);

        let mut wind = 0.0;
        if let Some(m) = &mut self.mars {
            let focus = self.rig.target;
            let ((push, hit), shake) = m.update(dt, &mut self.world, self.player.pos, focus, &mut self.puffs, &mut self.particles);
            self.player.push = push;
            if let Some(h) = hit {
                self.rig.shake(0.35);
                self.player.vel[0] += h.vx * 1.2;
                self.player.vel[2] += h.vz * 1.2;
                self.player.vel[1] += 2.5;
            }
            if shake > 0.0 {
                self.rig.shake(shake);
            }
            wind = m.dust() * 15.0;
        }
        let impacts = self.meteors.update(dt, &mut self.world, self.player.pos, self.rig.yaw, &mut self.puffs, &mut self.particles);
        for e in impacts {
            self.impact(e);
        }
        self.flash = (self.flash - real_dt * meteors::camera::FLASH_DECAY).max(0.0);
        self.puffs.update(dt);
        self.particles.update(dt);
        self.footprints.update(dt, wind);
        self.cover(dt);
        self.rig.update(real_dt, focus(self.draw_pos), false);
        self.world.radius = self.rig.chunk_radius();
        self.world.update(self.player.pos[0], self.player.pos[2], 2);
        for e in self.world.events.drain(..) {
            let spacing_core::world::WorldEvent::BlockChanged { x, y, z, .. } = e;
            self.footprints.clear_at(x, y, z);
        }
    }

    pub fn sprite_count(&self) -> usize {
        self.sprites.len()
    }

    /// O que o jogador sente num impacto (MeteorDirector): tremor, onda, soco de zoom, clarão, pausa e câmera lenta.
    fn impact(&mut self, e: meteors::Impact) {
        use meteors::camera as C;
        // a velocidade do empurrão perto (Meteors.impact)
        if e.distance < 7.0 {
            let p = self.player.pos;
            let (dx, dz) = (p[0] - e.pos[0], p[2] - e.pos[2]);
            let l = spacing_core::js::hypot(dx, dz).max(1e-6);
            let k = 1.0 - e.distance / 7.0;
            self.player.vel[0] += dx / l * 6.0 * k;
            self.player.vel[2] += dz / l * 6.0 * k;
            self.player.vel[1] = self.player.vel[1].max(4.0 * k);
        }
        self.rig.shake((C::SHAKE_MAX - e.distance / C::SHAKE_RANGE).max(C::SHAKE_MIN));
        self.meteors.waves.add([e.pos[0], e.pos[1] + 0.5, e.pos[2]], e.radius / meteors::RADIUS_REF);
        if e.distance < C::PUNCH_RANGE {
            self.rig.punch(C::PUNCH * (1.0 - e.distance / C::PUNCH_RANGE));
        }
        self.flash = self.flash.max(C::FLASH_MAX * (1.0 - e.distance / C::FLASH_RANGE).max(0.0).powf(1.5));
        if e.distance < C::NEAR_RANGE {
            self.hit_stop = self.hit_stop.max(C::HIT_STOP);
            self.slow_mo = C::SLOW_MO;
        }
        // pegadas sobre a cratera somem junto (os blocos mudaram)
    }

    /// o chão sob os pés (o astronauta pode estar um tico acima no fim de um degrau)
    fn ground(&self) -> u8 {
        let p = self.player.pos;
        self.world.peek_block(p[0].floor() as i32, spacing_core::js::round(p[1]) as i32 - 1, p[2].floor() as i32)
    }

    /// poeira e pegadas dos eventos do astronauta (Game.wireEvents)
    fn player_fx(&mut self) {
        let events: Vec<PlayerEvent> = self.player.events.drain(..).collect();
        for e in events {
            let dust = dust_of(self.ground());
            match e {
                PlayerEvent::Step(p) => {
                    if let Some(d) = dust {
                        let v = self.player.vel;
                        let run = ((spacing_core::js::hypot(v[0], v[2]) - 2.0) / 2.4).clamp(0.0, 1.0);
                        self.dust.step(&mut self.puffs, &mut self.particles, p, v[0], v[2], d, run);
                    }
                    self.footstep(false);
                }
                PlayerEvent::Land(p, speed) => {
                    if let Some(d) = dust {
                        self.dust.land(&mut self.puffs, &mut self.particles, p, d, ((speed - 7.0) / 8.0).min(1.0));
                    }
                    self.footstep(true);
                    self.rig.shake(0.12);
                }
                PlayerEvent::Jump(p) => {
                    if let Some(d) = dust {
                        self.dust.jump(&mut self.puffs, &mut self.rng, p, d);
                    }
                }
            }
        }
    }

    fn footstep(&mut self, both: bool) {
        let p = self.player.pos;
        if !takes_footprint(self.ground()) || (p[1] - spacing_core::js::round(p[1])).abs() > 0.05 {
            return;
        }
        let a = self.player.facing;
        let (rx, rz) = (a.cos(), -a.sin());
        let sides: Vec<f64> = if both {
            vec![-1.0, 1.0]
        } else {
            self.step_side = -self.step_side;
            vec![self.step_side]
        };
        for side in sides {
            self.footprints.place(p[0] + rx * side * 0.13, spacing_core::js::round(p[1]), p[2] + rz * side * 0.13, a + std::f64::consts::PI);
        }
    }

    /// caverna: a câmera chega perto quando há rocha em cima; escurece quando o céu some (Game.updateCover)
    fn cover(&mut self, dt: f64) {
        let p = self.player.pos;
        self.cover_t -= dt;
        if self.cover_t <= 0.0 {
            self.cover_t = 0.1;
            let mut n = 0;
            let y = p[1] + 1.9;
            let surface = self.world.terrain.column(p[0].floor(), p[2].floor()).0;
            if surface > p[1] + 3.0 {
                for dz in -1..=1 {
                    for dx in -1..=1 {
                        if self.world.roofed(p[0] + dx as f64 * 4.0, y, p[2] + dz as f64 * 4.0) {
                            n += 1;
                        }
                    }
                }
            }
            self.rig.cave_target = spacing_core::js::smoothstep(0.3, 0.7, n as f64 / 9.0);
        }
        let sky = self.world.sky_at(p[0], p[1] + 1.2, p[2]);
        let dark = 1.0 - spacing_core::js::smoothstep(0.2, 0.85, sky);
        self.dark += (dark - self.dark) * (1.0 - (-2.5 * dt).exp());
    }

    /// Sobe para a GPU as malhas novas e tira as que saíram.
    pub fn sync(&mut self, r: &mut Renderer) {
        for k in self.world.take_unloaded() {
            r.remove_chunk(k);
        }
        for m in self.world.take_meshes() {
            r.upload_chunk(&m);
        }
    }

    pub fn frame<'a>(&'a mut self, models: &Models, aspect: f64) -> Frame<'a> {
        self.parts.clear();
        let p = self.draw_pos;
        if let Some(a) = &models.astronaut {
            a.draw(Vec3::new(p[0] as f32, p[1] as f32, p[2] as f32), self.player.facing as f32, &self.player.anim.pose, self.player.mining, true, &mut self.parts);
        }
        self.sprites.clear();
        if let Some(l) = &models.lander {
            let base = Vec3::new(LANDER.0 as f32 + 0.5, self.lander_y as f32, LANDER.1 as f32 + 0.5);
            l.draw(Mat4::from_translation(base), &mut self.parts);
            for (name, at) in &l.markers {
                if name.starts_with("lamp_") {
                    let pos = base + *at;
                    signal_lamp(pos.to_array(), LAMP_RED, 0.07, 1.3, 1.0, &mut self.sprites);
                }
            }
        }
        self.footprints.draw(&mut self.sprites);
        self.meteors.draw(self.time, &mut self.sprites);
        for m in self.meteors.active.iter().filter(|m| m.flying()) {
            if let Some(rock) = models.rocks.get(m.rock) {
                let h = Vec3::new(m.head[0] as f32, m.head[1] as f32, m.head[2] as f32);
                let rot = glam::Quat::from_euler(glam::EulerRot::XYZ, m.rot[0] as f32, m.rot[1] as f32, m.rot[2] as f32);
                rock.draw(Mat4::from_scale_rotation_translation(Vec3::splat(m.rock_scale() as f32), rot, h), &mut self.parts);
            }
        }
        if let Some(m) = &self.mars {
            m.draw(&mut self.sprites);
        }
        self.particles.draw(&mut self.sprites);
        self.puffs.draw(&mut self.sprites);
        // pedras e minérios soltos dos chunks que já têm malha
        self.props.clear();
        for c in self.world.chunks.values().filter(|c| c.meshed) {
            for p in &c.props {
                if let Some(mesh) = prop_mesh(p.kind, p.variant) {
                    let inst = PropInstance { pos: [p.wx as f32 + 0.5, p.y as f32, p.wz as f32 + 0.5], rot: p.rot as f32, scale: [p.scale as f32, 0.0, 0.0, 0.0] };
                    self.props.push(PropDraw { mesh, inst });
                }
            }
        }
        let r = &self.rig;
        let d = self.dark as f32;
        // ondas de choque na tela (shockwave.fill): projeta com a mesma câmera do desenho
        let eye = Vec3::new(r.eye[0] as f32, r.eye[1] as f32, r.eye[2] as f32);
        let target = Vec3::new(r.target[0] as f32, r.target[1] as f32, r.target[2] as f32);
        let fov = base_fov(aspect) as f32;
        let vp = camera_matrix(eye, target, r.roll as f32, fov, aspect as f32);
        let right = (target - eye).normalize().cross(Vec3::Y).normalize();
        let project = |p: [f64; 3]| {
            let c = vp * glam::Vec4::new(p[0] as f32, p[1] as f32, p[2] as f32, 1.0);
            if c.w <= 0.0 {
                return None;
            }
            Some([(c.x / c.w) as f64, (c.y / c.w) as f64, (c.z / c.w) as f64])
        };
        self.shocks = self.meteors.waves.fill(&project, [right.x as f64, right.y as f64, right.z as f64], aspect);
        let point = self.meteors.light().map(|(p, i, c)| (Vec3::new(p[0] as f32, p[1] as f32, p[2] as f32), i as f32, [c[0] as f32, c[1] as f32, c[2] as f32]));
        // neblina: acompanha a distância da câmera (Game.ts), nunca perto demais dentro de caverna
        let fog_dist = r.eye_dist.max(16.0) as f32;
        let (fog_near, fog_far) = self.mars.as_ref().map(|m| m.fog(1.15, 2.1)).unwrap_or((1.15, 2.1));
        Frame {
            eye,
            target,
            roll: r.roll as f32,
            fov_deg: fov,
            time: self.time as f32,
            dark: d,
            lamp: Vec4::new(p[0] as f32, p[1] as f32 + 1.5, p[2] as f32, d * 1.15),
            mist_y: (self.base_y.floor() - 6.0) as f32,
            fog: (fog_dist * fog_near as f32, fog_dist * fog_far as f32),
            parts: &self.parts,
            props: &self.props,
            sprites: &self.sprites,
            screen: ScreenFx { flash: self.flash as f32, ..Default::default() },
            point,
            shocks: &self.shocks,
            storm: self.mars.as_ref().map(|m| m.dust() as f32).unwrap_or(0.0),
        }
    }
}

fn focus(p: [f64; 3]) -> [f64; 3] {
    [p[0], p[1] + 0.8, p[2]]
}
