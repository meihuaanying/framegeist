use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;

use framegeist_core::{load_template, render, render_rgba, RenderOptions, TemplateOverrides};

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

fn jpeg_with_exif(model: &str) -> Vec<u8> {
    let mut jpeg = gradient_jpeg(800, 600);
    let fields = vec![
        exif::Field {
            tag: exif::Tag::Make,
            ifd_num: exif::In::PRIMARY,
            value: exif::Value::Ascii(vec![b"Sony".to_vec()]),
        },
        exif::Field {
            tag: exif::Tag::Model,
            ifd_num: exif::In::PRIMARY,
            value: exif::Value::Ascii(vec![model.as_bytes().to_vec()]),
        },
    ];
    let mut writer = exif::experimental::Writer::new();
    for field in &fields {
        writer.push_field(field);
    }
    let mut buf = Cursor::new(Vec::new());
    writer.write(&mut buf, false).expect("exif");
    framegeist_core::splice_exif_app1(&mut jpeg, &buf.into_inner()).expect("splice");
    jpeg
}

fn red_png() -> Vec<u8> {
    let mut img = image::RgbaImage::new(64, 64);
    for px in img.pixels_mut() {
        *px = image::Rgba([255, 0, 0, 255]);
    }
    let mut out = Vec::new();
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png");
    out
}

fn count_red(img: &image::RgbaImage) -> u32 {
    img.pixels().filter(|p| p.0 == [255, 0, 0, 255]).count() as u32
}

const BADGE_TEMPLATE: &str = r##"{
  "meta": { "id": "badge-test", "name": "Badge", "version": "0.1.0", "minEngineVersion": "0.1.0",
            "author": "t", "license": "CC0-1.0", "category": "minimal" },
  "canvas": { "mode": "extend", "padding": { "bottom": 0.14 }, "background": { "type": "solid", "color": "#FFFFFF" } },
  "layers": [
    { "type": "text", "id": "primary", "anchor": "bottom-left", "offset": { "x": 0.08, "y": -0.05 },
      "font": { "family": ["JetBrains Mono"], "size": 0.03, "color": "#111111" },
      "content": [ { "expr": "exif.model", "fallback": "Camera" } ] },
    { "type": "image", "id": "brand", "anchor": "bottom-left", "offset": { "x": 0.02, "y": -0.05 },
      "asset": "@builtin/brand/{exif.brand_slug}", "size": { "height": 0.04 },
      "attachTo": "primary", "attachGap": 0.012 }
  ]
}"##;

fn badge_template() -> framegeist_core::Template {
    load_template(BADGE_TEMPLATE.as_bytes()).expect("badge template valid")
}

#[test]
fn image_layer_renders_and_attaches_left_of_text() {
    let photo = jpeg_with_exif("ILCE-7CM2");
    let mut assets = HashMap::new();
    assets.insert("@builtin/brand/sony".to_string(), red_png());
    let o = RenderOptions {
        assets: Some(assets),
        ..opts()
    };
    let img = render_rgba(&photo, &badge_template(), &o).unwrap();
    assert!(count_red(&img) > 100, "brand badge must paint red pixels");
    // badge should sit left of the text block: red pixels concentrated in the
    // left third of the canvas
    let (w, _h) = img.dimensions();
    let left_red = img
        .pixels()
        .enumerate()
        .filter(|(i, p)| {
            let x = (i % w as usize) as u32;
            p.0 == [255, 0, 0, 255] && x < w / 3
        })
        .count();
    assert!(left_red as u32 > 100, "badge must be attached at the left");
}

#[test]
fn show_logo_false_hides_badge() {
    let photo = jpeg_with_exif("ILCE-7CM2");
    let mut assets = HashMap::new();
    assets.insert("@builtin/brand/sony".to_string(), red_png());
    let o = RenderOptions {
        assets: Some(assets),
        overrides: Some(TemplateOverrides {
            show_logo: Some(false),
            ..Default::default()
        }),
        ..opts()
    };
    let img = render_rgba(&photo, &badge_template(), &o).unwrap();
    assert_eq!(count_red(&img), 0, "show_logo=false must skip brand layers");
}

