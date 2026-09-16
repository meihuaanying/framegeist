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
    // Legacy (pre-v0.4.0) values, kept so older template files stay loadable.
    ClassicWhite,
    Gallery,
    Technical,
    FrameShell,
    // v0.4.0 taxonomy (frameelf-aligned, original designs).
    WhiteBorder,
    Camera,
    Phone,
    Drone,
    Fuji,
    Film,
    Colorwalk,
    Colorful,
    ClassicWatermark,
    Portfolio,
    BlackFrame,
    Sports,
    Calendar,
    Magazine,
    Minimal,
    Borderless,
    Master,
    Personal,
    Polaroid,
    Festival,
    Effect,
    Colorcard,
    BlurBg,
    Ticket,
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
    /// v0.5.0: uploaded/builtin frame PNG overlay with blank-window detection.
    #[serde(default)]
    pub frame: Option<CanvasFrame>,
}

/// v0.5.0 frame maker: a PNG whose transparent window receives the photo.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CanvasFrame {
    pub asset: String,
    /// Photo inset relative to the frame window (0–0.3); only used when
    /// `autoDetect` is off.
    #[serde(default)]
    pub inset: Option<f64>,
    /// Detect the largest transparent window in the frame PNG (default true).
    #[serde(rename = "autoDetect", default = "default_true")]
    pub auto_detect: bool,
    /// Scale of the frame relative to the canvas (0.2–1.5, default 1).
    #[serde(default)]
    pub scale: Option<f64>,
    /// Frame translation, relative to canvas size.
    #[serde(default)]
    pub offset: Option<Offset>,
    /// v0.5.0: rotation of the frame overlay around the canvas center,
    /// degrees ([-360, 360], default 0). The detected photo window rotates
    /// with the frame.
    #[serde(default)]
    pub rotation: f64,
}

