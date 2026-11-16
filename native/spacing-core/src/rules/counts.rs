//! Quantidades por item, na ordem em que entraram (como um objeto do JS: a ordem decide o que vai primeiro para o
//! inventário). No salvamento é um objeto `{ "regolith": 3 }`.
use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::ItemId;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Counts(Vec<(ItemId, u32)>);

impl Counts {
    pub fn new() -> Self {
        Self(Vec::new())
    }

    pub fn from_pairs(p: &[(ItemId, u32)]) -> Self {
        let mut c = Self::new();
        for &(k, n) in p {
            c.add(k, n);
        }
        c
    }

    pub fn get(&self, item: ItemId) -> u32 {
        self.0.iter().find(|(k, _)| *k == item).map_or(0, |(_, n)| *n)
    }

    /// soma (n = 0 não cria a entrada, como o `add` do Crafting.ts)
    pub fn add(&mut self, item: ItemId, n: u32) {
        if n == 0 {
            return;
        }
        match self.0.iter_mut().find(|(k, _)| *k == item) {
            Some((_, v)) => *v += n,
            None => self.0.push((item, n)),
        }
    }

    /// troca o valor (0 tira a entrada)
    pub fn set(&mut self, item: ItemId, n: u32) {
        match self.0.iter().position(|(k, _)| *k == item) {
            Some(i) if n == 0 => {
                self.0.remove(i);
            }
            Some(i) => self.0[i].1 = n,
            None if n > 0 => self.0.push((item, n)),
            None => {}
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = (ItemId, u32)> + '_ {
        self.0.iter().copied()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn total(&self) -> u32 {
        self.0.iter().map(|(_, n)| n).sum()
    }

    pub fn pairs(&self) -> &[(ItemId, u32)] {
        &self.0
    }
}

impl Serialize for Counts {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, n) in &self.0 {
            m.serialize_entry(k.key(), n)?;
        }
        m.end()
    }
}

impl<'de> Deserialize<'de> for Counts {
    /// lê na ordem do arquivo; itens desconhecidos e números ruins são ignorados (salvamento velho ou mexido)
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Counts;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("um objeto item → quantidade")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Counts, A::Error> {
                let mut c = Counts::new();
                while let Some((k, v)) = a.next_entry::<String, serde_json::Value>()? {
                    if let (Some(item), Some(n)) = (ItemId::parse(&k), v.as_f64()) {
                        if n > 0.0 {
                            c.add(item, n.floor() as u32);
                        }
                    }
                }
                Ok(c)
            }
        }
        d.deserialize_map(V)
    }
}
