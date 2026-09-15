use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use ab_glyph::FontArc;
use cosmic_text::fontdb;

use crate::text_shape::SharedDb;
use crate::{Error, Result};

/// Loads font files from a directory and resolves template font families.
///
/// Family lookup convention: file stem, lowercased, with weight suffix
/// removed (`JetBrainsMono-Regular.ttf` -> `jetbrainsmono`).
///
/// Since v0.5.0 each entry keeps its raw bytes so the cosmic-text shaper can
/// build a font database lazily; the ab_glyph arc stays for the legacy path.
#[derive(Clone, Debug)]
pub struct FontEntry {
    pub arc: FontArc,
    pub bytes: Arc<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct FontBook {
    fonts: HashMap<String, FontEntry>,
    fallback: Option<String>,
    db: SharedDb,
}

fn family_key(file_stem: &str) -> String {
    crate::text_shape::family_key(file_stem)
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
                Self::insert_entry(&mut fonts, &stem, bytes)?;
            }
        }
        let fallback = fonts.keys().next().cloned();
        Ok(FontBook { fonts, fallback, db: Default::default() })
    }

    /// Register fonts from in-memory bytes (used by WASM/Android/HarmonyOS
    /// shells that have no filesystem font directory).
    pub fn from_bytes(entries: Vec<(String, Vec<u8>)>) -> Result<FontBook> {
        let mut fonts = HashMap::new();
        for (family, bytes) in entries {
            Self::insert_entry(&mut fonts, &family, bytes)?;
        }
        let fallback = fonts.keys().next().cloned();
        Ok(FontBook { fonts, fallback, db: Default::default() })
    }

    fn insert_entry(fonts: &mut HashMap<String, FontEntry>, family: &str, bytes: Vec<u8>) -> Result<()> {
        let arc = FontArc::try_from_vec(bytes.clone())
            .map_err(|e| Error::Font(format!("{family}: {e}")))?;
        fonts.insert(family_key(family), FontEntry { arc, bytes: Arc::new(bytes) });
        Ok(())
    }

    /// Add/replace a single font at runtime (lazy loading, v0.2.0).
    pub fn insert(&mut self, family: &str, bytes: Vec<u8>) -> Result<()> {
        Self::insert_entry(&mut self.fonts, family, bytes)?;
        self.db = Default::default();
        if self.fallback.is_none() {
            self.fallback = self.fonts.keys().next().cloned();
        }
        Ok(())
    }

    /// Family names currently registered.
    pub fn families(&self) -> Vec<String> {
        self.fonts.keys().cloned().collect()
    }

    pub fn empty() -> FontBook {
        FontBook { fonts: HashMap::new(), fallback: None, db: Default::default() }
    }

    pub fn pick(&self, families: &[String]) -> Option<&FontArc> {
        for family in families {
            let key = family.replace([' ', '_'], "").to_ascii_lowercase();
            if let Some(f) = self.fonts.get(&key) {
                return Some(&f.arc);
            }
        }
        self.fallback.as_ref().and_then(|k| self.fonts.get(k)).map(|e| &e.arc)
    }

    /// (family key, raw bytes) pairs in stable order (sorted by key).
    pub fn iter_entries(&self) -> Vec<(String, &[u8])> {
        let mut keys: Vec<&String> = self.fonts.keys().collect();
        keys.sort();
        keys.into_iter().map(|k| (k.clone(), self.fonts[k].bytes.as_slice())).collect()
    }

    /// Lazily built cosmic-text font database shared across clones.
    pub(crate) fn database(&self) -> Arc<fontdb::Database> {
        let mut guard = self.db.lock().expect("font db lock");
        if let Some(db) = guard.as_ref() {
            return db.clone();
        }
        let mut db = fontdb::Database::new();
        for entry in self.fonts.values() {
            db.load_font_data(entry.bytes.as_ref().clone());
        }
        let db = Arc::new(db);
        *guard = Some(db.clone());
        db
    }
}
