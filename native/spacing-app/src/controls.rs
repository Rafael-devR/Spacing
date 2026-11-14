//! Controles (porte da ideia de `src/core/Input.ts`): no celular, joystick que aparece onde o dedo toca na metade esquerda e
//! botões à direita; no computador, WASD/setas, espaço, Q/E para girar e a roda do mouse para o zoom. Vários dedos ao mesmo
//! tempo (andar e pular juntos), por isso os toques são tratados aqui e não pelo egui.
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Button {
    Jump,
    RotL,
    RotR,
    ZoomIn,
    ZoomOut,
    Stats,
    Planet,
    Vsync,
    Meteor,
    Bench,
}

#[derive(Clone, Copy, Debug)]
pub struct ButtonRect {
    pub b: Button,
    /// centro e raio, em pixels
    pub x: f32,
    pub y: f32,
    pub r: f32,
}

#[derive(Clone, Copy, Debug)]
enum Finger {
    Stick { ox: f32, oy: f32, x: f32, y: f32 },
    Button(Button),
    None,
}

/// pedidos de um quadro (consumidos pelo jogo)
#[derive(Clone, Copy, Debug, Default)]
pub struct Actions {
    pub jump: bool,
    pub rotate: f64,
    pub zoom: f64,
    pub toggle_stats: bool,
    pub switch_planet: bool,
    pub toggle_vsync: bool,
    pub meteor: bool,
    pub bench: bool,
}

pub struct Controls {
    /// direção forçada (roteiro das capturas de teste)
    pub scripted: Option<(f64, f64)>,
    fingers: HashMap<u64, Finger>,
    keys: std::collections::HashSet<String>,
    pub buttons: Vec<ButtonRect>,
    /// raio do joystick em pixels
    pub stick_r: f32,
    pub actions: Actions,
    /// houve toque alguma vez (mostra os botões)
    pub touched: bool,
}

impl Default for Controls {
    fn default() -> Self {
        Self { scripted: None, fingers: HashMap::new(), keys: Default::default(), buttons: Vec::new(), stick_r: 60.0, actions: Actions::default(), touched: cfg!(target_os = "android") }
    }
}

impl Controls {
    /// Arruma os botões para o tamanho da tela (pixels) e a densidade (pixels por ponto).
    pub fn layout(&mut self, w: f32, h: f32, ppp: f32) {
        let u = ppp;
        let m = 28.0 * u;
        let big = 46.0 * u;
        let small = 24.0 * u;
        self.stick_r = 56.0 * u;
        let jx = w - m - big;
        let jy = h - m - big;
        self.buttons = vec![
            ButtonRect { b: Button::Jump, x: jx, y: jy, r: big },
            ButtonRect { b: Button::RotL, x: jx - big - small * 1.6, y: jy + big * 0.35, r: small },
            ButtonRect { b: Button::RotR, x: jx + big * 0.1, y: jy - big - small * 1.4, r: small },
            ButtonRect { b: Button::ZoomIn, x: w - m - small, y: m + small + 40.0 * u, r: small },
            ButtonRect { b: Button::ZoomOut, x: w - m - small, y: m + small * 3.4 + 40.0 * u, r: small },
            ButtonRect { b: Button::Stats, x: m + small, y: m + small, r: small },
            ButtonRect { b: Button::Planet, x: m + small * 3.6, y: m + small, r: small },
            ButtonRect { b: Button::Vsync, x: m + small * 6.2, y: m + small, r: small },
            ButtonRect { b: Button::Meteor, x: m + small * 8.8, y: m + small, r: small },
            ButtonRect { b: Button::Bench, x: m + small * 11.4, y: m + small, r: small },
        ];
        let _ = h;
    }

    fn hit(&self, x: f32, y: f32) -> Option<Button> {
        self.buttons.iter().find(|b| (x - b.x).powi(2) + (y - b.y).powi(2) <= (b.r * 1.25).powi(2)).map(|b| b.b)
    }

    fn press(&mut self, b: Button) {
        let a = &mut self.actions;
        match b {
            Button::Jump => a.jump = true,
            Button::RotL => a.rotate -= 1.0,
            Button::RotR => a.rotate += 1.0,
            // zoom: contínuo enquanto o dedo fica no botão (held_zoom)
            Button::ZoomIn | Button::ZoomOut => {}
            Button::Stats => a.toggle_stats = true,
            Button::Planet => a.switch_planet = true,
            Button::Vsync => a.toggle_vsync = true,
            Button::Meteor => a.meteor = true,
            Button::Bench => a.bench = true,
        }
    }

