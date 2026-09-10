use std::path::PathBuf;

use ab_glyph::PxScale;
use image::{GenericImage, ImageBuffer, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;

use crate::exif::{cleaned_exif_tiff_full, probe_exif, ExifInfo};
use crate::sandbox::eval_expr;
use crate::template::{
    Anchor, BgKind, CanvasMode, ImageLayer, Layer, Template, TemplateOverrides, TextLayer,
};
use crate::text::FontBook;
use crate::{encode, Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Jpeg,
    Png,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sampling {
    Preview,
    Full,
}

#[derive(Debug, Clone)]
pub struct RenderOptions {
    pub format: OutputFormat,
    pub sampling: Sampling,
    pub assets_dir: Option<PathBuf>,
    /// In-memory asset map (v0.2.0): resolved image bytes for image layers /
    /// backgrounds, e.g. keys "@user/logo", "@user/background",
    /// "@builtin/brand/sony". Takes precedence over assets_dir.
    pub assets: Option<std::collections::HashMap<String, Vec<u8>>>,
    pub fonts: Option<crate::text::FontBook>,
    pub model_map: Option<crate::model_map::ModelMap>,
    pub write_exif: bool,
    pub keep_gps: bool,
    /// Maximum output edge (px). None = full resolution (export path).
    /// Preview uses Some(n); A5: same render code, only this scale differs.
    pub max_edge: Option<u32>,
    /// User-side overrides (T4.4 + v0.2.0): font/padding/color/aspect/…
    pub overrides: Option<TemplateOverrides>,
}

impl Default for RenderOptions {
    fn default() -> Self {
        RenderOptions {
            format: OutputFormat::Jpeg,
            sampling: Sampling::Full,
            assets_dir: None,
            assets: None,
            fonts: None,
            model_map: None,
            write_exif: true,
            keep_gps: false,
            max_edge: None,
            overrides: None,
        }
    }
}

/// Load the optional model-map override from `<assets_dir>/model-map.json`.
pub fn load_model_map(assets_dir: &std::path::Path) -> Result<Option<crate::model_map::ModelMap>> {
    let path = assets_dir.join("model-map.json");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)?;
    Ok(Some(crate::model_map::ModelMap::from_json(&bytes)?))
}

pub(crate) fn apply_model_map(info: &mut ExifInfo, map: &Option<crate::model_map::ModelMap>) {
    if let (Some(map), Some(model)) = (map, info.model.as_deref()) {
        if let Some(pretty) = map.resolve(model) {
            info.model_pretty = Some(pretty);
        }
    }
}

pub(crate) fn filter(sampling: Sampling) -> image::imageops::FilterType {
    match sampling {
        Sampling::Preview => image::imageops::FilterType::Triangle,
        Sampling::Full => image::imageops::FilterType::Lanczos3,
    }
}

fn resize_to_cover(src: &RgbaImage, target_w: u32, target_h: u32, filt: image::imageops::FilterType) -> RgbaImage {
    let (w, h) = src.dimensions();
    let scale = (target_w as f64 / w as f64).max(target_h as f64 / h as f64);
    let nw = ((w as f64) * scale).ceil().max(1.0) as u32;
    let nh = ((h as f64) * scale).ceil().max(1.0) as u32;
    image::imageops::resize(src, nw, nh, filt)
}

fn center_crop(src: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    let (sw, sh) = src.dimensions();
    let x = sw.saturating_sub(w) / 2;
    let y = sh.saturating_sub(h) / 2;
    image::imageops::crop_imm(src, x, y, w.min(sw), h.min(sh)).to_image()
}

/// Separable box blur (3 passes), deterministic approximation of a Gaussian.
fn box_blur_rgba(src: &RgbaImage, radius: u32) -> RgbaImage {
    if radius == 0 {
        return src.clone();
    }
    let mut current = src.clone();
    for _ in 0..3 {
        current = box_blur_pass(&current, radius);
    }
    current
}

fn box_blur_pass(src: &RgbaImage, radius: u32) -> RgbaImage {
    let (w, h) = src.dimensions();
    let r = radius as i64;
    let (mut tmp, mut out) = (src.clone(), src.clone());
    for y in 0..h {
        let mut acc = [0f64; 4];
        let mut count = 0f64;
        for dx in -r..=r {
            let sx = (dx).clamp(0, w as i64 - 1) as u32;
            let p = src.get_pixel(sx, y).0;
            for c in 0..4 {
                acc[c] += p[c] as f64;
            }
            count += 1.0;
        }
        for x in 0..w {
            let mut px = [0u8; 4];
            for c in 0..4 {
                px[c] = (acc[c] / count) as u8;
            }
            tmp.put_pixel(x, y, Rgba(px));
            let add_x = (x as i64 + r + 1).clamp(0, w as i64 - 1) as u32;
            let sub_x = (x as i64 - r).clamp(0, w as i64 - 1) as u32;
            let pa = src.get_pixel(add_x, y).0;
            let ps = src.get_pixel(sub_x, y).0;
            for c in 0..4 {
                acc[c] += pa[c] as f64 - ps[c] as f64;
            }
        }
    }
    for x in 0..w {
        let mut acc = [0f64; 4];
        let mut count = 0f64;
        for dy in -r..=r {
            let sy = (dy).clamp(0, h as i64 - 1) as u32;
            let p = tmp.get_pixel(x, sy).0;
            for c in 0..4 {
                acc[c] += p[c] as f64;
            }
            count += 1.0;
        }
        for y in 0..h {
            let mut px = [0u8; 4];
            for c in 0..4 {
                px[c] = (acc[c] / count) as u8;
            }
            out.put_pixel(x, y, Rgba(px));
            let add_y = (y as i64 + r + 1).clamp(0, h as i64 - 1) as u32;
            let sub_y = (y as i64 - r).clamp(0, h as i64 - 1) as u32;
            let pa = tmp.get_pixel(x, add_y).0;
            let ps = tmp.get_pixel(x, sub_y).0;
            for c in 0..4 {
                acc[c] += pa[c] as f64 - ps[c] as f64;
            }
        }
    }
    out
}

#[derive(Clone, Copy)]
struct CanvasGeometry {
    width: u32,
    height: u32,
    pad_left: u32,
    pad_top: u32,
    photo_h: u32,
}

fn compute_geometry(t: &Template, photo: &RgbaImage, overrides: Option<&TemplateOverrides>) -> CanvasGeometry {
    let (w, h) = photo.dimensions();
    let pad_scale = overrides.map(|o| o.padding_scale()).unwrap_or(1.0);
    let (pad_left, pad_top, pad_right, pad_bottom) = match t.canvas.mode {
        CanvasMode::Extend => {
            let p = &t.canvas.padding;
            let clamp01 = |v: f64| (v * pad_scale).clamp(0.0, 1.0);
            (
                (clamp01(p.left) * w as f64).round() as u32,
                (clamp01(p.top) * h as f64).round() as u32,
                (clamp01(p.right) * w as f64).round() as u32,
                (clamp01(p.bottom) * h as f64).round() as u32,
            )
        }
        CanvasMode::Overlay | CanvasMode::Cover => (0, 0, 0, 0),
    };
    CanvasGeometry {
        width: w + pad_left + pad_right,
        height: h + pad_top + pad_bottom,
        pad_left,
        pad_top,
        photo_h: h,
    }
}

#[derive(Clone)]
struct BgPlan {
    kind: BgKind,
    color: Option<String>,
    blur: Option<f64>,
    scale: Option<f64>,
    asset: Option<String>,
}

fn bg_plan(t: &Template, overrides: Option<&TemplateOverrides>) -> BgPlan {
    let mut plan = BgPlan {
        kind: t.canvas.background.kind,
        color: t.canvas.background.color.clone(),
        blur: t.canvas.background.blur,
        scale: t.canvas.background.scale,
        asset: t.canvas.background.asset.clone(),
    };
    if let Some(o) = overrides {
        if let Some(b) = &o.background {
            plan.kind = match b.as_str() {
                "blur" => BgKind::Blur,
                "solid" => BgKind::Solid,
                "image" => BgKind::Image,
                _ => BgKind::None,
            };
        }
        if let Some(c) = &o.background_color {
            plan.color = Some(c.clone());
        }
    }
    plan
}

/// Resolve image bytes for an asset path: in-memory map first, then
/// `assets_dir` (builtin brand/@user/, package-relative `assets/`).
#[allow(clippy::question_mark)]
fn resolve_asset_bytes(opts: &RenderOptions, path: &str) -> Option<Vec<u8>> {
    if let Some(map) = &opts.assets {
        if let Some(bytes) = map.get(path) {
            return Some(bytes.clone());
        }
    }
    let dir = opts.assets_dir.as_ref()?;
    let (base, rel) = if let Some(rel) = path.strip_prefix("@builtin/") {
        (dir.join("brand"), rel.to_string())
    } else if let Some(rel) = path.strip_prefix("@user/") {
        (dir.join("user"), rel.to_string())
    } else if let Some(rel) = path.strip_prefix("assets/") {
        (dir.clone(), rel.to_string())
    } else {
        return None;
    };
    let candidate = base.join(&rel);
    if candidate.is_file() {
        return std::fs::read(candidate).ok();
    }
    let with_png = base.join(format!("{rel}.png"));
    if with_png.is_file() {
        return std::fs::read(with_png).ok();
    }
    None
}

fn fill_solid(canvas: &mut RgbaImage, color: Option<&str>) {
    let c = color
        .and_then(|c| crate::template::parse_hex_color(c).ok())
        .unwrap_or([255u8, 255, 255, 255]);
    for px in canvas.pixels_mut() {
        *px = Rgba(c);
    }
}

fn build_canvas(
    geo: &CanvasGeometry,
    photo: &RgbaImage,
    t: &Template,
    plan: &BgPlan,
    opts: &RenderOptions,
    filt: image::imageops::FilterType,
) -> RgbaImage {
    let mut canvas = ImageBuffer::new(geo.width, geo.height);
    match (t.canvas.mode, plan.kind) {
        (CanvasMode::Overlay, _) | (_, BgKind::None) | (CanvasMode::Cover, _) => {
            canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
        }
        (CanvasMode::Extend, BgKind::Solid) => {
            fill_solid(&mut canvas, plan.color.as_deref());
            canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
        }
        (CanvasMode::Extend, BgKind::Blur) => {
            let bg_scale = plan.scale.unwrap_or(1.2);
            let tw = ((geo.width as f64) * bg_scale).ceil().max(1.0) as u32;
            let th = ((geo.height as f64) * bg_scale).ceil().max(1.0) as u32;
            let scaled = resize_to_cover(photo, tw, th, filt);
            let radius = ((plan.blur.unwrap_or(40.0) as u32) / 3).max(1);
            let blurred = box_blur_rgba(&scaled, radius);
            let cover = center_crop(&blurred, geo.width, geo.height);
            canvas.copy_from(&cover, 0, 0).ok();
            canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
        }
        (CanvasMode::Extend, BgKind::Image) => {
            let bytes = plan
                .asset
                .as_deref()
                .and_then(|a| resolve_asset_bytes(opts, a))
                .or_else(|| resolve_asset_bytes(opts, "@user/background"));
            let mut covered = false;
            if let Some(bytes) = bytes {
                if let Ok(bg_img) = image::load_from_memory(&bytes) {
                    let rgba = bg_img.to_rgba8();
                    let fitted = resize_to_cover(&rgba, geo.width, geo.height, filt);
                    canvas.copy_from(&center_crop(&fitted, geo.width, geo.height), 0, 0).ok();
                    covered = true;
                }
            }
            if !covered {
                fill_solid(&mut canvas, plan.color.as_deref());
            }
            canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
        }
    }
    canvas
}

/// Expand the canvas to a target aspect ratio (W:H), centering the existing
/// content and filling the margins with the background plan (PRD C7).
fn expand_to_aspect(
    base: RgbaImage,
    photo: &RgbaImage,
    plan: &BgPlan,
    opts: &RenderOptions,
    target: (u32, u32),
    filt: image::imageops::FilterType,
) -> RgbaImage {
    let (w, h) = base.dimensions();
    let cur = w as f64 / h as f64;
    let tgt = target.0 as f64 / target.1 as f64;
    if (cur - tgt).abs() < 0.002 {
        return base;
    }
    let (nw, nh) = if cur < tgt {
        (((h as f64) * tgt).ceil() as u32, h)
    } else {
        (w, ((w as f64) / tgt).ceil() as u32)
    };
    let mut canvas = ImageBuffer::new(nw, nh);
    match plan.kind {
        BgKind::Blur => {
            let bg_scale = plan.scale.unwrap_or(1.2);
            let tw = ((nw as f64) * bg_scale).ceil().max(1.0) as u32;
            let th = ((nh as f64) * bg_scale).ceil().max(1.0) as u32;
            let scaled = resize_to_cover(photo, tw, th, filt);
            let radius = ((plan.blur.unwrap_or(40.0) as u32) / 3).max(1);
            let blurred = box_blur_rgba(&scaled, radius);
            canvas.copy_from(&center_crop(&blurred, nw, nh), 0, 0).ok();
        }
        BgKind::Image => {
            let bytes = plan
                .asset
                .as_deref()
                .and_then(|a| resolve_asset_bytes(opts, a))
                .or_else(|| resolve_asset_bytes(opts, "@user/background"));
            let mut covered = false;
            if let Some(bytes) = bytes {
                if let Ok(bg_img) = image::load_from_memory(&bytes) {
                    let rgba = bg_img.to_rgba8();
                    let fitted = resize_to_cover(&rgba, nw, nh, filt);
                    canvas.copy_from(&center_crop(&fitted, nw, nh), 0, 0).ok();
                    covered = true;
                }
            }
            if !covered {
                fill_solid(&mut canvas, plan.color.as_deref());
            }
        }
        BgKind::None => {}
        BgKind::Solid => fill_solid(&mut canvas, plan.color.as_deref()),
    }
    let x = (nw.saturating_sub(w)) / 2;
    let y = (nh.saturating_sub(h)) / 2;
    canvas.copy_from(&base, x, y).ok();
    canvas
}

fn text_lines(layer: &TextLayer, info: &ExifInfo) -> Vec<String> {
    layer
        .content
        .iter()
        .filter_map(|item| eval_expr(&item.expr, info).or_else(|| item.fallback.clone()))
        .filter(|s| !s.is_empty())
        .collect()
}

fn measure_text(
    font: &ab_glyph::FontArc,
    scale: PxScale,
    text: &str,
) -> (u32, u32) {
    imageproc::drawing::text_size(scale, font, text)
}

/// Layout of a drawn text layer's first line (for attached logo placement).
#[derive(Debug, Clone, Copy)]
struct TextLayout {
    first_line_x: f32,
    first_line_y: f32,
    first_line_h: f32,
}

fn draw_text_layer(
    canvas: &mut RgbaImage,
    layer: &TextLayer,
    info: &ExifInfo,
    fonts: &FontBook,
    geo: &CanvasGeometry,
    overrides: Option<&TemplateOverrides>,
) -> Option<TextLayout> {
    let lines = text_lines(layer, info);
    if lines.is_empty() {
        return None;
    }
    let mut families = layer.font.family.clone();
    if let Some(f) = overrides.and_then(|o| o.font_family.as_deref()) {
        families.insert(0, f.to_string());
    }
    let font = fonts.pick(&families)?;
    let font_scale = overrides.map(|o| o.font_size_scale()).unwrap_or(1.0);
    let size_px = (layer.font.size * font_scale * geo.photo_h as f64) as f32;
    let scale = PxScale::from(size_px);
    let color = match overrides.and_then(|o| o.text_color.as_deref()) {
        Some(c) => crate::template::parse_hex_color(c).unwrap_or([0, 0, 0, 255]),
        None => crate::template::parse_hex_color(&layer.font.color).unwrap_or([0, 0, 0, 255]),
    };
    let line_h = size_px * layer.line_height as f32;
    let sizes: Vec<(f32, f32)> = lines
        .iter()
        .map(|l| {
            let (w, h) = measure_text(font, scale, l);
            (w as f32, h as f32)
        })
        .collect();
    let total_h = line_h * (lines.len() as f32 - 1.0) + sizes[sizes.len() - 1].1;
    let w = geo.width as f32;
    let h = geo.height as f32;

    let align_left = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft
    );
    let align_center = matches!(
        layer.anchor,
        Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter
    );
    let from_top = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight
    );
    let from_middle = matches!(
        layer.anchor,
        Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight
    );

    let off_x = layer.offset.x as f32 * w;
    let off_y = layer.offset.y as f32 * h;
    let base_y = if from_top {
        off_y
    } else if from_middle {
        (h - total_h) / 2.0 + off_y
    } else {
        h + off_y - total_h
    };

    let mut first_line: Option<TextLayout> = None;
    for (i, line) in lines.iter().enumerate() {
        let (lw, _lh) = sizes[i];
        let x = if align_left {
            off_x
        } else if align_center {
            (w - lw) / 2.0 + off_x
        } else {
            w + off_x - lw
        };
        let y = base_y + line_h * i as f32;
        if i == 0 {
            first_line = Some(TextLayout {
                first_line_x: x,
                first_line_y: y,
                first_line_h: sizes[0].1,
            });
        }
        draw_text_mut(
            canvas,
            Rgba(color),
            x.round() as i32,
            y.round() as i32,
            scale,
            font,
            line,
        );
    }
    first_line
}

