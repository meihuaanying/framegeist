//! v0.4.0 engine feature regressions: letter-spacing, rotation, opacity,
//! shape layers, palette extraction, tint background, canvas radius/shadow,
//! GPS expression gating and the new date tokens.

use framegeist_core::{load_template, render_rgba, render_rgba_with_image, ExifInfo, RenderOptions};

fn repo_root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

fn opts() -> RenderOptions {
    RenderOptions {
        assets_dir: Some(repo_root().join("templates/assets")),
        ..RenderOptions::default()
    }
}

fn solid_jpeg(w: u32, h: u32, rgb: [u8; 3]) -> Vec<u8> {
    let mut img = image::RgbaImage::new(w, h);
    for px in img.pixels_mut() {
        *px = image::Rgba([rgb[0], rgb[1], rgb[2], 255]);
    }
    framegeist_core::encode_jpeg_quality100(&img).expect("jpeg")
}

fn split_jpeg(w: u32, h: u32, left: [u8; 3], right: [u8; 3]) -> Vec<u8> {
    let mut img = image::RgbaImage::new(w, h);
    for (x, _y, px) in img.enumerate_pixels_mut() {
        *px = if x < w / 2 {
            image::Rgba([left[0], left[1], left[2], 255])
        } else {
            image::Rgba([right[0], right[1], right[2], 255])
        };
    }
    framegeist_core::encode_jpeg_quality100(&img).expect("jpeg")
}

fn white_text_overlay(letter_spacing: f64, rotation: f64, opacity: f64) -> framegeist_core::Template {
    let json = format!(
        r##"{{
  "meta": {{ "id": "v040-text", "name": "T", "version": "0.4.0", "minEngineVersion": "0.4.0",
            "author": "t", "license": "CC0-1.0", "category": "minimal" }},
  "canvas": {{ "mode": "overlay" }},
  "layers": [
    {{ "type": "text", "id": "t", "anchor": "middle-center",
      "font": {{ "family": ["Inter"], "size": 0.12, "color": "#FFFFFF" }},
      "letterSpacing": {letter_spacing}, "rotation": {rotation}, "opacity": {opacity},
      "content": [ {{ "expr": "'FRAMEGEIST'" }} ] }}
  ]
}}"##
    );
    load_template(json.as_bytes()).expect("text template valid")
}

fn white_bbox(img: &image::RgbaImage) -> (u32, u32, u32, u32) {
    let (w, h) = img.dimensions();
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    for (x, y, p) in img.enumerate_pixels() {
        if p.0[0] > 180 && p.0[1] > 180 && p.0[2] > 180 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    (x0, y0, x1, y1)
}

#[test]
fn letter_spacing_widens_text_block() {
    let photo = solid_jpeg(800, 400, [0, 0, 0]);
    let tight = render_rgba(&photo, &white_text_overlay(0.0, 0.0, 1.0), &opts()).unwrap();
    let wide = render_rgba(&photo, &white_text_overlay(0.3, 0.0, 1.0), &opts()).unwrap();
    let (tx0, _, tx1, _) = white_bbox(&tight);
    let (wx0, _, wx1, _) = white_bbox(&wide);
    assert!(
        (wx1 - wx0) > (tx1 - tx0) + 20,
        "letterSpacing must widen the block: tight {}px vs wide {}px",
        tx1 - tx0,
        wx1 - wx0
    );
}

#[test]
fn rotation_swaps_text_extent() {
    let photo = solid_jpeg(800, 400, [0, 0, 0]);
    let flat = render_rgba(&photo, &white_text_overlay(0.0, 0.0, 1.0), &opts()).unwrap();
    let rotated = render_rgba(&photo, &white_text_overlay(0.0, 90.0, 1.0), &opts()).unwrap();
    let (fx0, fy0, fx1, fy1) = white_bbox(&flat);
    let (rx0, ry0, rx1, ry1) = white_bbox(&rotated);
    assert!(
        (rx1 - rx0) < (fx1 - fx0) && (ry1 - ry0) > (fy1 - fy0),
        "90° rotation must make the block taller and narrower"
    );
}

#[test]
fn text_opacity_blends_with_photo() {
    let photo = solid_jpeg(800, 400, [0, 0, 0]);
    let img = render_rgba(&photo, &white_text_overlay(0.0, 0.0, 0.5), &opts()).unwrap();
    let mid_gray = img
        .pixels()
        .filter(|p| {
            let v = p.0[0] as i32;
            (90..=175).contains(&v) && (p.0[0] as i32 - p.0[1] as i32).abs() < 12
        })
        .count();
    assert!(mid_gray > 50, "50% text over black must produce gray pixels");
}

#[test]
fn shape_layer_draws_line_and_rotates() {
    let json = r##"{
  "meta": { "id": "v040-shape", "name": "S", "version": "0.4.0", "minEngineVersion": "0.4.0",
            "author": "t", "license": "CC0-1.0", "category": "minimal" },
  "canvas": { "mode": "overlay" },
  "layers": [
    { "type": "shape", "id": "rule", "anchor": "middle-center", "shape": "line",
      "size": { "width": 0.6, "height": 0.01 }, "color": "#FF0000" },
    { "type": "shape", "id": "dot", "anchor": "middle-center", "shape": "ellipse",
      "size": { "width": 0.1, "height": 0.1 }, "color": "#00FF00",
      "offset": { "x": 0.0, "y": -0.3 } }
  ]
}"##;
    let tpl = load_template(json.as_bytes()).expect("shape template valid");
    let photo = solid_jpeg(800, 400, [0, 0, 0]);
    let img = render_rgba(&photo, &tpl, &opts()).unwrap();
    let reds = img
        .pixels()
        .filter(|p| p.0[0] > 200 && p.0[1] < 60 && p.0[2] < 60)
        .count();
    let greens = img
        .pixels()
        .filter(|p| p.0[1] > 200 && p.0[0] < 60 && p.0[2] < 60)
        .count();
    assert!(reds > 100, "rule must paint red pixels, got {reds}");
    assert!(greens > 100, "dot must paint green pixels, got {greens}");
}

