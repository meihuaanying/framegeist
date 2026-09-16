//! v0.5.0: layer bounding boxes for the editor (hit testing, handles,
//! snapping guides). Mirrors the layout math used by `render.rs`; boxes are
//! approximate for effects that paint far outside the glyph box (stroke
//! padding is included from the effect width).

use image::RgbaImage;
use serde::Serialize;

use crate::exif::ExifInfo;
use crate::render::{CanvasGeometry, RenderOptions};
use crate::template::{Anchor, Layer, Template, TemplateOverrides};
use crate::text_shape::Shaper;

#[derive(Debug, Clone, Serialize)]
pub struct LayerBox {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub anchor: String,
    pub offset_x: f32,
    pub offset_y: f32,
    pub rotation: f32,
    pub z: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<LayerBox>>,
}

fn anchor_name(a: Anchor) -> &'static str {
    match a {
        Anchor::TopLeft => "top-left",
        Anchor::TopCenter => "top-center",
        Anchor::TopRight => "top-right",
        Anchor::MiddleLeft => "middle-left",
        Anchor::MiddleCenter => "middle-center",
        Anchor::MiddleRight => "middle-right",
        Anchor::BottomLeft => "bottom-left",
        Anchor::BottomCenter => "bottom-center",
        Anchor::BottomRight => "bottom-right",
    }
}

fn place(
    w: f32,
    h: f32,
    bw: f32,
    bh: f32,
    anchor: Anchor,
    offset_x: f64,
    offset_y: f64,
) -> (f32, f32) {
    let off_x = offset_x as f32 * w;
    let off_y = offset_y as f32 * h;
    let x = match anchor {
        Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft => off_x,
        Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter => (w - bw) / 2.0 + off_x,
        _ => w + off_x - bw,
    };
    let y = match anchor {
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight => off_y,
        Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight => (h - bh) / 2.0 + off_y,
        _ => h + off_y - bh,
    };
    (x, y)
}

/// Decode + probe + compute boxes (wasm-facing convenience).
pub fn layer_boxes_for_photo(
    photo: &[u8],
    template: &Template,
    opts: &RenderOptions,
) -> Result<String, crate::Error> {
    let rgba = crate::render::decode_oriented(photo, opts.max_edge, false, false)?;
    let rgba = crate::render::apply_crop_public(rgba, opts.overrides.as_ref().and_then(|o| o.crop));
    let mut info = crate::exif::probe_exif(photo)?;
    crate::render::apply_model_map(&mut info, &opts.model_map);
    layer_boxes_json(template, &info, &rgba, opts)
}

/// Compute editor boxes for a decoded photo + template + overrides.
pub fn layer_boxes_json(
    template: &Template,
    info: &ExifInfo,
    rgba: &RgbaImage,
    opts: &RenderOptions,
) -> Result<String, crate::Error> {
    let overrides = opts.overrides.as_ref();
    let geo = crate::render::compute_geometry(template, rgba, overrides);
    // Aspect expansion uses the same formula as expand_to_aspect.
    let (cw, ch) = match overrides.and_then(|o: &TemplateOverrides| o.aspect.as_deref()) {
        Some(name) => match crate::template::aspect_ratio(name) {
            Some((tw, th)) => {
                let (w, h) = (geo.width, geo.height);
                let cur = w as f64 / h as f64;
                let tgt = tw as f64 / th as f64;
                if (cur - tgt).abs() < 0.002 {
                    (w, h)
                } else if cur < tgt {
                    (((h as f64) * tgt).ceil() as u32, h)
                } else {
                    (w, ((w as f64) / tgt).ceil() as u32)
                }
            }
            None => (geo.width, geo.height),
        },
        None => (geo.width, geo.height),
    };
    let fonts = match &opts.fonts {
        Some(book) => book.clone(),
        None => match &opts.assets_dir {
            Some(dir) => crate::text::FontBook::load(&dir.join("fonts"))?,
            None => crate::text::FontBook::empty(),
        },
    };
    let mut shaper = Shaper::new(&fonts);
    let mut boxes: Vec<LayerBox> = Vec::new();
    for layer in &template.layers {
        if let Some(b) = layer_box(
            layer,
            info,
            &mut shaper,
            &geo,
            cw as f32,
            ch as f32,
            0.0,
            0.0,
        ) {
            boxes.push(b);
        }
    }
    serde_json::to_string(&boxes).map_err(|e| crate::Error::TemplateJson(e.to_string()))
}

