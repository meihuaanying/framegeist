use std::io::Cursor;
use std::path::PathBuf;

use framegeist_core::{load_template, render, render_rgba, RenderOptions};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
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

fn tpl(id: &str) -> framegeist_core::Template {
    let path = repo_root().join(format!("templates/{id}.json"));
    let bytes = std::fs::read(&path).expect("template");
    load_template(&bytes).expect("valid")
}

/// Catches the silent text-clipping regression: every template with a
/// bottom-anchored text layer must paint SOMETHING into the bottom band.
#[test]
fn bottom_text_is_visible() {
    let photo = std::fs::read(repo_root().join("templates/assets/test-photos/sample-landscape.jpg")).unwrap();
    for id in [
        "classic-white-bottom-param",
        "classic-white-v1",
        "film-v1",
        "polaroid-caption",
        "gallery-v1",
        "technical-v1",
        "magazine-v1",
        "frame-shell-v1",
        "minimal-v1",
    ] {
        let template = tpl(id);
        let img = render_rgba(&photo, &template, &opts()).unwrap();
        let (w, h) = img.dimensions();
        let band = (h as f64 * 0.10).round().max(1.0) as u32;
        let mut nonbg = 0u32;
        for y in (h - band)..h {
            for x in 0..w {
                let p = img.get_pixel(x, y).0;
                if p[0] < 250 || p[1] < 250 || p[2] < 250 {
                    nonbg += 1;
                }
            }
        }
        assert!(
            nonbg > 500,
            "{id}: bottom text produced only {nonbg} non-background pixels — clipped?"
        );
    }
}

/// EXIF orientation must be applied to pixels (portrait phones shoot with
/// Orientation=6 and unrotated pixels).
#[test]
fn orientation_is_applied() {
    use framegeist_core::encode_jpeg_quality100;
    let mut img = image::RgbaImage::new(1200, 900);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Rgba([(x % 251) as u8, (y % 241) as u8, 10, 255]);
    }
    let mut jpeg = encode_jpeg_quality100(&img).expect("jpeg");
    let fields = vec![
        exif::Field {
            tag: exif::Tag::Make,
            ifd_num: exif::In::PRIMARY,
            value: exif::Value::Ascii(vec![b"Sony".to_vec()]),
        },
        exif::Field {
            tag: exif::Tag::Orientation,
            ifd_num: exif::In::PRIMARY,
            value: exif::Value::Short(vec![6]),
        },
    ];
    let mut writer = exif::experimental::Writer::new();
    for field in &fields {
        writer.push_field(field);
    }
    let mut buf = Cursor::new(Vec::new());
    writer.write(&mut buf, false).expect("exif writer");
    framegeist_core::splice_exif_app1(&mut jpeg, &buf.into_inner()).expect("splice");

    let template = tpl("minimal-corner-iso");
    let out = render(&jpeg, &template, &opts()).expect("render");
    let decoded = image::load_from_memory(&out).expect("decode").to_rgb8();
    assert_eq!(decoded.dimensions(), (900, 1200), "orientation 6 must swap 1200x900 -> 900x1200");

    // exported EXIF must be normalized back to 1 so viewers don't double-rotate
    let info = framegeist_core::probe_exif(&out).expect("probe out");
    assert_eq!(info.orientation, Some(1));
}

/// Preview path is capped; export path stays full (PRD A5).
#[test]
fn preview_max_edge_and_export_full() {
    let photo = std::fs::read(repo_root().join("templates/assets/test-photos/sample-landscape.jpg")).unwrap();
    let template = tpl("classic-white-bottom-param");
    let preview_opts = RenderOptions {
        max_edge: Some(800),
        ..opts()
    };
    let preview = render_rgba(&photo, &template, &preview_opts).unwrap();
    assert!(preview.width() <= 800 + 96, "preview canvas capped at max_edge + padding: {}", preview.width());
    let full = render_rgba(&photo, &template, &opts()).unwrap();
    assert_eq!(full.width(), 1600 + 96 + 96, "export keeps full resolution");
}
