//! O salvamento no aparelho (Game.persist e loadSave do TS, docs/design/PORTE_RUST.md, M4d). Um arquivo JSON por planeta,
//! no mesmo formato do jogo web (`spacing_core::save`, versão 12): `save-lua.json` e `save-marte.json`. No Android fica na
//! pasta interna do app (some ao desinstalar); no computador, em `$SPACING_SAVES` ou `~/.local/share/spacing-nativo`.
//! Grava num arquivo temporário e troca de nome, para um desligamento no meio não deixar o salvamento pela metade.
use std::path::{Path, PathBuf};

use spacing_core::planet::PlanetId;
use spacing_core::save::{self, SaveData};

pub struct Store {
    dir: Option<PathBuf>,
}

fn name(p: PlanetId) -> &'static str {
    match p {
        PlanetId::Lua => "lua",
        PlanetId::Marte => "marte",
    }
}

/// segundos desde 1970 (a hora do `savedAt`, em milissegundos como no TS)
pub fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// semente de um jogo novo: sorteada (docs/design/MUNDO.md)
pub fn fresh_seed() -> u32 {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |d| d.as_nanos() as u64);
    let mut x = t ^ 0x9e37_79b9_7f4a_7c15;
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
    x ^= x >> 33;
    (x % 2_000_000_000) as u32 + 1
}

impl Store {
    /// `dir` None: nada é gravado (as capturas de teste)
    pub fn new(dir: Option<PathBuf>) -> Self {
        if let Some(d) = &dir {
            if let Err(e) = std::fs::create_dir_all(d) {
                log::error!("pasta do salvamento {}: {e}", d.display());
            }
        }
        Self { dir }
    }

    /// a pasta padrão do computador
    pub fn desktop_dir() -> PathBuf {
        if let Some(d) = std::env::var_os("SPACING_SAVES") {
            return PathBuf::from(d);
        }
        let home = std::env::var_os("HOME").map_or_else(|| PathBuf::from("."), PathBuf::from);
        home.join(".local/share/spacing-nativo")
    }

    pub fn path(&self, p: PlanetId) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| d.join(format!("save-{}.json", name(p))))
    }

    /// as configurações do jogador (prefs.rs)
    pub fn prefs_path(&self) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| d.join("prefs.json"))
    }

    /// há quantos segundos o salvamento do planeta foi gravado (None = não há); para o "Continuar missão" do título
    pub fn save_age(&self, p: PlanetId) -> Option<f64> {
        let modified = std::fs::metadata(self.path(p)?).ok()?.modified().ok()?;
        Some(modified.elapsed().map_or(0.0, |d| d.as_secs_f64()))
    }

    /// o salvamento do planeta, já na versão atual; nenhum, estragado ou de versão futura: None
    pub fn load(&self, p: PlanetId, fresh_seed: u32) -> Option<SaveData> {
        let path = self.path(p)?;
        let text = std::fs::read_to_string(&path).ok()?;
        let s = save::parse(&text, fresh_seed as f64);
        if s.is_none() {
            log::warn!("salvamento ilegível em {}: começa um jogo novo (o arquivo fica como .ruim)", path.display());
            let _ = std::fs::rename(&path, path.with_extension("json.ruim"));
        }
        s
    }

    pub fn write(&self, p: PlanetId, data: &SaveData) -> bool {
        let Some(path) = self.path(p) else { return false };
        match write_atomic(&path, &save::to_text(data, now_ms())) {
            Ok(()) => true,
            Err(e) => {
                log::error!("não deu para salvar em {}: {e}", path.display());
                false
            }
        }
    }

    /// "Novo jogo": o salvamento do planeta sai
    pub fn clear(&self, p: PlanetId) {
        if let Some(path) = self.path(p) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grava_e_le_de_volta() {
        let dir = std::env::temp_dir().join(format!("spacing-store-{}", std::process::id()));
        let st = Store::new(Some(dir.clone()));
        assert!(st.load(PlanetId::Lua, 5).is_none());
        let s = save::migrate(&serde_json::json!({ "version": 12, "seed": 77, "missions": { "step": 2, "count": 1 } }), 1.0).unwrap();
        assert!(st.write(PlanetId::Lua, &s));
        let back = st.load(PlanetId::Lua, 5).unwrap();
        assert_eq!(back.seed, 77.0);
        assert_eq!(back.missions.step, 2);
        assert!(back.saved_at > 0.0);
        assert!(st.load(PlanetId::Marte, 5).is_none());
        // estragado: vira jogo novo e o arquivo fica de lado
        std::fs::write(st.path(PlanetId::Marte).unwrap(), "{ quebrado").unwrap();
        assert!(st.load(PlanetId::Marte, 5).is_none());
        assert!(dir.join("save-marte.json.ruim").exists());
        st.clear(PlanetId::Lua);
        assert!(st.load(PlanetId::Lua, 5).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