/// Draw an image layer (brand badge / user asset). Returns silently when the
/// asset is missing (blank slot, no fake icon — v0.2.0 decision).
#[allow(clippy::question_mark)]
fn draw_image_layer(
    canvas: &mut RgbaImage,
    layer: &ImageLayer,
    info: &ExifInfo,
    geo: &CanvasGeometry,
    opts: &RenderOptions,
    text_layouts: &std::collections::HashMap<String, TextLayout>,
) {
    if opts.overrides.as_ref().and_then(|o| o.show_logo) == Some(false) {
        let is_brand = layer.asset.starts_with("@builtin/brand/")
            || layer.asset.starts_with("@builtin/lens/");
        if is_brand {
            return;
        }
    }
    let Some(path) = crate::template::eval_asset_path(&layer.asset, info) else {
        return;
    };
    let Some(bytes) = resolve_asset_bytes(opts, &path) else {
        return;
    };
    let Ok(img) = image::load_from_memory(&bytes) else {
        return;
    };
    let rgba = img.to_rgba8();
    let (iw, ih) = rgba.dimensions();
    if iw == 0 || ih == 0 {
        return;
    }
    let photo_h = geo.photo_h as f64;
    let target_h = layer
        .size
        .height
        .map(|h| (h * photo_h).round().max(2.0))
        .or_else(|| layer.size.width.map(|w| (w * geo.photo_h as f64).round().max(2.0) * ih as f64 / iw as f64));
    let scale = target_h.unwrap_or(0.03 * photo_h) / ih as f64;
    let tw = ((iw as f64) * scale).round().max(2.0) as u32;
    let th = ((ih as f64) * scale).round().max(2.0) as u32;
    let fitted = image::imageops::resize(&rgba, tw, th, image::imageops::FilterType::Lanczos3);

    let (ix, iy) = if let Some(target_id) = &layer.attach_to {
        let Some(tl) = text_layouts.get(target_id) else {
            return;
        };
        let gap = (layer.attach_gap.unwrap_or(0.01) * photo_h) as f32;
        let x = tl.first_line_x - gap - tw as f32;
        let y = tl.first_line_y + (tl.first_line_h - th as f32) / 2.0;
        (x.round() as i32, y.round() as i32)
    } else {
        let w = geo.width as f32;
        let h = geo.height as f32;
        let align_left = matches!(layer.anchor, Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft);
        let align_center = matches!(layer.anchor, Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter);
        let from_top = matches!(layer.anchor, Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight);
        let from_middle = matches!(layer.anchor, Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight);
        let off_x = layer.offset.x as f32 * w;
        let off_y = layer.offset.y as f32 * h;
        let x = if align_left {
            off_x
        } else if align_center {
            (w - tw as f32) / 2.0 + off_x
        } else {
            w + off_x - tw as f32
        };
        let y = if from_top {
            off_y
        } else if from_middle {
            (h - th as f32) / 2.0 + off_y
        } else {
            h + off_y - th as f32
        };
        (x.round() as i32, y.round() as i32)
    };

    let opacity = layer.opacity.clamp(0.0, 1.0) as f32;
    for (x, y, p) in fitted.enumerate_pixels() {
        let dx = ix + x as i32;
        let dy = iy + y as i32;
        if dx < 0 || dy < 0 || dx >= geo.width as i32 || dy >= geo.height as i32 {
            continue;
        }
        let src = p.0;
        let a = (src[3] as f32 * opacity) as u8;
        if a == 0 {
            continue;
        }
        let dst = canvas.get_pixel(dx as u32, dy as u32).0;
        let af = a as f32 / 255.0;
        let inv = 1.0 - af;
        let blended = [
            (src[0] as f32 * af + dst[0] as f32 * inv) as u8,
            (src[1] as f32 * af + dst[1] as f32 * inv) as u8,
            (src[2] as f32 * af + dst[2] as f32 * inv) as u8,
            dst[3].max(a),
        ];
        canvas.put_pixel(dx as u32, dy as u32, Rgba(blended));
    }
}

