//! v0.5.0 text art: mask-based text effects (stroke/double, relief, gradient
//! fills, foil, textures, shadows, flips) plus small helpers shared by the
//! calendar layer. All effects post-process the alpha mask produced by
//! `text_shape::Shaper`, so CLI/WASM/desktop stay pixel-identical.
#![allow(
    clippy::too_many_arguments,
    clippy::needless_range_loop,
    reason = "mask/geometry kernels are intentionally expressed with explicit x/y/radius/color parameter lists and indexed pixel loops"
)]

use image::{Rgba, RgbaImage};

use crate::render::RenderOptions;
use crate::template::{parse_hex_color, TextEffects, TextStroke};
use crate::text_shape::{ShapeRequest, Shaper, TextRaster};

/// Compose the final RGBA block for a shaped text raster, including all
/// effects. Returns the image plus the (x, y) offset of the original block
/// origin inside it (effects pad the block).
pub fn compose_text_layer(
    raster: &TextRaster,
    effects: Option<&TextEffects>,
    base_color: [u8; 4],
    opacity: f32,
    opts: &RenderOptions,
    resources_dir: Option<&std::path::Path>,
) -> (RgbaImage, i32, i32) {
    let (w, h) = (raster.width as i32, raster.height as i32);
    // Padding budget for effects that paint outside the glyph box.
    let mut pad = 2i32;
    if let Some(e) = effects {
        if let Some(s) = &e.stroke {
            let sw = (s.width as f32 * mask_unit(raster)).ceil() as i32;
            let gap = (s.gap.unwrap_or(s.width) as f32 * mask_unit(raster)).ceil() as i32;
            pad = pad.max(sw + if s.double { gap + sw } else { 0 } + 2);
        }
        if let Some(r) = &e.relief {
            pad = pad.max((r.depth.unwrap_or(0.06) as f32 * mask_unit(raster)).ceil() as i32 + 3);
        }
        if let Some(s) = &e.shadow {
            let d =
                (s.offset_x.abs().max(s.offset_y.abs()) as f32 * mask_unit(raster)).ceil() as i32;
            let b = (s.blur as f32 * mask_unit(raster)).ceil() as i32;
            pad = pad.max(d + b + 2);
        }
        if let Some(sx) = e.scale_x {
            let extra = ((sx as f32 - 1.0).abs() * raster.width as f32).ceil() as i32;
            pad = pad.max(extra + 2);
        }
    }
    let pw = (w + pad * 2).max(1) as u32;
    let ph = (h + pad * 2).max(1) as u32;

    // Base mask (0..1) at padded size.
    let mut mask = vec![0f32; (pw * ph) as usize];
    for y in 0..raster.height {
        for x in 0..raster.width {
            mask[((y as i32 + pad) as u32 * pw + (x as i32 + pad) as u32) as usize] =
                raster.get(x, y);
        }
    }
    if let Some(e) = effects {
        if e.flip_x {
            mask = flip_x(&mask, pw, ph);
        }
        if e.flip_y {
            mask = flip_y(&mask, pw, ph);
        }
        if let Some(sx) = e.scale_x {
            mask = scale_x(&mask, pw, ph, sx as f32);
        }
    }

    let mut out = RgbaImage::new(pw, ph);
    let has_effects = effects.is_some();

    // Outer shadow first (behind everything).
    if let Some(e) = effects {
        if let Some(shadow) = &e.shadow {
            let color = parse_hex_color(&shadow.color).unwrap_or([0, 0, 0, 255]);
            let unit = mask_unit(raster);
            let dx = (shadow.offset_x as f32 * unit).round() as i32;
            let dy = (shadow.offset_y as f32 * unit).round() as i32;
            let blur = (shadow.blur as f32 * unit).round() as u32;
            let mut m = shift(&mask, pw, ph, dx, dy);
            if blur > 0 {
                m = blur_mask(&m, pw, ph, blur);
            }
            let a = color[3] as f32 / 255.0 * shadow.opacity as f32 * opacity;
            paint_mask(&mut out, &m, color, a);
        }
    }

    // Stroke rings (behind the fill).
    if let Some(e) = effects {
        if let Some(stroke) = &e.stroke {
            paint_stroke(&mut out, raster, &mask, pw, ph, pad, stroke, opacity);
        }
    }

    // Relief (under the fill for engrave/inner-shadow, over for emboss).
    let relief = effects.and_then(|e| e.relief.as_ref());
    let emboss_on_top = relief
        .map(|r| matches!(r.mode.as_str(), "emboss" | "letterpress"))
        .unwrap_or(false);
    if let Some(r) = relief {
        if !emboss_on_top {
            paint_relief(&mut out, raster, &mask, pw, ph, r, opacity);
        }
    }

    // Fill (solid / gradient / foil / texture) through the mask.
    let fill = effects.and_then(|e| e.fill.as_ref());
    match fill {
        Some(f) if f.mode == "gradient" || f.mode == "foil" => {
            paint_gradient_fill(&mut out, raster, &mask, pw, ph, f, base_color, opacity);
        }
        Some(f) if f.mode == "texture" => {
            let tex = f
                .texture
                .as_deref()
                .and_then(|a| crate::render::resolve_asset_bytes(opts, a))
                .or_else(|| resources_dir.and_then(|d| std::fs::read(d.join("paper.png")).ok()));
            paint_texture_fill(&mut out, raster, &mask, pw, ph, f, tex, base_color, opacity);
        }
        _ => paint_mask(
            &mut out,
            &mask,
            base_color,
            base_color[3] as f32 / 255.0 * opacity,
        ),
    }

    if let Some(r) = relief {
        if emboss_on_top {
            paint_relief(&mut out, raster, &mask, pw, ph, r, opacity);
        }
    }

    if !has_effects {
        // no-op; kept for clarity
    }
    (out, pad, pad)
}

