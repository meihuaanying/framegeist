use image::{GenericImage, ImageBuffer, Rgba, RgbaImage};

use crate::exif::probe_exif;
use crate::layout::Layout;
use crate::render::{encode_output, filter};
use crate::template::parse_hex_color;
use crate::text::FontBook;
use crate::{Error, Result};

/// Cover-fit `photo` into a `w x h` box with the configured sampling filter.
fn cover_fit(photo: &RgbaImage, w: u32, h: u32, filt: image::imageops::FilterType) -> RgbaImage {
    let (pw, ph) = photo.dimensions();
    let scale = (w as f64 / pw as f64).max(h as f64 / ph as f64);
    let nw = ((pw as f64) * scale).ceil().max(1.0) as u32;
    let nh = ((ph as f64) * scale).ceil().max(1.0) as u32;
    let scaled = image::imageops::resize(photo, nw, nh, filt);
    let x = scaled.width().saturating_sub(w) / 2;
    let y = scaled.height().saturating_sub(h) / 2;
    image::imageops::crop_imm(&scaled, x, y, w.min(scaled.width()), h.min(scaled.height()))
        .to_image()
}

fn draw_info_line(
    canvas: &mut RgbaImage,
    text: &str,
    x: i32,
    y: i32,
    color: [u8; 4],
    scale: ab_glyph::PxScale,
    font: &ab_glyph::FontArc,
) {
    imageproc::drawing::draw_text_mut(canvas, Rgba(color), x, y, scale, font, text);
}

/// Render a collage: `photos` fill `layout.cells` in order (extra photos are
/// ignored, unfilled cells stay background). With `info_bar.enabled`, each
/// filled cell gets a one-line EXIF caption (model + exposure) drawn at its
/// bottom edge. Output metadata comes from the first photo (PRD B2/B3).
pub fn render_collage(
    photos: &[&[u8]],
    layout: &Layout,
    opts: &crate::RenderOptions,
) -> Result<Vec<u8>> {
    if photos.is_empty() {
        return Err(Error::Image("collage needs at least one photo".into()));
    }
    let base_w: u32 = 3000;
    let base_h = ((base_w as f64) / layout.aspect).round().max(1.0) as u32;
    let mut canvas = ImageBuffer::new(base_w, base_h);
    let bg = parse_hex_color(&layout.background).unwrap_or([255, 255, 255, 255]);
    for px in canvas.pixels_mut() {
        *px = Rgba(bg);
    }

    let filt = filter(opts.sampling);
    let gutter_x = (layout.gutter * base_w as f64).round() as i64;
    let gutter_y = (layout.gutter * base_h as f64).round() as i64;
    let filled = photos.len().min(layout.cells.len());

    let fonts = match &opts.fonts {
        Some(book) => book.clone(),
        None => match &opts.assets_dir {
            Some(dir) => FontBook::load(&dir.join("fonts"))?,
            None => FontBook::empty(),
        },
    };
    let font = fonts.pick(&["JetBrains Mono".to_string()]).cloned();
    let info_px = base_h as f64 * layout.info_bar.height * 0.32;
    let scale = ab_glyph::PxScale::from(info_px as f32);
    let info_color = parse_hex_color(&layout.info_bar.text_color).unwrap_or([85, 85, 85, 255]);

    for (i, cell) in layout.cells.iter().take(filled).enumerate() {
        let rgba = crate::render::decode_oriented(photos[i], None, false, false)?;

        let x0 = (cell.x * base_w as f64).round() as i64 + gutter_x;
        let y0 = (cell.y * base_h as f64).round() as i64 + gutter_y;
        let x1 = ((cell.x + cell.w) * base_w as f64).round() as i64 - gutter_x;
        let y1 = ((cell.y + cell.h) * base_h as f64).round() as i64 - gutter_y;
        let (cw, ch) = ((x1 - x0).max(2) as u32, (y1 - y0).max(2) as u32);
        let fitted = cover_fit(&rgba, cw, ch, filt);
        canvas
            .copy_from(&fitted, x0.max(0) as u32, y0.max(0) as u32)
            .map_err(|e| Error::Image(e.to_string()))?;

        if layout.info_bar.enabled {
            if let Some(font) = &font {
                let mut info = probe_exif(photos[i])?;
                crate::render::apply_model_map(&mut info, &opts.model_map);
                let model = info
                    .get("model_pretty")
                    .unwrap_or_else(|| "Unknown".to_string());
                let params = info
                    .get("aperture")
                    .map(|a| format!("f/{a}  ISO{}", info.get("iso").unwrap_or_default()))
                    .unwrap_or_default();
                let line = format!("{model}   {params}");
                let text_y = y0 + (ch as i64) - (info_px * 1.6).round() as i64;
                draw_info_line(
                    &mut canvas,
                    &line,
                    (x0.max(0) as u32 + (cw as f64 * 0.02) as u32) as i32,
                    text_y.max(0) as i32,
                    info_color,
                    scale,
                    font,
                );
            }
        }
    }

    encode_output(&canvas, Some(photos[0]), opts).map(|(bytes, _report)| bytes)
}
