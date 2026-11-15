//! A "mão" da tela de itens (porte do `src/ui/inventory/hand.ts`, docs/design/INVENTARIO.md): os gestos de mexer em itens, como
//! no Minecraft.
//!   - arrastar: o item segue o dedo e cai onde o dedo soltar;
//!   - tocar e tocar: o primeiro toque pega, o segundo solta (o mesmo espaço de novo cancela);
//!   - toque longo (ou botão direito): pega metade da pilha;
//!   - toque duplo (ou Shift + clique): manda rápido (quem decide para onde é a tela: barra ↔ mochila, ou a entrada da máquina).
//!
//! A mão não guarda itens: eles só mudam de lugar ao soltar. Ela não mexe no inventário; devolve o que fazer (`HandOut`), e a tela
//! repassa ao jogo. Fechar no meio de um gesto não perde nada. Sem egui aqui: a tela diz onde o dedo está (`Spot`) e quando.
use spacing_core::rules::inventory::Inventory;
use spacing_core::rules::ItemId;

/// segurar parado por este tempo pega metade
pub const LONG_S: f64 = 0.38;
/// dois toques dentro deste tempo = toque duplo
pub const DOUBLE_S: f64 = 0.33;
/// o dedo anda este tanto (pontos) antes de virar arrasto
pub const SLOP: f32 = 8.0;

