use std::collections::HashMap;
use std::path::Path;

use ab_glyph::FontArc;

use crate::{Error, Result};

/// Loads font files from a directory and resolves template font families.
///
/// Family lookup convention: file stem, lowercased, with weight suffix
/// removed (`JetBrainsMono-Regular.ttf` -> `jetbrainsmono`).
#[derive(Clone, Debug)]
pub struct FontBook {
    fonts: HashMap<String, FontArc>,
    fallback: Option<FontArc>,
}

fn family_key(file_stem: &str) -> String {
    let stem = file_stem
        .split('-')
        .next()
        .unwrap_or(file_stem);
    stem.replace([' ', '_'], "").to_ascii_lowercase()
}

impl FontBook {
    pub fn load(dir: &Path) -> Result<FontBook> {
        let mut fonts = HashMap::new();
        if dir.is_dir() {
            for entry in std::fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase());
                if !matches!(ext.as_deref(), Some("ttf") | Some("otf")) {
                    continue;
                }
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| Error::Font(format!("bad font filename: {}", path.display())))?
                    .to_string();
                let bytes = std::fs::read(&path)?;
                let font = FontArc::try_from_vec(bytes)
                    .map_err(|e| Error::Font(format!("{}: {e}", path.display())))?;
                fonts.insert(family_key(&stem), font);
            }
        }
        let fallback = fonts.values().next().cloned();
        Ok(FontBook { fonts, fallback })
    }

    /// Register fonts from in-memory bytes (used by WASM/Android/HarmonyOS
    /// shells that have no filesystem font directory).
    pub fn from_bytes(entries: Vec<(String, Vec<u8>)>) -> Result<FontBook> {
        let mut fonts = HashMap::new();
        for (family, bytes) in entries {
            let font = FontArc::try_from_vec(bytes)
                .map_err(|e| Error::Font(format!("{family}: {e}")))?;
            fonts.insert(family_key(&family), font);
        }
        let fallback = fonts.values().next().cloned();
        Ok(FontBook { fonts, fallback })
    }

    /// Add/replace a single font at runtime (lazy loading, v0.2.0).
    pub fn insert(&mut self, family: &str, bytes: Vec<u8>) -> Result<()> {
        let font = FontArc::try_from_vec(bytes)
            .map_err(|e| Error::Font(format!("{family}: {e}")))?;
        self.fonts.insert(family_key(family), font);
        if self.fallback.is_none() {
            self.fallback = self.fonts.values().next().cloned();
        }
        Ok(())
    }

    /// Family names currently registered.
    pub fn families(&self) -> Vec<String> {
        self.fonts.keys().cloned().collect()
    }

    pub fn empty() -> FontBook {
        FontBook {
            fonts: HashMap::new(),
            fallback: None,
        }
    }

    pub fn pick(&self, families: &[String]) -> Option<&FontArc> {
        for family in families {
            let key = family.replace([' ', '_'], "").to_ascii_lowercase();
            if let Some(f) = self.fonts.get(&key) {
                return Some(f);
            }
        }
        self.fallback.as_ref()
    }
}
