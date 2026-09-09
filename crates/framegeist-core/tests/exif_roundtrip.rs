use std::io::Cursor;

use framegeist_core::{
    encode, encode_jpeg_quality100, probe_exif, splice_exif_app1, Error, Result,
};

/// Build a synthetic JPEG with EXIF metadata (dogfoods the engine's own
/// EXIF writer) for round-trip tests.
fn jpeg_with_exif(
    width: u32,
    height: u32,
    fields: &[(exif::Tag, exif::In, exif::Value)],
) -> Result<Vec<u8>> {
    let mut img = image::GrayImage::new(width, height);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Luma([(x % 251) as u8 ^ (y % 241) as u8]);
    }
    let dynimg = image::DynamicImage::ImageLuma8(img).to_rgb8();
    let mut jpeg = Vec::new();
    let enc = jpeg_encoder::Encoder::new(&mut jpeg, 90);
    enc.encode(
        dynimg.as_raw(),
        width as u16,
        height as u16,
        jpeg_encoder::ColorType::Rgb,
    )
    .map_err(|e| Error::Encode(e.to_string()))?;

    let fields: Vec<exif::Field> = fields
        .iter()
        .map(|(tag, ifd_num, value)| exif::Field {
            tag: *tag,
            ifd_num: *ifd_num,
            value: value.clone(),
        })
        .collect();
    let mut writer = exif::experimental::Writer::new();
    for field in &fields {
        writer.push_field(field);
    }
    let mut buf = Cursor::new(Vec::new());
    writer
        .write(&mut buf, false)
        .map_err(|e| Error::Exif(e.to_string()))?;
    splice_exif_app1(&mut jpeg, &buf.into_inner())?;
    Ok(jpeg)
}

fn ascii(s: &str) -> exif::Value {
    exif::Value::Ascii(vec![s.as_bytes().to_vec()])
}

fn rational(num: u32, den: u32) -> exif::Value {
    exif::Value::Rational(vec![exif::Rational { num, denom: den }])
}

fn short(v: u16) -> exif::Value {
    exif::Value::Short(vec![v])
}

fn full_photo() -> Result<Vec<u8>> {
    jpeg_with_exif(
        64,
        48,
        &[
            (exif::Tag::Make, exif::In::PRIMARY, ascii("Fujifilm")),
            (exif::Tag::Model, exif::In::PRIMARY, ascii("X-T5")),
            (exif::Tag::LensModel, exif::In::PRIMARY, ascii("XF23mmF1.4 R LM WR")),
            (exif::Tag::FNumber, exif::In::PRIMARY, rational(14, 10)),
            (exif::Tag::ExposureTime, exif::In::PRIMARY, rational(1, 500)),
            (exif::Tag::PhotographicSensitivity, exif::In::PRIMARY, short(400)),
            (exif::Tag::FocalLength, exif::In::PRIMARY, rational(23, 1)),
            (exif::Tag::Orientation, exif::In::PRIMARY, short(1)),
            (
                exif::Tag::DateTimeOriginal,
                exif::In::PRIMARY,
                ascii("2026:09:09 10:00:00"),
            ),
        ],
    )
}

#[test]
fn probe_reads_all_key_fields() {
    let photo = full_photo().expect("build");
    let info = probe_exif(&photo).expect("probe");
    assert_eq!(info.make.as_deref(), Some("Fujifilm"));
    assert_eq!(info.model.as_deref(), Some("X-T5"));
    assert_eq!(info.model_pretty.as_deref(), Some("Fujifilm X-T5"));
    assert_eq!(info.lens.as_deref(), Some("XF23mmF1.4 R LM WR"));
    assert_eq!(info.aperture, Some(1.4));
    assert_eq!(info.shutter.as_deref(), Some("1/500s"));
    assert_eq!(info.iso, Some(400));
    assert_eq!(info.focal_mm, Some(23.0));
    assert_eq!(info.datetime.as_deref(), Some("2026:09:09 10:00:00"));
}

