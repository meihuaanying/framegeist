use std::path::PathBuf;

use ab_glyph::{Font, PxScale, ScaleFont};
use image::{GenericImage, ImageBuffer, Rgba, RgbaImage};
use imageproc::geometric_transformations::{rotate_about_center, Interpolation};

use crate::exif::{cleaned_exif_tiff_full, probe_exif, ExifInfo};
use crate::sandbox::eval_expr;
use crate::template::{
    Anchor, BgKind, CanvasMode, ChipShape, ImageLayer, Layer, PaletteLayer, ShapeKind, ShapeLayer,
    Template, TemplateOverrides, TextLayer,
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
    /// v0.5.0: force the legacy ab_glyph text renderer (parity/regression).
    pub legacy_text_renderer: bool,
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
            legacy_text_renderer: false,
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

pub(crate) fn resize_to_cover(
    src: &RgbaImage,
    target_w: u32,
    target_h: u32,
    filt: image::imageops::FilterType,
) -> RgbaImage {
    let (w, h) = src.dimensions();
    let scale = (target_w as f64 / w as f64).max(target_h as f64 / h as f64);
    let nw = ((w as f64) * scale).ceil().max(1.0) as u32;
    let nh = ((h as f64) * scale).ceil().max(1.0) as u32;
    image::imageops::resize(src, nw, nh, filt)
}

pub(crate) fn center_crop(src: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    let (sw, sh) = src.dimensions();
    let x = sw.saturating_sub(w) / 2;
    let y = sh.saturating_sub(h) / 2;
    image::imageops::crop_imm(src, x, y, w.min(sw), h.min(sh)).to_image()
}

/// Separable box blur (3 passes), deterministic approximation of a Gaussian.
pub(crate) fn box_blur_rgba(src: &RgbaImage, radius: u32) -> RgbaImage {
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
pub(crate) struct CanvasGeometry {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) pad_left: u32,
    pub(crate) pad_top: u32,
    pub(crate) photo_w: u32,
    pub(crate) photo_h: u32,
}

pub(crate) fn compute_geometry(
    t: &Template,
    photo: &RgbaImage,
    overrides: Option<&TemplateOverrides>,
) -> CanvasGeometry {
    let (w, h) = photo.dimensions();
    let pad_scale = overrides.map(|o| o.padding_scale()).unwrap_or(1.0);
    // v0.5.0: uniform extra margin, additive to canvas.padding (extend mode).
    let margin = overrides
        .and_then(|o| o.margin)
        .filter(|m| m.is_finite())
        .unwrap_or(0.0)
        .clamp(0.0, 0.5);
    let (pad_left, pad_top, pad_right, pad_bottom) = match t.canvas.mode {
        CanvasMode::Extend => {
            let p = &t.canvas.padding;
            let clamp01 = |v: f64| (v * pad_scale + margin).clamp(0.0, 1.0);
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
        photo_w: w,
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
                "tint" => BgKind::Tint,
                "texture" => BgKind::Texture,
                _ => BgKind::None,
            };
        }
        if let Some(c) = &o.background_color {
            plan.color = Some(c.clone());
        }
        if let Some(a) = &o.texture_asset {
            plan.asset = Some(a.clone());
        }
    }
    plan
}

/// Resolve image bytes for an asset path: in-memory map first, then
/// `assets_dir` (builtin brand/game/lens/@user/package-relative `assets/`).
#[allow(clippy::question_mark)]
pub(crate) fn resolve_asset_bytes(opts: &RenderOptions, path: &str) -> Option<Vec<u8>> {
    if let Some(map) = &opts.assets {
        if let Some(bytes) = map.get(path) {
            return Some(bytes.clone());
        }
    }
    let dir = opts.assets_dir.as_ref()?;
    // NOTE: rel keeps its sub-path ("brand/sony"); base must NOT add it again
    // (v0.2.0 had a double "brand/brand/" bug that blanked every badge).
    if let Some(rel) = path
        .strip_prefix("@builtin/")
        .or_else(|| path.strip_prefix("@user/"))
        .or_else(|| path.strip_prefix("assets/"))
    {
        let candidate = dir.join(rel);
        if candidate.is_file() {
            return std::fs::read(candidate).ok();
        }
        let with_png = dir.join(format!("{rel}.png"));
        if with_png.is_file() {
            return std::fs::read(with_png).ok();
        }
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

/// v0.5.0 texture background opacity: subtle grain over the base color.
const TEXTURE_OPACITY: f32 = 0.08;

/// Deterministic per-pixel hash in [0, 1) (splitmix-style finalizer). Same
/// input -> same value on every target, so CLI/WASM textures stay identical.
fn hash_noise(x: u32, y: u32, seed: u32) -> f32 {
    let mut h = (x as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (y as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F)
        ^ (seed as u64).wrapping_mul(0x1656_67B1_9E37_79F9);
    h ^= h >> 33;
    h = h.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
    h ^= h >> 33;
    (h >> 40) as f32 / 16_777_215.0
}

/// v0.5.0 `background.type:"texture"`: cover-fit the asset when one resolves,
/// otherwise synthesize a two-octave paper grain; either way the result is
/// blended over the base color at `TEXTURE_OPACITY` (6–10% range).
#[allow(clippy::needless_range_loop)]
fn fill_texture(
    canvas: &mut RgbaImage,
    plan: &BgPlan,
    opts: &RenderOptions,
    filt: image::imageops::FilterType,
) {
    let base = plan
        .color
        .as_deref()
        .and_then(|c| crate::template::parse_hex_color(c).ok())
        .unwrap_or([255u8, 255, 255, 255]);
    let (w, h) = canvas.dimensions();
    let texture = plan
        .asset
        .as_deref()
        .and_then(|a| resolve_asset_bytes(opts, a))
        .and_then(|bytes| image::load_from_memory(&bytes).ok())
        .map(|img| {
            let fitted = resize_to_cover(&img.to_rgba8(), w, h, filt);
            center_crop(&fitted, w, h)
        });
    for (x, y, px) in canvas.enumerate_pixels_mut() {
        let tex = match &texture {
            Some(img) => img.get_pixel(x, y).0,
            None => {
                let grain = hash_noise(x, y, 0x51) * 0.7 + hash_noise(x / 3, y / 3, 0x9E) * 0.3;
                let v = (grain * 255.0).round().clamp(0.0, 255.0) as u8;
                [v, v, v, 255]
            }
        };
        let mut out = base;
        for c in 0..3 {
            out[c] = (base[c] as f32 * (1.0 - TEXTURE_OPACITY) + tex[c] as f32 * TEXTURE_OPACITY)
                .round()
                .clamp(0.0, 255.0) as u8;
        }
        *px = Rgba(out);
    }
}

/// Average photo color (ignoring transparent pixels) — backdrop for `tint`.
fn average_color(img: &RgbaImage) -> [u8; 4] {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return [255, 255, 255, 255];
    }
    let step_x = (w / 64).max(1);
    let step_y = (h / 64).max(1);
    let mut acc = [0u64; 3];
    let mut n = 0u64;
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            let p = img.get_pixel(x, y).0;
            if p[3] >= 128 {
                acc[0] += p[0] as u64;
                acc[1] += p[1] as u64;
                acc[2] += p[2] as u64;
                n += 1;
            }
            x += step_x;
        }
        y += step_y;
    }
    if n == 0 {
        return [255, 255, 255, 255];
    }
    [
        (acc[0] / n) as u8,
        (acc[1] / n) as u8,
        (acc[2] / n) as u8,
        255,
    ]
}

fn photo_radius_px(radius: Option<f64>, photo: &RgbaImage) -> f32 {
    let (w, h) = photo.dimensions();
    radius.map(|r| (r * w.min(h) as f64) as f32).unwrap_or(0.0)
}

/// v0.5.0 card border: a stroke ring hugging the outside of the rounded card
/// edge. Drawn before the photo, so the inner half of the ring is covered and
/// the outer stroke stays visible around the card.
fn draw_card_border(
    canvas: &mut RgbaImage,
    geo: &CanvasGeometry,
    border: &crate::template::CardBorder,
    radius_px: f32,
) {
    if border.width <= 0.0 {
        return;
    }
    let width = border.width as f32 * geo.photo_w.min(geo.photo_h) as f32;
    if width < 0.5 {
        return;
    }
    let color = crate::template::parse_hex_color(&border.color).unwrap_or([0, 0, 0, 255]);
    render_shape(
        canvas,
        geo.pad_left as f32 - width,
        geo.pad_top as f32 - width,
        geo.photo_w as f32 + width * 2.0,
        geo.photo_h as f32 + width * 2.0,
        ShapeForm::Rect {
            radius_px: radius_px + width,
        },
        color,
        1.0,
        width,
        0.0,
    );
}

/// Anti-aliased coverage (0–1 over ~1px) of a rounded rectangle at a point.
fn rounded_rect_coverage(px: f32, py: f32, x: f32, y: f32, w: f32, h: f32, radius_px: f32) -> f32 {
    let hw = (w / 2.0).max(0.0);
    let hh = (h / 2.0).max(0.0);
    let r = radius_px.clamp(0.0, hw.min(hh));
    let qx = (px - (x + hw)).abs() - (hw - r);
    let qy = (py - (y + hh)).abs() - (hh - r);
    let d = qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - r;
    (0.5 - d).clamp(0.0, 1.0)
}