    pub fn touch_start(&mut self, id: u64, x: f32, y: f32, screen_w: f32) {
        self.touched = true;
        let f = if let Some(b) = self.hit(x, y) {
            self.press(b);
            Finger::Button(b)
        } else if x < screen_w * 0.5 {
            Finger::Stick { ox: x, oy: y, x, y }
        } else {
            Finger::None
        };
        self.fingers.insert(id, f);
    }

    pub fn touch_move(&mut self, id: u64, x: f32, y: f32) {
        if let Some(Finger::Stick { x: fx, y: fy, .. }) = self.fingers.get_mut(&id) {
            *fx = x;
            *fy = y;
        }
    }

    pub fn touch_end(&mut self, id: u64) {
        self.fingers.remove(&id);
    }

    /// botão de zoom seguro: zoom contínuo enquanto o dedo estiver em cima
    pub fn held_zoom(&self, dt: f64) -> f64 {
        let mut k = 1.0;
        for f in self.fingers.values() {
            match f {
                Finger::Button(Button::ZoomIn) => k *= (-1.2 * dt).exp(),
                Finger::Button(Button::ZoomOut) => k *= (1.2 * dt).exp(),
                _ => {}
            }
        }
        if self.keys.contains("+") || self.keys.contains("=") {
            k *= (-1.2 * dt).exp();
        }
        if self.keys.contains("-") {
            k *= (1.2 * dt).exp();
        }
        k
    }

    /// o joystick na tela: (origem, ponta), para desenhar
    pub fn stick(&self) -> Option<(f32, f32, f32, f32)> {
        self.fingers.values().find_map(|f| match *f {
            Finger::Stick { ox, oy, x, y } => {
                let (dx, dy) = (x - ox, y - oy);
                let l = (dx * dx + dy * dy).sqrt();
                let k = if l > self.stick_r { self.stick_r / l } else { 1.0 };
                Some((ox, oy, ox + dx * k, oy + dy * k))
            }
            _ => None,
        })
    }

    pub fn pressed(&self, b: Button) -> bool {
        self.fingers.values().any(|f| matches!(f, Finger::Button(x) if *x == b))
    }

    pub fn key(&mut self, name: &str, down: bool) {
        let k = name.to_lowercase();
        if down {
            if !self.keys.contains(&k) {
                match k.as_str() {
                    " " | "space" => self.actions.jump = true,
                    "q" => self.actions.rotate -= 1.0,
                    "e" => self.actions.rotate += 1.0,
                    "f3" | "tab" => self.actions.toggle_stats = true,
                    "m" => self.actions.switch_planet = true,
                    "v" => self.actions.toggle_vsync = true,
                    "t" => self.actions.meteor = true,
                    "b" => self.actions.bench = true,
                    _ => {}
                }
            }
            self.keys.insert(k);
        } else {
            self.keys.remove(&k);
        }
    }

    pub fn wheel(&mut self, lines: f64) {
        let f = (-lines * 0.12).exp();
        self.actions.zoom = if self.actions.zoom == 0.0 { f } else { self.actions.zoom * f };
    }

    /// direção pedida (-1..1; y > 0 = para a frente)
    pub fn move_dir(&self) -> (f64, f64) {
        if let Some(d) = self.scripted {
            return d;
        }
        let has = |k: &str| self.keys.contains(k);
        let mut x = 0.0;
        let mut y = 0.0;
        if has("a") || has("arrowleft") {
            x -= 1.0;
        }
        if has("d") || has("arrowright") {
            x += 1.0;
        }
        if has("w") || has("arrowup") {
            y += 1.0;
        }
        if has("s") || has("arrowdown") {
            y -= 1.0;
        }
        if let Some((ox, oy, px, py)) = self.stick() {
            x += ((px - ox) / self.stick_r) as f64;
            y -= ((py - oy) / self.stick_r) as f64;
        }
        (x.clamp(-1.0, 1.0), y.clamp(-1.0, 1.0))
    }

    pub fn take_actions(&mut self) -> Actions {
        std::mem::take(&mut self.actions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn joystick_e_pulo_juntos() {
        let mut c = Controls::default();
        c.layout(1000.0, 500.0, 1.0);
        c.touch_start(1, 100.0, 400.0, 1000.0);
        c.touch_move(1, 100.0, 340.0);
        let jump = c.buttons[0];
        c.touch_start(2, jump.x, jump.y, 1000.0);
        let (x, y) = c.move_dir();
        assert!(x.abs() < 1e-6 && y > 0.99, "joystick para cima = frente: {x} {y}");
        assert!(c.take_actions().jump);
        c.touch_end(1);
        assert_eq!(c.move_dir(), (0.0, 0.0));
    }
}
