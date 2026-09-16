//! v0.6.0: preview EXIF overrides, localized dates and OpenType feature flags.

use framegeist_core::{
    encode_jpeg_quality100, load_template_from_str, probe_exif, render_rgba, Error, OutputFormat,
    RenderOptions, Template, TemplateOverrides,
};
use image::{Rgba, RgbaImage};
use little_exif::{exif_tag::ExifTag, filetype::FileExtension, metadata::Metadata};
use serde_json::json;

fn photo(w: u32, h: u32, seed: u8) -> Vec<u8> {
    let mut img = RgbaImage::new(w, h);
    for (x, y, p) in img.enumerate_pixels_mut() {
        *p = Rgba([
            ((x * 255) / w.max(1)) as u8,
            ((y * 255) / h.max(1)) as u8 ^ seed,
            ((x + y) as u8).wrapping_mul(seed),
            255,
        ]);
    }
    encode_jpeg_quality100(&img).expect("jpeg")
}

fn photo_with_datetime(datetime: &str) -> Vec<u8> {
    let mut jpeg = photo(320, 240, 11);
    let mut md = Metadata::new();
    md.set_tag(ExifTag::DateTimeOriginal(datetime.into()));
    md.write_to_vec(&mut jpeg, FileExtension::JPEG)
        .expect("exif");
    jpeg
}

fn text_layer(expr: &str, fallback: &str, features: Option<&[&str]>) -> serde_json::Value {
    let mut layer = json!({
        "type": "text",
        "id": "caption",
        "anchor": "middle-center",
        "font": {"family": ["Inter"], "size": 0.06, "weight": 500, "color": "#111111"},
        "content": [{"expr": expr, "fallback": fallback}]
    });
    if let Some(f) = features {
        layer["features"] = json!(f);
    }
    layer
}

fn template(canvas: serde_json::Value, layers: Vec<serde_json::Value>) -> Template {
    let json = json!({
        "meta": {
            "id": "v6-test", "name": "V6 Test", "version": "1.0.0",
            "minEngineVersion": "0.6.0", "author": "FrameGeist",
            "license": "CC0-1.0", "category": "minimal"
        },
        "canvas": canvas,
        "layers": layers
    });
    load_template_from_str(&json.to_string()).expect("template loads")
}

fn assets_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../templates/assets")
}

fn render(photo: &[u8], tpl: &Template, overrides_json: &str) -> RgbaImage {
    let opts = RenderOptions {
        assets_dir: Some(assets_dir()),
        overrides: Some(TemplateOverrides::from_json(overrides_json).expect("overrides")),
        ..RenderOptions::default()
    };
    render_rgba(photo, tpl, &opts).expect("render")
}

