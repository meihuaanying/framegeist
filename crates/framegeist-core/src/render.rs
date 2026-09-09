use std::path::PathBuf;

use ab_glyph::PxScale;
use image::{GenericImage, ImageBuffer, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;

use crate::exif::{cleaned_exif_tiff, probe_exif, ExifInfo};
use crate::sandbox::eval_expr;
use crate::template::{
    Anchor, BgKind, CanvasMode, Layer, Template, TextLayer,
};
use crate::text::FontBook;
use crate::{encode, Result};

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
    pub fonts: Option<crate::text::FontBook>,
    pub write_exif: bool,
    pub keep_gps: bool,
}

impl Default for RenderOptions {
    fn default() -> Self {
        RenderOptions {
            format: OutputFormat::Jpeg,
            sampling: Sampling::Full,
            assets_dir: None,
            fonts: None,
            write_exif: true,
            keep_gps: false,
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

struct CanvasGeometry {
    width: u32,
    height: u32,
    pad_left: u32,
    pad_top: u32,
    photo_h: u32,
}

fn compute_geometry(t: &Template, photo: &RgbaImage) -> CanvasGeometry {
    let (w, h) = photo.dimensions();
    let (pad_left, pad_top, pad_right, pad_bottom) = match t.canvas.mode {
        CanvasMode::Extend => {
            let p = &t.canvas.padding;
            (
                (p.left * w as f64).round() as u32,
                (p.top * h as f64).round() as u32,
                (p.right * w as f64).round() as u32,
                (p.bottom * h as f64).round() as u32,
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

fn build_canvas(
    geo: &CanvasGeometry,
    photo: &RgbaImage,
    t: &Template,
    filt: image::imageops::FilterType,
) -> RgbaImage {
    let mut canvas = ImageBuffer::new(geo.width, geo.height);
    let bg = &t.canvas.background;
    match (t.canvas.mode, bg.kind) {
        (CanvasMode::Overlay, _) | (_, BgKind::None) | (CanvasMode::Cover, _) => {
            canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
        }
        (CanvasMode::Extend, BgKind::Solid) => {
            let color = bg
                .color
                .as_deref()
                .and_then(|c| crate::template::parse_hex_color(c).ok())
                .unwrap_or([255u8, 255, 255, 255]);
            for px in canvas.pixels_mut() {
                *px = Rgba(color);
            }
            canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
        }
        (CanvasMode::Extend, BgKind::Blur) => {
            let bg_scale = bg.scale.unwrap_or(1.2);
            let tw = ((geo.width as f64) * bg_scale).ceil().max(1.0) as u32;
            let th = ((geo.height as f64) * bg_scale).ceil().max(1.0) as u32;
            let scaled = resize_to_cover(photo, tw, th, filt);
            let radius = ((bg.blur.unwrap_or(40.0) as u32) / 3).max(1);
            let blurred = box_blur_rgba(&scaled, radius);
            let cover = center_crop(&blurred, geo.width, geo.height);
            canvas.copy_from(&cover, 0, 0).ok();
            canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
        }
        (CanvasMode::Extend, BgKind::Image) => {
            canvas.copy_from(photo, geo.pad_left, geo.pad_top).ok();
        }
    }
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

fn draw_text_layer(
    canvas: &mut RgbaImage,
    layer: &TextLayer,
    info: &ExifInfo,
    fonts: &FontBook,
    geo: &CanvasGeometry,
) {
    let lines = text_lines(layer, info);
    if lines.is_empty() {
        return;
    }
    let Some(font) = fonts.pick(&layer.font.family) else {
        return;
    };
    let size_px = (layer.font.size * geo.photo_h as f64) as f32;
    let scale = PxScale::from(size_px);
    let color = crate::template::parse_hex_color(&layer.font.color).unwrap_or([0, 0, 0, 255]);
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
        h - total_h - off_y
    };

    for (i, line) in lines.iter().enumerate() {
        let (lw, _lh) = sizes[i];
        let x = if align_left {
            off_x
        } else if align_center {
            (w - lw) / 2.0 + off_x
        } else {
            w - off_x - lw
        };
        let y = base_y + line_h * i as f32;
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
}

/// Render a photo against a template into an RGBA canvas. Preview and export
/// share this exact code path; only `RenderOptions.sampling` differs (PRD A5).
pub fn render_rgba(
    photo: &[u8],
    template: &Template,
    opts: &RenderOptions,
) -> Result<RgbaImage> {
    let img = image::load_from_memory(photo)?;
    let rgba = img.to_rgba8();
    let info = probe_exif(photo)?;
    let geo = compute_geometry(template, &rgba);
    let filt = filter(opts.sampling);
    let mut canvas = build_canvas(&geo, &rgba, template, filt);
    let fonts = match &opts.fonts {
        Some(book) => book.clone(),
        None => match &opts.assets_dir {
            Some(dir) => FontBook::load(&dir.join("fonts"))?,
            None => FontBook::empty(),
        },
    };
    for layer in &template.layers {
        if let Layer::Text(text) = layer {
            draw_text_layer(&mut canvas, text, &info, &fonts, &geo);
        }
        // Image layers resolve template-pack assets; skipped in the engine
        // skeleton until template packs ship (PRD E1).
    }
    Ok(canvas)
}

/// Full render pipeline: decode -> render -> encode -> metadata write-back.
pub fn render(photo: &[u8], template: &Template, opts: &RenderOptions) -> Result<Vec<u8>> {
    let canvas = render_rgba(photo, template, opts)?;
    encode_output(&canvas, photo, opts)
}

/// Encode an RGBA canvas with the configured format + metadata write-back.
pub(crate) fn encode_output(canvas: &RgbaImage, photo: &[u8], opts: &RenderOptions) -> Result<Vec<u8>> {
    match opts.format {
        OutputFormat::Jpeg => {
            let mut out = encode::encode_jpeg_quality100(canvas)?;
            if opts.write_exif {
                if let Some(tiff) = cleaned_exif_tiff(photo)? {
                    encode::splice_exif_app1(&mut out, &tiff)?;
                }
            }
            Ok(out)
        }
        OutputFormat::Png => {
            let mut out = encode::encode_png(canvas)?;
            if opts.write_exif {
                if let Some(tiff) = cleaned_exif_tiff(photo)? {
                    encode::splice_png_exif(&mut out, &tiff)?;
                }
            }
            Ok(out)
        }
    }
}
