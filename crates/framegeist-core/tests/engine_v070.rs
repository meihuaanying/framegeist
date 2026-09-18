//! v0.7.0: multi-weight font selection and the badge system v2 rules.

use framegeist_core::{
    encode_jpeg_quality100, load_template_from_str, render_rgba, RenderOptions, Template,
};
use image::{Rgba, RgbaImage};
use serde_json::json;

fn photo(w: u32, h: u32, gray: u8) -> Vec<u8> {
    let mut img = RgbaImage::new(w, h);
    for (_, _, p) in img.enumerate_pixels_mut() {
        *p = Rgba([gray, gray, gray, 255]);
    }
    encode_jpeg_quality100(&img).expect("jpeg")
}

fn assets_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../templates/assets")
}

fn text_template(weight: u32, text: &str) -> Template {
    let expr = format!("fmt('{text}', exif)");
    let layer = json!({
        "type": "text",
        "id": "t",
        "anchor": "middle-center",
        "font": {"family": ["Inter"], "size": 0.12, "weight": weight, "color": "#111111"},
        "content": [{"expr": expr, "fallback": text}]
    });
    let doc = json!({
        "meta": {
            "id": "v7-weight", "name": "V7 Weight", "version": "1.0.0",
            "minEngineVersion": "0.7.0", "author": "FrameGeist",
            "license": "CC0-1.0", "category": "minimal"
        },
        "canvas": {"mode": "overlay"},
        "layers": [layer]
    });
    load_template_from_str(&doc.to_string()).expect("template loads")
}

fn render(tpl: &Template, photo: &[u8]) -> RgbaImage {
    let opts = RenderOptions {
        assets_dir: Some(assets_dir()),
        ..RenderOptions::default()
    };
    render_rgba(photo, tpl, &opts).expect("render")
}

fn busy_photo(w: u32, h: u32) -> Vec<u8> {
    let mut img = RgbaImage::new(w, h);
    for (x, _, p) in img.enumerate_pixels_mut() {
        let v = if x < w / 2 { 8 } else { 247 };
        *p = Rgba([v, v, v, 255]);
    }
    encode_jpeg_quality100(&img).expect("jpeg")
}

fn asset_bytes(w: u32, h: u32, lum: u8) -> Vec<u8> {
    let mut img = RgbaImage::new(w, h);
    for (_, _, p) in img.enumerate_pixels_mut() {
        *p = Rgba([lum, lum, lum, 255]);
    }
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .expect("png");
    out.into_inner()
}

fn image_template(layer: serde_json::Value) -> Template {
    let doc = json!({
        "meta": {
            "id": "v7-badge", "name": "V7 Badge", "version": "1.0.0",
            "minEngineVersion": "0.7.0", "author": "FrameGeist",
            "license": "CC0-1.0", "category": "minimal"
        },
        "canvas": {"mode": "overlay"},
        "layers": [layer]
    });
    load_template_from_str(&doc.to_string()).expect("template loads")
}

fn render_assets(tpl: &Template, photo: &[u8], assets: &[(&str, Vec<u8>)]) -> RgbaImage {
    let map = assets
        .iter()
        .map(|(k, v)| ((*k).to_string(), v.clone()))
        .collect();
    let opts = RenderOptions {
        assets: Some(map),
        ..RenderOptions::default()
    };
    render_rgba(photo, tpl, &opts).expect("render")
}

struct BadgePixels {
    count: usize,
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
    min_lum: u8,
    max_lum: u8,
}

/// Pixels that differ from `base` (the same template without the badge).
fn badge_pixels(base: &RgbaImage, img: &RgbaImage) -> BadgePixels {
    let mut out = BadgePixels {
        count: 0,
        x0: i32::MAX,
        y0: i32::MAX,
        x1: i32::MIN,
        y1: i32::MIN,
        min_lum: 255,
        max_lum: 0,
    };
    for (x, y, p) in img.enumerate_pixels() {
        let a = base.get_pixel(x, y).0;
        let differs = (0..3).any(|i| (a[i] as i32 - p[i] as i32).abs() > 14);
        if !differs {
            continue;
        }
        out.count += 1;
        out.x0 = out.x0.min(x as i32);
        out.y0 = out.y0.min(y as i32);
        out.x1 = out.x1.max(x as i32);
        out.y1 = out.y1.max(y as i32);
        out.min_lum = out.min_lum.min(p[0]);
        out.max_lum = out.max_lum.max(p[0]);
    }
    out
}

