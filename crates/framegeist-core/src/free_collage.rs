//! v0.5.0 free collage: absolute-positioned photo items on a user canvas
//! (drag/scale/rotate/z/radius/border/crop), PRD C5 + v0.5 §3 拼图.
use serde::Deserialize;

use crate::render::{RenderOptions, Sampling};
use crate::template::{parse_hex_color, CropRect};
use crate::{Error, Result};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FreeSpec {
    /// Output canvas size in pixels (64–8192).
    pub width: u32,
    pub height: u32,
    #[serde(default = "default_background")]
    pub background: String,
    #[serde(default)]
    pub items: Vec<FreeItem>,
}

fn default_background() -> String {
    "#FFFFFF".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FreeItem {
    /// Index into the supplied photo list.
    pub photo: usize,
    /// Center position, normalized to the canvas (may exceed 0..1, clipped).
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Width, normalized to the canvas width (default 0.5).
    #[serde(default = "default_item_w")]
    pub w: f64,
    /// Height, normalized to the canvas height; default keeps the photo aspect.
    #[serde(default)]
    pub h: Option<f64>,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub z: i32,
    /// Corner radius, relative to min(w_px, h_px) (0–0.5).
    #[serde(default)]
    pub radius: Option<f64>,
    #[serde(default)]
    pub border: Option<FreeBorder>,
    #[serde(default)]
    pub crop: Option<CropRect>,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
}

fn default_item_w() -> f64 {
    0.5
}

fn default_opacity() -> f64 {
    1.0
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FreeBorder {
    /// Border width in canvas pixels (0–64).
    pub width: f64,
    #[serde(default = "default_border_color")]
    pub color: String,
}

fn default_border_color() -> String {
    "#FFFFFF".to_string()
}

impl FreeSpec {
    pub fn validate(&self) -> Result<()> {
        if !(64..=8192).contains(&self.width) || !(64..=8192).contains(&self.height) {
            return Err(Error::SchemaViolation(format!(
                "free collage canvas must be 64-8192 px (got {}x{})",
                self.width, self.height
            )));
        }
        if self.items.len() > 64 {
            return Err(Error::SchemaViolation(
                "free collage supports at most 64 items".into(),
            ));
        }
        parse_hex_color(&self.background)?;
        for (i, item) in self.items.iter().enumerate() {
            if !(0.01..=2.0).contains(&item.w) {
                return Err(Error::SchemaViolation(format!(
                    "items[{i}].w must be within [0.01, 2]"
                )));
            }
            if let Some(h) = item.h {
                if !(0.01..=2.0).contains(&h) {
                    return Err(Error::SchemaViolation(format!(
                        "items[{i}].h must be within [0.01, 2]"
                    )));
                }
            }
            if !(-360.0..=360.0).contains(&item.rotation) {
                return Err(Error::SchemaViolation(format!(
                    "items[{i}].rotation must be within [-360, 360]"
                )));
            }
            if let Some(r) = item.radius {
                if !(0.0..=0.5).contains(&r) {
                    return Err(Error::SchemaViolation(format!(
                        "items[{i}].radius must be within [0, 0.5]"
                    )));
                }
            }
            if let Some(b) = &item.border {
                if !(0.0..=64.0).contains(&b.width) {
                    return Err(Error::SchemaViolation(format!(
                        "items[{i}].border.width must be within [0, 64]"
                    )));
                }
                parse_hex_color(&b.color)?;
            }
            if !(0.0..=1.0).contains(&item.opacity) {
                return Err(Error::SchemaViolation(format!(
                    "items[{i}].opacity must be within [0, 1]"
                )));
            }
        }
        Ok(())
    }
}

pub fn load_free_spec(json: &[u8]) -> Result<FreeSpec> {
    if json.len() > 64 * 1024 {
        return Err(Error::TemplateTooLarge {
            size: json.len(),
            max: 64 * 1024,
        });
    }
    let value: serde_json::Value = serde_json::from_slice(json)?;
    crate::sandbox::check(&value)?;
    let spec: FreeSpec = serde_json::from_value(value)
        .map_err(|e| Error::SchemaViolation(format!("free collage rejected: {e}")))?;
    spec.validate()?;
    Ok(spec)
}

/// Render a free collage to encoded bytes.
pub fn render_free_collage(
    photos: &[&[u8]],
    spec: &FreeSpec,
    opts: &RenderOptions,
) -> Result<Vec<u8>> {
    spec.validate()?;
    if spec.items.is_empty() {
        return Err(Error::Image("free collage needs at least one item".into()));
    }
    let filt = match opts.sampling {
        Sampling::Preview => image::imageops::FilterType::Triangle,
        Sampling::Full => image::imageops::FilterType::Lanczos3,
    };
    let bg = parse_hex_color(&spec.background).unwrap_or([255, 255, 255, 255]);
    let mut canvas = image::RgbaImage::from_pixel(spec.width, spec.height, image::Rgba(bg));
    let mut order: Vec<(i32, usize)> = spec
        .items
        .iter()
        .enumerate()
        .map(|(i, it)| (it.z, i))
        .collect();
    order.sort_by_key(|(z, i)| (*z, *i));
    let mut used = 0usize;
    for (_, idx) in order {
        let item = &spec.items[idx];
        let Some(bytes) = photos.get(item.photo) else {
            return Err(Error::Image(format!(
                "free collage item {} references missing photo {}",
                idx, item.photo
            )));
        };
        let mut img = crate::render::decode_oriented(bytes, None, false, false)?;
        if let Some(crop) = item.crop {
            img = crate::render::apply_crop_public(img, Some(crop));
        }
        let tw = (item.w * spec.width as f64).round().max(4.0) as u32;
        let th = match item.h {
            Some(h) => (h * spec.height as f64).round().max(4.0) as u32,
            None => {
                let ar = img.height() as f64 / img.width().max(1) as f64;
                (tw as f64 * ar).round().max(4.0) as u32
            }
        };
        let fitted = image::imageops::resize(&img, tw, th, filt);
        // Optional border is a filled backing plate; radius rounds both.
        let radius_px = item.radius.map(|r| r as f32 * tw.min(th) as f32).unwrap_or(0.0);
        let (plate_w, plate_h) = match &item.border {
            Some(b) => {
                let bw = b.width.round().max(0.0) as u32 * 2;
                (tw + bw, th + bw)
            }
            None => (tw, th),
        };
        let mut plate = image::RgbaImage::from_pixel(plate_w, plate_h, image::Rgba([0, 0, 0, 0]));
        if let Some(b) = &item.border {
            let bc = parse_hex_color(&b.color).unwrap_or([255, 255, 255, 255]);
            for px in plate.pixels_mut() {
                *px = image::Rgba(bc);
            }
        }
        let ox = ((plate_w - tw) / 2) as i64;
        let oy = ((plate_h - th) / 2) as i64;
        if radius_px >= 0.5 {
            let rounded = rounded_alpha(&fitted, radius_px);
            image::imageops::overlay(&mut plate, &rounded, ox, oy);
        } else {
            image::imageops::overlay(&mut plate, &fitted, ox, oy);
        }
        let rotated = if item.rotation.abs() > 0.01 {
            rotate_keep(&plate, item.rotation as f32)
        } else {
            plate
        };
        let (rw, rh) = rotated.dimensions();
        let cx = (item.x * spec.width as f64).round() as i64;
        let cy = (item.y * spec.height as f64).round() as i64;
        let x = cx - rw as i64 / 2;
        let y = cy - rh as i64 / 2;
        crate::render::composite_over(&mut canvas, &rotated, x as i32, y as i32, item.opacity.clamp(0.0, 1.0) as f32);
        used += 1;
    }
    if used == 0 {
        return Err(Error::Image("free collage rendered nothing".into()));
    }
    let photo_bytes = photos.first().copied();
    let mut flat = canvas;
    for px in flat.pixels_mut() {
        px.0[3] = 255;
    }
    let (out, _report) = crate::render::encode_output_public(&flat, photo_bytes, opts)?;
    Ok(out)
}

/// Round the four corners via an alpha mask (same math as the photo radius).
fn rounded_alpha(img: &image::RgbaImage, radius_px: f32) -> image::RgbaImage {
    let (w, h) = img.dimensions();
    let r = radius_px.min(w.min(h) as f32 / 2.0).max(0.5);
    let mut out = img.clone();
    for (cx, cy) in [
        (r, r),
        (w as f32 - r, r),
        (r, h as f32 - r),
        (w as f32 - r, h as f32 - r),
    ] {
        let inside_x_positive = cx >= w as f32 / 2.0;
        let inside_y_positive = cy >= h as f32 / 2.0;
        let x0 = (cx - r - 1.0).max(0.0) as u32;
        let y0 = (cy - r - 1.0).max(0.0) as u32;
        let x1 = (cx + r + 1.0).min(w as f32) as u32;
        let y1 = (cy + r + 1.0).min(h as f32) as u32;
        for py in y0..y1 {
            for px in x0..x1 {
                let inside_x = if inside_x_positive { px as f32 + 0.5 > cx } else { px as f32 + 0.5 < cx };
                let inside_y = if inside_y_positive { py as f32 + 0.5 > cy } else { py as f32 + 0.5 < cy };
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

/// Rotate an image keeping it fully visible (transparent padding).
fn rotate_keep(img: &image::RgbaImage, degrees: f32) -> image::RgbaImage {
    let (w, h) = img.dimensions();
    let diag = ((w as f32).hypot(h as f32)).ceil().max(1.0) as u32;
    let mut padded = image::RgbaImage::new(diag, diag);
    let ox = ((diag - w) / 2) as i64;
    let oy = ((diag - h) / 2) as i64;
    image::imageops::overlay(&mut padded, img, ox, oy);
    imageproc::geometric_transformations::rotate_about_center(
        &padded,
        degrees.to_radians(),
        imageproc::geometric_transformations::Interpolation::Bilinear,
        image::Rgba([0, 0, 0, 0]),
    )
}