#[test]
fn palette_layer_extracts_chip_colors() {
    let json = r##"{
  "meta": { "id": "v040-palette", "name": "P", "version": "0.4.0", "minEngineVersion": "0.4.0",
            "author": "t", "license": "CC0-1.0", "category": "colorcard" },
  "canvas": { "mode": "overlay" },
  "layers": [
    { "type": "palette", "id": "chips", "anchor": "bottom-left", "offset": { "x": 0.05, "y": -0.08 },
      "count": 2, "shape": "square", "size": 0.12, "gap": 0.04 }
  ]
}"##;
    let tpl = load_template(json.as_bytes()).expect("palette template valid");
    let photo = split_jpeg(600, 300, [255, 0, 0], [0, 0, 255]);
    let img = render_rgba(&photo, &tpl, &opts()).unwrap();
    let reds = img
        .pixels()
        .filter(|p| p.0[0] > 200 && p.0[1] < 70 && p.0[2] < 70)
        .count();
    let blues = img
        .pixels()
        .filter(|p| p.0[2] > 200 && p.0[0] < 70 && p.0[1] < 70)
        .count();
    assert!(reds > 100, "palette must contain the red half, got {reds}");
    assert!(blues > 100, "palette must contain the blue half, got {blues}");
}

#[test]
fn tint_background_uses_photo_average_color() {
    let json = r##"{
  "meta": { "id": "v040-tint", "name": "Tint", "version": "0.4.0", "minEngineVersion": "0.4.0",
            "author": "t", "license": "CC0-1.0", "category": "colorwalk" },
  "canvas": { "mode": "extend", "padding": { "left": 0.3, "right": 0.3 },
              "background": { "type": "tint" } },
  "layers": []
}"##;
    let tpl = load_template(json.as_bytes()).expect("tint template valid");
    let photo = solid_jpeg(400, 200, [255, 0, 0]);
    let img = render_rgba(&photo, &tpl, &opts()).unwrap();
    let margin = img.get_pixel(5, 100).0;
    assert!(
        margin[0] > 200 && margin[1] < 40 && margin[2] < 40,
        "tint margin must take the photo average color, got {margin:?}"
    );
}

#[test]
fn canvas_radius_rounds_photo_corners() {
    let json = r##"{
  "meta": { "id": "v040-radius", "name": "R", "version": "0.4.0", "minEngineVersion": "0.4.0",
            "author": "t", "license": "CC0-1.0", "category": "effect" },
  "canvas": { "mode": "extend", "padding": { "top": 0.1, "right": 0.1, "bottom": 0.1, "left": 0.1 },
              "background": { "type": "solid", "color": "#FFFFFF" }, "radius": 0.2 },
  "layers": []
}"##;
    let tpl = load_template(json.as_bytes()).expect("radius template valid");
    let photo = solid_jpeg(400, 200, [255, 0, 0]);
    let img = render_rgba(&photo, &tpl, &opts()).unwrap();
    let (w, h) = img.dimensions();
    let pad_left = (0.1 * 400.0) as u32;
    let pad_top = (0.1 * 200.0) as u32;
    let corner = img.get_pixel(pad_left + 1, pad_top + 1).0;
    let center = img.get_pixel(w / 2, h / 2).0;
    assert!(
        corner[0] > 200 && corner[1] > 200 && corner[2] > 200,
        "rounded corner must reveal the white background, got {corner:?}"
    );
    assert!(center[0] > 200 && center[1] < 40, "photo center stays red");
}