/// v0.5.0 card inner shadow: darken the inside of the rounded card rect by
/// compositing black through `card_clip * blur(1 - shifted_card)`. Drawn over
/// the photo (after it is placed), before later layers. Deterministic.
fn draw_card_inner_shadow(
    canvas: &mut RgbaImage,
    geo: &CanvasGeometry,
    inner: &crate::template::InnerShadow,
    radius_px: f32,
) {
    if !inner.enabled || inner.opacity <= 0.0 {
        return;
    }
    let unit = geo.photo_w.min(geo.photo_h) as f32;
    if unit < 1.0 {
        return;
    }
    let x = geo.pad_left as f32;
    let y = geo.pad_top as f32;
    let w = geo.photo_w as f32;
    let h = geo.photo_h as f32;
    let dx = inner.offset_x as f32 * unit;
    let dy = inner.offset_y as f32 * unit;
    let blur_px = (inner.blur as f32 * unit).round() as u32;
    // Work on a region just big enough for the shadow; anything farther from
    // the card is clipped away below, so blur edge clamping stays invisible.
    let m = blur_px as f32 * 3.0 + dx.abs().max(dy.abs()) + 2.0;
    let (cw, ch) = canvas.dimensions();
    let x0 = (x - m).floor().max(0.0) as u32;
    let y0 = (y - m).floor().max(0.0) as u32;
    let x1 = ((x + w + m).ceil()).clamp(0.0, cw as f32) as u32;
    let y1 = ((y + h + m).ceil()).clamp(0.0, ch as f32) as u32;
    if x1 <= x0 || y1 <= y0 {
        return;
    }
    // Source layer: 1 - (card shifted by the offset), opaque everywhere else.
    let mut layer = RgbaImage::new(x1 - x0, y1 - y0);
    for (lx, ly, p) in layer.enumerate_pixels_mut() {
        let px = (x0 + lx) as f32 + 0.5;
        let py = (y0 + ly) as f32 + 0.5;
        let hole = rounded_rect_coverage(px - dx, py - dy, x, y, w, h, radius_px);
        let a = ((1.0 - hole) * 255.0).round().clamp(0.0, 255.0) as u8;
        *p = Rgba([0, 0, 0, a]);
    }
    let layer = if blur_px > 0 {
        box_blur_rgba(&layer, blur_px)
    } else {
        layer
    };
    let opacity = inner.opacity.clamp(0.0, 1.0) as f32;
    for (lx, ly, p) in layer.enumerate_pixels() {
        let a = p.0[3] as f32 / 255.0
            * rounded_rect_coverage(
                (x0 + lx) as f32 + 0.5,
                (y0 + ly) as f32 + 0.5,
                x,
                y,
                w,
                h,
                radius_px,
            )
            * opacity;
        if a <= 0.0 {
            continue;
        }
        let dst = canvas.get_pixel_mut(x0 + lx, y0 + ly);
        for c in 0..3 {
            dst.0[c] = (dst.0[c] as f32 * (1.0 - a)).round().clamp(0.0, 255.0) as u8;
        }
    }
}

/// Clone the photo with its four corners rounded (1px anti-aliased mask).
fn rounded_photo(photo: &RgbaImage, radius_px: f32) -> RgbaImage {
    let (w, h) = photo.dimensions();
    let mut out = photo.clone();
    let r = radius_px.min(w.min(h) as f32 / 2.0).max(0.5);
    for (corner_x, corner_y) in [
        (0.0f32, 0.0f32),
        (w as f32, 0.0),
        (0.0, h as f32),
        (w as f32, h as f32),
    ] {
        let cx = if corner_x == 0.0 { r } else { w as f32 - r };
        let cy = if corner_y == 0.0 { r } else { h as f32 - r };
        let x0 = (cx - r - 1.0).max(0.0) as u32;
        let y0 = (cy - r - 1.0).max(0.0) as u32;
        let x1 = ((cx + r + 1.0).min(w as f32)) as u32;
        let y1 = ((cy + r + 1.0).min(h as f32)) as u32;
        for py in y0..y1 {
            for px in x0..x1 {
                let inside_x = if corner_x == 0.0 {
                    px as f32 + 0.5 < cx
                } else {
                    px as f32 + 0.5 > cx
                };
                let inside_y = if corner_y == 0.0 {
                    py as f32 + 0.5 < cy
                } else {
                    py as f32 + 0.5 > cy
                };
                if !(inside_x && inside_y) {
                    continue;
                }
                let dx = px as f32 + 0.5 - cx;
                let dy = py as f32 + 0.5 - cy;
                let dist = (dx * dx + dy * dy).sqrt();
                let cov = (r + 0.5 - dist).clamp(0.0, 1.0);
                if cov < 1.0 {
                    let p = out.get_pixel_mut(px, py);
                    p.0[3] = (p.0[3] as f32 * cov) as u8;
                }
            }
        }
    }
    out
}

fn place_photo(canvas: &mut RgbaImage, photo: &RgbaImage, geo: &CanvasGeometry, radius_px: f32) {
    if radius_px >= 0.5 {
        let rounded = rounded_photo(photo, radius_px);
        // Blend (not replace): rounded corners must reveal what's underneath.
        composite_over(
            canvas,
            &rounded,
            geo.pad_left as i32,
            geo.pad_top as i32,
            1.0,
        );
    } else {
        canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
    }
}

/// Composite a blurred black rounded-rect shadow behind the photo slot.
fn draw_photo_shadow(
    canvas: &mut RgbaImage,
    geo: &CanvasGeometry,
    shadow: &crate::template::Shadow,
    radius_px: f32,
) {
    let photo_h = geo.photo_h as f32;
    let dx = shadow.offset_x as f32 * photo_h;
    let dy = shadow.offset_y as f32 * photo_h;
    let x = geo.pad_left as f32 + dx;
    let y = geo.pad_top as f32 + dy;
    let color = [0u8, 0, 0, (shadow.opacity.clamp(0.0, 1.0) * 255.0) as u8];
    let mut layer = RgbaImage::new(canvas.width(), canvas.height());
    render_shape(
        &mut layer,
        x,
        y,
        geo.photo_w as f32,
        photo_h,
        ShapeForm::Rect { radius_px },
        color,
        1.0,
        0.0,
        0.0,
    );
    let blur_px = (shadow.blur as f32 * photo_h).round() as u32;
    let layer = if blur_px > 0 {
        box_blur_rgba(&layer, blur_px)
    } else {
        layer
    };
    composite_over(canvas, &layer, 0, 0, 1.0);
}

/// v0.5.0: largest fully-transparent axis-aligned rectangle (histogram
/// method); returns normalized (x, y, w, h) inside the frame image.
pub(crate) fn transparent_window(img: &RgbaImage) -> Option<(f64, f64, f64, f64)> {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return None;
    }
    let mut heights = vec![0u32; w as usize];
    let mut best = (0u64, 0u32, 0u32, 0u32, 0u32); // area, x, y, w, h
    for y in 0..h {
        for x in 0..w {
            let a = img.get_pixel(x, y).0[3];
            heights[x as usize] = if a < 16 { heights[x as usize] + 1 } else { 0 };
        }
        // Largest rectangle in histogram for this row.
        let mut stack: Vec<u32> = Vec::new();
        for x in 0..=w {
            let cur = if x == w { 0 } else { heights[x as usize] };
            while let Some(&top) = stack.last() {
                if heights[top as usize] >= cur {
                    stack.pop();
                    let height = heights[top as usize];
                    let left = stack.last().map(|v| v + 1).unwrap_or(0);
                    let width = x - left;
                    let area = height as u64 * width as u64;
                    if area > best.0 {
                        best = (area, left, y + 1 - height, width, height);
                    }
                } else {
                    break;
                }
            }
            stack.push(x);
        }
    }
    if best.0 == 0 {
        return None;
    }
    Some((
        best.1 as f64 / w as f64,
        best.2 as f64 / h as f64,
        best.3 as f64 / w as f64,
        best.4 as f64 / h as f64,
    ))
}