impl std::fmt::Display for Category {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Category::ClassicWhite => "classic-white",
            Category::Gallery => "gallery",
            Category::Technical => "technical",
            Category::FrameShell => "frame-shell",
            Category::WhiteBorder => "white-border",
            Category::Camera => "camera",
            Category::Phone => "phone",
            Category::Drone => "drone",
            Category::Fuji => "fuji",
            Category::Film => "film",
            Category::Colorwalk => "colorwalk",
            Category::Colorful => "colorful",
            Category::ClassicWatermark => "classic-watermark",
            Category::Portfolio => "portfolio",
            Category::BlackFrame => "black-frame",
            Category::Sports => "sports",
            Category::Calendar => "calendar",
            Category::Magazine => "magazine",
            Category::Minimal => "minimal",
            Category::Borderless => "borderless",
            Category::Master => "master",
            Category::Personal => "personal",
            Category::Polaroid => "polaroid",
            Category::Festival => "festival",
            Category::Effect => "effect",
            Category::Colorcard => "colorcard",
            Category::BlurBg => "blur-bg",
            Category::Ticket => "ticket",
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
    /// v0.4.0: average color of the photo fills the canvas (seamless extension).
    Tint,
    /// v0.5.0: paper/noise texture. `background.asset` may point at a package
    /// texture; when absent a deterministic procedural grain is generated.
    Texture,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Copy, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Shadow {
    /// Present = enabled unless explicitly `false` (card overrides omit it).
    #[serde(default = "default_true")]
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
#[allow(clippy::large_enum_variant)]
pub enum Layer {
    Text(TextLayer),
    Image(ImageLayer),
    Shape(ShapeLayer),
    Palette(PaletteLayer),
    /// v0.5.0: container with relative children (grouping/hierarchy).
    Group(GroupLayer),
    /// v0.5.0: month calendar grid (with best-effort lunar day labels).
    Calendar(CalendarLayer),
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
    /// v0.4.0: extra advance between glyphs, in em units ([-0.05, 0.5]).
    #[serde(rename = "letterSpacing", default)]
    pub letter_spacing: f64,
    /// v0.4.0: rotation around the text block center, degrees ([-360, 360]).
    #[serde(default)]
    pub rotation: f64,
    /// v0.4.0: layer opacity ([0, 1]), watermarks use 0.7–0.95.
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    /// v0.4.0: explicit per-line alignment ("left"|"center"|"right");
    /// defaults to the anchor column.
    #[serde(default)]
    pub align: Option<String>,
    /// v0.5.0: text art effects (stroke/relief/fill/shadow/case/flip/stretch).
    #[serde(default)]
    pub effects: Option<TextEffects>,
    /// v0.6.0: OpenType features to enable (`tnum`, `lnum`, `onum`, `pnum`,
    /// `smcp`, `c2sc`, `liga`, `kern`, `frac`, `ss01`, `ss02`).
    #[serde(default)]
    pub features: Vec<String>,
    /// v0.5.0: fixed wrap width, relative canvas width (0–1).
    #[serde(default)]
    pub width: Option<f64>,
    /// v0.5.0: target block height, relative canvas height (0–1); font size
    /// is scaled so the shaped block matches.
    #[serde(default)]
    pub height: Option<f64>,
    /// v0.5.0: stretch glyphs to fill the space between the anchor column and
    /// the opposite edge.
    #[serde(rename = "stretchWidth", default)]
    pub stretch_width: bool,
    /// v0.5.0: scale the font so the block fills the space between the anchor
    /// row and the opposite edge.
    #[serde(rename = "stretchHeight", default)]
    pub stretch_height: bool,
    /// v0.5.0: scale to fill the whole page interior (both axes).
    #[serde(rename = "fillPage", default)]
    pub fill_page: bool,
    /// v0.5.0: explicit stacking order (lower paints first); ties keep array order.
    #[serde(default)]
    pub z: Option<i32>,
}

/// v0.5.0 text art presets and primitives (frameelf feature parity, visual
/// language 100% FrameGeist-original).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextEffects {
    #[serde(default)]
    pub stroke: Option<TextStroke>,
    #[serde(default)]
    pub relief: Option<TextRelief>,
    #[serde(default)]
    pub fill: Option<TextFill>,
    #[serde(default)]
    pub shadow: Option<TextShadow>,
    /// "upper" | "lower" | "title".
    #[serde(default)]
    pub case: Option<String>,
    #[serde(rename = "flipX", default)]
    pub flip_x: bool,
    #[serde(rename = "flipY", default)]
    pub flip_y: bool,
    /// Horizontal glyph stretch (0.5–2.0, default 1).
    #[serde(rename = "scaleX", default)]
    pub scale_x: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextStroke {
    /// Stroke width relative to font size (0.005–0.5).
    pub width: f64,
    pub color: String,
    /// Double line: an outer ring plus a thin inner ring separated by `gap`.
    #[serde(default)]
    pub double: bool,
    /// Gap between the two rings, relative to font size (default = width).
    #[serde(default)]
    pub gap: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextRelief {
    /// "emboss" | "engrave" | "letterpress" | "inner-shadow".
    pub mode: String,
    /// Depth relative to font size (0.01–0.3, default 0.06).
    #[serde(default)]
    pub depth: Option<f64>,
    #[serde(default)]
    pub highlight: Option<String>,
    #[serde(default)]
    pub shadow: Option<String>,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextFill {
    /// "gradient" | "foil" | "texture".
    pub mode: String,
    /// Two or more #RRGGBB[A] stops (gradient/foil).
    #[serde(default)]
    pub colors: Vec<String>,
    /// Gradient angle in degrees (default 90 = top→bottom).
    #[serde(default)]
    pub angle: Option<f64>,
    /// Template-package texture asset (texture mode), e.g. `assets/paper.png`.
    #[serde(default)]
    pub texture: Option<String>,
    /// Effect strength 0–1 (default 1).
    #[serde(default)]
    pub intensity: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextShadow {
    #[serde(rename = "offsetX", default)]
    pub offset_x: f64,
    #[serde(rename = "offsetY", default)]
    pub offset_y: f64,
    /// Blur radius relative to font size (0–0.5).
    #[serde(default)]
    pub blur: f64,
    pub color: String,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
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
    /// v0.5.0: explicit stacking order (lower paints first).
    #[serde(default)]
    pub z: Option<i32>,
}

pub(crate) fn default_opacity() -> f64 {
    1.0
}

pub(crate) fn default_background() -> String {
    "#FFFFFF".to_string()
}

/// v0.4.0: primitive shapes for rules, borders, dots and chips.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShapeLayer {
    pub id: String,
    pub anchor: Anchor,
    #[serde(default)]
    pub offset: Offset,
    pub shape: ShapeKind,
    #[serde(default)]
    pub size: ShapeSize,
    pub color: String,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    /// Corner radius for `rect`, relative to min(width,height) (0–0.5).
    #[serde(default)]
    pub radius: Option<f64>,
    /// When set, draw an outline instead of a fill (relative to photo width).
    #[serde(rename = "strokeWidth", default)]
    pub stroke_width: Option<f64>,
    /// Degrees, rotation around the shape center ([-360, 360]).
    #[serde(default)]
    pub rotation: f64,
    /// v0.5.0: draw two parallel lines separated by `gap`.
    #[serde(default)]
    pub double: bool,
    /// v0.5.0: double-line gap, relative to photo height (0–0.2).
    #[serde(default)]
    pub gap: Option<f64>,
    /// v0.5.0: layout frame roles: `outer` (border around the photo),
    /// `opposite-h` (top+bottom edges), `opposite-v` (left+right edges).
    #[serde(default)]
    pub frame: Option<String>,
    /// v0.5.0: frame inset, relative to photo size (0–0.5).
    #[serde(default)]
    pub margin: Option<f64>,
    /// v0.5.0: hide when fewer than two text layers exist (auto divider).
    #[serde(rename = "autoHide", default)]
    pub auto_hide: bool,
    /// v0.5.0: `auto` lets a line span the width between its insets.
    #[serde(default)]
    pub span: Option<String>,
    /// v0.5.0: explicit stacking order (lower paints first).
    #[serde(default)]
    pub z: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShapeKind {
    Line,
    Rect,
    Ellipse,
    Diamond,
    Hexagon,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShapeSize {
    /// Relative to photo width (0–1).
    #[serde(default)]
    pub width: Option<f64>,
    /// Relative to photo height (0–1).
    #[serde(default)]
    pub height: Option<f64>,
}

fn default_palette_count() -> u32 {
    5
}

fn default_chip_shape() -> ChipShape {
    ChipShape::Circle
}

/// v0.4.0: dominant-color chips extracted from the photo (color card).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaletteLayer {
    pub id: String,
    pub anchor: Anchor,
    #[serde(default)]
    pub offset: Offset,
    #[serde(default = "default_palette_count")]
    pub count: u32,
    #[serde(default = "default_chip_shape")]
    pub shape: ChipShape,
    /// "horizontal" (default) | "vertical".
    #[serde(default)]
    pub direction: Option<String>,
    /// Chip size, relative to photo height (default 0.035).
    #[serde(default)]
    pub size: Option<f64>,
    /// Gap between chips, relative to photo height (default = size * 0.35).
    #[serde(default)]
    pub gap: Option<f64>,
    /// Draw the #RRGGBB hex label next to each chip.
    #[serde(rename = "showHex", default)]
    pub show_hex: bool,
    #[serde(default)]
    pub label: Option<PaletteLabel>,
    /// v0.5.0: explicit stacking order (lower paints first).
    #[serde(default)]
    pub z: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChipShape {
    Circle,
    Square,
    Diamond,
    Hexagon,
    Strip,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaletteLabel {
    /// Relative to photo height (default 0.012).
    pub size: f64,
    pub color: String,
    #[serde(default)]
    pub family: Vec<String>,
}

/// v0.5.0 grouping/hierarchy: children are laid out inside the group box.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupLayer {
    pub id: String,
    pub anchor: Anchor,
    #[serde(default)]
    pub offset: Offset,
    /// Group box size, relative to canvas (defaults to the children union).
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    /// Children (1–32), drawn relative to the group box.
    pub children: Vec<Layer>,
    /// v0.5.0: explicit stacking order (lower paints first).
    #[serde(default)]
    pub z: Option<i32>,
}

/// v0.5.0: month calendar layer (best-effort lunar day labels, never invented).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalendarLayer {
    pub id: String,
    pub anchor: Anchor,
    #[serde(default)]
    pub offset: Offset,
    /// Calendar width, relative to canvas width (default 0.3).
    #[serde(default = "default_calendar_size")]
    pub size: f64,
    /// `exif` (default) takes the photo date; `fixed` uses year/month below.
    #[serde(rename = "dateSource", default)]
    pub date_source: Option<String>,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub month: Option<u32>,
    /// Show lunar day numbers under the solar day (default true).
    #[serde(rename = "showLunar", default = "default_true")]
    pub show_lunar: bool,
    /// Show weekday headers (default true).
    #[serde(rename = "showWeekdays", default = "default_true")]
    pub show_weekdays: bool,
    /// Possible values: "month" (default) | "day" | "strip" | "week".
    #[serde(default)]
    pub view: Option<String>,
    /// v0.5.0: binding-edge decoration for the month view (dashed center
    /// crease + evenly spaced top-edge notches), drawn in `color` at low
    /// opacity and kept clear of day glyphs. Default off.
    #[serde(default)]
    pub binding: Option<bool>,
    pub color: Option<String>,
    pub accent: Option<String>,
    #[serde(rename = "fontFamily", default)]
    pub font_family: Vec<String>,
    /// v0.5.0: explicit stacking order (lower paints first).
    #[serde(default)]
    pub z: Option<i32>,
}

fn default_calendar_size() -> f64 {
    0.3
}

fn default_true() -> bool {
    true
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
    /// "blur" | "solid" | "image" | "tint" | "texture" | "none"
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub background_color: Option<String>,
    /// v0.5.0: texture-asset override for `background:"texture"`; resolved like
    /// other asset paths, missing/failed assets fall back to procedural grain.
    #[serde(default)]
    pub texture_asset: Option<String>,
    #[serde(default)]
    pub flip_horizontal: Option<bool>,
    #[serde(default)]
    pub flip_vertical: Option<bool>,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub show_logo: Option<bool>,
    /// v0.5.0: keep output EXIF metadata (default true; GPS still needs
    /// `keepGps`).
    #[serde(default)]
    pub metadata: Option<bool>,
    /// v0.5.0: normalized crop rectangle applied to the photo before layout.
    #[serde(default)]
    pub crop: Option<CropRect>,
    /// v0.5.0: uniform extra canvas margin (0–0.5), additive to
    /// `canvas.padding` in `extend` mode.
    #[serde(default)]
    pub margin: Option<f64>,
    /// v0.5.0: card effect (rounded corners / outer shadow / edge border).
    #[serde(default)]
    pub card: Option<CardOverrides>,
    /// v0.6.0: date localization for `date('LOCAL', ...)` ("zh" | "en").
    #[serde(default)]
    pub date_locale: Option<String>,
    /// v0.6.0: preview-only EXIF values (editor "fill with sample values").
    /// Whitelisted scalar keys; never persisted into the photo.
    #[serde(default)]
    pub exif: Option<serde_json::Map<String, serde_json::Value>>,
}

/// v0.5.0 card effect overrides: rounded corners, outer shadow, edge border and
/// inner shadow applied to the photo card. When `enabled` is `false` the card
/// decoration is removed entirely (template `canvas.radius`/`shadow` are not
/// drawn either).
#[derive(Debug, Clone, Default, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardOverrides {
    #[serde(default)]
    pub enabled: Option<bool>,
    /// Corner radius relative to min(photo width, height), 0–0.25.
    #[serde(default)]
    pub radius: Option<f64>,
    /// Same shape as `canvas.shadow`; `enabled` defaults to true.
    #[serde(default)]
    pub shadow: Option<Shadow>,
    #[serde(default)]
    pub border: Option<CardBorder>,
    /// v0.5.0: inner shadow along the inside of the rounded card edge.
    #[serde(default)]
    pub inner_shadow: Option<InnerShadow>,
}

/// v0.5.0 card inner shadow. `blur` and `offsetX`/`offsetY` are relative to
/// min(photo width, height); the shadow darkens the card interior near the
/// edges, matching the classic inner-shadow look.
#[derive(Debug, Clone, Copy, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct InnerShadow {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Blur radius relative to min(photo width, height), 0–0.5.
    #[serde(default)]
    pub blur: f64,
    #[serde(default)]
    pub opacity: f64,
    #[serde(rename = "offsetX", default)]
    pub offset_x: f64,
    #[serde(rename = "offsetY", default)]
    pub offset_y: f64,
}

/// v0.5.0 card edge border stroke.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct CardBorder {
    /// Stroke width relative to min(photo width, height), 0–0.05.
    pub width: f64,
    pub color: String,
}

/// Normalized photo crop (0–1, origin top-left). `w`/`h` must be > 0.
#[derive(Debug, Clone, Copy, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct CropRect {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_crop_size")]
    pub w: f64,
    #[serde(default = "default_crop_size")]
    pub h: f64,
}

fn default_crop_size() -> f64 {
    1.0
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
            if !matches!(
                b.as_str(),
                "blur" | "solid" | "image" | "tint" | "texture" | "none"
            ) {
                return Err(Error::SchemaViolation(format!(
                    "overrides.background {b:?} must be blur|solid|image|tint|texture|none"
                )));
            }
        }
        if let Some(c) = &self.background_color {
            parse_hex_color(c)?;
        }
        if let Some(asset) = &self.texture_asset {
            if !is_asset_path(asset) {
                return Err(Error::SchemaViolation(format!(
                    "overrides.textureAsset {asset:?} must be @builtin/... or @user/... or assets/..."
                )));
            }
        }
        if let Some(f) = &self.font_family {
            if f.is_empty() || f.chars().count() > 64 {
                return Err(Error::SchemaViolation(
                    "overrides.fontFamily must be 1-64 characters".into(),
                ));
            }
        }
        if let Some(m) = self.margin {
            if !m.is_finite() || !(0.0..=0.5).contains(&m) {
                return Err(Error::SchemaViolation(
                    "overrides.margin must be within [0.0, 0.5]".into(),
                ));
            }
        }
        if let Some(card) = &self.card {
            if let Some(r) = card.radius {
                range_check("overrides.card.radius", r, 0.0, 0.25)?;
            }
            if let Some(shadow) = &card.shadow {
                range_check("overrides.card.shadow.blur", shadow.blur, 0.0, 0.5)?;
                range_check("overrides.card.shadow.opacity", shadow.opacity, 0.0, 1.0)?;
                range_check("overrides.card.shadow.offsetX", shadow.offset_x, -0.5, 0.5)?;
                range_check("overrides.card.shadow.offsetY", shadow.offset_y, -0.5, 0.5)?;
            }
            if let Some(border) = &card.border {
                range_check("overrides.card.border.width", border.width, 0.0, 0.05)?;
                parse_hex_color(&border.color)?;
            }
            if let Some(inner) = &card.inner_shadow {
                range_check("overrides.card.innerShadow.blur", inner.blur, 0.0, 0.5)?;
                range_check(
                    "overrides.card.innerShadow.opacity",
                    inner.opacity,
                    0.0,
                    1.0,
                )?;
                range_check(
                    "overrides.card.innerShadow.offsetX",
                    inner.offset_x,
                    -0.5,
                    0.5,
                )?;
                range_check(
                    "overrides.card.innerShadow.offsetY",
                    inner.offset_y,
                    -0.5,
                    0.5,
                )?;
            }
        }
        if let Some(locale) = &self.date_locale {
            if !matches!(locale.as_str(), "zh" | "en") {
                return Err(Error::SchemaViolation(
                    "overrides.dateLocale must be \"zh\" or \"en\"".into(),
                ));
            }
        }
        if let Some(exif) = &self.exif {
            const MAX_KEYS: usize = 48;
            const MAX_LEN: usize = 256;
            const ALLOWED: [&str; 27] = [
                "make",
                "model",
                "model_pretty",
                "lens",
                "focal",
                "focal_mm",
                "aperture",
                "shutter",
                "iso",
                "datetime",
                "brand_slug",
                "lens_slug",
                "lens_series",
                "film_mode",
                "wb_mode",
                "wb_shift_r",
                "wb_shift_b",
                "grain",
                "color_chrome",
                "chrome_fx_blue",
                "dynamic_range",
                "highlight_tone",
                "shadow_tone",
                "fuji_sharpness",
                "fuji_saturation",
                "fuji_nr",
                "fuji_clarity",
            ];
            if exif.len() > MAX_KEYS {
                return Err(Error::SchemaViolation(format!(
                    "overrides.exif supports at most {MAX_KEYS} keys"
                )));
            }
            for (key, value) in exif {
                if !ALLOWED.contains(&key.as_str()) {
                    return Err(Error::SchemaViolation(format!(
                        "overrides.exif key {key:?} is not supported"
                    )));
                }
                match value {
                    serde_json::Value::String(s) if s.len() <= MAX_LEN => {}
                    serde_json::Value::Number(_) => {}
                    serde_json::Value::Bool(_) => {}
                    _ => {
                        return Err(Error::SchemaViolation(format!(
                            "overrides.exif[{key:?}] must be a short string, number or bool"
                        )))
                    }
                }
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

pub(crate) fn is_semver(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn is_template_id(s: &str) -> bool {
    s.len() >= 3
        && s.len() <= 64
        && s.chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_layer_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
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
    if let Some(asset) = &bg.asset {
        if !is_asset_path(asset) {
            return Err(Error::SchemaViolation(format!(
                "canvas.background.asset {asset:?} must be @builtin/... or @user/... or assets/..."
            )));
        }
    }
    if let Some(blur) = bg.blur {
        range_check("canvas.background.blur", blur, 0.0, 200.0)?;
    }
    if let Some(scale) = bg.scale {
        range_check("canvas.background.scale", scale, 1.0, 4.0)?;
    }
    if let Some(radius) = t.canvas.radius {
        // v0.4.0: fraction of min(photo_w, photo_h) so previews and exports match.
        range_check("canvas.radius", radius, 0.0, 0.25)?;
    }
    if let Some(frame) = &t.canvas.frame {
        if !is_asset_path(&frame.asset) {
            return Err(Error::SchemaViolation(format!(
                "canvas.frame.asset {:?} must be @builtin/... or assets/... within the template package",
                frame.asset
            )));
        }
        if let Some(inset) = frame.inset {
            range_check("canvas.frame.inset", inset, 0.0, 0.3)?;
        }
        if let Some(scale) = frame.scale {
            range_check("canvas.frame.scale", scale, 0.2, 1.5)?;
        }
        if let Some(offset) = &frame.offset {
            range_check("canvas.frame.offset.x", offset.x, -1.0, 1.0)?;
            range_check("canvas.frame.offset.y", offset.y, -1.0, 1.0)?;
        }
        range_check("canvas.frame.rotation", frame.rotation, -360.0, 360.0)?;
    }
    if let Some(shadow) = &t.canvas.shadow {
        // v0.4.0: blur/offsets are fractions of photo height; opacity 0–1.
        range_check("canvas.shadow.blur", shadow.blur, 0.0, 0.5)?;
        range_check("canvas.shadow.opacity", shadow.opacity, 0.0, 1.0)?;
        range_check("canvas.shadow.offsetX", shadow.offset_x, -0.5, 0.5)?;
        range_check("canvas.shadow.offsetY", shadow.offset_y, -0.5, 0.5)?;
    }

    for (i, layer) in t.layers.iter().enumerate() {
        validate_layer(layer, i)?;
    }
    let mut text_ids: std::collections::HashSet<&str> = std::collections::HashSet::new();
    collect_text_ids(&t.layers, &mut text_ids);
    validate_attach_all(&t.layers, &text_ids)?;
    Ok(())
}

fn validate_attach_all(layers: &[Layer], text_ids: &std::collections::HashSet<&str>) -> Result<()> {
    for layer in layers {
        match layer {
            Layer::Image(image) => validate_image_attach(image, text_ids)?,
            Layer::Group(group) => validate_attach_all(&group.children, text_ids)?,
            _ => {}
        }
    }
    Ok(())
}

fn validate_layer(layer: &Layer, i: usize) -> Result<()> {
    let (id, offset) = match layer {
        Layer::Text(text) => (&text.id, text.offset),
        Layer::Image(image) => (&image.id, image.offset),
        Layer::Shape(shape) => (&shape.id, shape.offset),
        Layer::Palette(palette) => (&palette.id, palette.offset),
        Layer::Group(group) => (&group.id, group.offset),
        Layer::Calendar(cal) => (&cal.id, cal.offset),
    };
    if !is_layer_id(id) {
        return Err(Error::SchemaViolation(format!(
            "layers[{i}].id {id:?} must be 1-64 chars of [a-zA-Z0-9-]"
        )));
    }
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
            range_check(&format!("layers[{i}].font.size"), text.font.size, 0.0, 0.5)?;
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
            range_check(
                &format!("layers[{i}].letterSpacing"),
                text.letter_spacing,
                -0.05,
                0.5,
            )?;
            range_check(
                &format!("layers[{i}].rotation"),
                text.rotation,
                -360.0,
                360.0,
            )?;
            range_check(&format!("layers[{i}].opacity"), text.opacity, 0.0, 1.0)?;
            if let Some(align) = &text.align {
                if !matches!(align.as_str(), "left" | "center" | "right") {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].align must be left|center|right"
                    )));
                }
            }
            for feature in &text.features {
                if !matches!(
                    feature.as_str(),
                    "tnum"
                        | "lnum"
                        | "onum"
                        | "pnum"
                        | "smcp"
                        | "c2sc"
                        | "liga"
                        | "kern"
                        | "frac"
                        | "ss01"
                        | "ss02"
                ) {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].features contains unsupported feature {feature:?}"
                    )));
                }
            }
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
            if let Some(w) = text.width {
                range_check(&format!("layers[{i}].width"), w, 0.0, 1.0)?;
                if w <= 0.0 {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].width must be > 0"
                    )));
                }
            }
            if let Some(h) = text.height {
                range_check(&format!("layers[{i}].height"), h, 0.0, 1.0)?;
                if h <= 0.0 {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].height must be > 0"
                    )));
                }
            }
            if let Some(z) = text.z {
                range_check(&format!("layers[{i}].z"), z as f64, -1000.0, 1000.0)?;
            }
            validate_effects(text.effects.as_ref(), i)?;
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
            range_check(&format!("layers[{i}].opacity"), image.opacity, 0.0, 1.0)?;
        }
        Layer::Shape(shape) => {
            parse_hex_color(&shape.color)?;
            range_check(&format!("layers[{i}].opacity"), shape.opacity, 0.0, 1.0)?;
            range_check(
                &format!("layers[{i}].rotation"),
                shape.rotation,
                -360.0,
                360.0,
            )?;
            if let Some(w) = shape.size.width {
                range_check(&format!("layers[{i}].size.width"), w, 0.0, 1.0)?;
            }
            if let Some(h) = shape.size.height {
                range_check(&format!("layers[{i}].size.height"), h, 0.0, 1.0)?;
            }
            if let Some(r) = shape.radius {
                range_check(&format!("layers[{i}].radius"), r, 0.0, 0.5)?;
            }
            if let Some(sw) = shape.stroke_width {
                range_check(&format!("layers[{i}].strokeWidth"), sw, 0.0, 0.2)?;
            }
            if let Some(gap) = shape.gap {
                range_check(&format!("layers[{i}].gap"), gap, 0.0, 0.2)?;
            }
            if let Some(frame) = &shape.frame {
                if !matches!(frame.as_str(), "outer" | "opposite-h" | "opposite-v") {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].frame must be outer|opposite-h|opposite-v"
                    )));
                }
            }
            if let Some(margin) = shape.margin {
                range_check(&format!("layers[{i}].margin"), margin, 0.0, 0.5)?;
            }
            if let Some(span) = &shape.span {
                if span != "auto" {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].span must be \"auto\""
                    )));
                }
            }
            if let Some(z) = shape.z {
                range_check(&format!("layers[{i}].z"), z as f64, -1000.0, 1000.0)?;
            }
        }
        Layer::Palette(palette) => {
            if !(2..=8).contains(&palette.count) {
                return Err(Error::SchemaViolation(format!(
                    "layers[{i}].count must be within [2, 8]"
                )));
            }
            if let Some(direction) = &palette.direction {
                if !matches!(direction.as_str(), "horizontal" | "vertical") {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].direction must be horizontal|vertical"
                    )));
                }
            }
            if let Some(size) = palette.size {
                range_check(&format!("layers[{i}].size"), size, 0.005, 0.3)?;
            }
            if let Some(gap) = palette.gap {
                range_check(&format!("layers[{i}].gap"), gap, 0.0, 0.3)?;
            }
            if let Some(label) = &palette.label {
                range_check(&format!("layers[{i}].label.size"), label.size, 0.005, 0.05)?;
                parse_hex_color(&label.color)?;
                if label.family.len() > 2 {
                    return Err(Error::SchemaViolation(format!(
                        "layers[{i}].label.family must contain at most 2 families"
                    )));
                }
            }
        }
        Layer::Group(group) => validate_group(group, i)?,
        Layer::Calendar(cal) => validate_calendar(cal, i)?,
    }
    Ok(())
}