#[test]
fn canvas_shadow_darkens_backdrop_below_photo() {
    let json = r##"{
  "meta": { "id": "v040-shadow", "name": "Sh", "version": "0.4.0", "minEngineVersion": "0.4.0",
            "author": "t", "license": "CC0-1.0", "category": "effect" },
  "canvas": { "mode": "extend", "padding": { "top": 0.2, "right": 0.2, "bottom": 0.2, "left": 0.2 },
              "background": { "type": "solid", "color": "#FFFFFF" },
              "shadow": { "enabled": true, "blur": 0.2, "opacity": 0.6, "offsetX": 0.05, "offsetY": 0.05 } },
  "layers": []
}"##;
    let tpl = load_template(json.as_bytes()).expect("shadow template valid");
    let photo = solid_jpeg(400, 200, [255, 0, 0]);
    let img = render_rgba(&photo, &tpl, &opts()).unwrap();
    let (w, h) = img.dimensions();
    let pad_right = (0.2 * 400.0) as u32;
    let photo_right = w - pad_right;
    let mid_y = h / 2;
    let right_edge = img.get_pixel(photo_right + 6, mid_y).0;
    assert!(
        right_edge[0] < 235,
        "shadow must darken the backdrop to the right of the photo, got {right_edge:?}"
    );
}

#[test]
fn gps_expressions_require_keep_gps() {
    let json = r##"{
  "meta": { "id": "v040-gps", "name": "G", "version": "0.4.0", "minEngineVersion": "0.4.0",
            "author": "t", "license": "CC0-1.0", "category": "sports" },
  "canvas": { "mode": "overlay" },
  "layers": [
    { "type": "text", "id": "gps", "anchor": "middle-left", "offset": { "x": 0.1, "y": 0.0 },
      "font": { "family": ["Inter"], "size": 0.06, "color": "#FFFFFF" },
      "content": [ { "expr": "exif.gps_latlon", "fallback": null } ] }
  ]
}"##;
    let tpl = load_template(json.as_bytes()).expect("gps template valid");
    let info = ExifInfo {
        gps_lat: Some(23.13694),
        gps_lon: Some(113.32444),
        gps_alt: Some(2459.0),
        datetime: Some("2026:08:19 12:00:00".into()),
        ..ExifInfo::default()
    };
    let base = image::RgbaImage::from_pixel(800, 400, image::Rgba([0, 0, 0, 255]));
    let hidden_opts = RenderOptions { keep_gps: false, ..opts() };
    let shown_opts = RenderOptions { keep_gps: true, ..opts() };
    let hidden = render_rgba_with_image(&base, &tpl, &info, &hidden_opts).unwrap();
    let shown = render_rgba_with_image(&base, &tpl, &info, &shown_opts).unwrap();
    let white = |img: &image::RgbaImage| {
        img.pixels().filter(|p| p.0[0] > 180 && p.0[1] > 180).count()
    };
    assert_eq!(white(&hidden), 0, "GPS text must stay hidden without keep_gps");
    assert!(white(&shown) > 50, "GPS text must render with keep_gps");

    // Formatted helpers (v0.4.0 A8).
    assert_eq!(info.get("gps_alt").as_deref(), Some("2459m"));
    assert_eq!(info.get("gps_lat").as_deref(), Some("23\u{b0}8'13\"N"));
    assert_eq!(
        info.get("gps_latlon").as_deref(),
        Some("23\u{b0}8'13\"N 113\u{b0}19'28\"E")
    );
    assert_eq!(info.get("weekday_cn").as_deref(), Some("星期三"));
    assert_eq!(info.get("weekday").as_deref(), Some("Wednesday"));
}

#[test]
fn date_english_tokens_render() {
    let info = ExifInfo {
        datetime: Some("2026:07:15 10:08:00".into()),
        ..ExifInfo::default()
    };
    assert_eq!(
        framegeist_core::sandbox::eval_expr("date('MMMM Do, YYYY', exif.datetime)", &info).as_deref(),
        Some("July 15th, 2026")
    );
    assert_eq!(
        framegeist_core::sandbox::eval_expr("date('WW', exif.datetime)", &info).as_deref(),
        Some("Wednesday")
    );
    assert_eq!(
        framegeist_core::sandbox::eval_expr("date('MMM D, YYYY', exif.datetime)", &info).as_deref(),
        Some("Jul 15, 2026")
    );
}