/// Decode photo bytes, apply EXIF orientation + optional flips, optionally cap
/// the longest edge (preview path). Shared by frame and collage rendering.
pub(crate) fn decode_oriented(
    photo: &[u8],
    max_edge: Option<u32>,
    flip_h: bool,
    flip_v: bool,
) -> Result<RgbaImage> {
    let mut img = image::load_from_memory(photo)?;
    let ori_raw = probe_exif(photo)?.orientation.unwrap_or(1);
    let ori = match ori_raw {
        2 => image::metadata::Orientation::FlipHorizontal,
        3 => image::metadata::Orientation::Rotate180,
        4 => image::metadata::Orientation::FlipVertical,
        5 => image::metadata::Orientation::Rotate90,
        6 => image::metadata::Orientation::Rotate90,
        7 => image::metadata::Orientation::Rotate270,
        8 => image::metadata::Orientation::Rotate270,
        _ => image::metadata::Orientation::NoTransforms,
    };
    img.apply_orientation(ori);
    if flip_h {
        img = img.fliph();
    }
    if flip_v {
        img = img.flipv();
    }
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    match max_edge {
        Some(cap) if w.max(h) > cap => {
            let scale = cap as f64 / w.max(h) as f64;
            let nw = ((w as f64) * scale).ceil().max(1.0) as u32;
            let nh = ((h as f64) * scale).ceil().max(1.0) as u32;
            Ok(image::imageops::resize(&rgba, nw, nh, image::imageops::FilterType::Triangle))
        }
        _ => Ok(rgba),
    }
}