/// o que está embaixo do dedo
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Spot {
    /// um espaço do inventário (índice: barra 0..8, mochila 8..32)
    Slot(usize),
    /// a saída da máquina; `true` = há algo pronto
    Out(bool),
    /// a entrada da máquina (aceita itens)
    Input,
    /// dentro do painel do inventário, fora de um espaço (a saída pode ser solta aqui)
    Pane,
    /// outra coisa (botões, fundo)
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Src {
    Inv(usize),
    Out,
}

/// o que a tela deve fazer
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HandOut {
    /// mover até `n` unidades de um espaço para outro (`Inventory::move_n`)
    Move { from: usize, to: usize, n: u32 },
    /// mandar rápido
    Quick(usize),
    /// `n` unidades do espaço `from` soltas na entrada da máquina
    Feed { from: usize, n: u32 },
    /// pegar o que a máquina tem pronto
    TakeOut,
    /// mostrar os detalhes do item
    Focus(ItemId),
}

#[derive(Clone, Copy, Debug)]
pub struct Held {
    pub index: usize,
    pub n: u32,
    t: f64,
}

#[derive(Clone, Copy, Debug)]
struct Press {
    src: Option<Src>,
    spot: Spot,
    x0: f32,
    y0: f32,
    t0: f64,
    half: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Drag {
    pub src: Src,
    pub n: u32,
}

#[derive(Clone, Debug, Default)]
pub struct Hand {
    /// espaço na mão no modo tocar e tocar
    pub held: Option<Held>,
    /// espaço sendo arrastado agora
    pub lifted: Option<usize>,
    press: Option<Press>,
    pub drag: Option<Drag>,
    /// onde o dedo está (o fantasma do item segue) e o que está embaixo
    pub at: (f32, f32),
    pub hover: Option<Spot>,
    /// metade pega pelo toque longo, antes de mexer (mostra o fantasma no lugar)
    pub half_shown: Option<(ItemId, u32)>,
    last: (Option<usize>, f64),
}

impl Hand {
    /// larga tudo sem mexer em nada (a tela fechou)
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    fn src_of(spot: Spot, inv: &Inventory) -> Option<Src> {
        match spot {
            Spot::Slot(i) if inv.slot(i).is_some() => Some(Src::Inv(i)),
            Spot::Out(true) => Some(Src::Out),
            _ => None,
        }
    }

    /// o dedo (ou o botão do mouse; `secondary` = botão direito) apertou
    pub fn down(&mut self, x: f32, y: f32, spot: Spot, secondary: bool, now: f64, inv: &Inventory) {
        self.at = (x, y);
        if self.press.is_some() {
            return;
        }
        if !matches!(spot, Spot::Slot(_) | Spot::Out(_) | Spot::Input) {
            // toque fora de um espaço (e fora dos botões) solta o que estava na mão
            if spot == Spot::Pane {
                self.held = None;
            }
            return;
        }
        self.press = Some(Press { src: Self::src_of(spot, inv), spot, x0: x, y0: y, t0: now, half: secondary });
    }

    /// a cada quadro: o toque longo vira "metade"
    pub fn update(&mut self, now: f64, inv: &Inventory) {
        let Some(p) = &mut self.press else { return };
        if p.half || self.held.is_some() || self.drag.is_some() || now - p.t0 < LONG_S {
            return;
        }
        if let Some(Src::Inv(i)) = p.src {
            p.half = true;
            if let Some(s) = inv.slot(i) {
                if s.n > 1 {
                    self.half_shown = Some((s.item, s.n.div_ceil(2)));
                }
            }
        }
    }

    pub fn moved(&mut self, x: f32, y: f32, spot: Spot, inv: &Inventory) -> Vec<HandOut> {
        self.at = (x, y);
        let mut out = Vec::new();
        let Some(p) = self.press else { return out };
        if self.drag.is_none() {
            if (x - p.x0).hypot(y - p.y0) < SLOP {
                return out;
            }
            let Some(src) = p.src else { return out };
            let mut n = 0;
            if let Src::Inv(i) = src {
                let Some(s) = inv.slot(i) else { return out };
                n = match self.held {
                    Some(h) if h.index == i => h.n,
                    _ if p.half => s.n.div_ceil(2),
                    _ => s.n,
                };
                self.lifted = Some(i);
                out.push(HandOut::Focus(s.item));
            }
            self.held = None;
            self.half_shown = None;
            self.drag = Some(Drag { src, n });
        }
        self.hover = Some(spot);
        out
    }

    /// o dedo soltou em cima de `spot`; `shift` = a tecla Shift (mandar rápido no computador)
    pub fn up(&mut self, x: f32, y: f32, spot: Spot, now: f64, shift: bool, inv: &Inventory) -> Vec<HandOut> {
        self.at = (x, y);
        let mut out = Vec::new();
        let Some(p) = self.press.take() else { return out };
        self.half_shown = None;
        if let Some(d) = self.drag.take() {
            self.lifted = None;
            self.hover = None;
            self.drop(d.src, d.n, spot, &mut out);
            return out;
        }
        self.tap(p, now, shift, inv, &mut out);
        out
    }

    fn tap(&mut self, p: Press, now: f64, shift: bool, inv: &Inventory, out: &mut Vec<HandOut>) {
        let index = match p.spot {
            Spot::Slot(i) => Some(i),
            _ => None,
        };
        if let Some(h) = self.held.take() {
            if index == Some(h.index) {
                // o mesmo espaço: toque duplo manda rápido; devagar, só larga
                if now - h.t < DOUBLE_S {
                    out.push(HandOut::Quick(h.index));
                }
                return;
            }
            self.drop(Src::Inv(h.index), h.n, p.spot, out);
            return;
        }
        if p.src == Some(Src::Out) {
            out.push(HandOut::TakeOut);
            return;
        }
        let Some(i) = index else { return };
        let Some(s) = inv.slot(i) else { return };
        // Shift + clique manda rápido; um segundo toque logo depois de largar no mesmo espaço também
        if shift || (self.last.0 == Some(i) && now - self.last.1 < DOUBLE_S) {
            self.last.0 = None;
            out.push(HandOut::Quick(i));
            return;
        }
        let n = if p.half { s.n.div_ceil(2) } else { s.n };
        self.held = Some(Held { index: i, n, t: now });
        self.last = (Some(i), now);
        out.push(HandOut::Focus(s.item));
    }

    fn drop(&mut self, src: Src, n: u32, target: Spot, out: &mut Vec<HandOut>) {
        match (src, target) {
            (Src::Out, Spot::Slot(_) | Spot::Pane) => out.push(HandOut::TakeOut),
            (Src::Inv(from), Spot::Slot(to)) if to != from => {
                out.push(HandOut::Move { from, to, n });
                self.last = (Some(to), f64::NEG_INFINITY);
            }
            (Src::Inv(from), Spot::Input) => out.push(HandOut::Feed { from, n }),
            _ => {}
        }
    }

    /// o espaço de onde sai o que está na mão (tocar e tocar) ou sendo arrastado
    pub fn source(&self) -> Option<usize> {
        self.lifted.or(self.held.map(|h| h.index))
    }

    pub fn busy(&self) -> bool {
        self.press.is_some() || self.held.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use spacing_core::rules::Events;

    fn inv() -> Inventory {
        let mut i = Inventory::new();
        let mut ev = Events::new();
        i.add(ItemId::of("iron"), 10, false, &mut ev); // espaço 0
        i.add(ItemId::of("ice"), 5, false, &mut ev); // espaço 1
        i
    }

    #[test]
    fn arrastar_move_tudo() {
        let i = inv();
        let mut h = Hand::default();
        h.down(10.0, 10.0, Spot::Slot(0), false, 0.0, &i);
        assert_eq!(h.moved(40.0, 10.0, Spot::Slot(9), &i), vec![HandOut::Focus(ItemId::of("iron"))]);
        assert_eq!(h.lifted, Some(0));
        assert_eq!(h.up(40.0, 10.0, Spot::Slot(9), 0.2, false, &i), vec![HandOut::Move { from: 0, to: 9, n: 10 }]);
        assert!(h.lifted.is_none() && !h.busy());
    }

    #[test]
    fn segurar_pega_metade() {
        let i = inv();
        let mut h = Hand::default();
        h.down(10.0, 10.0, Spot::Slot(0), false, 0.0, &i);
        h.update(0.2, &i);
        assert!(h.half_shown.is_none());
        h.update(0.5, &i);
        assert_eq!(h.half_shown, Some((ItemId::of("iron"), 5)));
        h.moved(60.0, 10.0, Spot::Slot(12), &i);
        assert_eq!(h.up(60.0, 10.0, Spot::Slot(12), 0.8, false, &i), vec![HandOut::Move { from: 0, to: 12, n: 5 }]);
    }

    #[test]
    fn botao_direito_pega_metade_e_toque_toque_solta() {
        let i = inv();
        let mut h = Hand::default();
        h.down(10.0, 10.0, Spot::Slot(1), true, 0.0, &i);
        h.up(10.0, 10.0, Spot::Slot(1), 0.1, false, &i);
        assert_eq!(h.held.map(|x| (x.index, x.n)), Some((1, 3)));
        h.down(90.0, 10.0, Spot::Slot(20), false, 1.0, &i);
        assert_eq!(h.up(90.0, 10.0, Spot::Slot(20), 1.1, false, &i), vec![HandOut::Move { from: 1, to: 20, n: 3 }]);
        assert!(h.held.is_none());
    }

    #[test]
    fn toque_duplo_manda_rapido() {
        let i = inv();
        let mut h = Hand::default();
        h.down(10.0, 10.0, Spot::Slot(0), false, 0.0, &i);
        h.up(10.0, 10.0, Spot::Slot(0), 0.05, false, &i);
        h.down(10.0, 10.0, Spot::Slot(0), false, 0.15, &i);
        assert_eq!(h.up(10.0, 10.0, Spot::Slot(0), 0.2, false, &i), vec![HandOut::Quick(0)]);
        // devagar: só larga
        h.down(10.0, 10.0, Spot::Slot(0), false, 1.0, &i);
        h.up(10.0, 10.0, Spot::Slot(0), 1.05, false, &i);
        h.down(10.0, 10.0, Spot::Slot(0), false, 2.0, &i);
        assert!(h.up(10.0, 10.0, Spot::Slot(0), 2.05, false, &i).is_empty());
        assert!(h.held.is_none());
        // Shift + clique
        h.down(10.0, 10.0, Spot::Slot(1), false, 5.0, &i);
        assert_eq!(h.up(10.0, 10.0, Spot::Slot(1), 5.05, true, &i), vec![HandOut::Quick(1)]);
    }

    #[test]
    fn soltar_na_entrada_e_pegar_a_saida() {
        let i = inv();
        let mut h = Hand::default();
        h.down(10.0, 10.0, Spot::Slot(0), false, 0.0, &i);
        h.moved(200.0, 10.0, Spot::Input, &i);
        assert_eq!(h.up(200.0, 10.0, Spot::Input, 0.3, false, &i), vec![HandOut::Feed { from: 0, n: 10 }]);
        // saída pronta: tocar pega; arrastar para o inventário também
        h.down(300.0, 10.0, Spot::Out(true), false, 1.0, &i);
        assert_eq!(h.up(300.0, 10.0, Spot::Out(true), 1.05, false, &i), vec![HandOut::TakeOut]);
        h.down(300.0, 10.0, Spot::Out(true), false, 2.0, &i);
        h.moved(50.0, 50.0, Spot::Pane, &i);
        assert_eq!(h.up(50.0, 50.0, Spot::Pane, 2.3, false, &i), vec![HandOut::TakeOut]);
        // saída sem nada pronto não pega
        h.down(300.0, 10.0, Spot::Out(false), false, 3.0, &i);
        assert!(h.up(300.0, 10.0, Spot::Out(false), 3.05, false, &i).is_empty());
    }

    #[test]
    fn soltar_fora_cancela() {
        let i = inv();
        let mut h = Hand::default();
        h.down(10.0, 10.0, Spot::Slot(0), false, 0.0, &i);
        h.moved(500.0, 500.0, Spot::Other, &i);
        assert!(h.up(500.0, 500.0, Spot::Other, 0.3, false, &i).is_empty());
        // espaço vazio não pega nada
        h.down(10.0, 10.0, Spot::Slot(5), false, 1.0, &i);
        assert!(h.up(10.0, 10.0, Spot::Slot(5), 1.05, false, &i).is_empty());
        assert!(h.held.is_none());
    }
}