fn validate_group(group: &GroupLayer, i: usize) -> Result<()> {
    if group.children.is_empty() || group.children.len() > 32 {
        return Err(Error::SchemaViolation(format!(
            "layers[{i}].children must contain 1-32 items"
        )));
    }
    for child in &group.children {
        validate_layer(child, i)?;
    }
    if let Some(w) = group.width {
        range_check(&format!("layers[{i}].width"), w, 0.0, 1.0)?;
    }
    if let Some(h) = group.height {
        range_check(&format!("layers[{i}].height"), h, 0.0, 1.0)?;
    }
    range_check(&format!("layers[{i}].opacity"), group.opacity, 0.0, 1.0)?;
    Ok(())
}

fn validate_calendar(cal: &CalendarLayer, i: usize) -> Result<()> {
    range_check(&format!("layers[{i}].size"), cal.size, 0.05, 0.6)?;
    if let Some(source) = &cal.date_source {
        if !matches!(source.as_str(), "exif" | "fixed") {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].dateSource must be exif|fixed"
            )));
        }
    }
    if let Some(year) = cal.year {
        if !(1900..=2100).contains(&year) {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].year must be within [1900, 2100]"
            )));
        }
    }
    if let Some(month) = cal.month {
        if !(1..=12).contains(&month) {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].month must be within [1, 12]"
            )));
        }
    }
    if let Some(view) = &cal.view {
        if !matches!(view.as_str(), "month" | "day" | "strip" | "week") {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].view must be month|day|strip|week"
            )));
        }
    }
    if let Some(color) = &cal.color {
        parse_hex_color(color)?;
    }
    if let Some(accent) = &cal.accent {
        parse_hex_color(accent)?;
    }
    if cal.font_family.len() > 2 {
        return Err(Error::SchemaViolation(format!(
            "layers[{i}].fontFamily must contain at most 2 families"
        )));
    }
    Ok(())
}