#[allow(clippy::too_many_arguments)]
fn layer_box(
    layer: &Layer,
    info: &ExifInfo,
    shaper: &mut Shaper,
    geo: &CanvasGeometry,
    fw: f32,
    fh: f32,
    origin_x: f32,
    origin_y: f32,
) -> Option<LayerBox> {
    let z = match layer {
        Layer::Text(t) => t.z.unwrap_or(0),
        Layer::Image(i) => i.z.unwrap_or(0),
        Layer::Shape(s) => s.z.unwrap_or(0),
        Layer::Palette(p) => p.z.unwrap_or(0),
        Layer::Group(g) => g.z.unwrap_or(0),
        Layer::Calendar(c) => c.z.unwrap_or(0),
    };
    match layer {
        Layer::Text(text) => {
            let lines = crate::render::text_lines_public(text, info);
            if lines.is_empty() {
                return None;
            }
            let families = text.font.family.clone();
            let size_px = (text.font.size * geo.photo_h as f64) as f32;
            let wrap = text.width.map(|w| (w as f32 * fw).max(4.0));
            let text_joined = lines.join("\n");
            let raster = shaper.shape(&crate::text_shape::ShapeRequest {
                text: &text_joined,
                families: &families,
                weight: text.font.weight,
                size_px,
                line_height: text.line_height as f32,
                letter_spacing_em: text.letter_spacing as f32,
                align: text.align.as_deref().unwrap_or("left"),
                max_width: wrap,
            })?;
            let pad = text
                .effects
                .as_ref()
                .and_then(|e| e.stroke.as_ref())
                .map(|s| (s.width as f32 * raster.first_baseline.max(1.0)).ceil())
                .unwrap_or(0.0);
            let (bw, bh) = (raster.width as f32, raster.height as f32);
            let (x, y) = place(fw, fh, bw, bh, text.anchor, text.offset.x, text.offset.y);
            Some(LayerBox {
                id: text.id.clone(),
                kind: "text".into(),
                x: x + origin_x - pad,
                y: y + origin_y - pad,
                w: bw + pad * 2.0,
                h: bh + pad * 2.0,
                anchor: anchor_name(text.anchor).into(),
                offset_x: text.offset.x as f32,
                offset_y: text.offset.y as f32,
                rotation: text.rotation as f32,
                z,
                children: None,
            })
        }
        Layer::Image(image) => {
            let photo_h = geo.photo_h as f64;
            let target_h = image
                .size
                .height
                .map(|h| (h * photo_h).round().max(2.0))
                .or_else(|| {
                    image
                        .size
                        .width
                        .map(|w| (w * photo_h).round().max(2.0) * 0.66)
                });
            let th = target_h.unwrap_or(0.03 * photo_h) as f32;
            let tw = image
                .size
                .width
                .map(|w| (w as f32 * geo.photo_w as f32).max(2.0))
                .unwrap_or(th * 2.6);
            let (x, y) = place(fw, fh, tw, th, image.anchor, image.offset.x, image.offset.y);
            Some(LayerBox {
                id: image.id.clone(),
                kind: "image".into(),
                x: x + origin_x,
                y: y + origin_y,
                w: tw,
                h: th,
                anchor: anchor_name(image.anchor).into(),
                offset_x: image.offset.x as f32,
                offset_y: image.offset.y as f32,
                rotation: 0.0,
                z,
                children: None,
            })
        }
        Layer::Shape(shape) => {
            let (mut sw, mut sh) = match shape.shape {
                crate::template::ShapeKind::Line => (0.2, 0.0015),
                crate::template::ShapeKind::Rect => (0.2, 0.2),
                _ => (0.05, 0.05),
            };
            if let Some(frame) = shape.frame.as_deref() {
                let margin = shape.margin.unwrap_or(0.04) as f32;
                let (x, y, w, h) = match frame {
                    "opposite-h" => (
                        margin * fw,
                        margin * fh,
                        fw * (1.0 - margin * 2.0),
                        fh * (1.0 - margin * 2.0),
                    ),
                    "opposite-v" => (
                        margin * fw,
                        margin * fh,
                        fw * (1.0 - margin * 2.0),
                        fh * (1.0 - margin * 2.0),
                    ),
                    _ => (
                        margin * fw,
                        margin * fh,
                        fw * (1.0 - margin * 2.0),
                        fh * (1.0 - margin * 2.0),
                    ),
                };
                return Some(LayerBox {
                    id: shape.id.clone(),
                    kind: "shape".into(),
                    x: x + origin_x,
                    y: y + origin_y,
                    w,
                    h,
                    anchor: anchor_name(shape.anchor).into(),
                    offset_x: shape.offset.x as f32,
                    offset_y: shape.offset.y as f32,
                    rotation: 0.0,
                    z,
                    children: None,
                });
            }
            if shape.span.as_deref() == Some("auto") {
                let inset = shape.margin.unwrap_or(0.06) as f32;
                sw = (1.0 - inset * 2.0).max(0.01);
                let w = sw * fw;
                let h = sh * geo.photo_h as f32;
                return Some(LayerBox {
                    id: shape.id.clone(),
                    kind: "shape".into(),
                    x: inset * fw + origin_x,
                    y: place(fw, fh, w, h, shape.anchor, shape.offset.x, shape.offset.y).1
                        + origin_y,
                    w,
                    h,
                    anchor: anchor_name(shape.anchor).into(),
                    offset_x: shape.offset.x as f32,
                    offset_y: shape.offset.y as f32,
                    rotation: shape.rotation as f32,
                    z,
                    children: None,
                });
            }
            sw *= geo.photo_w as f32;
            sh *= geo.photo_h as f32;
            let (x, y) = place(fw, fh, sw, sh, shape.anchor, shape.offset.x, shape.offset.y);
            Some(LayerBox {
                id: shape.id.clone(),
                kind: "shape".into(),
                x: x + origin_x,
                y: y + origin_y,
                w: sw,
                h: sh,
                anchor: anchor_name(shape.anchor).into(),
                offset_x: shape.offset.x as f32,
                offset_y: shape.offset.y as f32,
                rotation: shape.rotation as f32,
                z,
                children: None,
            })
        }
        Layer::Palette(p) => {
            let dir = p.direction.as_deref().unwrap_or("horizontal");
            let size = p.size.unwrap_or(0.035) as f32 * geo.photo_h as f32;
            let gap = p.gap.unwrap_or(p.size.unwrap_or(0.035) * 0.35) as f32 * geo.photo_h as f32;
            let n = p.count as f32;
            let (sw, sh) = if dir == "vertical" {
                (size, n * size + (n - 1.0) * gap)
            } else {
                (n * size + (n - 1.0) * gap, size)
            };
            let (x, y) = place(fw, fh, sw, sh, p.anchor, p.offset.x, p.offset.y);
            Some(LayerBox {
                id: p.id.clone(),
                kind: "palette".into(),
                x: x + origin_x,
                y: y + origin_y,
                w: sw,
                h: sh,
                anchor: anchor_name(p.anchor).into(),
                offset_x: p.offset.x as f32,
                offset_y: p.offset.y as f32,
                rotation: 0.0,
                z,
                children: None,
            })
        }
        Layer::Calendar(cal) => {
            let w = cal.size as f32 * fw;
            let h = match cal.view.as_deref() {
                Some("strip") => w * 0.16,
                Some("day") => w * 0.9,
                _ => w * 0.82,
            };
            let (x, y) = place(fw, fh, w, h, cal.anchor, cal.offset.x, cal.offset.y);
            Some(LayerBox {
                id: cal.id.clone(),
                kind: "calendar".into(),
                x: x + origin_x,
                y: y + origin_y,
                w,
                h,
                anchor: anchor_name(cal.anchor).into(),
                offset_x: cal.offset.x as f32,
                offset_y: cal.offset.y as f32,
                rotation: 0.0,
                z,
                children: None,
            })
        }
        Layer::Group(g) => {
            let gw = g.width.map(|v| v as f32 * fw).unwrap_or(fw);
            let gh = g.height.map(|v| v as f32 * fh).unwrap_or(fh);
            let (x, y) = place(fw, fh, gw, gh, g.anchor, g.offset.x, g.offset.y);
            let sub_geo = CanvasGeometry {
                width: gw.max(1.0) as u32,
                height: gh.max(1.0) as u32,
                pad_left: 0,
                pad_top: 0,
                photo_w: geo.photo_w,
                photo_h: geo.photo_h,
            };
            let mut children = Vec::new();
            for child in &g.children {
                if let Some(b) = layer_box(child, info, shaper, &sub_geo, gw, gh, x, y) {
                    children.push(b);
                }
            }
            Some(LayerBox {
                id: g.id.clone(),
                kind: "group".into(),
                x: x + origin_x,
                y: y + origin_y,
                w: gw,
                h: gh,
                anchor: anchor_name(g.anchor).into(),
                offset_x: g.offset.x as f32,
                offset_y: g.offset.y as f32,
                rotation: 0.0,
                z,
                children: Some(children),
            })
        }
    }
}
