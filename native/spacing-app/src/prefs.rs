//! Preferências do jogador: a tela de configurações (docs/design/INTERFACE_NATIVA.md, docs/design/PAUSA.md), a mesma no
//! título e na pausa. Ficam em `prefs.json`, na pasta dos salvamentos; um arquivo que falta ou que não se lê vira o padrão.
use std::path::Path;

use serde_json::{json, Value};

/// qualidade dos gráficos: a automática deixa a resolução dinâmica decidir; as outras fixam a escala da cena
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Qualidade {
    Auto,
    Baixa,
    Media,
    Alta,
}

impl Qualidade {
    const TODAS: [Qualidade; 4] = [Qualidade::Auto, Qualidade::Baixa, Qualidade::Media, Qualidade::Alta];

    pub fn nome(self) -> &'static str {
        match self {
            Qualidade::Auto => "Automática",
            Qualidade::Baixa => "Baixa",
            Qualidade::Media => "Média",
            Qualidade::Alta => "Alta",
        }
    }

    fn chave(self) -> &'static str {
        match self {
            Qualidade::Auto => "auto",
            Qualidade::Baixa => "low",
            Qualidade::Media => "medium",
            Qualidade::Alta => "high",
        }
    }

    /// a próxima (passo 1) ou a anterior (passo -1), dando a volta
    pub fn passo(self, d: i32) -> Self {
        let i = Self::TODAS.iter().position(|q| *q == self).unwrap_or(0) as i32;
        Self::TODAS[(i + d).rem_euclid(4) as usize]
    }

    /// quanto da escala da cena (None = a resolução dinâmica decide)
    pub fn escala(self) -> Option<f32> {
        match self {
            Qualidade::Auto => None,
            Qualidade::Baixa => Some(0.5),
            Qualidade::Media => Some(0.75),
            Qualidade::Alta => Some(1.0),
        }
    }
}

/// tremor de tela nos impactos (os mesmos três níveis do jogo web)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tremor {
    Desligado,
    Baixo,
    Normal,
}

impl Tremor {
    const TODOS: [Tremor; 3] = [Tremor::Desligado, Tremor::Baixo, Tremor::Normal];

    pub fn nome(self) -> &'static str {
        match self {
            Tremor::Desligado => "Desligado",
            Tremor::Baixo => "Baixo",
            Tremor::Normal => "Normal",
        }
    }

    fn chave(self) -> &'static str {
        match self {
            Tremor::Desligado => "off",
            Tremor::Baixo => "low",
            Tremor::Normal => "normal",
        }
    }

    pub fn passo(self, d: i32) -> Self {
        let i = Self::TODOS.iter().position(|t| *t == self).unwrap_or(0) as i32;
        Self::TODOS[(i + d).rem_euclid(3) as usize]
    }

    /// multiplica o tremor da câmera (`CameraRig::shake_scale`)
    pub fn escala(self) -> f64 {
        match self {
            Tremor::Desligado => 0.0,
            Tremor::Baixo => 0.5,
            Tremor::Normal => 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Prefs {
    pub qualidade: Qualidade,
    /// liga e desliga todo o som (docs/design/AUDIO_NATIVO.md)
    pub som: bool,
    /// liga e desliga a vibração do aparelho (`vibracao.rs`)
    pub vibracao: bool,
    pub tremor: Tremor,
    /// mira ao segurar o dedo: acima dele (true, o padrão do jogo web) ou embaixo dele
    pub mira_acima: bool,
    /// só no computador (no celular o jogo já ocupa a tela toda)
    pub tela_cheia: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self { qualidade: Qualidade::Auto, som: true, vibracao: true, tremor: Tremor::Normal, mira_acima: true, tela_cheia: false }
    }
}

impl Prefs {
    pub fn de_json(v: &Value) -> Self {
        let mut p = Self::default();
        if let Some(q) = v.get("quality").and_then(Value::as_str) {
            p.qualidade = Qualidade::TODAS.into_iter().find(|x| x.chave() == q).unwrap_or(p.qualidade);
        }
        if let Some(t) = v.get("shake").and_then(Value::as_str) {
            p.tremor = Tremor::TODOS.into_iter().find(|x| x.chave() == t).unwrap_or(p.tremor);
        }
        let flag = |k: &str, d: bool| v.get(k).and_then(Value::as_bool).unwrap_or(d);
        p.som = flag("sound", p.som);
        p.vibracao = flag("vibration", p.vibracao);
        p.tela_cheia = flag("fullscreen", p.tela_cheia);
        if let Some(a) = v.get("touchAim").and_then(Value::as_str) {
            p.mira_acima = a != "finger";
        }
        p
    }

    pub fn para_json(&self) -> Value {
        json!({
            "quality": self.qualidade.chave(),
            "sound": self.som,
            "vibration": self.vibracao,
            "shake": self.tremor.chave(),
            "touchAim": if self.mira_acima { "offset" } else { "finger" },
            "fullscreen": self.tela_cheia,
        })
    }

    /// lê do arquivo (sem arquivo, ou ilegível: o padrão)
    pub fn ler(path: Option<&Path>) -> Self {
        path.and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .map_or_else(Self::default, |v| Self::de_json(&v))
    }

    pub fn gravar(&self, path: Option<&Path>) {
        let Some(path) = path else { return };
        let tmp = path.with_extension("json.tmp");
        let ok = std::fs::write(&tmp, self.para_json().to_string()).and_then(|_| std::fs::rename(&tmp, path));
        if let Err(e) = ok {
            log::error!("não deu para gravar as configurações em {}: {e}", path.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ida_e_volta_e_padrao() {
        let p = Prefs { qualidade: Qualidade::Media, som: false, vibracao: true, tremor: Tremor::Baixo, mira_acima: false, tela_cheia: true };
        assert_eq!(Prefs::de_json(&p.para_json()), p);
        // arquivo velho ou estragado: o que não se lê fica no padrão
        assert_eq!(Prefs::de_json(&json!({ "quality": "ultra", "sound": "sim" })), Prefs::default());
        assert_eq!(Prefs::ler(Some(Path::new("/caminho/que/nao/existe.json"))), Prefs::default());
    }

    #[test]
    fn escolhas_dao_a_volta() {
        assert_eq!(Qualidade::Alta.passo(1), Qualidade::Auto);
        assert_eq!(Qualidade::Auto.passo(-1), Qualidade::Alta);
        assert_eq!(Tremor::Normal.passo(1), Tremor::Desligado);
    }
}