/// Font size proxy: the mask height of one line is not known here, so effects
/// use the raster's first baseline as the em-size stand-in (stable and
/// documented in TEMPLATE-SPEC).
fn mask_unit(raster: &TextRaster) -> f32 {
    raster.first_baseline.max(1.0)
}

pub fn flip_x(mask: &[f32], w: u32, h: u32) -> Vec<f32> {
    let mut out = vec![0f32; mask.len()];
    for y in 0..h {
        for x in 0..w {
            out[(y * w + x) as usize] = mask[(y * w + (w - 1 - x)) as usize];
        }
    }
    out
}

pub fn flip_y(mask: &[f32], w: u32, h: u32) -> Vec<f32> {
    let mut out = vec![0f32; mask.len()];
    for y in 0..h {
        for x in 0..w {
            out[(y * w + x) as usize] = mask[((h - 1 - y) * w + x) as usize];
        }
    }
    out
}

pub fn scale_x(mask: &[f32], w: u32, h: u32, sx: f32) -> Vec<f32> {
    if (sx - 1.0).abs() < 0.001 {
        return mask.to_vec();
    }
    let mut out = vec![0f32; mask.len()];
    for y in 0..h {
        for x in 0..w {
            let src = x as f32 / sx;
            let x0 = src.floor() as i64;
            let t = src - x0 as f32;
            let x0 = x0.clamp(0, w as i64 - 1) as u32;
            let x1 = (x0 + 1).min(w - 1);
            let v = mask[(y * w + x0) as usize] * (1.0 - t) + mask[(y * w + x1) as usize] * t;
            out[(y * w + x) as usize] = v;
        }
    }
    out
}

pub fn shift(mask: &[f32], w: u32, h: u32, dx: i32, dy: i32) -> Vec<f32> {
    let mut out = vec![0f32; mask.len()];
    for y in 0..h as i32 {
        let sy = y - dy;
        if sy < 0 || sy >= h as i32 {
            continue;
        }
        for x in 0..w as i32 {
            let sx = x - dx;
            if sx < 0 || sx >= w as i32 {
                continue;
            }
            out[(y as u32 * w + x as u32) as usize] = mask[(sy as u32 * w + sx as u32) as usize];
        }
    }
    out
}

