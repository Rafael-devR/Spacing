//! O jogo do M2 (docs/design/PORTE_RUST.md): andar na Lua (ou em Marte). Mundo em chunks com threads, astronauta com física e
//! animação, câmera isométrica, módulo de pouso. Mesmas regras do `src/app/Game.ts` para o que existe aqui.
use glam::{Mat4, Vec3, Vec4};
use spacing_core::camera::{base_fov, IsoRig};
use spacing_core::planet::{planet, PlanetId};
use spacing_core::fx::{dust_of, signal_lamp, takes_footprint, DustFx, Footprints, Particles, Puffs, Rng, Sprite};
use spacing_core::player::{MoveInput, Player, PlayerEvent};
use spacing_core::terrain::{LANDER, SPAWN};
use spacing_core::world::{World, SYNC_BUDGET};
use spacing_render::astronaut::{Astronaut, StaticModel};
use spacing_render::{load_glb, prop_mesh, Frame, PartDraw, PropDraw, PropInstance, Renderer, ScreenFx};

use crate::controls::Controls;

/// passo fixo da simulação e limite de passos por quadro (src/app/config.ts)
const FIXED_STEP: f64 = 1.0 / 60.0;
const MAX_STEPS: u32 = 5;

static ASTRONAUT_GLB: &[u8] = include_bytes!("../../../src/assets/models/astronaut.glb");
static LANDER_GLB: &[u8] = include_bytes!("../../../src/assets/models/lander.glb");

/// os modelos já na GPU (refeitos quando o Android recria a superfície)
pub struct Models {
    astronaut: Option<Astronaut>,
    lander: Option<StaticModel>,
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
        if astronaut.is_none() {
            log::warn!("astronauta não carregou");
        }
        Self { astronaut, lander }
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
            draw_pos,
        }
    }

    /// Um quadro: entrada, passos fixos de física, câmera, chunks.
    pub fn update(&mut self, dt: f64, c: &mut Controls) {
        let dt = dt.min(0.25);
        self.time += dt;
        let a = c.take_actions();
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

        self.puffs.update(dt);
        self.particles.update(dt);
        self.footprints.update(dt, 0.0);
        self.cover(dt);
        self.rig.update(dt, focus(self.draw_pos), false);
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
        // neblina: acompanha a distância da câmera (Game.ts), nunca perto demais dentro de caverna
        let fog_dist = r.eye_dist.max(16.0) as f32;
        Frame {
            eye: Vec3::new(r.eye[0] as f32, r.eye[1] as f32, r.eye[2] as f32),
            target: Vec3::new(r.target[0] as f32, r.target[1] as f32, r.target[2] as f32),
            roll: r.roll as f32,
            fov_deg: base_fov(aspect) as f32,
            time: self.time as f32,
            dark: d,
            lamp: Vec4::new(p[0] as f32, p[1] as f32 + 1.5, p[2] as f32, d * 1.15),
            mist_y: (self.base_y.floor() - 6.0) as f32,
            fog: (fog_dist * 1.15, fog_dist * 2.1),
            parts: &self.parts,
            props: &self.props,
            sprites: &self.sprites,
            screen: ScreenFx::default(),
        }
    }
}

fn focus(p: [f64; 3]) -> [f64; 3] {
    [p[0], p[1] + 0.8, p[2]]
}