#[test]
fn photo_without_exif_probes_clean() {
    let img = image::DynamicImage::new_rgb8(16, 16).to_rgb8();
    let mut jpeg = Vec::new();
    let enc = jpeg_encoder::Encoder::new(&mut jpeg, 90);
    enc.encode(
        img.as_raw(),
        16,
        16,
        jpeg_encoder::ColorType::Rgb,
    )
    .map_err(|e| Error::Encode(e.to_string()))
    .expect("encode");
    let info = probe_exif(&jpeg).expect("probe");
    assert!(info.model.is_none());
}

#[test]
fn cleaned_exif_drops_gps_keeps_camera_fields() {
    let photo = full_photo().expect("build");
    let tiff = framegeist_core::cleaned_exif_tiff(&photo)
        .expect("clean")
        .expect("exif present");
    let mut container = photo.clone();
    splice_exif_app1(&mut container, &tiff).expect("splice");
    let cleaned = framegeist_core::cleaned_exif_tiff(&container)
        .expect("clean")
        .expect("exif present");
    let reader = exif::Reader::new()
        .read_from_container(&mut Cursor::new(&cleaned))
        .expect("parse cleaned");
    let codes: Vec<u16> = reader.fields().map(|f| f.tag.number()).collect();
    assert!(codes.contains(&0x0110), "Model must survive");
    assert!(codes.contains(&0x829D), "FNumber must survive");
    assert!(codes.contains(&0x9003), "DateTimeOriginal must survive");
    // GPS tags live at 0x0000-0x001F and the GPS IFD pointer is 0x8825;
    // none of them may survive the whitelist.
    assert!(!codes.iter().any(|c| *c <= 0x001F), "no GPS entry may survive");
    assert!(!codes.contains(&0x8825), "GPSInfoIFDPointer must not survive");
}

#[test]
fn render_retains_exif_key_fields() {
    let photo = full_photo().expect("build");
    let tpl = load_template().expect("template");
    let opts = framegeist_core::RenderOptions::default();
    let out = framegeist_core::render(&photo, &tpl, &opts).expect("render");
    let info = probe_exif(&out).expect("probe output");
    assert_eq!(info.model.as_deref(), Some("X-T5"));
    assert_eq!(info.iso, Some(400));
    assert_eq!(info.aperture, Some(1.4));
    assert_eq!(info.shutter.as_deref(), Some("1/500s"));
    assert_eq!(info.focal_mm, Some(23.0));
}

fn load_template() -> Result<framegeist_core::Template> {
    framegeist_core::load_template_from_str(
        r##"{
        "meta": {
            "id": "exif-test", "name": "T", "version": "0.1.0",
            "minEngineVersion": "0.1.0", "author": "t", "license": "CC0-1.0",
            "category": "minimal"
        },
        "canvas": { "mode": "overlay" },
        "layers": [ {
            "type": "text", "id": "a", "anchor": "bottom-left",
            "font": { "family": ["JetBrains Mono"], "size": 0.03, "color": "#111111" },
            "content": [ { "expr": "exif.model", "fallback": "n/a" } ]
        } ]
    }"##,
    )
}

#[test]
fn png_encode_is_lossless() {
    let mut img = image::RgbaImage::new(8, 8);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Rgba([x as u8 * 7, y as u8 * 11, 0, 255]);
    }
    let png = encode::encode_png(&img).expect("png");
    let decoded = image::load_from_memory(&png).expect("decode");
    assert_eq!(decoded.to_rgba8().as_raw(), img.as_raw());
}

#[test]
fn jpeg_q100_444_roundtrip_is_high_fidelity() {
    let mut img = image::RgbaImage::new(64, 64);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Rgba([(x * 4) as u8, (y * 4) as u8, (x * y) as u8, 255]);
    }
    let jpeg = encode_jpeg_quality100(&img).expect("jpeg");
    let decoded = image::load_from_memory(&jpeg).expect("decode").to_rgba8();
    let mut diff = 0usize;
    let total = img.as_raw().len();
    for (a, b) in img.as_raw().iter().zip(decoded.as_raw().iter()) {
        if a.abs_diff(*b) > 2 {
            diff += 1;
        }
    }
    // 4:4:4 + q100: DCT rounding may leave sub-quantization noise on
    // high-frequency patterns, but drift must stay under 0.5% of samples.
    assert!(
        diff * 1000 < total * 5,
        "unexpected pixel drift: {diff}/{total}"
    );
}