#[test]
fn exif_override_fills_missing_fields() {
    let tpl = template(
        json!({"mode": "overlay"}),
        vec![text_layer("if_empty(exif.model, 'CAM')", "CAM", None)],
    );
    let p = photo(320, 240, 3);
    let plain = render(&p, &tpl, "{}");
    let filled = render(&p, &tpl, r##"{"exif":{"model":"ILCE-7RM3"}}"##);
    assert_ne!(
        plain.as_raw(),
        filled.as_raw(),
        "override must change the rendered caption"
    );
}

#[test]
fn date_locale_changes_the_caption() {
    let tpl = template(
        json!({"mode": "overlay"}),
        vec![text_layer("date('LOCAL', exif.datetime)", "", None)],
    );
    let p = photo_with_datetime("2026:05:02 15:13:35");
    let zh = render(&p, &tpl, r##"{"dateLocale":"zh"}"##);
    let en = render(&p, &tpl, r##"{"dateLocale":"en"}"##);
    let neutral = render(&p, &tpl, "{}");
    assert_ne!(zh.as_raw(), en.as_raw(), "zh vs en captions must differ");
    assert_ne!(
        neutral.as_raw(),
        zh.as_raw(),
        "neutral ISO caption must differ from localized"
    );
}

#[test]
fn features_validate_and_render() {
    let ok = template(
        json!({"mode": "overlay"}),
        vec![text_layer("'1234567890'", "", Some(&["tnum"]))],
    );
    let p = photo(320, 240, 5);
    let _ = render(&p, &ok, "{}");

    let bad = json!({
        "meta": {
            "id": "v6-bad", "name": "Bad", "version": "1.0.0",
            "minEngineVersion": "0.6.0", "author": "FrameGeist",
            "license": "CC0-1.0", "category": "minimal"
        },
        "canvas": {"mode": "overlay"},
        "layers": [text_layer("'1234567890'", "", Some(&["xx99"]))]
    });
    let err = load_template_from_str(&bad.to_string()).expect_err("bad feature must fail");
    assert!(matches!(err, Error::SchemaViolation(_)), "got {err:?}");
}

/// v0.6.0 Q10: encode a photo + template into the requested container.
fn render_to(photo: &[u8], tpl: &Template, format: OutputFormat) -> Vec<u8> {
    let opts = RenderOptions {
        format,
        ..RenderOptions::default()
    };
    framegeist_core::render(photo, tpl, &opts).expect("render")
}

/// All `ispe` box dimensions in an ISOBMFF (AVIF) stream. image 0.25 only
/// decodes AVIF with `avif-native` (dav1d, not wasm-friendly), so the test
/// parses the container directly.
fn avif_ispe_dimensions(bytes: &[u8]) -> Vec<(u32, u32)> {
    let mut dims = Vec::new();
    let mut i = 0;
    while i + 16 <= bytes.len() {
        if &bytes[i..i + 4] == b"ispe" {
            let w = u32::from_be_bytes(bytes[i + 8..i + 12].try_into().unwrap());
            let h = u32::from_be_bytes(bytes[i + 12..i + 16].try_into().unwrap());
            dims.push((w, h));
            i += 4;
        } else {
            i += 1;
        }
    }
    dims
}

#[test]
fn avif_export_decodes_with_ftyp_and_dimensions() {
    let tpl = template(
        json!({"mode": "overlay"}),
        vec![text_layer("'1234567890'", "", Some(&["tnum"]))],
    );
    let p = photo(320, 240, 7);
    let out = render_to(&p, &tpl, OutputFormat::Avif);

    assert!(out.len() > 64, "avif output too small: {} bytes", out.len());
    assert_eq!(&out[4..8], b"ftyp", "missing ftyp box");
    let brand = &out[8..12];
    assert!(
        brand == b"avif" || brand == b"avis",
        "unexpected ftyp brand {brand:?}"
    );
    let dims = avif_ispe_dimensions(&out);
    assert!(
        dims.contains(&(320, 240)),
        "ispe dimensions {dims:?} must contain 320x240"
    );
}

#[test]
fn webp_export_decodes_with_riff_magic_and_dimensions() {
    let tpl = template(
        json!({"mode": "overlay"}),
        vec![text_layer("'1234567890'", "", Some(&["tnum"]))],
    );
    let p = photo(320, 240, 7);
    let out = render_to(&p, &tpl, OutputFormat::Webp);

    assert_eq!(&out[0..4], b"RIFF", "missing RIFF magic");
    assert_eq!(&out[8..12], b"WEBP", "missing WEBP magic");
    // The image crate's WebP decoder is feature-enabled, so size can be
    // verified by a real decode.
    let decoded =
        image::load_from_memory_with_format(&out, image::ImageFormat::WebP).expect("webp");
    assert_eq!(decoded.to_rgba8().dimensions(), (320, 240));
}

#[test]
fn avif_webp_keep_exif_metadata() {
    let tpl = template(json!({"mode": "overlay"}), vec![]);
    let p = photo_with_datetime("2024:03:02 10:11:12");

    let avif = render_to(&p, &tpl, OutputFormat::Avif);
    let webp = render_to(&p, &tpl, OutputFormat::Webp);

    // Container-level markers: AVIF `Exif` item, WebP `EXIF` RIFF chunk.
    assert!(
        avif.windows(4).any(|w| w == b"Exif"),
        "AVIF must carry an Exif item"
    );
    assert!(
        webp.windows(4).any(|w| w == b"EXIF"),
        "WebP must carry an EXIF chunk"
    );
    // kamadak-exif reads both containers: the passthrough EXIF survives.
    assert_eq!(
        probe_exif(&avif).expect("probe avif").datetime.as_deref(),
        Some("2024:03:02 10:11:12")
    );
    assert_eq!(
        probe_exif(&webp).expect("probe webp").datetime.as_deref(),
        Some("2024:03:02 10:11:12")
    );
}

#[test]
fn avif_webp_sizes_are_smaller_than_png() {
    let tpl = template(
        json!({"mode": "overlay"}),
        vec![text_layer("date('LOCAL', exif.datetime)", "", None)],
    );
    let p = photo(960, 640, 7);
    let png = render_to(&p, &tpl, OutputFormat::Png);
    let avif = render_to(&p, &tpl, OutputFormat::Avif);
    let webp = render_to(&p, &tpl, OutputFormat::Webp);

    assert!(
        avif.len() < png.len(),
        "avif {} bytes must be smaller than png {} bytes",
        avif.len(),
        png.len()
    );
    assert!(
        webp.len() < png.len(),
        "webp {} bytes must be smaller than png {} bytes",
        webp.len(),
        png.len()
    );
}

#[test]
fn locale_and_exif_overrides_are_validated() {
    assert!(TemplateOverrides::from_json(r##"{"dateLocale":"fr"}"##).is_err());
    assert!(TemplateOverrides::from_json(r##"{"dateLocale":"zh"}"##).is_ok());
    assert!(TemplateOverrides::from_json(r##"{"exif":{"evil":"x"}}"##).is_err());
    assert!(TemplateOverrides::from_json(r##"{"exif":{"model":"X"}}"##).is_ok());
    assert!(TemplateOverrides::from_json(r##"{"exif":{"model":{"nested":1}}}"##).is_err());
}
