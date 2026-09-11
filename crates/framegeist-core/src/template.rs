use serde::Deserialize;
use std::collections::HashMap;

use crate::sandbox;
use crate::{Error, Result};

pub const MAX_TEMPLATE_JSON_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Template {
    pub meta: Meta,
    pub canvas: Canvas,
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub fields: HashMap<String, FieldDef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Category {
    ClassicWhite,
    Film,
    Polaroid,
    Gallery,
    Technical,
    Magazine,
    Minimal,
    FrameShell,
    Game,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum License {
    #[serde(rename = "CC0-1.0")]
    Cc0,
    #[serde(rename = "CC-BY-4.0")]
    CcBy,
    #[serde(rename = "CC-BY-SA-4.0")]
    CcBySa,
    #[serde(rename = "OFL-1.1")]
    Ofl,
    #[serde(rename = "Apache-2.0")]
    Apache,
    #[serde(rename = "MIT")]
    Mit,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Meta {
    pub id: String,
    pub name: String,
    /// Localized display names, e.g. {"zh": "原神·风起", "en": "Genshin: Anemo"}.
    #[serde(rename = "nameI18n", default)]
    pub name_i18n: Option<std::collections::HashMap<String, String>>,
    /// Optional disclaimer (game templates: "Unofficial fan-made design…").
    #[serde(default)]
    pub notice: Option<String>,
    pub version: String,
    #[serde(rename = "minEngineVersion")]
    pub min_engine_version: String,
    pub author: String,
    pub license: License,
    pub category: Category,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Canvas {
    pub mode: CanvasMode,
    #[serde(default)]
    pub padding: Padding,
    #[serde(default)]
    pub background: Background,
    #[serde(default)]
    pub radius: Option<f64>,
    #[serde(default)]
    pub shadow: Option<Shadow>,
}

impl std::fmt::Display for Category {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Category::ClassicWhite => "classic-white",
            Category::Film => "film",
            Category::Polaroid => "polaroid",
            Category::Gallery => "gallery",
            Category::Technical => "technical",
            Category::Magazine => "magazine",
            Category::Minimal => "minimal",
            Category::FrameShell => "frame-shell",
            Category::Game => "game",
        };
        f.write_str(s)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasMode {
    Extend,
    Overlay,
    Cover,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Padding {
    #[serde(default)]
    pub top: f64,
    #[serde(default)]
    pub right: f64,
    #[serde(default)]
    pub bottom: f64,
    #[serde(default)]
    pub left: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Background {
    #[serde(rename = "type")]
    pub kind: BgKind,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub blur: Option<f64>,
    #[serde(default)]
    pub scale: Option<f64>,
    /// Optional background image reference (@builtin/..., @user/..., assets/...).
    #[serde(default)]
    pub asset: Option<String>,
}

impl Default for Background {
    fn default() -> Self {
        Background {
            kind: BgKind::None,
            color: None,
            blur: None,
            scale: None,
            asset: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BgKind {
    Blur,
    Solid,
    Image,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Shadow {
    pub enabled: bool,
    #[serde(default)]
    pub blur: f64,
    #[serde(default)]
    pub opacity: f64,
    #[serde(rename = "offsetX", default)]
    pub offset_x: f64,
    #[serde(rename = "offsetY", default)]
    pub offset_y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Layer {
    Text(TextLayer),
    Image(ImageLayer),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextLayer {
    pub id: String,
    pub anchor: Anchor,
    #[serde(default)]
    pub offset: Offset,
    pub font: FontSpec,
    #[serde(rename = "lineHeight", default = "default_line_height")]
    pub line_height: f64,
    pub content: Vec<ContentItem>,
}

fn default_line_height() -> f64 {
    1.3
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageLayer {
    pub id: String,
    pub anchor: Anchor,
    #[serde(default)]
    pub offset: Offset,
    pub asset: String,
    #[serde(default)]
    pub size: ImageSize,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    /// Attach to a text layer id: place the image just left of that layer's
    /// first line, vertically centered (watermark prefix icon).
    #[serde(rename = "attachTo", default)]
    pub attach_to: Option<String>,
    /// Gap between the attached image and the text (fraction of photo height).
    #[serde(rename = "attachGap", default)]
    pub attach_gap: Option<f64>,
    /// Badge tint strategy: "auto" (pick black/white by background luminance,
    /// default) | "light" | "dark".
    #[serde(default)]
    pub tint: Option<String>,
}

fn default_opacity() -> f64 {
    1.0
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageSize {
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub width: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Anchor {
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    MiddleCenter,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Offset {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FontSpec {
    pub family: Vec<String>,
    pub size: f64,
    #[serde(default)]
    pub weight: Option<u32>,
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentItem {
    pub expr: String,
    #[serde(default)]
    pub fallback: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldDef {
    #[serde(rename = "type")]
    pub kind: String,
    pub source: String,
    #[serde(default)]
    pub transform: Option<String>,
}

/// User-side render overrides (v0.2.0): safe knobs on top of template defaults.
/// JSON is camelCase (the Web UI sends `fontSizeScale` etc.).
#[derive(Debug, Clone, Default, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TemplateOverrides {
    #[serde(default)]
    pub font_size_scale: Option<f64>,
    #[serde(default)]
    pub padding_scale: Option<f64>,
    #[serde(default)]
    pub text_color: Option<String>,
    /// "1:1" | "4:3" | "3:2" | "16:9" | "9:16" | "original"
    #[serde(default)]
    pub aspect: Option<String>,
    /// "blur" | "solid" | "image" | "none"
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub flip_horizontal: Option<bool>,
    #[serde(default)]
    pub flip_vertical: Option<bool>,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub show_logo: Option<bool>,
}

/// Aspect-ratio preset name -> (w, h) multiplier. None = no change.
pub fn aspect_ratio(name: &str) -> Option<(u32, u32)> {
    match name {
        "1:1" => Some((1, 1)),
        "4:3" => Some((4, 3)),
        "3:2" => Some((3, 2)),
        "16:9" => Some((16, 9)),
        "9:16" => Some((9, 16)),
        _ => None,
    }
}

impl TemplateOverrides {
    pub fn from_json(json: &str) -> Result<Self> {
        if json.trim().is_empty() {
            return Ok(TemplateOverrides::default());
        }
        let o: TemplateOverrides = serde_json::from_str(json)
            .map_err(|e| Error::TemplateJson(format!("overrides: {e}")))?;
        o.validate()?;
        Ok(o)
    }

    pub fn validate(&self) -> Result<()> {
        if let Some(v) = self.font_size_scale {
            if !v.is_finite() || !(0.5..=2.0).contains(&v) {
                return Err(Error::SchemaViolation(
                    "overrides.fontSizeScale must be within [0.5, 2.0]".into(),
                ));
            }
        }
        if let Some(v) = self.padding_scale {
            if !v.is_finite() || !(0.5..=2.0).contains(&v) {
                return Err(Error::SchemaViolation(
                    "overrides.paddingScale must be within [0.5, 2.0]".into(),
                ));
            }
        }
        if let Some(c) = &self.text_color {
            parse_hex_color(c)?;
        }
        if let Some(a) = &self.aspect {
            if a != "original" && aspect_ratio(a).is_none() {
                return Err(Error::SchemaViolation(format!(
                    "overrides.aspect {a:?} must be one of 1:1,4:3,3:2,16:9,9:16,original"
                )));
            }
        }
        if let Some(b) = &self.background {
            if !matches!(b.as_str(), "blur" | "solid" | "image" | "none") {
                return Err(Error::SchemaViolation(format!(
                    "overrides.background {b:?} must be blur|solid|image|none"
                )));
            }
        }
        if let Some(c) = &self.background_color {
            parse_hex_color(c)?;
        }
        if let Some(f) = &self.font_family {
            if f.is_empty() || f.chars().count() > 64 {
                return Err(Error::SchemaViolation(
                    "overrides.fontFamily must be 1-64 characters".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn font_size_scale(&self) -> f64 {
        self.font_size_scale.unwrap_or(1.0)
    }

    pub fn padding_scale(&self) -> f64 {
        self.padding_scale.unwrap_or(1.0)
    }
}

pub fn parse_hex_color(hex: &str) -> Result<[u8; 4]> {
    let trimmed = hex.trim_start_matches('#');
    if !(trimmed.len() == 6 || trimmed.len() == 8)
        || !trimmed.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(Error::SchemaViolation(format!(
            "bad color literal {hex:?} (expected #RRGGBB or #RRGGBBAA)"
        )));
    }
    let bytes = trimmed
        .as_bytes()
        .chunks(2)
        .map(|pair| {
            pair.iter()
                .filter_map(|b| (*b as char).to_digit(16))
                .fold(0u8, |acc, d| acc * 16 + d as u8)
        })
        .collect::<Vec<u8>>();
    match bytes.len() {
        3 => Ok([bytes[0], bytes[1], bytes[2], 255]),
        4 => Ok([bytes[0], bytes[1], bytes[2], bytes[3]]),
        _ => Err(Error::SchemaViolation(format!("bad color literal {hex:?}"))),
    }
}

fn is_semver(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn is_template_id(s: &str) -> bool {
    s.len() >= 3
        && s.len() <= 64
        && s.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_layer_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn is_asset_path(s: &str) -> bool {
    let stripped = s
        .replace("{exif.brand_slug}", "sony")
        .replace("{exif.lens_slug}", "sony")
        .replace("{exif.lens_series}", "sony-gm");
    (stripped.starts_with("@builtin/")
        || stripped.starts_with("@user/")
        || stripped.starts_with("assets/"))
        && stripped.len() <= 200
        && stripped.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '{' | '}' | '-' | '@')
        })
        && !stripped.contains("..")
}

/// Evaluate `{exif.<key>}` placeholders inside an asset path.
pub fn eval_asset_path(path: &str, info: &crate::exif::ExifInfo) -> Option<String> {
    let mut out = String::with_capacity(path.len());
    let mut rest = path;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        let close = after.find('}')?;
        let token = &after[..close];
        let key = token.strip_prefix("exif.")?;
        let val = info.get(key)?;
        if val.is_empty() {
            return None;
        }
        out.push_str(&rest[..open]);
        out.push_str(&val);
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    Some(out)
}

fn range_check(name: &str, value: f64, lo: f64, hi: f64) -> Result<()> {
    if value.is_finite() && (lo..=hi).contains(&value) {
        Ok(())
    } else {
        Err(Error::SchemaViolation(format!(
            "{name} = {value} out of range [{lo}, {hi}]"
        )))
    }
}

/// Semantic validation on top of serde's structural rejection.
/// The machine-readable counterpart lives in `docs/schema/template.schema.json`.
fn validate_semantics(t: &Template) -> Result<()> {
    if !is_template_id(&t.meta.id) {
        return Err(Error::SchemaViolation(format!(
            "meta.id {:?} must be 3-64 chars of [a-z0-9-]",
            t.meta.id
        )));
    }
    if !is_semver(&t.meta.version) {
        return Err(Error::SchemaViolation(format!(
            "meta.version {:?} must be semver X.Y.Z",
            t.meta.version
        )));
    }
    if !is_semver(&t.meta.min_engine_version) {
        return Err(Error::SchemaViolation(format!(
            "meta.minEngineVersion {:?} must be semver X.Y.Z",
            t.meta.min_engine_version
        )));
    }
    if t.meta.name.is_empty() || t.meta.name.chars().count() > 64 {
        return Err(Error::SchemaViolation(
            "meta.name must be 1-64 characters".into(),
        ));
    }

    let p = &t.canvas.padding;
    range_check("canvas.padding.top", p.top, 0.0, 1.0)?;
    range_check("canvas.padding.right", p.right, 0.0, 1.0)?;
    range_check("canvas.padding.bottom", p.bottom, 0.0, 1.0)?;
    range_check("canvas.padding.left", p.left, 0.0, 1.0)?;
    let bg = &t.canvas.background;
    if let Some(color) = &bg.color {
        parse_hex_color(color)?;
    }
    if let Some(blur) = bg.blur {
        range_check("canvas.background.blur", blur, 0.0, 200.0)?;
    }
    if let Some(scale) = bg.scale {
        range_check("canvas.background.scale", scale, 1.0, 4.0)?;
    }
    if let Some(radius) = t.canvas.radius {
        range_check("canvas.radius", radius, 0.0, 512.0)?;
    }
    if let Some(shadow) = &t.canvas.shadow {
        range_check("canvas.shadow.blur", shadow.blur, 0.0, 512.0)?;
        range_check("canvas.shadow.opacity", shadow.opacity, 0.0, 1.0)?;
        range_check("canvas.shadow.offsetX", shadow.offset_x, -512.0, 512.0)?;
        range_check("canvas.shadow.offsetY", shadow.offset_y, -512.0, 512.0)?;
    }

    for (i, layer) in t.layers.iter().enumerate() {
        let (id, anchor_present, offset) = match layer {
            Layer::Text(text) => (&text.id, true, text.offset),
            Layer::Image(image) => (&image.id, true, image.offset),
        };
        if !is_layer_id(id) {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].id {id:?} must be 1-64 chars of [a-zA-Z0-9-]"
            )));
        }
        let _ = anchor_present;
        range_check(&format!("layers[{i}].offset.x"), offset.x, -1.0, 1.0)?;
        range_check(&format!("layers[{i}].offset.y"), offset.y, -1.0, 1.0)?;
        match layer {
            Layer::Text(text) => {
                if text.content.is_empty() || text.content.len() > 64 {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].content must contain 1-64 items"
                    )));
                }
                if text.font.family.is_empty() || text.font.family.len() > 8 {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].font.family must contain 1-8 families"
                    )));
                }
                for family in &text.font.family {
                    if family.is_empty() || family.chars().count() > 64 {
                        return Err(Error::SchemaViolation(format!(
                            "layers[{i}].font.family item must be 1-64 characters"
                        )));
                    }
                }
                if let Some(weight) = text.font.weight {
                    range_check(
                        &format!("layers[{i}].font.weight"),
                        weight as f64,
                        100.0,
                        900.0,
                    )?;
                }
                range_check(
                    &format!("layers[{i}].font.size"),
                    text.font.size,
                    0.0,
                    0.5,
                )?;
                if text.font.size <= 0.0 {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].font.size must be > 0"
                    )));
                }
                if !text.font.color.eq_ignore_ascii_case("auto") {
                    parse_hex_color(&text.font.color)?;
                }
                range_check(
                    &format!("layers[{i}].lineHeight"),
                    text.line_height,
                    0.5,
                    4.0,
                )?;
                for item in &text.content {
                    if item.expr.is_empty() || item.expr.chars().count() > 512 {
                        return Err(Error::SchemaViolation(format!(
                            "layers[{i}].content[].expr must be 1-512 characters"
                        )));
                    }
                    if let Some(fallback) = &item.fallback {
                        if fallback.chars().count() > 256 {
                            return Err(Error::SchemaViolation(format!(
                                "layers[{i}].content[].fallback must be at most 256 characters"
                            )));
                        }
                    }
                }
            }
            Layer::Image(image) => {
                if !is_asset_path(&image.asset) {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].asset {:?} must be @builtin/... or assets/... within the template package",
                        image.asset
                    )));
                }
                if let Some(h) = image.size.height {
                    range_check(&format!("layers[{i}].size.height"), h, 0.0, 1.0)?;
                    if h <= 0.0 {
                        return Err(Error::SchemaViolation(format!(
                            "layers[{i}].size.height must be > 0"
                        )));
                    }
                }
                if let Some(w) = image.size.width {
                    range_check(&format!("layers[{i}].size.width"), w, 0.0, 1.0)?;
                    if w <= 0.0 {
                        return Err(Error::SchemaViolation(format!(
                            "layers[{i}].size.width must be > 0"
                        )));
                    }
                }
                range_check(
                    &format!("layers[{i}].opacity"),
                    image.opacity,
                    0.0,
                    1.0,
                )?;
            }
        }
    }
    let text_ids: std::collections::HashSet<&str> = t
        .layers
        .iter()
        .filter_map(|l| match l {
            Layer::Text(text) => Some(text.id.as_str()),
            _ => None,
        })
        .collect();
    for layer in &t.layers {
        if let Layer::Image(image) = layer {
            if let Some(target) = &image.attach_to {
                if !text_ids.contains(target.as_str()) {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{}].attachTo references unknown text layer {target:?}",
                        image.id
                    )));
                }
                if let Some(gap) = image.attach_gap {
                    if !gap.is_finite() || !(0.0..=0.2).contains(&gap) {
                        return Err(Error::SchemaViolation(format!(
                            "layers[{}].attachGap must be within [0, 0.2]",
                            image.id
                        )));
                    }
                }
            }
            if let Some(tint) = &image.tint {
                if !matches!(tint.as_str(), "auto" | "light" | "dark") {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{}].tint must be auto|light|dark",
                        image.id
                    )));
                }
            }
        }
    }
    Ok(())
}

pub fn load_template_from_str(json: &str) -> Result<Template> {
    if json.len() > MAX_TEMPLATE_JSON_BYTES {
        return Err(Error::TemplateTooLarge {
            size: json.len(),
            max: MAX_TEMPLATE_JSON_BYTES,
        });
    }
    let value: serde_json::Value = serde_json::from_str(json)?;
    sandbox::check(&value)?;
    let template: Template = serde_json::from_value(value)
        .map_err(|e| Error::SchemaViolation(format!("template structure rejected: {e}")))?;
    validate_semantics(&template)?;
    for layer in &template.layers {
        if let Layer::Text(text) = layer {
            for item in &text.content {
                sandbox::validate_expr(&item.expr)?;
            }
        }
    }
    Ok(template)
}

pub fn load_template(json: &[u8]) -> Result<Template> {
    let s = std::str::from_utf8(json).map_err(|e| Error::TemplateJson(e.to_string()))?;
    load_template_from_str(s)
}
