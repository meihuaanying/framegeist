//! v1.2.0 — official accent faces for monochrome series badges.
//!
//! Series badges ship as a single monochrome mark (`<slug>.png` + `-light`),
//! so the engine's colour branch (`primary_colorful`) never fires and the
//! official accent colour recorded in the manifest never reaches the canvas.
//! v1.2.0 adds an optional `<slug>-accent.png` face: a pure recolour of the
//! official mark, so geometry — and therefore layout — is identical, and the
//! face only wins when it clears the WCAG 1.4.11 3:1 floor against the local
//! background (or the layer explicitly asks for colour).

use std::collections::HashMap;

use framegeist_core::render::{pick_badge_face, BadgeAvailability, BadgeFace, BadgeScores};
use framegeist_core::{
    encode_jpeg_quality100, load_template_from_str, render, OutputFormat, RenderOptions, Sampling,
    Template,
};
use image::RgbaImage;

/// Nikon S-Line yellow: clears 3:1 on a dark band, fails it on a light one.
const YELLOW: [u8; 3] = [255, 225, 0];
/// Canon-style red: clears 3:1 on both, so it survives a light background.
const RED: [u8; 3] = [214, 0, 28];

fn scores(color: f32, accent: f32, dark: f32, light: f32) -> BadgeScores {
    BadgeScores {
        color,
        accent,
        dark,
        light,
    }
}

fn all_faces() -> BadgeAvailability {
    BadgeAvailability {
        mono: true,
        light: true,
        accent: true,
    }
}

fn photo(w: u32, h: u32) -> Vec<u8> {
    let mut img = RgbaImage::new(w, h);
    for (x, y, p) in img.enumerate_pixels_mut() {
        *p = image::Rgba([(x * 255 / w) as u8, (y * 255 / h) as u8, 180, 255]);
    }
    encode_jpeg_quality100(&img).expect("jpeg")
}

/// Solid bar mark in `rgb` on a transparent background.
fn mark(rgb: [u8; 3]) -> Vec<u8> {
    let mut img = RgbaImage::new(64, 64);
    for (x, y, p) in img.enumerate_pixels_mut() {
        let inside = (8..56).contains(&x) && (24..40).contains(&y);
        *p = if inside {
            image::Rgba([rgb[0], rgb[1], rgb[2], 255])
        } else {
            image::Rgba([0, 0, 0, 0])
        };
    }
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .expect("png encode");
    out.into_inner()
}

/// A monochrome mark plus its official accent face, wired through the in-memory
/// asset map so the test needs no fixture files on disk.
fn assets(slug: &str, accent: [u8; 3]) -> HashMap<String, Vec<u8>> {
    let mut map = HashMap::new();
    let base = format!("@builtin/series/{slug}");
    map.insert(base.clone(), mark([17, 17, 17]));
    map.insert(format!("{base}-mono"), mark([0, 0, 0]));
    map.insert(format!("{base}-light"), mark([255, 255, 255]));
    map.insert(format!("{base}-accent"), mark(accent));
    map
}

fn opts(assets: &HashMap<String, Vec<u8>>) -> RenderOptions {
    RenderOptions {
        format: OutputFormat::Png,
        sampling: Sampling::Full,
        assets: Some(assets.clone()),
        ..RenderOptions::default()
    }
}

/// Photo + a solid band at the bottom (where series badges actually live) with
/// the badge pinned inside that band.
fn template(slug: &str, bg: &str) -> Template {
    let json = format!(
        r##"{{
  "meta": {{ "id": "v120-accent", "name": "v1.2.0 accent", "version": "1.0.0", "minEngineVersion": "1.0.0", "author": "FrameGeist", "license": "CC0-1.0", "category": "camera" }},
  "canvas": {{ "mode": "extend", "padding": {{ "bottom": 0.3 }}, "background": {{ "type": "solid", "color": "{bg}" }} }},
  "layers": [
    {{ "type": "image", "id": "badge", "anchor": "bottom-center", "offset": {{ "x": 0, "y": -0.04 }},
      "size": {{ "width": 0.18, "height": 0.18 }}, "asset": "@builtin/series/{slug}" }}
  ]
}}"##
    );
    load_template_from_str(&json).expect("template loads")
}

fn render_img(photo_bytes: &[u8], tpl: &Template, assets: &HashMap<String, Vec<u8>>) -> RgbaImage {
    let bytes = render(photo_bytes, tpl, &opts(assets)).expect("render");
    image::load_from_memory(&bytes).expect("decode").to_rgba8()
}

/// How many opaque pixels are close to `want` (tolerating Lanczos resampling).
fn count_near(img: &RgbaImage, want: [u8; 3], tol: i32) -> usize {
    img.pixels()
        .filter(|p| {
            p[3] > 200
                && (p[0] as i32 - want[0] as i32).abs() <= tol
                && (p[1] as i32 - want[1] as i32).abs() <= tol
                && (p[2] as i32 - want[2] as i32).abs() <= tol
        })
        .count()
}

/// Pixels that read as `want` by hue. Sampling by hue rather than exact RGB
/// keeps the assertion honest under Lanczos resampling and the contrast stroke.
fn hue_like(img: &RgbaImage, want: [u8; 3], tol: i32) -> usize {
    count_near(img, want, tol)
}