/// v0.5.0 frame overlay: draw the frame PNG (cover-fit to canvas × scale)
/// and, when auto-detecting, re-place the photo inside its transparent window.
fn draw_canvas_frame(
    canvas: &mut RgbaImage,
    photo: &RgbaImage,
    t: &Template,
    opts: &RenderOptions,
    filt: image::imageops::FilterType,
) {
    let Some(frame) = &t.canvas.frame else { return };
    let Some(bytes) = resolve_asset_bytes(opts, &frame.asset)
        .or_else(|| resolve_asset_bytes(opts, "@user/frame"))
    else {
        return;
    };
    let Ok(img) = image::load_from_memory(&bytes) else {
        return;
    };
    let frame_rgba = img.to_rgba8();
    let (fw, fh) = frame_rgba.dimensions();
    if fw == 0 || fh == 0 {
        return;
    }
    let (cw, ch) = canvas.dimensions();
    let scale = frame.scale.unwrap_or(1.0) as f32;
    // Cover-fit the frame to the canvas so there are no gaps.
    let cover = (cw as f32 / fw as f32).max(ch as f32 / fh as f32);
    let s = cover * scale;
    let dw = ((fw as f32) * s).round().max(1.0) as u32;
    let dh = ((fh as f32) * s).round().max(1.0) as u32;
    let ox = if dw > cw { (dw - cw) / 2 } else { 0 };
    let oy = if dh > ch { (dh - ch) / 2 } else { 0 };
    let off = frame
        .offset
        .as_ref()
        .map(|o| (o.x, o.y))
        .unwrap_or((0.0, 0.0));
    let dx = ((cw as f64 - dw as f64) / 2.0 - ox as f64 + off.0 * cw as f64).round() as i32;
    let dy = ((ch as f64 - dh as f64) / 2.0 - oy as f64 + off.1 * ch as f64).round() as i32;

    let fitted = image::imageops::resize(&frame_rgba, dw, dh, filt);

    // v0.5.0: the frame and its detected photo window are composed into the
    // same coordinate space, then rotated together about the canvas center.
    let compose = |dst: &mut RgbaImage| {
        if frame.auto_detect {
            if let Some((nx, ny, nw, nh)) = transparent_window(&fitted) {
                let inset = frame.inset.unwrap_or(0.0) as f32;
                let wx = dx as f32 + nx as f32 * dw as f32;
                let wy = dy as f32 + ny as f32 * dh as f32;
                let ww = (nw as f32 * dw as f32).max(7.0);
                let wh = (nh as f32 * dh as f32).max(7.0);
                let trim = inset * ww.min(wh);
                let (wx, wy, ww, wh) = (
                    wx + trim,
                    wy + trim,
                    (ww - trim * 2.0).max(5.0),
                    (wh - trim * 2.0).max(5.0),
                );
                let cover_p = (ww / photo.width() as f32).max(wh / photo.height() as f32);
                let pw = (photo.width() as f32 * cover_p).ceil().max(1.0) as u32;
                let ph = (photo.height() as f32 * cover_p).ceil().max(1.0) as u32;
                let scaled = image::imageops::resize(photo, pw, ph, filt);
                let cropped = center_crop(
                    &scaled,
                    ww.round().max(1.0) as u32,
                    wh.round().max(1.0) as u32,
                );
                composite_over(dst, &cropped, wx.round() as i32, wy.round() as i32, 1.0);
            }
        }
        composite_over(dst, &fitted, dx, dy, 1.0);
    };
    if frame.rotation.abs() > 0.01 {
        let mut layer = RgbaImage::new(cw, ch);
        compose(&mut layer);
        let diag = ((cw as f32).hypot(ch as f32)).ceil().max(1.0) as u32;
        let mut padded = RgbaImage::new(diag, diag);
        image::imageops::overlay(
            &mut padded,
            &layer,
            ((diag - cw) / 2) as i64,
            ((diag - ch) / 2) as i64,
        );
        let rotated = rotate_about_center(
            &padded,
            (frame.rotation as f32).to_radians(),
            Interpolation::Bilinear,
            Rgba([0, 0, 0, 0]),
        );
        composite_over(
            canvas,
            &rotated,
            (cw as i32 - diag as i32) / 2,
            (ch as i32 - diag as i32) / 2,
            1.0,
        );
    } else {
        compose(canvas);
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
    // v0.5.0 card overrides reuse the template canvas radius/shadow paths.
    // `card.enabled: false` removes the card decoration entirely (template
    // canvas radius/shadow included).
    let card_override = opts.overrides.as_ref().and_then(|o| o.card.as_ref());
    let card_off = card_override.is_some_and(|c| c.enabled == Some(false));
    let card = card_override.filter(|c| c.enabled != Some(false));
    let radius_px = if card_off {
        0.0
    } else {
        photo_radius_px(card.and_then(|c| c.radius).or(t.canvas.radius), photo)
    };
    let shadow = if card_off {
        None
    } else {
        card.and_then(|c| c.shadow)
            .or(t.canvas.shadow)
            .filter(|s| s.enabled)
    };
    match (t.canvas.mode, plan.kind) {
        (CanvasMode::Overlay, _) | (_, BgKind::None) | (CanvasMode::Cover, _) => {
            // No backdrop: a shadow would be invisible after flattening.
        }
        (CanvasMode::Extend, BgKind::Solid) => {
            fill_solid(&mut canvas, plan.color.as_deref());
        }
        (CanvasMode::Extend, BgKind::Tint) => {
            let c = average_color(photo);
            fill_solid(
                &mut canvas,
                Some(&format!("#{:02X}{:02X}{:02X}", c[0], c[1], c[2])),
            );
        }
        (CanvasMode::Extend, BgKind::Texture) => {
            fill_texture(&mut canvas, plan, opts, filt);
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
                    canvas
                        .copy_from(&center_crop(&fitted, geo.width, geo.height), 0, 0)
                        .ok();
                    covered = true;
                }
            }
            if !covered {
                fill_solid(&mut canvas, plan.color.as_deref());
            }
        }
    }
    if let Some(sh) = shadow {
        if !matches!(
            (t.canvas.mode, plan.kind),
            (CanvasMode::Overlay, _) | (_, BgKind::None) | (CanvasMode::Cover, _)
        ) {
            draw_photo_shadow(&mut canvas, geo, &sh, radius_px);
        }
    }
    // v0.5.0 card border sits on the card edge, between shadow and photo.
    if let Some(border) = card.and_then(|c| c.border.as_ref()) {
        draw_card_border(&mut canvas, geo, border, radius_px);
    }
    place_photo(&mut canvas, photo, geo, radius_px);
    // v0.5.0 card inner shadow sits on the photo, clipped to the card rect.
    if let Some(inner) = card.and_then(|c| c.inner_shadow.as_ref()) {
        draw_card_inner_shadow(&mut canvas, geo, inner, radius_px);
    }
    draw_canvas_frame(&mut canvas, photo, t, opts, filt);
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
        BgKind::Tint => {
            let c = average_color(photo);
            fill_solid(
                &mut canvas,
                Some(&format!("#{:02X}{:02X}{:02X}", c[0], c[1], c[2])),
            );
        }
        BgKind::Texture => fill_texture(&mut canvas, plan, opts, filt),
    }
    let x = (nw.saturating_sub(w)) / 2;
    let y = (nh.saturating_sub(h)) / 2;
    canvas.copy_from(&base, x, y).ok();
    canvas
}