#[test]
fn missing_brand_asset_leaves_blank_not_fake() {
    let photo = jpeg_with_exif("UNKNOWN-CAM");
    let o = opts();
    let img = render_rgba(&photo, &badge_template(), &o).unwrap();
    assert_eq!(count_red(&img), 0, "no asset -> blank slot");
}

/// Regression: `@builtin/brand/{slug}` must resolve against assets_dir
/// (`<assets>/brand/<slug>.png`) — v0.2.0 had a double-"brand/" bug that
/// silently blanked every built-in badge (CLI included).
#[test]
fn builtin_brand_badge_renders_from_assets_dir() {
    let photo = jpeg_with_exif("ILCE-7CM2");
    let tpl = load_template(&std::fs::read(repo_root().join("templates/film-sprocket-01.json")).unwrap()).unwrap();
    let with_logo = render(&photo, &tpl, &opts()).unwrap();
    let o = RenderOptions {
        overrides: Some(TemplateOverrides {
            show_logo: Some(false),
            ..Default::default()
        }),
        ..opts()
    };
    let without = render(&photo, &tpl, &o).unwrap();
    // outputs must differ: the badge is present on disk (svg->png assets)
    assert_ne!(with_logo, without, "brand badge must render from assets_dir");
    let brand_file = repo_root().join("templates/assets/brand/sony-light.png");
    assert!(brand_file.is_file(), "brand asset missing: {}", brand_file.display());
}

#[test]
fn aspect_override_changes_dimensions() {
    let photo = gradient_jpeg(1600, 1200);
    let tpl = load_template(&std::fs::read(repo_root().join("crates/framegeist-cli/tests/fixtures/classic-white-bottom-param.json")).unwrap()).unwrap();
    for (name, w, h) in [("1:1", 1u32, 1u32), ("16:9", 16, 9), ("3:2", 3, 2)] {
        let o = RenderOptions {
            overrides: Some(TemplateOverrides {
                aspect: Some(name.into()),
                ..Default::default()
            }),
            ..opts()
        };
        let img = render_rgba(&photo, &tpl, &o).unwrap();
        let (iw, ih) = img.dimensions();
        let ratio = iw as f64 / ih as f64;
        let target = w as f64 / h as f64;
        assert!(
            (ratio - target).abs() < 0.01,
            "aspect {name}: got {iw}x{ih} ratio {ratio:.3}, want {target:.3}"
        );
    }
}

#[test]
fn background_override_solid_color() {
    let photo = gradient_jpeg(800, 600);
    let tpl = load_template(&std::fs::read(repo_root().join("crates/framegeist-cli/tests/fixtures/classic-white-bottom-param.json")).unwrap()).unwrap();
    let o = RenderOptions {
        overrides: Some(TemplateOverrides {
            background: Some("solid".into()),
            background_color: Some("#00FF00".into()),
            ..Default::default()
        }),
        ..opts()
    };
    let img = render_rgba(&photo, &tpl, &o).unwrap();
    let p = img.get_pixel(2, 2).0;
    assert!(p[1] > 240 && p[0] < 20 && p[2] < 20, "corner must be green, got {p:?}");
}

#[test]
fn flip_override_changes_pixels() {
    let photo = gradient_jpeg(800, 600);
    let tpl = load_template(&std::fs::read(repo_root().join("crates/framegeist-cli/tests/fixtures/classic-white-bottom-param.json")).unwrap()).unwrap();
    let normal = render_rgba(&photo, &tpl, &opts()).unwrap();
    let o = RenderOptions {
        overrides: Some(TemplateOverrides {
            flip_horizontal: Some(true),
            ..Default::default()
        }),
        ..opts()
    };
    let flipped = render_rgba(&photo, &tpl, &o).unwrap();
    assert_ne!(normal.as_raw(), flipped.as_raw(), "flip must change pixels");
}

#[test]
fn font_override_changes_rendering() {
    let photo = jpeg_with_exif("ILCE-7CM2");
    let o = opts();
    let base = render(&photo, &badge_template(), &o).unwrap();
    let o2 = RenderOptions {
        overrides: Some(TemplateOverrides {
            font_family: Some("Bebas Neue".into()),
            ..Default::default()
        }),
        ..o
    };
    let other = render(&photo, &badge_template(), &o2).unwrap();
    assert_ne!(base, other, "fontFamily override must change text rendering");
}