/// Flatten RGBA over white, dropping alpha (JPEG has no alpha channel).
fn flatten_over_white(img: &RgbaImage) -> RgbaImage {
    let mut out = img.clone();
    for px in out.pixels_mut() {
        let [r, g, b, a] = px.0;
        if a < 255 {
            let af = a as f64 / 255.0;
            let inv = 1.0 - af;
            px.0 = [
                (r as f64 * af + 255.0 * inv) as u8,
                (g as f64 * af + 255.0 * inv) as u8,
                (b as f64 * af + 255.0 * inv) as u8,
                255,
            ];
        }
    }
    out
}

fn flip_flags(opts: &RenderOptions) -> (bool, bool) {
    let o = opts.overrides.as_ref();
    (
        o.and_then(|o| o.flip_horizontal).unwrap_or(false),
        o.and_then(|o| o.flip_vertical).unwrap_or(false),
    )
}

/// Render a photo against a template into an RGBA canvas. Preview and export
/// share this exact code path; only `RenderOptions.max_edge`/`sampling`
/// differ (PRD A5).
pub fn render_rgba(
    photo: &[u8],
    template: &Template,
    opts: &RenderOptions,
) -> Result<RgbaImage> {
    let (fh, fv) = flip_flags(opts);
    let rgba = decode_oriented(photo, opts.max_edge, fh, fv)?;
    let mut info = probe_exif(photo)?;
    apply_model_map(&mut info, &opts.model_map);
    render_rgba_with_image(&rgba, template, &info, opts)
}