fn paint_mask(out: &mut RgbaImage, mask: &[f32], color: [u8; 4], opacity: f32) {
    let (w, h) = out.dimensions();
    for y in 0..h {
        for x in 0..w {
            let m = mask[(y * w + x) as usize] * opacity;
            if m <= 0.0 {
                continue;
            }
            let p = out.get_pixel_mut(x, y);
            let src_a = m * (color[3] as f32 / 255.0);
            if src_a <= 0.0 {
                continue;
            }
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

/// Squared Euclidean distance to the nearest active (>= 0.5) pixel.
fn distance_field(mask: &[f32], w: u32, h: u32) -> Vec<f32> {
    let (wi, hi) = (w as usize, h as usize);
    let mut f = vec![1e20f64; wi * hi];
    for i in 0..wi * hi {
        // seed: distance 0 at active pixels, else a large finite start.
        f[i] = if mask[i] >= 0.5 { 0.0 } else { 1e20 };
    }
    // Felzenszwalb & Huttenlocher 1D squared distance transform.
    let edt_1d = |f: &mut [f64], n: usize| {
        let mut v = vec![0usize; n];
        let mut z = vec![0f64; n + 1];
        let mut k = 0usize;
        v[0] = 0;
        z[0] = f64::NEG_INFINITY;
        z[1] = f64::INFINITY;
        for q in 1..n {
            loop {
                let vk = v[k];
                let s = ((f[q] + (q * q) as f64) - (f[vk] + (vk * vk) as f64))
                    / (2.0 * (q as f64 - vk as f64));
                if s <= z[k] && k > 0 {
                    k -= 1;
                } else {
                    z[k + 1] = s;
                    break;
                }
            }
            k += 1;
            v[k] = q;
            z[k + 1] = f64::INFINITY;
        }
        let mut out = vec![0f64; n];
        k = 0;
        for q in 0..n {
            while z[k + 1] < q as f64 {
                k += 1;
            }
            let d = q as f64 - v[k] as f64;
            out[q] = d * d + f[v[k]];
        }
        f.copy_from_slice(&out);
    };
    for y in 0..hi {
        edt_1d(&mut f[y * wi..(y + 1) * wi], wi);
    }
    for x in 0..wi {
        let mut col = vec![0f64; hi];
        for y in 0..hi {
            col[y] = f[y * wi + x];
        }
        edt_1d(&mut col, hi);
        for y in 0..hi {
            f[y * wi + x] = col[y];
        }
    }
    f.into_iter().map(|v| v as f32).collect()
}

fn blur_mask(mask: &[f32], w: u32, h: u32, radius: u32) -> Vec<f32> {
    if radius == 0 {
        return mask.to_vec();
    }
    let mut img = RgbaImage::new(w, h);
    for (i, m) in mask.iter().enumerate() {
        let x = (i as u32) % w;
        let y = (i as u32) / w;
        let a = (m.clamp(0.0, 1.0) * 255.0) as u8;
        img.put_pixel(x, y, Rgba([255, 255, 255, a]));
    }
    let blurred = crate::render::box_blur_rgba(&img, radius);
    blurred.pixels().map(|p| p.0[3] as f32 / 255.0).collect()
}

fn paint_stroke(
    out: &mut RgbaImage,
    _raster: &TextRaster,
    mask: &[f32],
    w: u32,
    h: u32,
    _pad: i32,
    stroke: &TextStroke,
    opacity: f32,
) {
    let unit = mask_unit(_raster);
    let sw = (stroke.width as f32 * unit).max(0.5);
    let color = parse_hex_color(&stroke.color).unwrap_or([0, 0, 0, 255]);
    let dist = distance_field(mask, w, h);
    let outer = |d: f32| (sw + 0.5 - d).clamp(0.0, 1.0);
    let mut ring = vec![0f32; mask.len()];
    for i in 0..mask.len() {
        let d = dist[i].sqrt();
        ring[i] = outer(d) * (1.0 - mask[i]);
    }
    paint_mask(out, &ring, color, opacity);
    if stroke.double {
        let gap = (stroke.gap.unwrap_or(stroke.width) as f32 * unit).max(0.5);
        let inner = sw * 0.5;
        let mut ring2 = vec![0f32; mask.len()];
        for i in 0..mask.len() {
            let d = dist[i].sqrt();
            let t = (d - (sw + gap)).clamp(0.0, inner + 0.5);
            ring2[i] = if d >= sw + gap && t <= inner {
                1.0 - (t / (inner + 0.5))
            } else {
                0.0
            } * (1.0 - mask[i]);
        }
        paint_mask(out, &ring2, color, opacity);
    }
}

fn paint_relief(
    out: &mut RgbaImage,
    raster: &TextRaster,
    mask: &[f32],
    w: u32,
    h: u32,
    relief: &crate::template::TextRelief,
    opacity: f32,
) {
    let unit = mask_unit(raster);
    let depth = (relief.depth.unwrap_or(0.06) as f32 * unit).max(1.0);
    let d = depth.round() as i32;
    let hi = parse_hex_color(relief.highlight.as_deref().unwrap_or("#FFFFFF"))
        .unwrap_or([255, 255, 255, 255]);
    let sh =
        parse_hex_color(relief.shadow.as_deref().unwrap_or("#000000")).unwrap_or([0, 0, 0, 255]);
    let op = relief.opacity as f32 * opacity;
    match relief.mode.as_str() {
        "emboss" => {
            // Highlight up-left, shadow down-right.
            let hl = shift(mask, w, h, -d, -d);
            let mut high = vec![0f32; mask.len()];
            let mut low = vec![0f32; mask.len()];
            for i in 0..mask.len() {
                high[i] = (hl[i] - mask[i]).max(0.0);
                low[i] = (mask[i] - hl[i]).max(0.0);
            }
            paint_mask(out, &low, sh, op * 0.8);
            paint_mask(out, &high, hi, op);
        }
        "letterpress" => {
            // Pressed in: shadow up-left, highlight down-right.
            let hl = shift(mask, w, h, d, d);
            let mut side = vec![0f32; mask.len()];
            for i in 0..mask.len() {
                side[i] = (mask[i] - hl[i]).max(0.0);
            }
            paint_mask(out, &side, hs_darken(sh), op * 0.5);
            let hl2 = shift(mask, w, h, -d, -d);
            let mut side2 = vec![0f32; mask.len()];
            for i in 0..mask.len() {
                side2[i] = (hl2[i] - mask[i]).max(0.0);
            }
            paint_mask(out, &side2, hi, op * 0.6);
        }
        "engrave" => {
            let hl = shift(mask, w, h, -d, -d);
            let mut low = vec![0f32; mask.len()];
            for i in 0..mask.len() {
                low[i] = (mask[i] - hl[i]).max(0.0);
            }
            paint_mask(out, &low, hs_darken(sh), op * 0.9);
            let hl2 = shift(mask, w, h, d, d);
            let mut high = vec![0f32; mask.len()];
            for i in 0..mask.len() {
                high[i] = (hl2[i] - mask[i]).max(0.0);
            }
            paint_mask(out, &high, hi, op * 0.5);
        }
        _ => {
            // inner-shadow: darken inside near the edges.
            let erode = shift(mask, w, h, 0, 0);
            let inner = distance_field(&erode, w, h);
            let mut shade = vec![0f32; mask.len()];
            for i in 0..mask.len() {
                let d2 = inner[i].sqrt();
                shade[i] = mask[i] * (1.0 - (d2 / depth.max(0.5)).clamp(0.0, 1.0));
            }
            paint_mask(out, &shade, hs_darken(sh), op * 0.8);
        }
    }
}

fn hs_darken(c: [u8; 4]) -> [u8; 4] {
    [
        ((c[0] as u16 * 3) / 5) as u8,
        ((c[1] as u16 * 3) / 5) as u8,
        ((c[2] as u16 * 3) / 5) as u8,
        c[3],
    ]
}

fn paint_gradient_fill(
    out: &mut RgbaImage,
    _raster: &TextRaster,
    mask: &[f32],
    w: u32,
    h: u32,
    fill: &crate::template::TextFill,
    base_color: [u8; 4],
    opacity: f32,
) {
    let intensity = fill.intensity.unwrap_or(1.0) as f32;
    let stops: Vec<[u8; 4]> = if fill.colors.is_empty() {
        let c = base_color;
        vec![
            [
                c[0].saturating_add(30),
                c[1].saturating_add(30),
                c[2].saturating_add(20),
                c[3],
            ],
            [
                c[0].saturating_sub(40).max(8),
                c[1].saturating_sub(40).max(8),
                c[2].saturating_sub(40).max(8),
                c[3],
            ],
        ]
    } else {
        fill.colors
            .iter()
            .map(|c| parse_hex_color(c).unwrap_or(base_color))
            .collect()
    };
    let angle = fill.angle.unwrap_or(90.0) as f32;
    let (sin_a, cos_a) = angle.to_radians().sin_cos();
    let wf = w as f32;
    let hf = h as f32;
    let cx = wf / 2.0;
    let cy = hf / 2.0;
    let norm = (wf * cos_a.abs() + hf * sin_a.abs()).max(1.0);
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) as usize;
            let m = mask[i];
            if m <= 0.0 {
                continue;
            }
            // Gradient coordinate: projection onto the angle axis, normalized.
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let proj = dx * cos_a + dy * sin_a;
            let mut t = (proj / norm + 0.5).clamp(0.0, 1.0);
            let mut color = sample_stops(&stops, t);
            if fill.mode == "foil" {
                // Specular band sweeping across the glyphs.
                let band = ((proj - (cx * cos_a + cy * sin_a).cos()) / (wf * 0.16))
                    .sin()
                    .abs();
                let spec = (1.0 - band).powi(3) * intensity;
                color = [
                    (color[0] as f32 + (255.0 - color[0] as f32) * spec).min(255.0) as u8,
                    (color[1] as f32 + (255.0 - color[1] as f32) * spec).min(255.0) as u8,
                    (color[2] as f32 + (255.0 - color[2] as f32) * spec).min(255.0) as u8,
                    color[3],
                ];
                t = t.clamp(0.0, 1.0);
                let _ = t;
            }
            let p = out.get_pixel_mut(x, y);
            let src_a = m * opacity * (color[3] as f32 / 255.0);
            if src_a <= 0.0 {
                continue;
            }
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

fn sample_stops(stops: &[[u8; 4]], t: f32) -> [u8; 4] {
    if stops.is_empty() {
        return [0, 0, 0, 255];
    }
    if stops.len() == 1 {
        return stops[0];
    }
    let t = t.clamp(0.0, 1.0) * (stops.len() - 1) as f32;
    let i = t.floor() as usize;
    let i1 = (i + 1).min(stops.len() - 1);
    let f = t - i as f32;
    let mut out = [0u8; 4];
    for ch in 0..4 {
        out[ch] = (stops[i][ch] as f32 * (1.0 - f) + stops[i1][ch] as f32 * f).round() as u8;
    }
    out
}

fn paint_texture_fill(
    out: &mut RgbaImage,
    _raster: &TextRaster,
    mask: &[f32],
    w: u32,
    h: u32,
    fill: &crate::template::TextFill,
    texture: Option<Vec<u8>>,
    base_color: [u8; 4],
    opacity: f32,
) {
    let intensity = fill.intensity.unwrap_or(1.0) as f32;
    let tex = texture
        .and_then(|b| image::load_from_memory(&b).ok())
        .map(|i| i.to_rgba8());
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) as usize;
            let m = mask[i];
            if m <= 0.0 {
                continue;
            }
            let mut color = base_color;
            if let Some(t) = &tex {
                let (tw, th) = t.dimensions();
                let tx = (x as u64 * tw as u64 / w.max(1) as u64) as u32;
                let ty = (y as u64 * th as u64 / h.max(1) as u64) as u32;
                let tp = t.get_pixel(tx.min(tw - 1), ty.min(th - 1)).0;
                let lum = (tp[0] as f32 * 0.3 + tp[1] as f32 * 0.59 + tp[2] as f32 * 0.11) / 255.0;
                let f = (1.0 - intensity) + intensity * (0.35 + lum * 0.9);
                color = [
                    (base_color[0] as f32 * f).min(255.0) as u8,
                    (base_color[1] as f32 * f).min(255.0) as u8,
                    (base_color[2] as f32 * f).min(255.0) as u8,
                    base_color[3],
                ];
            }
            let p = out.get_pixel_mut(x, y);
            let src_a = m * opacity * (color[3] as f32 / 255.0);
            if src_a <= 0.0 {
                continue;
            }
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

/// Shape a single-line string and paint it solid at (x, y) onto `canvas`.
/// Returns the drawn size. Used by the calendar layer.
pub fn draw_solid_text(
    canvas: &mut RgbaImage,
    shaper: &mut Shaper,
    text: &str,
    families: &[String],
    size_px: f32,
    color: [u8; 4],
    x: i32,
    y: i32,
    opacity: f32,
) -> (u32, u32) {
    let req = ShapeRequest {
        text,
        families,
        weight: None,
        size_px,
        line_height: 1.2,
        letter_spacing_em: 0.0,
        align: "left",
        max_width: None,
        features: &[],
    };
    let Some(raster) = shaper.shape(&req) else {
        return (0, 0);
    };
    let (w, h) = (raster.width, raster.height);
    let mut layer = RgbaImage::new(w, h);
    let opacity = opacity.clamp(0.0, 1.0);
    for py in 0..h {
        for px in 0..w {
            let m = raster.get(px, py) * opacity;
            if m <= 0.0 {
                continue;
            }
            let a = m * (color[3] as f32 / 255.0);
            layer.put_pixel(
                px,
                py,
                Rgba([color[0], color[1], color[2], (a * 255.0) as u8]),
            );
        }
    }
    crate::render::composite_over(canvas, &layer, x, y, 1.0);
    (w, h)
}