#[test]
fn overrides_camel_case_json_parses() {
    // Regression: the Web UI sends camelCase; snake_case-only parsing 400'd.
    let o = TemplateOverrides::from_json(
        r##"{"fontSizeScale":1.5,"paddingScale":0.8,"textColor":"#FF0000","aspect":"1:1","background":"blur","flipHorizontal":true,"fontFamily":"Inter","showLogo":false}"##,
    )
    .expect("camelCase overrides must parse");
    assert_eq!(o.font_size_scale, Some(1.5));
    assert_eq!(o.aspect.as_deref(), Some("1:1"));
    assert_eq!(o.show_logo, Some(false));
    assert!(TemplateOverrides::from_json(r#"{"aspect":"7:5"}"#).is_err());
}

#[test]
fn error_codes_are_stable() {
    use framegeist_core::Error;
    assert_eq!(Error::Image("x".into()).code(), "image");
    assert_eq!(Error::UnsupportedFormat("x".into()).code(), "unsupported_format");
    assert_eq!(Error::TemplateTooLarge { size: 1, max: 2 }.code(), "template_too_large");
    let err = load_template(b"{").unwrap_err();
    assert!(matches!(err.code(), "template_json" | "template_schema"));
}

/* ------------------------- v0.3.0: auto contrast ------------------------- */

const AUTO_CONTRAST_TEMPLATE: &str = r##"{
  "meta": { "id": "contrast-test", "name": "Contrast", "version": "0.1.0", "minEngineVersion": "0.1.0",
            "author": "t", "license": "CC0-1.0", "category": "minimal" },
  "canvas": { "mode": "extend", "padding": { "bottom": 0.2 }, "background": { "type": "solid", "color": "#FFFFFF" } },
  "layers": [
    { "type": "text", "id": "line", "anchor": "bottom-left", "offset": { "x": 0.05, "y": -0.08 },
      "font": { "family": ["JetBrains Mono"], "size": 0.05, "color": "#EEEEEE" },
      "content": [ { "expr": "'CONTRAST'", "fallback": null } ] }
  ]
}"##;

/// Count dark pixels only in the bottom band (the padded caption area), so
/// the photo content cannot pollute the assertion.
fn dark_text_pixels(img: &image::RgbaImage) -> u32 {
    let (_, h) = img.dimensions();
    let y0 = (h as f64 * 0.78) as u32;
    img.enumerate_pixels()
        .filter(|(_, y, p)| *y >= y0 && p.0[0] < 90 && p.0[1] < 90 && p.0[2] < 90)
        .count() as u32
}
fn light_text_pixels(img: &image::RgbaImage) -> u32 {
    let (_, h) = img.dimensions();
    let y0 = (h as f64 * 0.78) as u32;
    img.enumerate_pixels()
        .filter(|(_, y, p)| *y >= y0 && p.0[0] > 200 && p.0[1] > 200 && p.0[2] > 200)
        .count() as u32
}

#[test]
fn auto_contrast_darkens_low_contrast_text_on_light_bg() {
    let photo = gradient_jpeg(800, 600);
    let tpl = load_template(AUTO_CONTRAST_TEMPLATE.as_bytes()).unwrap();
    let img = render_rgba(&photo, &tpl, &opts()).unwrap();
    // light-gray #EEE text on white would be ~invisible; engine must darken it
    assert!(dark_text_pixels(&img) > 200, "auto-contrast must darken text on light bg");
    // manual override is respected even when low contrast
    let o = RenderOptions {
        overrides: Some(TemplateOverrides {
            text_color: Some("#EEEEEE".into()),
            ..Default::default()
        }),
        ..opts()
    };
    let manual = render_rgba(&photo, &tpl, &o).unwrap();
    assert!(dark_text_pixels(&manual) < 50, "manual color must not be auto-changed");
}

#[test]
fn auto_color_picks_by_background() {
    let photo = gradient_jpeg(800, 600);
    let white = AUTO_CONTRAST_TEMPLATE.replace("#EEEEEE", "auto");
    let dark = white.replace("#FFFFFF", "#0B0B0B");
    let tpl_w = load_template(white.as_bytes()).unwrap();
    let tpl_d = load_template(dark.as_bytes()).unwrap();
    let img_w = render_rgba(&photo, &tpl_w, &opts()).unwrap();
    let img_d = render_rgba(&photo, &tpl_d, &opts()).unwrap();
    assert!(dark_text_pixels(&img_w) > 200, "'auto' must choose dark on white");
    assert!(light_text_pixels(&img_d) > 200, "'auto' must choose light on dark");
}

const TINT_TEMPLATE: &str = r##"{
  "meta": { "id": "tint-test", "name": "Tint", "version": "0.1.0", "minEngineVersion": "0.1.0",
            "author": "t", "license": "CC0-1.0", "category": "minimal" },
  "canvas": { "mode": "extend", "padding": { "bottom": 0.14 }, "background": { "type": "solid", "color": "#FFFFFF" } },
  "layers": [
    { "type": "text", "id": "primary", "anchor": "bottom-left", "offset": { "x": 0.08, "y": -0.05 },
      "font": { "family": ["JetBrains Mono"], "size": 0.03, "color": "#111111" },
      "content": [ { "expr": "'X'", "fallback": null } ] },
    { "type": "image", "id": "badge", "anchor": "bottom-left", "asset": "@builtin/brand/test",
      "size": { "height": 0.04 }, "attachTo": "primary" }
  ]
}"##;

