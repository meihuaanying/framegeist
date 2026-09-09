use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::PathBuf;

use framegeist_core::{
    encode_jpeg_quality100, load_template, render, splice_exif_app1, OutputFormat, RenderOptions,
    Sampling,
};
use sha2::{Digest, Sha256};

const TEMPLATE_IDS: [&str; 3] = [
    "classic-white-bottom-param",
    "minimal-corner-iso",
    "polaroid-caption",
];

const SHAPES: [(&str, u32, u32); 3] = [("landscape", 1600, 1200), ("portrait", 1200, 1600), ("square", 1280, 1280)];

const VARIANTS: [&str; 4] = ["jpeg-full-exif", "jpeg-partial-exif", "jpeg-no-exif", "png"];

fn gradient(width: u32, height: u32) -> image::RgbaImage {
    let mut img = image::RgbaImage::new(width, height);
    for (x, y, px) in img.enumerate_pixels_mut() {
        let r = ((x * 255) / width.max(1)) as u8;
        let g = ((y * 255) / height.max(1)) as u8;
        let b = ((x + y) % 256) as u8;
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

fn exif_tiff(full: bool) -> Vec<u8> {
    let tuples: Vec<(exif::Tag, exif::In, exif::Value)> = if full {
        vec![
            (exif::Tag::Make, exif::In::PRIMARY, ascii("Sony")),
            (exif::Tag::Model, exif::In::PRIMARY, ascii("ILCE-7CM2")),
            (exif::Tag::LensModel, exif::In::PRIMARY, ascii("FE 35mm F1.4 GM")),
            (exif::Tag::FNumber, exif::In::PRIMARY, rational(28, 10)),
            (exif::Tag::ExposureTime, exif::In::PRIMARY, rational(1, 125)),
            (exif::Tag::PhotographicSensitivity, exif::In::PRIMARY, short(200)),
            (exif::Tag::FocalLength, exif::In::PRIMARY, rational(35, 1)),
            (exif::Tag::Orientation, exif::In::PRIMARY, short(1)),
            (
                exif::Tag::DateTimeOriginal,
                exif::In::PRIMARY,
                ascii("2026:09:09 08:30:00"),
            ),
        ]
    } else {
        vec![
            (exif::Tag::Make, exif::In::PRIMARY, ascii("Fujifilm")),
            (exif::Tag::Model, exif::In::PRIMARY, ascii("X100VI")),
            (exif::Tag::PhotographicSensitivity, exif::In::PRIMARY, short(125)),
        ]
    };
    let fields: Vec<exif::Field> = tuples
        .into_iter()
        .map(|(tag, ifd_num, value)| exif::Field {
            tag,
            ifd_num,
            value,
        })
        .collect();
    let mut writer = exif::experimental::Writer::new();
    for field in &fields {
        writer.push_field(field);
    }
    let mut buf = Cursor::new(Vec::new());
    writer.write(&mut buf, false).expect("exif writer");
    buf.into_inner()
}

fn build_photo(variant: &str, shape: (u32, u32)) -> Vec<u8> {
    let img = gradient(shape.0, shape.1);
    match variant {
        "png" => {
            let mut out = Vec::new();
            image::DynamicImage::ImageRgba8(img)
                .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
                .expect("png encode");
            out
        }
        v => {
            let mut jpeg = encode_jpeg_quality100(&img).expect("jpeg encode");
            match v {
                "jpeg-full-exif" => splice_exif_app1(&mut jpeg, &exif_tiff(true)).expect("splice"),
                "jpeg-partial-exif" => {
                    splice_exif_app1(&mut jpeg, &exif_tiff(false)).expect("splice")
                }
                _ => {}
            }
            jpeg
        }
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

fn load_all_templates() -> Vec<(String, framegeist_core::Template)> {
    let templates_dir = repo_root().join("templates");
    let mut out = Vec::new();
    for id in TEMPLATE_IDS {
        let path = templates_dir.join(format!("{id}.json"));
        let bytes = std::fs::read(&path)
            .unwrap_or_else(|e| panic!("missing template {}: {e}", path.display()));
        let tpl = load_template(&bytes).unwrap_or_else(|e| panic!("template {id} invalid: {e}"));
        out.push((id.to_string(), tpl));
    }
    out
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn baselines_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/baselines.json")
}

#[test]
fn golden_regression() {
    let templates = load_all_templates();
    let opts = RenderOptions {
        format: OutputFormat::Jpeg,
        sampling: Sampling::Full,
        assets_dir: Some(repo_root().join("templates/assets")),
        ..RenderOptions::default()
    };

    let mut hashes = BTreeMap::new();
    for (shape_name, w, h) in SHAPES {
        for variant in VARIANTS {
            let photo = build_photo(variant, (w, h));
            for (id, tpl) in &templates {
                let out = render(&photo, tpl, &opts)
                    .unwrap_or_else(|e| panic!("render failed for {variant}/{shape_name}/{id}: {e}"));
                let key = format!("{variant}_{shape_name}@{id}");
                hashes.insert(key, sha256_hex(&out));
            }
        }
    }

    let path = baselines_path();
    if std::env::var("FRAMEGEIST_UPDATE_BASELINES").as_deref() == Ok("1") {
        let json = serde_json::to_string_pretty(&hashes).expect("serialize baselines");
        std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
        std::fs::write(&path, json + "\n").expect("write baselines");
        println!("baselines updated: {}", path.display());
        return;
    }

    let stored = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "golden baselines missing at {} ({e}); run with FRAMEGEIST_UPDATE_BASELINES=1",
            path.display()
        )
    });
    let stored: BTreeMap<String, String> = serde_json::from_str(&stored).expect("parse baselines");
    let mut mismatches = Vec::new();
    for (key, hash) in &hashes {
        match stored.get(key) {
            Some(expected) if expected == hash => {}
            Some(expected) => mismatches.push(format!("{key}: {expected} -> {hash}")),
            None => mismatches.push(format!("{key}: MISSING baseline -> {hash}")),
        }
    }
    for key in stored.keys() {
        if !hashes.contains_key(key) {
            mismatches.push(format!("{key}: stale baseline (photo/template removed)"));
        }
    }
    assert!(
        mismatches.is_empty(),
        "golden regression failed ({} mismatches):\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
    println!(
        "golden regression passed: {} baselines, 0 mismatches",
        hashes.len()
    );
}
