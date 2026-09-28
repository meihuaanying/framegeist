// v1.0.0: auto-fitted info block (whitespace-region typography).
//
// Verifies that an `infoBlock` fills ~2/3 of its whitespace band, stays inside
// the band (never over the photo), reports the same geometry through the public
// `boxes` API, and that the fit is deterministic.

use framegeist_core::{
    encode_jpeg_quality100, load_template_from_str, render, OutputFormat, RenderOptions, Sampling,
    Template,
};
use image::RgbaImage;

const LINES: &str = r#"[
      {"expr":"if_empty(exif.model_pretty, 'FUJIFILM')","role":"display"},
      {"expr":"if_empty(exif.focal, '23mm f/2.0')","role":"support"},
      {"expr":"if_empty(exif.iso, 'ISO 400')","role":"detail"}
    ]"#;

fn bottom_template(with_block: bool) -> String {
    let block = if with_block {
        format!(
            r##","infoBlock":{{"side":"bottom","align":"left","color":"#111111","font":{{"family":["Geist"]}},"lines":{LINES}}}"##
        )
    } else {
        String::new()
    };
    format!(
        r##"{{
  "meta": {{"id":"v100-info-block","name":"V100 Info Block","version":"1.0.0","minEngineVersion":"0.9.4","author":"FrameGeist","license":"CC0-1.0","category":"minimal"}},
  "canvas": {{"mode":"extend","padding":{{"bottom":0.30}},"background":{{"type":"solid","color":"#FFFFFF"}}}},
  "layers": []{block}
}}"##
    )
}

fn left_template() -> String {
    format!(
        r##"{{
  "meta": {{"id":"v100-info-block-left","name":"V100 Info Block Left","version":"1.0.0","minEngineVersion":"0.9.4","author":"FrameGeist","license":"CC0-1.0","category":"minimal"}},
  "canvas": {{"mode":"extend","padding":{{"left":0.30}},"background":{{"type":"solid","color":"#FFFFFF"}}}},
  "layers": [],
  "infoBlock": {{"side":"left","color":"#111111","font":{{"family":["Geist"]}},"lines":{LINES}}}
}}"##
    )
}

fn photo(w: u32, h: u32) -> Vec<u8> {
    let mut img = RgbaImage::new(w, h);
    for (x, y, p) in img.enumerate_pixels_mut() {
        *p = image::Rgba([
            ((x as f32 / w as f32) * 255.0) as u8,
            ((y as f32 / h as f32) * 255.0) as u8,
            200,
            255,
        ]);
    }
    encode_jpeg_quality100(&img).expect("jpeg")
}

fn assets_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../templates/assets")
}

fn opts() -> RenderOptions {
    RenderOptions {
        format: OutputFormat::Png,
        sampling: Sampling::Full,
        assets_dir: Some(assets_dir()),
        ..RenderOptions::default()
    }
}

fn render_img(photo: &[u8], tpl: &Template) -> RgbaImage {
    let bytes = render(photo, tpl, &opts()).expect("render");
    image::load_from_memory(&bytes).expect("decode").to_rgba8()
}

fn boxes(photo: &[u8], tpl: &Template) -> serde_json::Value {
    let json =
        framegeist_core::boxes::layer_boxes_for_photo(photo, tpl, &opts()).expect("boxes json");
    let v: serde_json::Value = serde_json::from_str(&json).expect("boxes parse");
    // `layer_boxes_json` returns a bare array of boxes; normalise for the tests.
    if v.is_array() {
        serde_json::json!({ "boxes": v })
    } else {
        v
    }
}

