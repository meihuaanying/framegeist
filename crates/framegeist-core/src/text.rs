use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use ab_glyph::FontArc;
use cosmic_text::fontdb;

use crate::text_shape::SharedDb;
use crate::{Error, Result};

/// Loads font files from a directory and resolves template font families.
///
/// Family lookup convention: file stem, lowercased, with the weight suffix
/// removed (`JetBrainsMono-600.ttf` -> `jetbrainsmono`). Since v0.7.0 one
/// family key can hold several faces (one per weight); the cosmic-text shaper
/// then selects the face matching `font.weight` through fontdb.
///
/// Each entry keeps its raw bytes so the shaper can build a font database
/// lazily; the ab_glyph arc stays for the legacy path.
#[derive(Clone, Debug)]
pub struct FontEntry {
    pub arc: FontArc,
    pub bytes: Arc<Vec<u8>>,
    pub weight: u16,
}

#[derive(Clone, Debug)]
pub struct FontBook {
    fonts: HashMap<String, Vec<FontEntry>>,
    fallback: Option<String>,
    db: SharedDb,
}

fn family_key(file_stem: &str) -> String {
    crate::text_shape::family_key(file_stem)
}

/// Reads `usWeightClass` from the OS/2 table of an sfnt (TTF/OTF) buffer.
fn os2_weight(bytes: &[u8]) -> u16 {
    if bytes.len() < 12 {
        return 400;
    }
    let num_tables = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
    for i in 0..num_tables {
        let off = 12 + i * 16;
        if off + 16 > bytes.len() {
            break;
        }
        if &bytes[off..off + 4] == b"OS/2" {
            let table_off = u32::from_be_bytes([
                bytes[off + 8],
                bytes[off + 9],
                bytes[off + 10],
                bytes[off + 11],
            ]) as usize;
            if table_off + 6 <= bytes.len() {
                return u16::from_be_bytes([bytes[table_off + 4], bytes[table_off + 5]]);
            }
        }
    }
    400
}

impl FontBook {
    pub fn load(dir: &Path) -> Result<FontBook> {
        let mut fonts: HashMap<String, Vec<FontEntry>> = HashMap::new();
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
        Ok(FontBook {
            fonts,
            fallback,
            db: Default::default(),
        })
    }

    /// Register fonts from in-memory bytes (used by WASM/Android/HarmonyOS
    /// shells that have no filesystem font directory).
    pub fn from_bytes(entries: Vec<(String, Vec<u8>)>) -> Result<FontBook> {
        let mut fonts: HashMap<String, Vec<FontEntry>> = HashMap::new();
        for (family, bytes) in entries {
            Self::insert_entry(&mut fonts, &family, bytes)?;
        }
        let fallback = fonts.keys().next().cloned();
        Ok(FontBook {
            fonts,
            fallback,
            db: Default::default(),
        })
    }

    fn insert_entry(
        fonts: &mut HashMap<String, Vec<FontEntry>>,
        family: &str,
        bytes: Vec<u8>,
    ) -> Result<()> {
        let weight = os2_weight(&bytes);
        let arc = FontArc::try_from_vec(bytes.clone())
            .map_err(|e| Error::Font(format!("{family}: {e}")))?;
        let entry = FontEntry {
            arc,
            bytes: Arc::new(bytes),
            weight,
        };
        let key = family_key(family);
        let list = fonts.entry(key).or_default();
        // Re-inserting the same family+weight replaces the face (lazy reload).
        if let Some(slot) = list.iter_mut().find(|e| e.weight == weight) {
            *slot = entry;
        } else {
            list.push(entry);
            list.sort_by_key(|e| e.weight);
        }
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
        let mut keys: Vec<String> = self.fonts.keys().cloned().collect();
        keys.sort();
        keys
    }

    pub fn empty() -> FontBook {
        FontBook {
            fonts: HashMap::new(),
            fallback: None,
            db: Default::default(),
        }
    }

    /// Face closest to Regular (legacy ab_glyph path, no per-weight attrs).
    pub fn pick(&self, families: &[String]) -> Option<&FontArc> {
        for family in families {
            let key = family.replace([' ', '_'], "").to_ascii_lowercase();
            if let Some(list) = self.fonts.get(&key) {
                let best = list
                    .iter()
                    .min_by_key(|e| (e.weight as i32 - 400).unsigned_abs())
                    .or_else(|| list.first())?;
                return Some(&best.arc);
            }
        }
        self.fallback
            .as_ref()
            .and_then(|k| self.fonts.get(k))
            .and_then(|list| {
                list.iter()
                    .min_by_key(|e| (e.weight as i32 - 400).unsigned_abs())
            })
            .map(|e| &e.arc)
    }

    /// (family key, raw bytes) pairs in stable order (sorted by key, weight).
    pub fn iter_entries(&self) -> Vec<(String, &[u8])> {
        let mut keys: Vec<&String> = self.fonts.keys().collect();
        keys.sort();
        let mut out = Vec::new();
        for k in keys {
            for entry in &self.fonts[k] {
                out.push((k.clone(), entry.bytes.as_slice()));
            }
        }
        out
    }

    /// Lazily built cosmic-text font database shared across clones.
    pub(crate) fn database(&self) -> Arc<fontdb::Database> {
        let mut guard = match self.db.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(db) = guard.as_ref() {
            return db.clone();
        }
        let mut db = fontdb::Database::new();
        for list in self.fonts.values() {
            for entry in list {
                db.load_font_data(entry.bytes.as_ref().clone());
            }
        }
        let db = Arc::new(db);
        *guard = Some(db.clone());
        db
    }
}