/// Same as `render_rgba` but for an already-decoded (and already flipped)
/// image; used by the Web/Desktop preview raw path.
pub fn render_rgba_with_image(
    rgba: &RgbaImage,
    template: &Template,
    info: &ExifInfo,
    opts: &RenderOptions,
) -> Result<RgbaImage> {
    let overrides = opts.overrides.as_ref();
    let geo = compute_geometry(template, rgba, overrides);
    let filt = filter(opts.sampling);
    let plan = bg_plan(template, overrides);
    let base = build_canvas(&geo, rgba, template, &plan, opts, filt);
    let (mut canvas, geo) = match overrides.and_then(|o| o.aspect.as_deref()) {
        Some(name) => match crate::template::aspect_ratio(name) {
            Some(target) => {
                let expanded = expand_to_aspect(base, rgba, &plan, opts, target, filt);
                let (w2, h2) = expanded.dimensions();
                (
                    expanded,
                    CanvasGeometry {
                        width: w2,
                        height: h2,
                        ..geo
                    },
                )
            }
            None => (base, geo),
        },
        None => (base, geo),
    };
    let fonts = match &opts.fonts {
        Some(book) => book.clone(),
        None => match &opts.assets_dir {
            Some(dir) => FontBook::load(&dir.join("fonts"))?,
            None => FontBook::empty(),
        },
    };
    let mut text_layouts: std::collections::HashMap<String, TextLayout> =
        std::collections::HashMap::new();
    for layer in &template.layers {
        if let Layer::Text(text) = layer {
            if let Some(layout) =
                draw_text_layer(&mut canvas, text, info, &fonts, &geo, overrides)
            {
                text_layouts.insert(text.id.clone(), layout);
            }
        }
    }
    for layer in &template.layers {
        if let Layer::Image(image) = layer {
            draw_image_layer(&mut canvas, image, info, &geo, opts, &text_layouts);
        }
    }
    Ok(canvas)
}