/// Tight dark-ink extent inside a canvas rectangle (u32::MAX,0,0,0 when empty).
fn ink_bbox(img: &RgbaImage, rx: u32, ry: u32, rw: u32, rh: u32) -> (u32, u32, u32, u32) {
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0u32, 0u32);
    for y in ry..(ry + rh).min(img.height()) {
        for x in rx..(rx + rw).min(img.width()) {
            let p = img.get_pixel(x, y).0;
            let lum = (p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000;
            if lum < 128 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    (x0, y0, x1, y1)
}

fn num(v: &serde_json::Value, key: &str) -> f32 {
    v[key].as_f64().expect(key) as f32
}

#[test]
fn bottom_info_block_fills_two_thirds_of_the_band() {
    let tpl = load_template_from_str(&bottom_template(true)).expect("template loads");
    let ph = photo(1600, 1200);
    let img = render_img(&ph, &tpl);
    assert_eq!(
        (img.width(), img.height()),
        (1600, 1560),
        "canvas = photo + 0.30 bottom band"
    );

    let (x0, y0, x1, y1) = ink_bbox(&img, 0, 1200, 1600, 360);
    assert!(x0 != u32::MAX, "info block painted ink in the bottom band");
    let block_h = (y1 - y0 + 1) as f32;
    let want = 360.0 * 2.0 / 3.0;
    assert!(
        (block_h - want).abs() <= 5.0,
        "visible height {block_h} should fill ~2/3 of the band ({want})"
    );
    assert!(
        y0 >= 1200 && y1 < 1560,
        "ink stays inside the band, never over the photo (y {y0}..{y1})"
    );
    assert!(x1 < 1600, "ink stays inside the canvas");
}

#[test]
fn boxes_api_reports_the_same_geometry_as_the_pixels() {
    let tpl = load_template_from_str(&bottom_template(true)).expect("template loads");
    let ph = photo(1600, 1200);
    let img = render_img(&ph, &tpl);
    let (x0, y0, x1, y1) = ink_bbox(&img, 0, 1200, 1600, 360);
    assert!(x0 != u32::MAX, "ink present");

    let j = boxes(&ph, &tpl);
    let list = j["boxes"].as_array().expect("boxes array");
    let ib = list
        .iter()
        .find(|b| b["id"] == "info-block")
        .expect("info-block box present");
    let (bx, by, bw, bh) = (num(ib, "x"), num(ib, "y"), num(ib, "w"), num(ib, "h"));
    let (iw, ih) = ((x1 - x0 + 1) as f32, (y1 - y0 + 1) as f32);
    assert!((bx - x0 as f32).abs() <= 2.0, "box x {bx} vs ink {x0}");
    assert!((by - y0 as f32).abs() <= 2.0, "box y {by} vs ink {y0}");
    assert!((bw - iw).abs() <= 2.0, "box w {bw} vs ink {iw}");
    assert!((bh - ih).abs() <= 2.0, "box h {bh} vs ink {ih}");

    let kids = ib["children"].as_array().expect("per-line child boxes");
    assert_eq!(kids.len(), 3, "one child box per line (<= 3 lines)");
    for k in kids {
        let (kx, ky, kw, kh) = (num(k, "x"), num(k, "y"), num(k, "w"), num(k, "h"));
        assert!(
            kx >= bx - 1.0
                && ky >= by - 1.0
                && kx + kw <= bx + bw + 1.0
                && ky + kh <= by + bh + 1.0,
            "line box ({kx},{ky},{kw},{kh}) stays inside the block ({bx},{by},{bw},{bh})"
        );
        assert!(
            ky >= 1200.0 && ky + kh <= 1560.0,
            "line box stays inside the band, never over the photo"
        );
    }
}

#[test]
fn left_info_block_fills_two_thirds_of_the_band_width() {
    let tpl = load_template_from_str(&left_template()).expect("template loads");
    let ph = photo(1600, 1200);
    let img = render_img(&ph, &tpl);
    assert_eq!(
        (img.width(), img.height()),
        (2080, 1200),
        "canvas = photo + 0.30 left band"
    );

    let (x0, _y0, x1, _y1) = ink_bbox(&img, 0, 0, 480, 1200);
    assert!(x0 != u32::MAX, "info block painted ink in the left band");
    let block_w = (x1 - x0 + 1) as f32;
    let want = 480.0 * 2.0 / 3.0;
    assert!(
        (block_w - want).abs() <= 5.0,
        "visible width {block_w} should fill ~2/3 of the band ({want})"
    );
    assert!(
        x1 < 480,
        "ink stays inside the left band, never over the photo"
    );
}

#[test]
fn info_block_validation_rejects_bad_shapes() {
    assert!(
        load_template_from_str(&bottom_template(true)).is_ok(),
        "baseline template is valid"
    );
    let four = bottom_template(true).replace(
        r#"{"expr":"if_empty(exif.iso, 'ISO 400')","role":"detail"}"#,
        r#"{"expr":"if_empty(exif.iso, 'ISO 400')","role":"detail"},{"expr":"'x'","role":"detail"}"#,
    );
    assert!(load_template_from_str(&four).is_err(), "4 lines rejected");
    assert!(
        load_template_from_str(
            &bottom_template(true).replace(r#""side":"bottom""#, r#""side":"top""#)
        )
        .is_err(),
        "unsupported side rejected"
    );
    assert!(
        load_template_from_str(&bottom_template(true).replace(r#"{"bottom":0.30}"#, "{}")).is_err(),
        "missing whitespace band rejected"
    );
    assert!(
        load_template_from_str(
            &bottom_template(true).replace(r#""role":"detail""#, r#""role":"hero""#)
        )
        .is_err(),
        "unknown role rejected"
    );
}

#[test]
fn info_block_is_opt_in_and_deterministic() {
    let ph = photo(1200, 900);

    let without = load_template_from_str(&bottom_template(false)).expect("template loads");
    let img = render_img(&ph, &without);
    assert_eq!((img.width(), img.height()), (1200, 1170));
    assert!(
        ink_bbox(&img, 0, 900, 1200, 270).0 == u32::MAX,
        "no ink without an infoBlock"
    );

    let tpl = load_template_from_str(&bottom_template(true)).expect("template loads");
    let a = render_img(&ph, &tpl);
    let b = render_img(&ph, &tpl);
    assert_eq!(a.as_raw(), b.as_raw(), "two renders are byte-identical");
    assert_eq!(boxes(&ph, &tpl), boxes(&ph, &tpl), "boxes JSON is stable");
}

/// v1.0.0 (Q10): yellow badges (nikon, insta360) switch to the black `-mono`
/// variant on light backgrounds and keep the official yellow on dark ones.
/// The v0.9.0 3:1 non-text contrast gate already implements the rule; this
/// guards the real asset matrix against regressions.
#[test]
fn yellow_badge_variants_follow_background_contrast() {
    let ph = photo(1600, 1200);
    for slug in ["nikon", "insta360"] {
        let white = load_template_from_str(&badge_template(slug, "#FFFFFF")).expect("template");
        let img = render_img(&ph, &white);
        let (dark, yellow) = badge_ink_stats(&img, 0, 1200, 1600, 360);
        assert!(dark > 0, "{slug}: dark mono ink present on white");
        assert!(
            yellow < 40,
            "{slug}: official yellow must not be used on white (yellow px {yellow})"
        );

        let black = load_template_from_str(&badge_template(slug, "#000000")).expect("template");
        let img = render_img(&ph, &black);
        let (_, yellow) = badge_ink_stats(&img, 0, 1200, 1600, 360);
        assert!(
            yellow > 40,
            "{slug}: official yellow kept on black (yellow px {yellow})"
        );
        // (No `dark` comparison here: the black background itself fills the
        // sampled band, so a dark-pixel count is meaningless on dark plates.)
    }
}

fn badge_template(slug: &str, bg: &str) -> String {
    format!(
        r##"{{"meta":{{"id":"v100-badge-{slug}","name":"Badge","version":"1.0.0","minEngineVersion":"1.0.0","author":"FrameGeist","license":"CC0-1.0","category":"minimal"}},"canvas":{{"mode":"extend","padding":{{"bottom":0.30}},"background":{{"type":"solid","color":"{bg}"}}}},"layers":[{{"type":"image","id":"badge","anchor":"bottom-center","asset":"@builtin/brand/{slug}","size":{{"height":0.06}}}}]}}"##
    )
}

/// Counts (dark ink px, yellow ink px) inside a canvas rectangle.
fn badge_ink_stats(img: &RgbaImage, rx: u32, ry: u32, rw: u32, rh: u32) -> (u32, u32) {
    let (mut dark, mut yellow) = (0u32, 0u32);
    for y in ry..(ry + rh).min(img.height()) {
        for x in rx..(rx + rw).min(img.width()) {
            let p = img.get_pixel(x, y).0;
            let lum = (p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000;
            if lum < 100 {
                dark += 1;
            }
            if p[0] > 200 && p[1] > 180 && p[2] < 120 {
                yellow += 1;
            }
        }
    }
    (dark, yellow)
}
