//! Energia da base (porte de `src/systems/Power.ts`, docs/design/ENERGIA.md). Nada vem do nada: a eletricidade vem do sol
//! (painéis do telhado e painéis no chão ligados por cabo), a sobra vai para a bateria e a falta sai dela. Bateria vazia
//! e geração menor que o consumo: o que é elétrico anda mais devagar, na proporção do que há.
use std::collections::HashMap;

use super::rules;
use crate::js;

#[derive(Clone, Debug, PartialEq)]
pub struct PanelInfo {
    pub key: String,
    pub x: i32,
    pub z: i32,
    /// dentro do alcance do cabo
    pub linked: bool,
    /// 0..1 da luz que chega nele
    pub light: f64,
    /// quanto gera agora (kW)
    pub kw: f64,
}

/// um painel colocado no mundo
#[derive(Clone, Debug, PartialEq)]
pub struct PanelSpot {
    pub key: String,
    pub x: i32,
    pub z: i32,
}

/// um consumidor ligado agora
#[derive(Clone, Debug, PartialEq)]
pub struct Load {
    pub id: String,
    pub kw: f64,
}

/// O que a energia precisa saber do mundo a cada passo.
pub trait PowerWorld {
    /// painéis colocados
    fn panels(&self) -> Vec<PanelSpot>;
    /// 0..1: o painel vê o sol? (None = não dá para saber agora, fica o último)
    fn exposure(&self, x: i32, z: i32) -> Option<f64>;
    /// consumidores ligados (estações trabalhando, traje recarregando)
    fn loads(&self) -> Vec<Load>;
    /// tempestade de poeira, 0..1
    fn dust(&self) -> f64 {
        0.0
    }
}

#[derive(Clone, Debug)]
pub struct Power {
    /// centro da base (alcance do cabo)
    pub base: (f64, f64),
    /// luz do planeta (Lua 1, Marte 0,43)
    pub solar: f64,
    /// quanto a sombra deixa passar
    pub shade: f64,
    /// carga da bateria (kJ)
    pub battery: f64,
    /// gerado agora (kW)
    pub generation: f64,
    /// pedido agora, com o habitat (kW)
    pub demand: f64,
    /// 0..1 do pedido atendido
    pub satisfaction: f64,
    /// 0..1 de sol que chega (planeta e tempestade)
    pub sun: f64,
    pub last_loads: Vec<Load>,
    pub panels: Vec<PanelInfo>,
    light: HashMap<String, f64>,
    scan_t: f64,
}

impl Power {
    /// `battery`: a do salvamento (None = a do começo)
    pub fn new(base: (f64, f64), solar: f64, shade: f64, battery: Option<f64>, w: &dyn PowerWorld) -> Self {
        let p = &rules().power;
        let mut s = Self {
            base,
            solar,
            shade,
            battery: battery.filter(|b| b.is_finite()).map_or(p.battery_kj * p.battery_start, |b| b.clamp(0.0, p.battery_kj)),
            generation: 0.0,
            demand: 0.0,
            satisfaction: 1.0,
            sun: 1.0,
            last_loads: Vec::new(),
            panels: Vec::new(),
            light: HashMap::new(),
            scan_t: 0.0,
        };
        s.scan(w);
        s
    }

    pub fn capacity(&self) -> f64 {
        rules().power.battery_kj
    }

    /// gerado pelos painéis do telhado (kW)
    pub fn roof_kw(&self) -> f64 {
        let p = &rules().power;
        p.roof_panels * p.roof_panel_kw * self.sun
    }

    /// velocidade de quem usa a rede (0..1)
    pub fn grid_speed(&self) -> f64 {
        self.satisfaction
    }

    /// revê os painéis (alcance, sombra); roda a cada segundo
    fn scan(&mut self, w: &dyn PowerWorld) {
        let p = &rules().power;
        self.sun = self.solar * (1.0 - p.storm_loss * w.dust());
        let (bx, bz) = self.base;
        self.panels = w
            .panels()
            .into_iter()
            .map(|q| {
                let linked = js::hypot(q.x as f64 + 0.5 - bx, q.z as f64 + 0.5 - bz) <= p.cable_reach;
                if let Some(seen) = w.exposure(q.x, q.z) {
                    self.light.insert(q.key.clone(), seen);
                }
                let lit = self.light.get(&q.key).copied().unwrap_or(1.0);
                let light = self.shade + (1.0 - self.shade) * lit;
                let kw = if linked { p.panel_kw * light * self.sun } else { 0.0 };
                PanelInfo { key: q.key, x: q.x, z: q.z, linked, light, kw }
            })
            .collect();
    }

    pub fn update(&mut self, dt: f64, w: &dyn PowerWorld) {
        let p = &rules().power;
        self.scan_t -= dt;
        if self.scan_t <= 0.0 {
            self.scan_t = 1.0;
            self.scan(w);
        }
        self.generation = self.roof_kw() + self.panels.iter().fold(0.0, |s, q| s + q.kw);
        self.last_loads = std::iter::once(Load { id: "life".into(), kw: p.life_support_kw }).chain(w.loads()).collect();
        self.demand = self.last_loads.iter().fold(0.0, |s, l| s + l.kw);
        let net = self.generation - self.demand;
        if net >= 0.0 {
            self.battery = p.battery_kj.min(self.battery + net * dt);
            self.satisfaction = 1.0;
        } else if self.battery > 0.0 {
            self.battery = (self.battery + net * dt).max(0.0);
            self.satisfaction = 1.0;
        } else {
            self.satisfaction = if self.demand > 0.0 { (self.generation / self.demand).max(0.0) } else { 1.0 };
        }
    }

    /// o salvamento guarda só a bateria, arredondada
    pub fn serialize(&self) -> f64 {
        js::round(self.battery)
    }
}