/// Raw-encode path: caller supplies decoded RGBA bytes (orientation already
/// applied) plus optional original file bytes for EXIF text + write-back.
pub fn render_from_rgba(
    photo_bytes: Option<&[u8]>,
    rgba: &[u8],
    width: u32,
    height: u32,
    template: &Template,
    opts: &RenderOptions,
) -> Result<(Vec<u8>, Option<crate::exif::MetadataReport>)> {
    let mut img = RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| Error::Image(format!("rgba buffer size mismatch for {width}x{height}")))?;
    let (fh, fv) = flip_flags(opts);
    if fh {
        img = image::imageops::flip_horizontal(&img);
    }
    if fv {
        img = image::imageops::flip_vertical(&img);
    }
    let mut info = match photo_bytes {
        Some(b) => probe_exif(b)?,
        None => ExifInfo::default(),
    };
    apply_model_map(&mut info, &opts.model_map);
    let canvas = render_rgba_with_image(&img, template, &info, opts)?;
    encode_output(&canvas, photo_bytes, opts)
}

/// Full render pipeline: decode -> render -> encode -> metadata write-back.
pub fn render(photo: &[u8], template: &Template, opts: &RenderOptions) -> Result<Vec<u8>> {
    Ok(render_with_report(photo, template, opts)?.0)
}

