use std::collections::HashMap;

use crate::{Error, Result};

/// Extensible model-code -> vendor-official-name map (PRD B5).
/// The builtin table is a seed; an optional data file
/// (`model-map.json`, shape `{ "ILCE-7CM2": "Sony α7C II", ... }`) overrides
/// and extends it at runtime, shipped inside the template assets package.
#[derive(Debug, Clone, Default)]
pub struct ModelMap {
    map: HashMap<String, String>,
}

impl ModelMap {
    pub fn from_json(bytes: &[u8]) -> Result<ModelMap> {
        let value: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|e| Error::TemplateJson(e.to_string()))?;
        let obj = value
            .as_object()
            .ok_or_else(|| Error::SchemaViolation("model-map.json must be a JSON object".into()))?;
        let mut map = HashMap::new();
        for (k, v) in obj {
            let name = v
                .as_str()
                .ok_or_else(|| Error::SchemaViolation(format!("model-map[{k}] must be a string")))?;
            map.insert(k.to_ascii_uppercase(), name.to_string());
        }
        Ok(ModelMap { map })
    }

    /// Resolve a raw model code to its pretty name: data-file override first,
    /// builtin seed second, None if unknown.
    pub fn resolve(&self, model: &str) -> Option<String> {
        self.map
            .get(&model.to_ascii_uppercase())
            .cloned()
            .or_else(|| builtin(model).map(|s| s.to_string()))
    }
}

fn builtin(model: &str) -> Option<&'static str> {
    match model {
        "ILCE-7CM2" => Some("Sony \u{03b1}7C II"),
        "ILCE-7M4" => Some("Sony \u{03b1}7 IV"),
        "ILCE-6700" => Some("Sony \u{03b1}6700"),
        "X-T5" => Some("Fujifilm X-T5"),
        "X100VI" => Some("Fujifilm X100VI"),
        "NIKON Z fc" => Some("Nikon Z fc"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn override_and_fallback() {
        let map = ModelMap::from_json(br#"{ "CUSTOM-1": "Custom Camera One" }"#).expect("map");
        assert_eq!(map.resolve("custom-1").as_deref(), Some("Custom Camera One"));
        assert_eq!(map.resolve("X-T5").as_deref(), Some("Fujifilm X-T5"));
        assert_eq!(map.resolve("UNKNOWN"), None);
    }

    #[test]
    fn bad_map_rejected() {
        assert!(ModelMap::from_json(b"[]").is_err());
        assert!(ModelMap::from_json(br#"{ "A": 1 }"#).is_err());
    }
}