fn solid_png(rgb: [u8; 3], size: u32) -> Vec<u8> {
    let mut img = image::RgbaImage::new(size, size);
    for px in img.pixels_mut() {
        *px = image::Rgba([rgb[0], rgb[1], rgb[2], 255]);
    }
    let mut out = Vec::new();
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

#[test]
fn badge_autotint_picks_light_variant_on_dark_bg() {
    let photo = gradient_jpeg(800, 600);
    let mut assets = HashMap::new();
    assets.insert("@builtin/brand/test".to_string(), solid_png([255, 0, 0], 64)); // dark-variant red
    assets.insert("@builtin/brand/test-light".to_string(), solid_png([0, 0, 255], 64)); // light-variant blue
    let count = |img: &image::RgbaImage, c: [u8; 4]| img.pixels().filter(|p| p.0 == c).count() as u32;

    let on_light = RenderOptions { assets: Some(assets.clone()), ..opts() };
    let img = render_rgba(&photo, &load_template(TINT_TEMPLATE.as_bytes()).unwrap(), &on_light).unwrap();
    assert!(count(&img, [255, 0, 0, 255]) > 100, "light bg must use dark (red) badge");
    assert_eq!(count(&img, [0, 0, 255, 255]), 0);

    let dark_src = TINT_TEMPLATE.replace("#FFFFFF", "#0B0B0B");
    let on_dark = RenderOptions { assets: Some(assets), ..opts() };
    let img2 = render_rgba(&photo, &load_template(dark_src.as_bytes()).unwrap(), &on_dark).unwrap();
    assert!(count(&img2, [0, 0, 255, 255]) > 100, "dark bg must auto-pick light (blue) badge");
    assert_eq!(count(&img2, [255, 0, 0, 255]), 0);
}

#[test]
fn probe_reports_lens_series() {
    let mut jpeg = gradient_jpeg(400, 300);
    let fields = vec![exif::Field {
        tag: exif::Tag::LensModel,
        ifd_num: exif::In::PRIMARY,
        value: exif::Value::Ascii(vec![b"FE 35mm F1.4 GM".to_vec()]),
    }];
    let mut writer = exif::experimental::Writer::new();
    for field in &fields {
        writer.push_field(field);
    }
    let mut buf = Cursor::new(Vec::new());
    writer.write(&mut buf, false).expect("exif");
    framegeist_core::splice_exif_app1(&mut jpeg, &buf.into_inner()).expect("splice");
    let info = framegeist_core::probe_exif(&jpeg).expect("probe");
    assert_eq!(info.lens_slug.as_deref(), Some("sony"));
    assert_eq!(info.lens_series.as_deref(), Some("sony-gm"));
}
