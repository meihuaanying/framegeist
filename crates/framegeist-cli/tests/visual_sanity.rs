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

/// In-memory synthetic photo (test-photos are derived artifacts, CI-checkout
/// safe: nothing on disk is assumed beyond templates/ + fonts).
fn gradient_jpeg(w: u32, h: u32) -> Vec<u8> {
    let mut img = image::RgbaImage::new(w, h);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Rgba([
            ((x * 255) / w.max(1)) as u8,
            ((y * 255) / h.max(1)) as u8,
            (((x + y) * 3) % 256) as u8,
            255,
        ]);
    }
    framegeist_core::encode_jpeg_quality100(&img).expect("jpeg")
}

fn tpl(id: &str) -> framegeist_core::Template {
    let fixture = repo_root().join(format!("crates/framegeist-cli/tests/fixtures/{id}.json"));
    let path = if fixture.is_file() {
        fixture
    } else {
        repo_root().join(format!("templates/{id}.json"))
    };
    let bytes = std::fs::read(&path).expect("template");
    load_template(&bytes).expect("valid")
}

/// Catches the silent text-clipping regression: every template with a
/// bottom-anchored text layer must paint SOMETHING into the bottom band.
#[test]
fn bottom_text_is_visible() {
    let photo = gradient_jpeg(1600, 1200);
    for id in [
        "classic-white-bottom-param",
        "polaroid-caption",
        "white-border-editorial-01",
        "film-sprocket-01",
        "magazine-cover-banner-01",
        "portfolio-atelier-plate-01",
        "camera-topdeck-bar-01",
        "classic-watermark-single-row",
        "ticket-stub-horizontal-01",
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
    let photo = gradient_jpeg(1600, 1200);
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

fn count_text_pixels(img: &image::RgbaImage) -> u32 {
    let (w, h) = img.dimensions();
    let band = (h as f64 * 0.12).round() as u32;
    let mut n = 0;
    for y in (h - band)..h {
        for x in 0..w {
            let p = img.get_pixel(x, y).0;
            if p[0] < 200 && p[1] < 200 && p[2] < 200 {
                n += 1;
            }
        }
    }
    n
}

/// T4.4: overrides change the render as requested.
#[test]
fn overrides_affect_render() {
    use framegeist_core::TemplateOverrides;
    let photo = gradient_jpeg(1600, 1200);
    let template = tpl("classic-white-bottom-param");
    let base = render_rgba(&photo, &template, &opts()).unwrap();

    let padded = RenderOptions {
        overrides: Some(TemplateOverrides {
            padding_scale: Some(2.0),
            ..Default::default()
        }),
        ..opts()
    };
    let padded_img = render_rgba(&photo, &template, &padded).unwrap();
    assert!(
        padded_img.width() > base.width(),
        "padding_scale 2.0 must grow the canvas: {} vs {}",
        padded_img.width(),
        base.width()
    );

    let bigger = RenderOptions {
        overrides: Some(TemplateOverrides {
            font_size_scale: Some(2.0),
            ..Default::default()
        }),
        ..opts()
    };
    let bigger_img = render_rgba(&photo, &template, &bigger).unwrap();
    assert!(
        count_text_pixels(&bigger_img) > count_text_pixels(&base),
        "font_size_scale 2.0 must paint more text pixels"
    );

    let reddish = RenderOptions {
        overrides: Some(TemplateOverrides {
            text_color: Some("#FF0000".into()),
            ..Default::default()
        }),
        ..opts()
    };
    let red_img = render_rgba(&photo, &template, &reddish).unwrap();
    let (w, h) = red_img.dimensions();
    let mut red_dominant = 0u32;
    for y in (h - (h / 8))..h {
        for x in 0..w {
            let p = red_img.get_pixel(x, y).0;
            if p[0] > 150 && p[1] < 120 && p[2] < 120 {
                red_dominant += 1;
            }
        }
    }
    assert!(red_dominant > 200, "text_color override must produce red pixels, got {red_dominant}");
}

/// Raw RGBA path (browser pre-decode fast preview) must match the byte path.
#[test]
fn raw_rgba_path_matches_byte_path() {
    let photo = gradient_jpeg(1600, 1200);
    let template = tpl("classic-white-bottom-param");
    let o = opts();
    let via_bytes = framegeist_core::render(&photo, &template, &o).unwrap();
    let decoded = image::load_from_memory(&photo).unwrap().to_rgba8();
    let (w, h) = decoded.dimensions();
    let (via_raw, _report) = framegeist_core::render_from_rgba(
        Some(&photo),
        decoded.as_raw(),
        w,
        h,
        &template,
        &o,
    )
    .unwrap();
    assert_eq!(via_bytes, via_raw, "raw path must be byte-identical to the decode path");
}
