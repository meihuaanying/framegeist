// Generates the fixed test photos used for template sample renders (PRD C6).
// Usage: cargo run -p framegeist-cli --example make_test_photos [outdir]
use std::io::Cursor;
use std::path::PathBuf;

use framegeist_core::{encode_jpeg_quality100, splice_exif_app1};

fn gradient(w: u32, h: u32) -> image::RgbaImage {
    let mut img = image::RgbaImage::new(w, h);
    for (x, y, px) in img.enumerate_pixels_mut() {
        let r = ((x * 255) / w.max(1)) as u8;
        let g = ((y * 255) / h.max(1)) as u8;
        let b = (((x * 7) + (y * 13)) % 256) as u8;
        *px = image::Rgba([r, g, b, 255]);
    }
    img
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

fn exif_tiff(make: &str, model: &str, lens: &str, focal: u32) -> Vec<u8> {
    let tuples: Vec<(exif::Tag, exif::In, exif::Value)> = vec![
        (exif::Tag::Make, exif::In::PRIMARY, ascii(make)),
        (exif::Tag::Model, exif::In::PRIMARY, ascii(model)),
        (exif::Tag::LensModel, exif::In::PRIMARY, ascii(lens)),
        (exif::Tag::FNumber, exif::In::PRIMARY, rational(28, 10)),
        (exif::Tag::ExposureTime, exif::In::PRIMARY, rational(1, 250)),
        (exif::Tag::PhotographicSensitivity, exif::In::PRIMARY, short(200)),
        (exif::Tag::FocalLength, exif::In::PRIMARY, rational(focal, 1)),
        (exif::Tag::Orientation, exif::In::PRIMARY, short(1)),
        (
            exif::Tag::DateTimeOriginal,
            exif::In::PRIMARY,
            ascii("2026:09:09 08:30:00"),
        ),
    ];
    let fields: Vec<exif::Field> = tuples
        .into_iter()
        .map(|(tag, ifd_num, value)| exif::Field { tag, ifd_num, value })
        .collect();
    let mut writer = exif::experimental::Writer::new();
    for field in &fields {
        writer.push_field(field);
    }
    let mut buf = Cursor::new(Vec::new());
    writer.write(&mut buf, false).expect("exif writer");
    buf.into_inner()
}

fn jpeg_photo(w: u32, h: u32, tiff: Option<Vec<u8>>) -> Vec<u8> {
    let mut jpeg = encode_jpeg_quality100(&gradient(w, h)).expect("jpeg");
    if let Some(tiff) = tiff {
        splice_exif_app1(&mut jpeg, &tiff).expect("splice");
    }
    jpeg
}

fn png_photo(w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::new();
    image::DynamicImage::ImageRgba8(gradient(w, h))
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png");
    out
}

fn main() {
    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "templates/assets/test-photos".to_string()),
    );
    std::fs::create_dir_all(&out).expect("mkdir");
    let photos: Vec<(&str, Vec<u8>)> = vec![
        (
            "sample-landscape.jpg",
            jpeg_photo(1600, 1200, Some(exif_tiff("Sony", "ILCE-7CM2", "FE 35mm F1.4 GM", 35))),
        ),
        (
            "sample-portrait.jpg",
            jpeg_photo(1200, 1600, Some(exif_tiff("Fujifilm", "X-T5", "XF23mmF1.4 R LM WR", 23))),
        ),
        ("sample-square.jpg", jpeg_photo(1280, 1280, None)),
        ("sample-noexif.png", png_photo(1600, 1200)),
    ];
    for (name, bytes) in photos {
        std::fs::write(out.join(name), bytes).expect("write");
        println!("wrote {}", out.join(name).display());
    }
}
