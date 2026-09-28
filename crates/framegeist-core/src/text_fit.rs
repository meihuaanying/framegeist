//! v1.0.0 info-block auto-fit.
//!
//! Places up to three info lines inside a whitespace region so the visible text
//! block fills ~2/3 of that region (height on the bottom side, width on the
//! left/right sides), with deterministic, region-clamped sizes.
//!
//! This module is the single source of truth for both the renderer
//! (`render::draw_info_block`) and the geometry API (`boxes::layer_boxes`), so
//! layer boxes can never drift from the painted pixels (v0.9.4 lesson).

use crate::exif::ExifInfo;
use crate::render::CanvasGeometry;
use crate::sandbox::eval_expr_locale;
use crate::template::{InfoBlock, Side};
use crate::text_shape::{ShapeRequest, Shaper};

/// v1.0.0: evaluates the info block's lines exactly like `render::text_lines`
/// does for text layers (expression, then fallback, then drop empties).
pub(crate) fn block_lines(ib: &InfoBlock, info: &ExifInfo, locale: &str) -> Vec<String> {
    ib.lines
        .iter()
        .filter_map(|line| {
            eval_expr_locale(&line.expr, info, locale).or_else(|| line.fallback.clone())
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// Role table: size ratio vs the block base size, default weight, tracking (em).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct RoleSpec {
    pub name: &'static str,
    pub ratio: f32,
    pub weight: u32,
    pub tracking_em: f32,
}

pub(crate) fn role_spec(role: Option<&str>) -> RoleSpec {
    match role.unwrap_or("support") {
        "display" => RoleSpec {
            name: "display",
            ratio: 1.0,
            weight: 600,
            tracking_em: -0.02,
        },
        "detail" => RoleSpec {
            name: "detail",
            ratio: 0.58,
            weight: 400,
            tracking_em: 0.08,
        },
        _ => RoleSpec {
            name: "support",
            ratio: 0.72,
            weight: 400,
            tracking_em: 0.0,
        },
    }
}

/// Whitespace region of a side in canvas px: `(x, y, w, h)`.
///
/// The bottom band spans the photo width; the side bands span the photo height.
pub(crate) fn region(geo: &CanvasGeometry, side: Side) -> (f32, f32, f32, f32) {
    let w = geo.width as f32;
    let pl = geo.pad_left as f32;
    let pt = geo.pad_top as f32;
    let pw = geo.photo_w as f32;
    let ph = geo.photo_h as f32;
    let pr = (w - pl - pw).max(0.0);
    let pb = ((geo.height as f32) - pt - ph).max(0.0);
    match side {
        Side::Bottom => (pl, pt + ph, (w - pl - pr).max(0.0), pb),
        Side::Left => (0.0, pt, pl, ph),
        Side::Right => ((w - pr).max(0.0), pt, pr, ph),
    }
}

#[derive(Debug, Clone)]
pub(crate) struct FitLine {
    pub text: String,
    pub role: &'static str,
    pub size_px: f32,
    pub weight: u32,
    pub tracking_em: f32,
    pub ink_w: f32,
    pub ink_h: f32,
    /// Ink-box origin in canvas px (top-left of the tight glyph bbox).
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone)]
pub(crate) struct InfoFit {
    /// Base (display-role) size in canvas px — consumed by geometry assertions.
    #[allow(dead_code)]
    pub base_px: f32,
    /// Visible ink extent of the whole block: `(x, y, w, h)` in canvas px.
    pub block: (f32, f32, f32, f32),
    pub lines: Vec<FitLine>,
}

/// Fit the info lines into the whitespace region of `block.side`.
///
/// Deterministic: pure function of the template block, the resolved line texts,
/// the canvas geometry and the font database.
pub(crate) fn fit(
    block: &InfoBlock,
    lines: &[String],
    geo: &CanvasGeometry,
    shaper: &mut Shaper,
) -> Option<InfoFit> {
    if lines.is_empty() || lines.len() > 3 {
        return None;
    }
    let side = block.side_enum()?;
    let (rx, ry, rw, rh) = region(geo, side);
    if rw < 8.0 || rh < 8.0 {
        return None;
    }
    let families = &block.font.family;
    if families.is_empty() {
        return None;
    }
    let fill = block.fill_ratio() as f32;
    let line_height = block.line_height_value() as f32;
    let min_px = ((block.size_min_ratio() as f32) * (geo.photo_h as f32)).max(1.0);
    let max_px = ((block.size_max_ratio() as f32) * (geo.photo_h as f32)).max(min_px + 0.5);

    // 1) Measure every line once at a reference size (vector text scales
    //    linearly, so a single measurement per line is enough).
    let s_ref = max_px.clamp(16.0, 512.0);
    struct Meas {
        spec: RoleSpec,
        weight: u32,
        ink_w: f32,
        ink_h: f32,
    }
    let mut meas: Vec<Meas> = Vec::with_capacity(lines.len());
    for (i, text) in lines.iter().enumerate() {
        let spec = role_spec(block.lines.get(i).and_then(|l| l.role.as_deref()));
        let weight = block.font.weight.unwrap_or(spec.weight);
        let raster = shaper.shape(&ShapeRequest {
            text,
            families,
            weight: Some(weight),
            size_px: s_ref,
            line_height,
            letter_spacing_em: spec.tracking_em,
            align: "left",
            max_width: None,
            features: &[],
        })?;
        meas.push(Meas {
            spec,
            weight,
            ink_w: raster.width as f32,
            ink_h: raster.height as f32,
        });
    }

    // 2) Solve the base size (the display line's size; line i = base * ratio_i).
    // v1.0.0: the inter-line gap follows the block's lineHeight (leading = lineHeight - 1).
    let gap_ratio: f32 = (block.line_height_value() as f32 - 1.0).clamp(0.15, 0.6); // inter-line gap vs the taller neighbour size
    let unit_h: Vec<f32> = meas
        .iter()
        .map(|m| (m.ink_h / s_ref) * m.spec.ratio)
        .collect();
    let unit_w: Vec<f32> = meas
        .iter()
        .map(|m| (m.ink_w / s_ref) * m.spec.ratio)
        .collect();
    let gaps_unit: f32 = meas
        .iter()
        .enumerate()
        .skip(1)
        .map(|(i, m)| gap_ratio * m.spec.ratio.max(meas[i - 1].spec.ratio))
        .sum();
    let total_h_unit: f32 = unit_h.iter().sum::<f32>() + gaps_unit;
    let widest_unit: f32 = unit_w.iter().copied().fold(0.0f32, f32::max);
    if total_h_unit <= 0.0 || widest_unit <= 0.0 {
        return None;
    }

    let mut s = match side {
        Side::Bottom => (fill * rh) / total_h_unit,
        Side::Left | Side::Right => (fill * rw) / widest_unit,
    };
    s = s.clamp(min_px, max_px);
    // Never overflow the region on either axis.
    let block_h_at = |s: f32| total_h_unit * s;
    let block_w_at = |s: f32| widest_unit * s;
    let fh = if block_h_at(s) > rh {
        rh / block_h_at(s)
    } else {
        1.0
    };
    let fw = if block_w_at(s) > rw {
        rw / block_w_at(s)
    } else {
        1.0
    };
    s *= fh.min(fw);

    // 3) Lay the lines out inside the block (top-down, ink boxes).
    let mut out_lines: Vec<FitLine> = Vec::with_capacity(lines.len());
    let mut cursor = 0.0f32;
    let mut block_w = 0.0f32;
    for (i, (text, m)) in lines.iter().zip(meas.iter()).enumerate() {
        let size = s * m.spec.ratio;
        let scale = size / s_ref;
        let ink_w = m.ink_w * scale;
        let ink_h = m.ink_h * scale;
        if i > 0 {
            let taller = m.spec.ratio.max(meas[i - 1].spec.ratio);
            cursor += gap_ratio * s * taller;
        }
        out_lines.push(FitLine {
            text: text.clone(),
            role: m.spec.name,
            size_px: size,
            weight: m.weight,
            tracking_em: m.spec.tracking_em,
            ink_w,
            ink_h,
            x: 0.0,
            y: cursor,
        });
        cursor += ink_h;
        block_w = block_w.max(ink_w);
    }
    let block_h = cursor;

    // 4) Centre the block in the region (bottom side honours `align` on x).
    let align = block.align_value();
    let bx = match side {
        Side::Bottom => match align {
            "center" => rx + (rw - block_w) / 2.0,
            "right" => rx + rw - block_w,
            _ => rx,
        },
        Side::Left | Side::Right => rx + (rw - block_w) / 2.0,
    };
    let by = ry + (rh - block_h) / 2.0;
    for l in out_lines.iter_mut() {
        l.x = match align {
            "center" => bx + (block_w - l.ink_w) / 2.0,
            "right" => bx + block_w - l.ink_w,
            _ => bx,
        };
        l.y += by;
    }

    Some(InfoFit {
        base_px: s,
        block: (bx, by, block_w, block_h),
        lines: out_lines,
    })
}