/// Same as `render` but also returns the PRD B3 metadata cleanup report.
pub fn render_with_report(
    photo: &[u8],
    template: &Template,
    opts: &RenderOptions,
) -> Result<(Vec<u8>, Option<crate::exif::MetadataReport>)> {
    let canvas = render_rgba(photo, template, opts)?;
    encode_output(&canvas, Some(photo), opts)
}

/// Encode an RGBA canvas with the configured format + metadata write-back.
pub(crate) fn encode_output(
    canvas: &RgbaImage,
    photo: Option<&[u8]>,
    opts: &RenderOptions,
) -> Result<(Vec<u8>, Option<crate::exif::MetadataReport>)> {
    let (cw, ch) = canvas.dimensions();
    match opts.format {
        OutputFormat::Jpeg => {
            let flat = flatten_over_white(canvas);
            let mut out = encode::encode_jpeg_quality100(&flat)?;
            let report = if opts.write_exif {
                match photo {
                    Some(bytes) => match cleaned_exif_tiff_full(bytes, Some((cw, ch)), opts.keep_gps)? {
                        Some((tiff, report)) => {
                            encode::splice_exif_app1(&mut out, &tiff)?;
                            Some(report)
                        }
                        None => None,
                    },
                    None => None,
                }
            } else {
                None
            };
            Ok((out, report))
        }
        OutputFormat::Png => {
            let mut out = encode::encode_png(canvas)?;
            let report = if opts.write_exif {
                match photo {
                    Some(bytes) => match cleaned_exif_tiff_full(bytes, Some((cw, ch)), opts.keep_gps)? {
                        Some((tiff, report)) => {
                            encode::splice_png_exif(&mut out, &tiff)?;
                            Some(report)
                        }
                        None => None,
                    },
                    None => None,
                }
            } else {
                None
            };
            Ok((out, report))
        }
    }
}