/// v1.2.0: an accent that fails the 3:1 floor on the local background must fall
/// back to the black mono face; the same accent on a dark band is used.
#[test]
fn accent_face_follows_local_contrast() {
    let assets = assets("v120-yellow", YELLOW);
    let ph = photo(400, 300);

    let dark = render_img(&ph, &template("v120-yellow", "#101010"), &assets);
    assert!(
        hue_like(&dark, YELLOW, 45) > 300,
        "yellow accent not used on a dark band: {} px",
        hue_like(&dark, YELLOW, 45)
    );
    assert_eq!(
        count_near(&dark, [255, 255, 255], 30),
        0,
        "light face used on a dark band"
    );

    let light = render_img(&ph, &template("v120-yellow", "#FFFFFF"), &assets);
    assert_eq!(
        hue_like(&light, YELLOW, 45),
        0,
        "yellow accent used on a light band (contrast ~1.2:1)"
    );
    assert!(
        count_near(&light, [0, 0, 0], 30) > 300,
        "mono face not used on a light band"
    );
}

/// v1.2.0: an accent that clears 3:1 everywhere keeps the official colour on
/// both light and dark bands — the accent is not a dark-background-only trick.
#[test]
fn strong_accent_survives_light_background() {
    let assets = assets("v120-red", RED);
    let ph = photo(400, 300);
    let light = render_img(&ph, &template("v120-red", "#FFFFFF"), &assets);
    assert!(
        hue_like(&light, RED, 45) > 300,
        "red accent dropped on a light band: {} px",
        hue_like(&light, RED, 45)
    );
}

/// v1.2.0: the accent face is a pure recolour, so the drawn geometry is
/// identical to the mono face — the layout must not move. Measured on a white
/// band, where both faces stand out clearly from the background.
#[test]
fn accent_face_keeps_mono_geometry() {
    let assets = assets("v120-geometry", RED);
    let ph = photo(400, 300);
    let with_accent = render_img(&ph, &template("v120-geometry", "#FFFFFF"), &assets);

    // Same template with the accent face absent: the engine must fall back.
    let mut no_accent = assets.clone();
    no_accent.remove("@builtin/series/v120-geometry-accent");
    let without = render_img(&ph, &template("v120-geometry", "#FFFFFF"), &no_accent);

    // Only look inside the band: the photo above it is bright by design. The
    // threshold is hue-agnostic (anything that is not the white band) so a
    // black face and a red face are measured with the same ruler.
    let band_top = 300;
    let ink_box = |img: &RgbaImage| -> Option<(u32, u32, u32, u32)> {
        let mut b = (u32::MAX, u32::MAX, 0u32, 0u32);
        for (x, y, p) in img.enumerate_pixels() {
            if y >= band_top && (p[0] < 247 || p[1] < 247 || p[2] < 247) {
                b.0 = b.0.min(x);
                b.1 = b.1.min(y);
                b.2 = b.2.max(x);
                b.3 = b.3.max(y);
            }
        }
        if b.0 == u32::MAX {
            None
        } else {
            Some(b)
        }
    };
    let a = ink_box(&with_accent).expect("accent ink");
    let b = ink_box(&without).expect("mono ink");
    assert_eq!(
        a, b,
        "accent face changed the drawn geometry: {a:?} vs {b:?}"
    );
    assert!(
        hue_like(&with_accent, RED, 45) > 300,
        "geometry run did not use the accent face"
    );
}

/// v1.2.0 decision table, exercised without any fixture assets.
#[test]
fn accent_face_policy() {
    // Colourful primary keeps the pre-v1.2 behaviour.
    assert_eq!(
        pick_badge_face(
            "auto",
            None,
            true,
            scores(9.0, 9.0, 18.0, 18.0),
            all_faces(),
            false
        ),
        BadgeFace::Primary
    );
    // Colourful primary whose colour fails the floor drops to the light face.
    assert_eq!(
        pick_badge_face(
            "auto",
            None,
            true,
            scores(1.4, 9.0, 18.0, 18.0),
            all_faces(),
            true
        ),
        BadgeFace::Light
    );
    // Monochrome mark + accent that clears the floor -> accent.
    assert_eq!(
        pick_badge_face(
            "auto",
            None,
            false,
            scores(0.5, 4.2, 18.0, 18.0),
            all_faces(),
            false
        ),
        BadgeFace::Accent
    );
    // Accent too weak for the background -> normal black/white choice.
    assert_eq!(
        pick_badge_face(
            "auto",
            None,
            false,
            scores(0.5, 1.3, 18.0, 18.0),
            all_faces(),
            false
        ),
        BadgeFace::Mono
    );
    // Explicit `tint: "color"` / `contrast: "color"` forces the accent.
    assert_eq!(
        pick_badge_face(
            "auto",
            Some("color"),
            false,
            scores(0.5, 1.3, 18.0, 18.0),
            all_faces(),
            false
        ),
        BadgeFace::Accent
    );
    assert_eq!(
        pick_badge_face(
            "color",
            None,
            false,
            scores(0.5, 1.3, 18.0, 18.0),
            all_faces(),
            true
        ),
        BadgeFace::Accent
    );
    // No accent face on disk -> unchanged v0.9 behaviour.
    let no_accent = BadgeAvailability {
        mono: true,
        light: true,
        accent: false,
    };
    assert_eq!(
        pick_badge_face(
            "auto",
            None,
            false,
            scores(0.5, 99.0, 18.0, 18.0),
            no_accent,
            false
        ),
        BadgeFace::Mono
    );
    // Pre-v0.9 single-face asset set: keep whatever is loaded.
    let single = BadgeAvailability::default();
    assert_eq!(
        pick_badge_face(
            "auto",
            None,
            false,
            scores(0.5, 99.0, 18.0, 18.0),
            single,
            true
        ),
        BadgeFace::Primary
    );
    assert_eq!(
        pick_badge_face(
            "auto",
            None,
            false,
            scores(0.5, 99.0, 18.0, 18.0),
            single,
            false
        ),
        BadgeFace::Primary
    );
}
