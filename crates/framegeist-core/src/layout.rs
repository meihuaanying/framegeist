use serde::Deserialize;

use crate::sandbox;
use crate::{Error, Result};

pub const MAX_LAYOUT_JSON_BYTES: usize = 64 * 1024;
const MAX_CELLS: usize = 25;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layout {
    pub meta: LayoutMeta,
    pub cells: Vec<Cell>,
    #[serde(default = "default_gutter")]
    pub gutter: f64,
    #[serde(default = "default_background")]
    pub background: String,
    #[serde(rename = "aspect", default = "default_aspect")]
    pub aspect: f64,
    #[serde(default)]
    pub info_bar: InfoBar,
}

fn default_gutter() -> f64 {
    0.01
}

fn default_background() -> String {
    "#FFFFFF".to_string()
}

fn default_aspect() -> f64 {
    1.0
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub license: String,
    #[serde(default)]
    pub slots: Option<u32>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InfoBar {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_info_height")]
    pub height: f64,
    #[serde(default = "default_info_color")]
    pub color: String,
    #[serde(default = "default_info_text_color")]
    pub text_color: String,
}

impl Default for InfoBar {
    fn default() -> Self {
        InfoBar {
            enabled: false,
            height: 0.06,
            color: "#FFFFFF".to_string(),
            text_color: "#555555".to_string(),
        }
    }
}

fn default_info_height() -> f64 {
    0.06
}

fn default_info_color() -> String {
    "#FFFFFF".to_string()
}

fn default_info_text_color() -> String {
    "#555555".to_string()
}

fn is_layout_id(s: &str) -> bool {
    s.len() >= 3
        && s.len() <= 64
        && s.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_semver(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

pub fn load_layout(json: &[u8]) -> Result<Layout> {
    if json.len() > MAX_LAYOUT_JSON_BYTES {
        return Err(Error::TemplateTooLarge {
            size: json.len(),
            max: MAX_LAYOUT_JSON_BYTES,
        });
    }
    let value: serde_json::Value =
        serde_json::from_slice(json).map_err(|e| Error::TemplateJson(e.to_string()))?;
    sandbox::check(&value)?;
    let layout: Layout =
        serde_json::from_value(value).map_err(|e| Error::SchemaViolation(format!("layout structure rejected: {e}")))?;
    validate_layout(&layout)?;
    Ok(layout)
}

fn validate_layout(l: &Layout) -> Result<()> {
    if !is_layout_id(&l.meta.id) {
        return Err(Error::SchemaViolation(format!(
            "meta.id {:?} must be 3-64 chars of [a-z0-9-]",
            l.meta.id
        )));
    }
    if !is_semver(&l.meta.version) {
        return Err(Error::SchemaViolation(format!(
            "meta.version {:?} must be semver X.Y.Z",
            l.meta.version
        )));
    }
    if l.meta.name.is_empty() || l.meta.name.chars().count() > 64 {
        return Err(Error::SchemaViolation(
            "meta.name must be 1-64 characters".into(),
        ));
    }
    if !(0.2..=4.0).contains(&l.aspect) || !l.aspect.is_finite() {
        return Err(Error::SchemaViolation(
            "aspect must be within [0.2, 4.0]".into(),
        ));
    }
    range("gutter", l.gutter, 0.0, 0.2)?;
    crate::template::parse_hex_color(&l.background)?;
    crate::template::parse_hex_color(&l.info_bar.color)?;
    crate::template::parse_hex_color(&l.info_bar.text_color)?;
    range("info_bar.height", l.info_bar.height, 0.0, 0.5)?;
    if l.cells.is_empty() || l.cells.len() > MAX_CELLS {
        return Err(Error::SchemaViolation(format!(
            "cells must contain 1-{MAX_CELLS} rects"
        )));
    }
    for (i, c) in l.cells.iter().enumerate() {
        for (name, v, lo) in [
            ("x", c.x, 0.0),
            ("y", c.y, 0.0),
            ("w", c.w, 0.0 + f64::EPSILON),
            ("h", c.h, 0.0 + f64::EPSILON),
        ] {
            let ok = v.is_finite() && v >= lo && v <= 1.0;
            if !ok {
                return Err(Error::SchemaViolation(format!(
                    "cells[{i}].{name} = {v} must be within [0, 1]"
                )));
            }
        }
        if c.w <= 0.0 || c.h <= 0.0 {
            return Err(Error::SchemaViolation(format!(
                "cells[{i}] width/height must be > 0"
            )));
        }
        if c.x + c.w > 1.0 + 1e-9 || c.y + c.h > 1.0 + 1e-9 {
            return Err(Error::SchemaViolation(format!(
                "cells[{i}] exceeds canvas bounds"
            )));
        }
    }
    Ok(())
}

fn range(name: &str, v: f64, lo: f64, hi: f64) -> Result<()> {
    if v.is_finite() && (lo..=hi).contains(&v) {
        Ok(())
    } else {
        Err(Error::SchemaViolation(format!(
            "{name} = {v} out of range [{lo}, {hi}]"
        )))
    }
}