fn validate_image_attach(
    image: &ImageLayer,
    text_ids: &std::collections::HashSet<&str>,
) -> Result<()> {
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
    Ok(())
}

fn collect_text_ids<'a>(layers: &'a [Layer], out: &mut std::collections::HashSet<&'a str>) {
    for layer in layers {
        match layer {
            Layer::Text(text) => {
                out.insert(text.id.as_str());
            }
            Layer::Group(group) => collect_text_ids(&group.children, out),
            _ => {}
        }
    }
}

fn validate_exprs(layers: &[Layer]) -> Result<()> {
    for layer in layers {
        match layer {
            Layer::Text(text) => {
                for item in &text.content {
                    sandbox::validate_expr(&item.expr)?;
                }
            }
            Layer::Group(group) => validate_exprs(&group.children)?,
            _ => {}
        }
    }
    Ok(())
}

fn validate_effects(effects: Option<&TextEffects>, i: usize) -> Result<()> {
    let Some(effects) = effects else {
        return Ok(());
    };
    if let Some(stroke) = &effects.stroke {
        range_check(
            &format!("layers[{i}].effects.stroke.width"),
            stroke.width,
            0.005,
            0.5,
        )?;
        parse_hex_color(&stroke.color)?;
        if let Some(gap) = stroke.gap {
            range_check(&format!("layers[{i}].effects.stroke.gap"), gap, 0.0, 0.5)?;
        }
    }
    if let Some(relief) = &effects.relief {
        if !matches!(
            relief.mode.as_str(),
            "emboss" | "engrave" | "letterpress" | "inner-shadow"
        ) {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].effects.relief.mode must be emboss|engrave|letterpress|inner-shadow"
            )));
        }
        if let Some(depth) = relief.depth {
            range_check(
                &format!("layers[{i}].effects.relief.depth"),
                depth,
                0.01,
                0.3,
            )?;
        }
        if let Some(color) = &relief.highlight {
            parse_hex_color(color)?;
        }
        if let Some(color) = &relief.shadow {
            parse_hex_color(color)?;
        }
        range_check(
            &format!("layers[{i}].effects.relief.opacity"),
            relief.opacity,
            0.0,
            1.0,
        )?;
    }
    if let Some(fill) = &effects.fill {
        if !matches!(fill.mode.as_str(), "gradient" | "foil" | "texture") {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].effects.fill.mode must be gradient|foil|texture"
            )));
        }
        if fill.colors.len() > 8 {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].effects.fill.colors must contain at most 8 stops"
            )));
        }
        for color in &fill.colors {
            parse_hex_color(color)?;
        }
        if fill.mode != "texture" && fill.colors.len() < 2 {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].effects.fill.colors needs at least 2 stops for gradient/foil"
            )));
        }
        if let Some(texture) = &fill.texture {
            if !is_asset_path(texture) {
                return Err(Error::SchemaViolation(format!(
                    "layers[{i}].effects.fill.texture must be @builtin/... or assets/..."
                )));
            }
        }
        if let Some(angle) = fill.angle {
            range_check(
                &format!("layers[{i}].effects.fill.angle"),
                angle,
                -360.0,
                360.0,
            )?;
        }
        if let Some(intensity) = fill.intensity {
            range_check(
                &format!("layers[{i}].effects.fill.intensity"),
                intensity,
                0.0,
                1.0,
            )?;
        }
    }
    if let Some(shadow) = &effects.shadow {
        range_check(
            &format!("layers[{i}].effects.shadow.offsetX"),
            shadow.offset_x,
            -0.5,
            0.5,
        )?;
        range_check(
            &format!("layers[{i}].effects.shadow.offsetY"),
            shadow.offset_y,
            -0.5,
            0.5,
        )?;
        range_check(
            &format!("layers[{i}].effects.shadow.blur"),
            shadow.blur,
            0.0,
            0.5,
        )?;
        parse_hex_color(&shadow.color)?;
        range_check(
            &format!("layers[{i}].effects.shadow.opacity"),
            shadow.opacity,
            0.0,
            1.0,
        )?;
    }
    if let Some(case) = &effects.case {
        if !matches!(case.as_str(), "upper" | "lower" | "title") {
            return Err(Error::SchemaViolation(format!(
                "layers[{i}].effects.case must be upper|lower|title"
            )));
        }
    }
    if let Some(scale) = effects.scale_x {
        range_check(&format!("layers[{i}].effects.scaleX"), scale, 0.5, 2.0)?;
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
    validate_exprs(&template.layers)?;
    Ok(template)
}

pub fn load_template(json: &[u8]) -> Result<Template> {
    let s = std::str::from_utf8(json).map_err(|e| Error::TemplateJson(e.to_string()))?;
    load_template_from_str(s)
}