fn srgb_channel(u: u8) -> f32 {
    let s = u as f32 / 255.0;
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

fn srgb_luminance(c: [u8; 3]) -> f32 {
    0.2126 * srgb_channel(c[0]) + 0.7152 * srgb_channel(c[1]) + 0.0722 * srgb_channel(c[2])
}

fn contrast_ratio(l1: f32, l2: f32) -> f32 {
    let (a, b) = if l1 > l2 { (l1, l2) } else { (l2, l1) };
    (a + 0.05) / (b + 0.05)
}

/// Average relative luminance of a canvas region (transparent = white).
fn region_luminance(img: &RgbaImage, x: i32, y: i32, w: u32, h: u32) -> f32 {
    let (iw, ih) = img.dimensions();
    let x0 = x.max(0).min(iw as i32 - 1);
    let y0 = y.max(0).min(ih as i32 - 1);
    let x1 = (x + w as i32).max(0).min(iw as i32);
    let y1 = (y + h as i32).max(0).min(ih as i32);
    if x1 <= x0 || y1 <= y0 {
        return 1.0;
    }
    let mut sum = 0f64;
    let mut n = 0f64;
    for py in y0..y1 {
        for px in x0..x1 {
            let p = img.get_pixel(px as u32, py as u32).0;
            let a = p[3] as f32 / 255.0;
            let r = p[0] as f32 * a + 255.0 * (1.0 - a);
            let g = p[1] as f32 * a + 255.0 * (1.0 - a);
            let b = p[2] as f32 * a + 255.0 * (1.0 - a);
            sum += srgb_luminance([r as u8, g as u8, b as u8]) as f64;
            n += 1.0;
        }
    }
    (sum / n.max(1.0)) as f32
}

/// Keep the preferred color when it has decent contrast; otherwise fall back
/// to whichever of near-black/near-white reads better (v0.3.0 auto-contrast).
fn adapt_text_color(preferred: [u8; 4], bg_lum: f32, force_auto: bool) -> [u8; 4] {
    let dark = [17u8, 17, 17, 255];
    let light = [255u8, 255, 255, 255];
    if !force_auto {
        let ratio = contrast_ratio(
            srgb_luminance([preferred[0], preferred[1], preferred[2]]),
            bg_lum,
        );
        if ratio >= 2.5 {
            return preferred;
        }
    }
    let dl = srgb_luminance([dark[0], dark[1], dark[2]]);
    let ll = srgb_luminance([light[0], light[1], light[2]]);
    if contrast_ratio(ll, bg_lum) >= contrast_ratio(dl, bg_lum) {
        light
    } else {
        dark
    }
}

fn text_lines(layer: &TextLayer, info: &ExifInfo) -> Vec<String> {
    layer
        .content
        .iter()
        .filter_map(|item| eval_expr(&item.expr, info).or_else(|| item.fallback.clone()))
        .filter(|s| !s.is_empty())
        .collect()
}

/// v0.5.0: public wrapper for the editor box calculations.
pub(crate) fn text_lines_public(layer: &TextLayer, info: &ExifInfo) -> Vec<String> {
    text_lines(layer, info)
}

/// Layout of a drawn text layer's first line (for attached logo placement).
#[derive(Debug, Clone, Copy)]
struct TextLayout {
    first_line_x: f32,
    first_line_y: f32,
    first_line_h: f32,
}

/// Blend `src` onto `dst` at (x, y) with a global opacity multiplier.
#[allow(clippy::needless_range_loop)]
pub(crate) fn composite_over(dst: &mut RgbaImage, src: &RgbaImage, x: i32, y: i32, opacity: f32) {
    let (dw, dh) = dst.dimensions();
    for (sx, sy, p) in src.enumerate_pixels() {
        let dx = x + sx as i32;
        let dy = y + sy as i32;
        if dx < 0 || dy < 0 || dx >= dw as i32 || dy >= dh as i32 {
            continue;
        }
        let a = (p.0[3] as f32 / 255.0) * opacity.clamp(0.0, 1.0);
        if a <= 0.0 {
            continue;
        }
        let d = dst.get_pixel_mut(dx as u32, dy as u32);
        let da = d.0[3] as f32 / 255.0;
        let out_a = a + da * (1.0 - a);
        if out_a <= 0.0 {
            continue;
        }
        for ch in 0..3 {
            let sc = p.0[ch] as f32 / 255.0;
            let dc = d.0[ch] as f32 / 255.0;
            d.0[ch] = (((sc * a + dc * da * (1.0 - a)) / out_a) * 255.0)
                .round()
                .clamp(0.0, 255.0) as u8;
        }
        d.0[3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
    }
}

/// Solid axis-aligned rectangle helper (calendar rules, dividers).
pub(crate) fn draw_rect(
    canvas: &mut RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    color: [u8; 4],
    opacity: f32,
) {
    render_shape(
        canvas,
        x,
        y,
        w,
        h,
        ShapeForm::Rect { radius_px: 0.0 },
        color,
        opacity,
        0.0,
        0.0,
    );
}

/// Per-line widths and vertical metrics for a text block (v0.4.0: with
/// letter-spacing, so imageproc's `text_size` no longer applies).
fn line_metrics(
    lines: &[String],
    font: &ab_glyph::FontArc,
    size_px: f32,
    letter_spacing_em: f32,
) -> (Vec<f32>, f32, f32, f32) {
    let scaled = font.as_scaled(PxScale::from(size_px));
    let spacing = letter_spacing_em * size_px;
    let widths: Vec<f32> = lines
        .iter()
        .map(|line| {
            let mut w = 0.0f32;
            let n = line.chars().count();
            for (i, c) in line.chars().enumerate() {
                w += scaled.h_advance(scaled.glyph_id(c));
                if i + 1 < n {
                    w += spacing;
                }
            }
            w
        })
        .collect();
    (widths, spacing, scaled.ascent(), scaled.descent())
}

/// Render a multi-line text block into a tight RGBA image with letter-spacing
/// (A1) and per-line alignment. Glyphs are blitted via ab_glyph coverage.
#[allow(clippy::too_many_arguments, clippy::needless_range_loop)]
fn render_text_block(
    lines: &[String],
    font: &ab_glyph::FontArc,
    size_px: f32,
    line_height: f32,
    letter_spacing_em: f32,
    align: &str,
    color: [u8; 4],
) -> RgbaImage {
    let (widths, spacing, ascent, descent) = line_metrics(lines, font, size_px, letter_spacing_em);
    let line_h = size_px * line_height;
    let block_w = widths
        .iter()
        .cloned()
        .fold(0.0f32, f32::max)
        .ceil()
        .max(1.0) as u32;
    let block_h = ((ascent - descent) + line_h * (lines.len() as f32 - 1.0))
        .ceil()
        .max(1.0) as u32;
    let mut block = RgbaImage::new(block_w, block_h);
    let scaled = font.as_scaled(PxScale::from(size_px));
    for (i, line) in lines.iter().enumerate() {
        let baseline = ascent + line_h * i as f32;
        let mut pen = match align {
            "center" => (block_w as f32 - widths[i]) / 2.0,
            "right" => block_w as f32 - widths[i],
            _ => 0.0,
        };
        for c in line.chars() {
            let gid = scaled.glyph_id(c);
            let glyph = gid.with_scale_and_position(size_px, ab_glyph::point(0.0, 0.0));
            if let Some(glyph) = font.outline_glyph(glyph) {
                let bounds = glyph.px_bounds();
                let origin_x = pen.round() as i32 + bounds.min.x as i32;
                let origin_y = baseline.round() as i32 + bounds.min.y as i32;
                glyph.draw(|gx, gy, cov| {
                    let x = origin_x + gx as i32;
                    let y = origin_y + gy as i32;
                    if x < 0 || y < 0 || x as u32 >= block_w || y as u32 >= block_h || cov <= 0.0 {
                        return;
                    }
                    let p = block.get_pixel_mut(x as u32, y as u32);
                    let src_a = cov.clamp(0.0, 1.0) * (color[3] as f32 / 255.0);
                    if src_a <= 0.0 {
                        return;
                    }
                    let dst_a = p.0[3] as f32 / 255.0;
                    let out_a = src_a + dst_a * (1.0 - src_a);
                    for ch in 0..3 {
                        let sc = color[ch] as f32 / 255.0;
                        let dc = p.0[ch] as f32 / 255.0;
                        p.0[ch] =
                            (((sc * src_a + dc * dst_a * (1.0 - src_a)) / out_a) * 255.0) as u8;
                    }
                    p.0[3] = (out_a * 255.0).round() as u8;
                });
            }
            pen += scaled.h_advance(gid) + spacing;
        }
    }
    block
}

#[derive(Clone, Copy)]
enum ShapeForm {
    Rect { radius_px: f32 },
    Ellipse,
    Diamond,
    Hexagon,
}

const SQRT3: f32 = 1.732_050_8;

/// Draw a primitive shape in the rect (x, y, w, h) with a 3x3 supersampled
/// edge. `stroke_px` > 0 draws an outline; `rotation_deg` rotates the form
/// around its center (v0.4.0 A2/A4).
#[allow(clippy::too_many_arguments, clippy::needless_range_loop)]
fn render_shape(
    canvas: &mut RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    form: ShapeForm,
    color: [u8; 4],
    opacity: f32,
    stroke_px: f32,
    rotation_deg: f32,
) {
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    let color_a = (color[3] as f32 / 255.0) * opacity.clamp(0.0, 1.0);
    if color_a <= 0.0 {
        return;
    }
    let theta = rotation_deg.to_radians();
    let (sin_t, cos_t) = theta.sin_cos();
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let half_w = w / 2.0;
    let half_h = h / 2.0;
    let inside = |px: f32, py: f32, shrink: f32| -> bool {
        let dx = px - cx;
        let dy = py - cy;
        let rx = dx * cos_t + dy * sin_t;
        let ry = -dx * sin_t + dy * cos_t;
        let hw = (half_w - shrink).max(0.01);
        let hh = (half_h - shrink).max(0.01);
        match form {
            ShapeForm::Rect { radius_px } => {
                let r = (radius_px - shrink).clamp(0.0, hw.min(hh));
                let qx = rx.abs() - (hw - r);
                let qy = ry.abs() - (hh - r);
                if rx.abs() > hw || ry.abs() > hh {
                    false
                } else if qx <= 0.0 || qy <= 0.0 {
                    true
                } else {
                    qx * qx + qy * qy <= r * r + 1e-3
                }
            }
            ShapeForm::Ellipse => (rx / hw).powi(2) + (ry / hh).powi(2) <= 1.0,
            ShapeForm::Diamond => rx.abs() / hw + ry.abs() / hh <= 1.0,
            ShapeForm::Hexagon => {
                let u = rx / hw;
                let v = ry / hh;
                v.abs() <= 1.0 && u.abs() <= 1.0 - v.abs() / SQRT3
            }
        }
    };
    let margin = 2.0;
    let x0 = (x - margin).floor().max(0.0) as u32;
    let y0 = (y - margin).floor().max(0.0) as u32;
    let x1 = ((x + w + margin).ceil().max(0.0) as u32).min(canvas.width());
    let y1 = ((y + h + margin).ceil().max(0.0) as u32).min(canvas.height());
    let samples = 3u32;
    for py in y0..y1 {
        for px in x0..x1 {
            let mut hit = 0u32;
            for sy in 0..samples {
                for sx in 0..samples {
                    let fx = px as f32 + (sx as f32 + 0.5) / samples as f32;
                    let fy = py as f32 + (sy as f32 + 0.5) / samples as f32;
                    let is_in = if stroke_px > 0.0 {
                        inside(fx, fy, 0.0) && !inside(fx, fy, stroke_px)
                    } else {
                        inside(fx, fy, 0.0)
                    };
                    if is_in {
                        hit += 1;
                    }
                }
            }
            if hit == 0 {
                continue;
            }
            let src_a = hit as f32 / (samples * samples) as f32 * color_a;
            let p = canvas.get_pixel_mut(px, py);
            let dst_a = p.0[3] as f32 / 255.0;
            let out_a = src_a + dst_a * (1.0 - src_a);
            if out_a <= 0.0 {
                continue;
            }
            for ch in 0..3 {
                let sc = color[ch] as f32 / 255.0;
                let dc = p.0[ch] as f32 / 255.0;
                p.0[ch] = (((sc * src_a + dc * dst_a * (1.0 - src_a)) / out_a) * 255.0)
                    .round()
                    .clamp(0.0, 255.0) as u8;
            }
            p.0[3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
}

/// Dispatch: v0.5.0 cosmic-text path when a shaper is available; legacy
/// ab_glyph path when `--legacy-text-renderer` is active (render parity gate).
#[allow(clippy::too_many_arguments)]
fn draw_text_layer(
    canvas: &mut RgbaImage,
    layer: &TextLayer,
    info: &ExifInfo,
    fonts: &FontBook,
    shaper: Option<&mut crate::text_shape::Shaper>,
    geo: &CanvasGeometry,
    overrides: Option<&TemplateOverrides>,
    opts: &RenderOptions,
) -> Option<TextLayout> {
    match shaper {
        Some(shaper) => draw_text_layer_v5(canvas, layer, info, shaper, geo, overrides, opts),
        None => draw_text_layer_legacy(canvas, layer, info, fonts, geo, overrides),
    }
}

/// v0.5.0: cosmic-text shaping + mask-based text effects + adaptive sizes.
#[allow(clippy::too_many_arguments)]
fn draw_text_layer_v5(
    canvas: &mut RgbaImage,
    layer: &TextLayer,
    info: &ExifInfo,
    shaper: &mut crate::text_shape::Shaper,
    geo: &CanvasGeometry,
    overrides: Option<&TemplateOverrides>,
    opts: &RenderOptions,
) -> Option<TextLayout> {
    let mut lines = text_lines(layer, info);
    if lines.is_empty() {
        return None;
    }
    if let Some(effects) = &layer.effects {
        if let Some(case) = effects.case.as_deref() {
            lines = lines
                .into_iter()
                .map(|l| match case {
                    "upper" => l.to_uppercase(),
                    "lower" => l.to_lowercase(),
                    "title" => l
                        .split(' ')
                        .map(|w| {
                            let mut c = w.chars();
                            match c.next() {
                                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                                None => String::new(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" "),
                    _ => l,
                })
                .collect();
        }
    }
    let mut families = layer.font.family.clone();
    if let Some(f) = overrides.and_then(|o| o.font_family.as_deref()) {
        families.insert(0, f.to_string());
    }
    let font_scale = overrides.map(|o| o.font_size_scale()).unwrap_or(1.0);
    let mut size_px = (layer.font.size * font_scale * geo.photo_h as f64) as f32;
    if size_px <= 0.0 {
        return None;
    }
    let w = geo.width as f32;
    let h = geo.height as f32;
    let col_left = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft
    );
    let col_center = matches!(
        layer.anchor,
        Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter
    );
    let row_top = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight
    );
    let row_middle = matches!(
        layer.anchor,
        Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight
    );

    let text_joined = lines.join("\n");
    let wrap_width = layer.width.map(|fw| (fw as f32 * w).max(4.0));
    let request = |size: f32, wrap: Option<f32>| crate::text_shape::ShapeRequest {
        text: &text_joined,
        families: &families,
        weight: layer.font.weight,
        size_px: size,
        line_height: layer.line_height as f32,
        letter_spacing_em: layer.letter_spacing as f32,
        align: layer.align.as_deref().unwrap_or(if col_left {
            "left"
        } else if col_center {
            "center"
        } else {
            "right"
        }),
        max_width: wrap,
    };
    let mut raster = shaper.shape(&request(size_px, wrap_width))?;

    // Adaptive height: scale the font so the shaped block matches the target.
    if let Some(target_h) = layer.height {
        let target = (target_h as f32 * h).max(4.0);
        let cur = raster.height as f32;
        if cur > 0.0 && (cur - target).abs() > 1.0 {
            size_px = (size_px * target / cur).clamp(1.0, 4096.0);
            if let Some(r) = shaper.shape(&request(size_px, wrap_width)) {
                raster = r;
            }
        }
    }
    // Fill-page / stretch sizing.
    let mut target_w: Option<f32> = None;
    if layer.fill_page {
        let th = 0.9 * h;
        let cur = raster.height as f32;
        if cur > 0.0 {
            size_px = (size_px * th / cur).clamp(1.0, 4096.0);
            if let Some(r) = shaper.shape(&request(size_px, wrap_width)) {
                raster = r;
            }
        }
        target_w = Some(0.9 * w);
    } else if layer.stretch_width || layer.stretch_height {
        if layer.stretch_height {
            let px = layer.offset.x as f32 * w;
            let block_x = if col_left {
                px
            } else if col_center {
                (w - raster.width as f32) / 2.0 + px
            } else {
                w + px - raster.width as f32
            };
            let avail = if row_top {
                h
            } else if row_middle {
                h / 2.0
            } else {
                h
            };
            let _ = block_x;
            let th = (avail * 0.9).max(8.0);
            let cur = raster.height as f32;
            if cur > 0.0 {
                size_px = (size_px * th / cur).clamp(1.0, 4096.0);
                if let Some(r) = shaper.shape(&request(size_px, wrap_width)) {
                    raster = r;
                }
            }
        }
        if layer.stretch_width {
            let bw = raster.width as f32;
            target_w = Some(if col_left {
                (w - 0.05 * w).max(bw)
            } else if col_center {
                0.9 * w
            } else {
                (w - 0.05 * w).max(bw)
            });
        }
    }

    let margin = 4.0;
    let block_x = if col_left {
        layer.offset.x as f32 * w
    } else if col_center {
        (w - raster.width as f32) / 2.0 + layer.offset.x as f32 * w
    } else {
        w + layer.offset.x as f32 * w - raster.width as f32
    };
    let block_y = if row_top {
        layer.offset.y as f32 * h
    } else if row_middle {
        (h - raster.height as f32) / 2.0 + layer.offset.y as f32 * h
    } else {
        h + layer.offset.y as f32 * h - raster.height as f32
    };

    let manual = overrides.and_then(|o| o.text_color.as_deref());
    let force_auto = manual.is_none() && layer.font.color.eq_ignore_ascii_case("auto");
    let base_color = match manual {
        Some(c) => crate::template::parse_hex_color(c).unwrap_or([0, 0, 0, 255]),
        None if force_auto => [17, 17, 17, 255],
        None => crate::template::parse_hex_color(&layer.font.color).unwrap_or([0, 0, 0, 255]),
    };
    let color = if manual.is_some() {
        base_color
    } else {
        let bg = region_luminance(
            canvas,
            (block_x - margin).round() as i32,
            (block_y - margin).round() as i32,
            raster.width + (margin * 2.0) as u32,
            raster.height + (margin * 2.0) as u32,
        );
        adapt_text_color(base_color, bg, force_auto)
    };
    let resources_dir = opts.assets_dir.as_deref();
    let opacity = layer.opacity.clamp(0.0, 1.0) as f32;
    let (mut block, pad_x, pad_y) = crate::text_art::compose_text_layer(
        &raster,
        layer.effects.as_ref(),
        color,
        opacity,
        opts,
        resources_dir,
    );
    // Horizontal stretch: rescale the composed block to the target width.
    if let Some(tw) = target_w {
        let bw = block.width() as f32;
        if bw > 1.0 && (tw - bw).abs() > 1.0 {
            let nh = block.height().max(1);
            let nw = tw.clamp(1.0, 8192.0).round() as u32;
            block = image::imageops::resize(&block, nw, nh, image::imageops::FilterType::Triangle);
        }
    }
    let bx = block_x - pad_x as f32;
    let by = block_y - pad_y as f32;
    if layer.rotation.abs() > 0.01 {
        let (bw, bh) = block.dimensions();
        let diag = ((bw as f32).hypot(bh as f32)).ceil().max(1.0) as u32;
        let mut padded = RgbaImage::new(diag, diag);
        let ox = ((diag - bw) / 2) as i64;
        let oy = ((diag - bh) / 2) as i64;
        image::imageops::overlay(&mut padded, &block, ox, oy);
        let rotated = rotate_about_center(
            &padded,
            (layer.rotation as f32).to_radians(),
            Interpolation::Bilinear,
            Rgba([0, 0, 0, 0]),
        );
        let cx = block_x + raster.width as f32 / 2.0;
        let cy = block_y + raster.height as f32 / 2.0;
        composite_over(
            canvas,
            &rotated,
            (cx - diag as f32 / 2.0).round() as i32,
            (cy - diag as f32 / 2.0).round() as i32,
            1.0,
        );
    } else {
        composite_over(canvas, &block, bx.round() as i32, by.round() as i32, 1.0);
    }
    Some(TextLayout {
        first_line_x: block_x,
        first_line_y: block_y,
        first_line_h: raster.first_baseline,
    })
}

/// v0.4.0 legacy path (ab_glyph); kept for `--legacy-text-renderer` parity.
fn draw_text_layer_legacy(
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
    let line_h = size_px * layer.line_height as f32;
    let (widths, _spacing, ascent, descent) =
        line_metrics(&lines, font, size_px, layer.letter_spacing as f32);
    let block_w = widths
        .iter()
        .cloned()
        .fold(0.0f32, f32::max)
        .ceil()
        .max(1.0);
    let block_h = ((ascent - descent) + line_h * (lines.len() as f32 - 1.0))
        .ceil()
        .max(1.0);

    let w = geo.width as f32;
    let h = geo.height as f32;
    let col_left = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft
    );
    let col_center = matches!(
        layer.anchor,
        Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter
    );
    let row_top = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight
    );
    let row_middle = matches!(
        layer.anchor,
        Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight
    );
    let off_x = layer.offset.x as f32 * w;
    let off_y = layer.offset.y as f32 * h;
    let block_x = if col_left {
        off_x
    } else if col_center {
        (w - block_w) / 2.0 + off_x
    } else {
        w + off_x - block_w
    };
    let block_y = if row_top {
        off_y
    } else if row_middle {
        (h - block_h) / 2.0 + off_y
    } else {
        h + off_y - block_h
    };

    let manual = overrides.and_then(|o| o.text_color.as_deref());
    let force_auto = manual.is_none() && layer.font.color.eq_ignore_ascii_case("auto");
    let base_color = match manual {
        Some(c) => crate::template::parse_hex_color(c).unwrap_or([0, 0, 0, 255]),
        None if force_auto => [17, 17, 17, 255],
        None => crate::template::parse_hex_color(&layer.font.color).unwrap_or([0, 0, 0, 255]),
    };
    let color = if manual.is_some() {
        base_color
    } else {
        let bg = region_luminance(
            canvas,
            block_x.round() as i32,
            block_y.round() as i32,
            block_w.ceil() as u32 + 2,
            block_h.ceil() as u32 + 2,
        );
        adapt_text_color(base_color, bg, force_auto)
    };
    let align = layer.align.clone().unwrap_or_else(|| {
        if col_left {
            "left".to_string()
        } else if col_center {
            "center".to_string()
        } else {
            "right".to_string()
        }
    });
    let block = render_text_block(
        &lines,
        font,
        size_px,
        layer.line_height as f32,
        layer.letter_spacing as f32,
        &align,
        color,
    );
    let opacity = layer.opacity.clamp(0.0, 1.0) as f32;
    if layer.rotation.abs() > 0.01 {
        // Pad to the block diagonal so rotation never clips glyphs.
        let (bw, bh) = block.dimensions();
        let diag = ((bw as f32).hypot(bh as f32)).ceil().max(1.0) as u32;
        let mut padded = RgbaImage::new(diag, diag);
        let ox = ((diag - bw) / 2) as i64;
        let oy = ((diag - bh) / 2) as i64;
        image::imageops::overlay(&mut padded, &block, ox, oy);
        let rotated = rotate_about_center(
            &padded,
            (layer.rotation as f32).to_radians(),
            Interpolation::Bilinear,
            Rgba([0, 0, 0, 0]),
        );
        let cx = block_x + bw as f32 / 2.0;
        let cy = block_y + bh as f32 / 2.0;
        composite_over(
            canvas,
            &rotated,
            (cx - diag as f32 / 2.0).round() as i32,
            (cy - diag as f32 / 2.0).round() as i32,
            opacity,
        );
    } else {
        composite_over(
            canvas,
            &block,
            block_x.round() as i32,
            block_y.round() as i32,
            opacity,
        );
    }
    Some(TextLayout {
        first_line_x: block_x,
        first_line_y: block_y,
        first_line_h: ascent - descent,
    })
}

/// v0.4.0 A4: primitive shape layer (rules, borders, dots, chips).
fn draw_shape_layer(
    canvas: &mut RgbaImage,
    layer: &ShapeLayer,
    geo: &CanvasGeometry,
    text_count: usize,
) {
    // v0.5.0 auto divider: hide when there is nothing to separate.
    if layer.auto_hide && text_count < 2 {
        return;
    }
    let w = geo.width as f32;
    let h = geo.height as f32;
    // v0.5.0 layout frames are sized from the photo and ignore `size`.
    if let Some(frame) = layer.frame.as_deref() {
        draw_shape_frame(canvas, layer, geo, frame);
        return;
    }
    let (default_w, default_h) = match layer.shape {
        ShapeKind::Line => (0.2, 0.0015),
        ShapeKind::Rect => (0.2, 0.2),
        ShapeKind::Ellipse | ShapeKind::Diamond | ShapeKind::Hexagon => (0.05, 0.05),
    };
    let mut sw = layer.size.width.unwrap_or(default_w) as f32 * geo.photo_w as f32;
    let sh = layer.size.height.unwrap_or(default_h) as f32 * geo.photo_h as f32;
    let col_left = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft
    );
    let col_center = matches!(
        layer.anchor,
        Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter
    );
    let row_top = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight
    );
    let row_middle = matches!(
        layer.anchor,
        Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight
    );
    let off_x = layer.offset.x as f32 * w;
    let off_y = layer.offset.y as f32 * h;
    // v0.5.0 `span: auto`: a rule spans the inset width around its anchor.
    let mut sx_override: Option<f32> = None;
    if layer.span.as_deref() == Some("auto") {
        let inset = layer
            .margin
            .map(|m| m as f32 * geo.photo_w as f32)
            .unwrap_or(0.06 * geo.photo_w as f32);
        sw = (w - inset * 2.0).max(2.0);
        sx_override = Some(inset);
    }
    let sx = match sx_override {
        Some(x) => x,
        None if col_left => off_x,
        None if col_center => (w - sw) / 2.0 + off_x,
        None => w + off_x - sw,
    };
    let sy = if row_top {
        off_y
    } else if row_middle {
        (h - sh) / 2.0 + off_y
    } else {
        h + off_y - sh
    };
    let color = crate::template::parse_hex_color(&layer.color).unwrap_or([0, 0, 0, 255]);
    let radius_px = layer.radius.unwrap_or(0.0) as f32 * sw.min(sh);
    let stroke_px = layer
        .stroke_width
        .map(|s| s as f32 * geo.photo_w as f32)
        .unwrap_or(0.0);
    let form = match layer.shape {
        ShapeKind::Line | ShapeKind::Rect => ShapeForm::Rect { radius_px },
        ShapeKind::Ellipse => ShapeForm::Ellipse,
        ShapeKind::Diamond => ShapeForm::Diamond,
        ShapeKind::Hexagon => ShapeForm::Hexagon,
    };
    render_shape(
        canvas,
        sx,
        sy,
        sw,
        sh,
        form,
        color,
        layer.opacity as f32,
        stroke_px,
        layer.rotation as f32,
    );
    if layer.double && matches!(layer.shape, ShapeKind::Line) {
        let gap = layer.gap.unwrap_or(0.006) as f32 * geo.photo_h as f32;
        render_shape(
            canvas,
            sx,
            sy - gap / 2.0,
            sw,
            sh,
            form,
            color,
            layer.opacity as f32,
            stroke_px,
            layer.rotation as f32,
        );
        render_shape(
            canvas,
            sx,
            sy + gap / 2.0,
            sw,
            sh,
            form,
            color,
            layer.opacity as f32,
            stroke_px,
            layer.rotation as f32,
        );
    }
}

/// v0.5.0 layout frames: outer border / opposite horizontal / opposite vertical.
fn draw_shape_frame(canvas: &mut RgbaImage, layer: &ShapeLayer, geo: &CanvasGeometry, frame: &str) {
    let color = crate::template::parse_hex_color(&layer.color).unwrap_or([0, 0, 0, 255]);
    let margin = layer.margin.unwrap_or(0.04) as f32 * geo.photo_w as f32;
    let thickness = layer
        .stroke_width
        .map(|s| (s as f32 * geo.photo_w as f32).max(1.0))
        .unwrap_or_else(|| (geo.photo_h as f32 * 0.002).max(1.0));
    let opacity = layer.opacity as f32;
    let x0 = margin;
    let y0 = margin;
    let x1 = geo.width as f32 - margin;
    let y1 = geo.height as f32 - margin;
    if x1 <= x0 || y1 <= y0 {
        return;
    }
    match frame {
        "opposite-h" => {
            render_shape(
                canvas,
                x0,
                y0,
                x1 - x0,
                thickness,
                ShapeForm::Rect { radius_px: 0.0 },
                color,
                opacity,
                0.0,
                0.0,
            );
            render_shape(
                canvas,
                x0,
                y1 - thickness,
                x1 - x0,
                thickness,
                ShapeForm::Rect { radius_px: 0.0 },
                color,
                opacity,
                0.0,
                0.0,
            );
        }
        "opposite-v" => {
            render_shape(
                canvas,
                x0,
                y0,
                thickness,
                y1 - y0,
                ShapeForm::Rect { radius_px: 0.0 },
                color,
                opacity,
                0.0,
                0.0,
            );
            render_shape(
                canvas,
                x1 - thickness,
                y0,
                thickness,
                y1 - y0,
                ShapeForm::Rect { radius_px: 0.0 },
                color,
                opacity,
                0.0,
                0.0,
            );
        }
        _ => {
            // outer: four edges with square corners and optional double rule.
            render_shape(
                canvas,
                x0,
                y0,
                x1 - x0,
                thickness,
                ShapeForm::Rect { radius_px: 0.0 },
                color,
                opacity,
                0.0,
                0.0,
            );
            render_shape(
                canvas,
                x0,
                y1 - thickness,
                x1 - x0,
                thickness,
                ShapeForm::Rect { radius_px: 0.0 },
                color,
                opacity,
                0.0,
                0.0,
            );
            render_shape(
                canvas,
                x0,
                y0,
                thickness,
                y1 - y0,
                ShapeForm::Rect { radius_px: 0.0 },
                color,
                opacity,
                0.0,
                0.0,
            );
            render_shape(
                canvas,
                x1 - thickness,
                y0,
                thickness,
                y1 - y0,
                ShapeForm::Rect { radius_px: 0.0 },
                color,
                opacity,
                0.0,
                0.0,
            );
            if layer.double {
                let gap = layer.gap.unwrap_or(0.004) as f32 * geo.photo_h as f32;
                let ix0 = x0 + thickness + gap;
                let iy0 = y0 + thickness + gap;
                let ix1 = x1 - thickness - gap;
                let iy1 = y1 - thickness - gap;
                let t2 = (thickness * 0.5).max(1.0);
                let long = match layer.shape {
                    ShapeKind::Ellipse => ShapeForm::Ellipse,
                    ShapeKind::Diamond => ShapeForm::Diamond,
                    ShapeKind::Hexagon => ShapeForm::Hexagon,
                    _ => ShapeForm::Rect { radius_px: 0.0 },
                };
                let _ = long;
                let op = opacity * 0.8;
                render_shape(
                    canvas,
                    ix0,
                    iy0,
                    (ix1 - ix0).max(1.0),
                    t2,
                    ShapeForm::Rect { radius_px: 0.0 },
                    color,
                    op,
                    0.0,
                    0.0,
                );
                render_shape(
                    canvas,
                    ix0,
                    iy1 - t2,
                    (ix1 - ix0).max(1.0),
                    t2,
                    ShapeForm::Rect { radius_px: 0.0 },
                    color,
                    op,
                    0.0,
                    0.0,
                );
                render_shape(
                    canvas,
                    ix0,
                    iy0,
                    t2,
                    (iy1 - iy0).max(1.0),
                    ShapeForm::Rect { radius_px: 0.0 },
                    color,
                    op,
                    0.0,
                    0.0,
                );
                render_shape(
                    canvas,
                    ix1 - t2,
                    iy0,
                    t2,
                    (iy1 - iy0).max(1.0),
                    ShapeForm::Rect { radius_px: 0.0 },
                    color,
                    op,
                    0.0,
                    0.0,
                );
            }
        }
    }
}

/// v0.4.0 A5: dominant colors via deterministic median cut over a 64x64 grid.
fn extract_palette(photo: &RgbaImage, count: usize) -> Vec<[u8; 3]> {
    let (w, h) = photo.dimensions();
    if w == 0 || h == 0 || count == 0 {
        return Vec::new();
    }
    let samples = 64u32;
    let mut pixels: Vec<[u8; 3]> = Vec::with_capacity((samples * samples) as usize);
    for gy in 0..samples {
        for gx in 0..samples {
            let px = ((gx as f32 + 0.5) / samples as f32 * w as f32) as u32;
            let py = ((gy as f32 + 0.5) / samples as f32 * h as f32) as u32;
            let p = photo.get_pixel(px.min(w - 1), py.min(h - 1)).0;
            if p[3] < 128 {
                continue;
            }
            pixels.push([p[0], p[1], p[2]]);
        }
    }
    if pixels.is_empty() {
        return vec![[255, 255, 255]; count];
    }
    let mut boxes: Vec<Vec<[u8; 3]>> = vec![pixels];
    while boxes.len() < count {
        let mut best: Option<(usize, usize, u8)> = None;
        for (i, b) in boxes.iter().enumerate() {
            if b.len() < 2 {
                continue;
            }
            let mut ranges = [0u8; 3];
            for ch in 0..3 {
                let mut lo = 255u8;
                let mut hi = 0u8;
                for p in b {
                    lo = lo.min(p[ch]);
                    hi = hi.max(p[ch]);
                }
                ranges[ch] = hi.saturating_sub(lo);
            }
            let Some((ch, r)) = ranges
                .iter()
                .enumerate()
                .max_by_key(|(_, r)| **r)
                .map(|(c, r)| (c, *r))
            else {
                continue;
            };
            if r == 0 {
                continue;
            }
            match best {
                Some((_, _, br)) if br >= r => {}
                _ => best = Some((i, ch, r)),
            }
        }
        let Some((idx, ch, _)) = best else { break };
        let mut b = boxes.remove(idx);
        b.sort_by_key(|p| p[ch]);
        let mid = b.len() / 2;
        let b2 = b.split_off(mid);
        boxes.push(b);
        boxes.push(b2);
    }
    // Dominant first: sort clusters by size, then drop near-duplicates.
    let mut clusters: Vec<(usize, [u8; 3])> = boxes
        .iter()
        .map(|b| {
            let n = b.len().max(1) as u64;
            let mut acc = [0u64; 3];
            for p in b {
                for ch in 0..3 {
                    acc[ch] += p[ch] as u64;
                }
            }
            (
                b.len(),
                [(acc[0] / n) as u8, (acc[1] / n) as u8, (acc[2] / n) as u8],
            )
        })
        .collect();
    clusters.sort_by_key(|a| std::cmp::Reverse(a.0));
    let mut unique: Vec<[u8; 3]> = Vec::with_capacity(clusters.len());
    for (_, color) in clusters {
        let too_close = unique.iter().any(|c| {
            let d = |i: usize| (c[i] as i32 - color[i] as i32).abs();
            d(0) + d(1) + d(2) < 48
        });
        if !too_close {
            unique.push(color);
        }
    }
    unique
}

/// v0.4.0 A5: draw dominant-color chips (circle/square/diamond/hexagon/strip)
/// with optional hex labels.
fn draw_palette_layer(
    canvas: &mut RgbaImage,
    layer: &PaletteLayer,
    geo: &CanvasGeometry,
    palette: &[[u8; 3]],
    fonts: &FontBook,
) {
    if palette.is_empty() {
        return;
    }
    let n = (layer.count as usize).min(palette.len());
    let w = geo.width as f32;
    let h = geo.height as f32;
    let photo_h = geo.photo_h as f32;
    let size = layer.size.unwrap_or(0.035) as f32 * photo_h;
    let gap = layer.gap.map(|g| g as f32 * photo_h).unwrap_or(size * 0.35);
    let vertical = matches!(layer.direction.as_deref(), Some("vertical"));
    let total = size * n as f32 + gap * (n as f32 - 1.0);
    let col_left = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft
    );
    let col_center = matches!(
        layer.anchor,
        Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter
    );
    let row_top = matches!(
        layer.anchor,
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight
    );
    let row_middle = matches!(
        layer.anchor,
        Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight
    );
    let off_x = layer.offset.x as f32 * w;
    let off_y = layer.offset.y as f32 * h;
    let (start_x, start_y) = if vertical {
        let x = if col_left {
            off_x
        } else if col_center {
            (w - size) / 2.0 + off_x
        } else {
            w + off_x - size
        };
        let y = if row_top {
            off_y
        } else if row_middle {
            (h - total) / 2.0 + off_y
        } else {
            h + off_y - total
        };
        (x, y)
    } else {
        let x = if col_left {
            off_x
        } else if col_center {
            (w - total) / 2.0 + off_x
        } else {
            w + off_x - total
        };
        let y = if row_top {
            off_y
        } else if row_middle {
            (h - size) / 2.0 + off_y
        } else {
            h + off_y - size
        };
        (x, y)
    };

    let label_font = layer.label.as_ref().and_then(|l| {
        let families = if l.family.is_empty() {
            vec!["jetbrainsmono".to_string(), "inter".to_string()]
        } else {
            l.family.clone()
        };
        fonts.pick(&families)
    });

    let mut labels: Vec<(f32, f32, [u8; 3])> = Vec::new();
    for (i, entry) in palette.iter().take(n).enumerate() {
        let color = [entry[0], entry[1], entry[2], 255];
        let (cx, cy) = if vertical {
            (start_x, start_y + i as f32 * (size + gap))
        } else {
            (start_x + i as f32 * (size + gap), start_y)
        };
        let (cw, chh) = match layer.shape {
            ChipShape::Strip => (size / 3.0, size),
            _ => (size, size),
        };
        let form = match layer.shape {
            ChipShape::Circle => ShapeForm::Ellipse,
            ChipShape::Square | ChipShape::Strip => ShapeForm::Rect { radius_px: 0.0 },
            ChipShape::Diamond => ShapeForm::Diamond,
            ChipShape::Hexagon => ShapeForm::Hexagon,
        };
        let dx = cx + (size - cw) / 2.0;
        let dy = cy + (size - chh) / 2.0;
        render_shape(canvas, dx, dy, cw, chh, form, color, 1.0, 0.0, 0.0);
        labels.push((cx, cy, *entry));
    }

    if layer.show_hex {
        if let Some(font) = label_font {
            let (size_px, color) = match &layer.label {
                Some(l) => (
                    l.size as f32 * photo_h,
                    crate::template::parse_hex_color(&l.color).unwrap_or([107, 114, 128, 255]),
                ),
                None => (0.012 * photo_h, [107u8, 114, 128, 255]),
            };
            for (cx, cy, entry) in labels {
                let text = format!("#{:02X}{:02X}{:02X}", entry[0], entry[1], entry[2]);
                let block = render_text_block(&[text], font, size_px, 1.2, 0.02, "left", color);
                let (bw, bh) = block.dimensions();
                let (lx, ly) = if vertical {
                    (cx + size + gap * 0.6, cy + (size - bh as f32) / 2.0)
                } else {
                    (cx + (size - bw as f32) / 2.0, cy + size + gap * 0.4)
                };
                composite_over(canvas, &block, lx.round() as i32, ly.round() as i32, 1.0);
            }
        }
    }
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
        let is_brand =
            layer.asset.starts_with("@builtin/brand/") || layer.asset.starts_with("@builtin/lens/");
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
        .or_else(|| {
            layer
                .size
                .width
                .map(|w| (w * geo.photo_h as f64).round().max(2.0) * ih as f64 / iw as f64)
        });
    let scale = target_h.unwrap_or(0.03 * photo_h) / ih as f64;
    let tw = ((iw as f64) * scale).round().max(2.0) as u32;
    let th = ((ih as f64) * scale).round().max(2.0) as u32;

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

    // Built-in badges pick their black/white variant by local background
    // luminance unless the template pins a tint (v0.3.0 autoTint).
    let mut rgba = rgba;
    let explicit = layer.tint.as_deref();
    let is_builtin = path.starts_with("@builtin/") && !path.ends_with("-light");
    if is_builtin && explicit != Some("light") && explicit != Some("dark") {
        let bg = region_luminance(canvas, ix, iy, tw, th);
        let want_light = bg < 0.5;
        if want_light {
            let light_path = format!("{path}-light");
            if let Some(lb) = resolve_asset_bytes(opts, &light_path) {
                if let Ok(li) = image::load_from_memory(&lb) {
                    rgba = li.to_rgba8();
                }
            }
        }
    }

    let fitted = image::imageops::resize(&rgba, tw, th, image::imageops::FilterType::Lanczos3);

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
            Ok(image::imageops::resize(
                &rgba,
                nw,
                nh,
                image::imageops::FilterType::Triangle,
            ))
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
pub fn render_rgba(photo: &[u8], template: &Template, opts: &RenderOptions) -> Result<RgbaImage> {
    let (fh, fv) = flip_flags(opts);
    let rgba = decode_oriented(photo, opts.max_edge, fh, fv)?;
    let rgba = apply_crop(rgba, opts.overrides.as_ref().and_then(|o| o.crop));
    let mut info = probe_exif(photo)?;
    apply_model_map(&mut info, &opts.model_map);
    render_rgba_with_image(&rgba, template, &info, opts)
}

/// v0.5.0 crop override: normalized rect (0–1) applied before layout.
pub(crate) fn apply_crop_public(
    img: RgbaImage,
    crop: Option<crate::template::CropRect>,
) -> RgbaImage {
    apply_crop(img, crop)
}

fn apply_crop(img: RgbaImage, crop: Option<crate::template::CropRect>) -> RgbaImage {
    let Some(c) = crop else { return img };
    let (w, h) = img.dimensions();
    let x = (c.x.clamp(0.0, 1.0) * w as f64).round() as u32;
    let y = (c.y.clamp(0.0, 1.0) * h as f64).round() as u32;
    let cw = (c.w.clamp(0.01, 1.0) * w as f64).round().max(1.0) as u32;
    let ch = (c.h.clamp(0.01, 1.0) * h as f64).round().max(1.0) as u32;
    let cw = cw.min(w.saturating_sub(x).max(1));
    let ch = ch.min(h.saturating_sub(y).max(1));
    if cw < 2 || ch < 2 {
        return img;
    }
    image::imageops::crop_imm(&img, x, y, cw, ch).to_image()
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
    // v0.4.0 B3: GPS expressions only evaluate when the user opted in.
    let gps_hidden;
    let info = if opts.keep_gps
        || (info.gps_lat.is_none() && info.gps_lon.is_none() && info.gps_alt.is_none())
    {
        info
    } else {
        gps_hidden = ExifInfo {
            gps_lat: None,
            gps_lon: None,
            gps_alt: None,
            ..info.clone()
        };
        &gps_hidden
    };
    let palette_colors = extract_palette(rgba, 8);
    let mut shaper = if opts.legacy_text_renderer {
        None
    } else {
        Some(crate::text_shape::Shaper::new(&fonts))
    };
    let text_count = count_text_layers(&template.layers);
    let mut text_layouts: std::collections::HashMap<String, TextLayout> =
        std::collections::HashMap::new();
    // v0.5.0: layers paint by explicit `z` then declaration order (photo is
    // always at the bottom). Attached badges are deferred until all text
    // layouts exist, then paint last.
    let mut order: Vec<(i32, usize)> = template
        .layers
        .iter()
        .enumerate()
        .map(|(i, l)| (layer_z(l), i))
        .collect();
    order.sort_by_key(|(z, i)| (*z, *i));
    let mut deferred_badges: Vec<&Layer> = Vec::new();
    for (_z, idx) in order {
        let layer = &template.layers[idx];
        if matches!(layer, Layer::Image(img) if img.attach_to.is_some()) {
            deferred_badges.push(layer);
            continue;
        }
        if let Some((id, layout)) = draw_layer(
            &mut canvas,
            layer,
            info,
            &fonts,
            shaper.as_mut(),
            &geo,
            overrides,
            opts,
            &palette_colors,
            text_count,
            &text_layouts,
        ) {
            text_layouts.insert(id, layout);
        }
    }
    for layer in deferred_badges {
        draw_layer(
            &mut canvas,
            layer,
            info,
            &fonts,
            shaper.as_mut(),
            &geo,
            overrides,
            opts,
            &palette_colors,
            text_count,
            &text_layouts,
        );
    }
    Ok(canvas)
}

fn layer_z(layer: &Layer) -> i32 {
    match layer {
        Layer::Text(t) => t.z.unwrap_or(0),
        Layer::Image(i) => i.z.unwrap_or(0),
        Layer::Shape(s) => s.z.unwrap_or(0),
        Layer::Palette(p) => p.z.unwrap_or(0),
        Layer::Group(g) => g.z.unwrap_or(0),
        Layer::Calendar(c) => c.z.unwrap_or(0),
    }
}

fn count_text_layers(layers: &[Layer]) -> usize {
    layers
        .iter()
        .map(|l| match l {
            Layer::Text(_) => 1,
            Layer::Group(g) => count_text_layers(&g.children),
            _ => 0,
        })
        .sum()
}

/// Draw one layer; returns the text layout when the layer was text.
#[allow(clippy::too_many_arguments)]
fn draw_layer(
    canvas: &mut RgbaImage,
    layer: &Layer,
    info: &ExifInfo,
    fonts: &FontBook,
    shaper: Option<&mut crate::text_shape::Shaper>,
    geo: &CanvasGeometry,
    overrides: Option<&TemplateOverrides>,
    opts: &RenderOptions,
    palette_colors: &[[u8; 3]],
    text_count: usize,
    text_layouts: &std::collections::HashMap<String, TextLayout>,
) -> Option<(String, TextLayout)> {
    match layer {
        Layer::Text(text) => {
            let layout = draw_text_layer(canvas, text, info, fonts, shaper, geo, overrides, opts)?;
            Some((text.id.clone(), layout))
        }
        Layer::Image(image) => {
            draw_image_layer(canvas, image, info, geo, opts, text_layouts);
            None
        }
        Layer::Shape(shape) => {
            draw_shape_layer(canvas, shape, geo, text_count);
            None
        }
        Layer::Palette(palette) => {
            draw_palette_layer(canvas, palette, geo, palette_colors, fonts);
            None
        }
        Layer::Group(group) => {
            draw_group_layer(
                canvas,
                group,
                info,
                fonts,
                shaper,
                geo,
                overrides,
                opts,
                palette_colors,
                text_count,
                text_layouts,
            );
            None
        }
        Layer::Calendar(cal) => {
            if let Some(s) = shaper {
                crate::calendar::draw_calendar_layer(
                    canvas,
                    cal,
                    info,
                    s,
                    geo,
                    (geo.width, geo.height),
                );
            }
            None
        }
    }
}

/// v0.5.0 group: children lay out inside the group box, then composite with
/// the group opacity.
#[allow(clippy::too_many_arguments)]
fn draw_group_layer(
    canvas: &mut RgbaImage,
    group: &crate::template::GroupLayer,
    info: &ExifInfo,
    fonts: &FontBook,
    mut shaper: Option<&mut crate::text_shape::Shaper>,
    geo: &CanvasGeometry,
    overrides: Option<&TemplateOverrides>,
    opts: &RenderOptions,
    palette_colors: &[[u8; 3]],
    text_count: usize,
    _outer_layouts: &std::collections::HashMap<String, TextLayout>,
) {
    let w = geo.width as f32;
    let h = geo.height as f32;
    let gw = group
        .width
        .map(|v| (v * geo.width as f64).round().max(1.0) as u32)
        .unwrap_or(geo.width);
    let gh = group
        .height
        .map(|v| (v * geo.height as f64).round().max(1.0) as u32)
        .unwrap_or(geo.height);
    let col_left = matches!(
        group.anchor,
        Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft
    );
    let col_center = matches!(
        group.anchor,
        Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter
    );
    let row_top = matches!(
        group.anchor,
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight
    );
    let row_middle = matches!(
        group.anchor,
        Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight
    );
    let off_x = group.offset.x as f32 * w;
    let off_y = group.offset.y as f32 * h;
    let gx = if col_left {
        off_x
    } else if col_center {
        (w - gw as f32) / 2.0 + off_x
    } else {
        w + off_x - gw as f32
    };
    let gy = if row_top {
        off_y
    } else if row_middle {
        (h - gh as f32) / 2.0 + off_y
    } else {
        h + off_y - gh as f32
    };
    let sub_geo = CanvasGeometry {
        width: gw,
        height: gh,
        pad_left: 0,
        pad_top: 0,
        photo_w: geo.photo_w,
        photo_h: geo.photo_h,
    };
    let mut sub = RgbaImage::new(gw, gh);
    let mut layouts: std::collections::HashMap<String, TextLayout> =
        std::collections::HashMap::new();
    let mut deferred: Vec<&Layer> = Vec::new();
    for child in &group.children {
        if matches!(child, Layer::Image(img) if img.attach_to.is_some()) {
            deferred.push(child);
            continue;
        }
        if let Some((id, layout)) = draw_layer(
            &mut sub,
            child,
            info,
            fonts,
            shaper.as_deref_mut(),
            &sub_geo,
            overrides,
            opts,
            palette_colors,
            text_count,
            &layouts,
        ) {
            layouts.insert(id, layout);
        }
    }
    for child in deferred {
        if let Some((id, layout)) = draw_layer(
            &mut sub,
            child,
            info,
            fonts,
            shaper.as_deref_mut(),
            &sub_geo,
            overrides,
            opts,
            palette_colors,
            text_count,
            &layouts,
        ) {
            layouts.insert(id, layout);
        }
    }
    composite_over(
        canvas,
        &sub,
        gx.round() as i32,
        gy.round() as i32,
        group.opacity.clamp(0.0, 1.0) as f32,
    );
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
    let img = apply_crop(img, opts.overrides.as_ref().and_then(|o| o.crop));
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
    // v0.5.0 export option: keep EXIF metadata (default on; GPS still gated
    // by keep_gps).
    let write_exif = opts.write_exif
        && opts
            .overrides
            .as_ref()
            .and_then(|o| o.metadata)
            .unwrap_or(true);
    match opts.format {
        OutputFormat::Jpeg => {
            let flat = flatten_over_white(canvas);
            let mut out = encode::encode_jpeg_quality100(&flat)?;
            let report = if write_exif {
                match photo {
                    Some(bytes) => {
                        match cleaned_exif_tiff_full(bytes, Some((cw, ch)), opts.keep_gps)? {
                            Some((tiff, report)) => {
                                encode::splice_exif_app1(&mut out, &tiff)?;
                                Some(report)
                            }
                            None => None,
                        }
                    }
                    None => None,
                }
            } else {
                None
            };
            Ok((out, report))
        }
        OutputFormat::Png => {
            let mut out = encode::encode_png(canvas)?;
            let report = if write_exif {
                match photo {
                    Some(bytes) => {
                        match cleaned_exif_tiff_full(bytes, Some((cw, ch)), opts.keep_gps)? {
                            Some((tiff, report)) => {
                                encode::splice_png_exif(&mut out, &tiff)?;
                                Some(report)
                            }
                            None => None,
                        }
                    }
                    None => None,
                }
            } else {
                None
            };
            Ok((out, report))
        }
    }
}

/// v0.5.0: public wrapper for free-collage / external callers in-crate.
pub(crate) fn encode_output_public(
    canvas: &RgbaImage,
    photo: Option<&[u8]>,
    opts: &RenderOptions,
) -> Result<(Vec<u8>, Option<crate::exif::MetadataReport>)> {
    encode_output(canvas, photo, opts)
}