fn badge_layer(size_h: f64, corner: Option<&str>) -> serde_json::Value {
    let mut layer = json!({
        "type": "image",
        "id": "badge",
        "anchor": "middle-center",
        "asset": "@builtin/brand/fake",
        "size": {"height": size_h}
    });
    if let Some(c) = corner {
        layer["corner"] = json!(c);
        layer["margin"] = json!(0.04);
    }
    layer
}

fn badge_assets() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("@builtin/brand/fake", asset_bytes(512, 512, 10)),
        ("@builtin/brand/fake-light", asset_bytes(512, 512, 245)),
    ]
}

#[test]
fn badge_size_floor_applies() {
    let tpl = image_template(badge_layer(0.002, None));
    let p = photo(600, 1600, 235);
    let base = render(
        &image_template(
            json!({"type":"image","id":"none","anchor":"middle-center","asset":"@builtin/brand/missing","size":{"height":0.002}}),
        ),
        &p,
    );
    let img = render_assets(&tpl, &p, &badge_assets());
    let b = badge_pixels(&base, &img);
    assert!(b.count > 100, "badge must be drawn ({} px)", b.count);
    let h = (b.y1 - b.y0 + 1) as f64;
    assert!(
        h >= 52.0,
        "badge height {h} must respect the 3.5% floor (56px)"
    );
}

#[test]
fn badge_contrast_on_black_white_and_busy() {
    let tpl = image_template(badge_layer(0.08, None));
    let empty = image_template(
        json!({"type":"image","id":"none","anchor":"middle-center","asset":"@builtin/brand/missing","size":{"height":0.08}}),
    );
    let assets = badge_assets();

    let black = photo(600, 400, 6);
    let b = badge_pixels(
        &render(&empty, &black),
        &render_assets(&tpl, &black, &assets),
    );
    assert!(
        b.max_lum > 200,
        "on black the light variant must be used (max {})",
        b.max_lum
    );

    let white = photo(600, 400, 247);
    let b = badge_pixels(
        &render(&empty, &white),
        &render_assets(&tpl, &white, &assets),
    );
    assert!(
        b.min_lum < 60,
        "on white the dark variant must be used (min {})",
        b.min_lum
    );

    let busy = busy_photo(600, 400);
    let b = badge_pixels(&render(&empty, &busy), &render_assets(&tpl, &busy, &assets));
    assert!(
        b.min_lum < 60 && b.max_lum > 200,
        "on a busy background the guard must add contrast (min {} max {})",
        b.min_lum,
        b.max_lum
    );
}

#[test]
fn badge_max_width_and_corner_placement() {
    let assets = vec![
        ("@builtin/brand/fake", asset_bytes(1024, 128, 10)),
        ("@builtin/brand/fake-light", asset_bytes(1024, 128, 245)),
    ];
    let tpl = image_template(badge_layer(0.3, Some("top-left")));
    let empty = image_template(
        json!({"type":"image","id":"none","anchor":"middle-center","asset":"@builtin/brand/missing","size":{"height":0.3}}),
    );
    let p = photo(1000, 800, 210);
    let b = badge_pixels(&render(&empty, &p), &render_assets(&tpl, &p, &assets));
    assert!(b.count > 100, "badge must be drawn");
    let w = (b.x1 - b.x0 + 1) as f64;
    assert!(
        w <= 360.0,
        "max width must clamp the 8:1 wordmark to <= 32% (got {w})"
    );
    assert!(
        b.x0 <= 50,
        "corner top-left margin must be respected (x0 {})",
        b.x0
    );
}

fn ink(img: &RgbaImage) -> u64 {
    img.pixels()
        .map(|p| (255 - p[0]) as u64 + (255 - p[1]) as u64 + (255 - p[2]) as u64)
        .sum()
}

#[test]
fn font_weight_picks_distinct_faces() {
    let p = photo(480, 320, 255);
    let w400 = render(&text_template(400, "Frame Geist 2026"), &p);
    let w600 = render(&text_template(600, "Frame Geist 2026"), &p);
    let w700 = render(&text_template(700, "Frame Geist 2026"), &p);
    assert_ne!(
        w400.as_raw(),
        w600.as_raw(),
        "weight 400 and 600 must differ"
    );
    assert_ne!(
        w600.as_raw(),
        w700.as_raw(),
        "weight 600 and 700 must differ"
    );
    let i400 = ink(&w400);
    let i600 = ink(&w600);
    let i700 = ink(&w700);
    assert!(
        i600 > i400,
        "600 must be heavier than 400 ({i600} vs {i400})"
    );
    assert!(
        i700 > i600,
        "700 must be heavier than 600 ({i700} vs {i600})"
    );
}
