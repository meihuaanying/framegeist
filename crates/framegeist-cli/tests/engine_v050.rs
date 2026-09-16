//! v0.5.0 engine regression: text effects, adaptive sizing, divider, group,
//! calendar, crop, metadata switch, Fuji MakerNote, legacy text renderer.
use framegeist_core::{
    encode_jpeg_quality100, load_template_from_str, render, render_with_report, OutputFormat,
    RenderOptions, Sampling, Template,
};
use image::RgbaImage;

fn photo(w: u32, h: u32) -> Vec<u8> {
    let mut img = RgbaImage::new(w, h);
    for (x, y, px) in img.enumerate_pixels_mut() {
        let r = ((x * 255) / w.max(1)) as u8;
        let g = ((y * 255) / h.max(1)) as u8;
        let b = 200u8;
        *px = image::Rgba([r, g, b, 255]);
    }
    encode_jpeg_quality100(&img).expect("jpeg")
}

fn template(layers: &str) -> Template {
    let json = format!(
        r##"{{
          "meta": {{"id":"v5-test","name":"V5 Test","version":"1.0.0","minEngineVersion":"0.4.0","author":"FrameGeist","license":"CC0-1.0","category":"minimal"}},
          "canvas": {{"mode":"overlay"}},
          "layers": [{layers}]
        }}"##
    );
    load_template_from_str(&json).expect("template loads")
}

fn text_layer(extra: &str) -> String {
    format!(
        r##"{{"type":"text","id":"t1","anchor":"middle-center","offset":{{"x":0,"y":0}},
            "font":{{"family":["JetBrains Mono"],"size":0.12,"color":"#111111"}},
            "lineHeight":1.3,"content":[{{"expr":"'SAMPLE'"}}]{extra}}}"##
    )
}

fn assets_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../templates/assets")
}

fn render_img(photo: &[u8], tpl: &Template) -> RgbaImage {
    let opts = RenderOptions {
        format: OutputFormat::Png,
        sampling: Sampling::Full,
        assets_dir: Some(assets_dir()),
        ..RenderOptions::default()
    };
    let bytes = render(photo, tpl, &opts).expect("render");
    image::load_from_memory(&bytes).expect("decode").to_rgba8()
}

fn render_img_with(photo: &[u8], tpl: &Template, opts: RenderOptions) -> RgbaImage {
    let bytes = render(photo, tpl, &opts).expect("render");
    image::load_from_memory(&bytes).expect("decode").to_rgba8()
}

fn count(img: &RgbaImage, pred: impl Fn([u8; 4]) -> bool) -> usize {
    img.pixels().filter(|p| pred(p.0)).count()
}

fn ink() -> impl Fn([u8; 4]) -> bool {
    |p: [u8; 4]| p[0] < 140 && p[1] < 140 && p[2] < 140
}

fn red_pixels() -> impl Fn([u8; 4]) -> bool {
    |p: [u8; 4]| p[0] > 170 && p[1] < 90 && p[2] < 90
}

#[test]
fn stroke_paints_outside_glyphs() {
    let p = photo(800, 600);
    let plain = template(&text_layer(""));
    let stroked = template(&text_layer(
        r##","effects":{"stroke":{"width":0.12,"color":"#FF0000"}}"##,
    ));
    let a = render_img(&p, &plain);
    let b = render_img(&p, &stroked);
    assert_eq!(
        count(&a, red_pixels()),
        0,
        "no stroke should mean no red pixels"
    );
    assert!(
        count(&b, red_pixels()) > 200,
        "stroke must paint a visible red ring"
    );
}

#[test]
fn double_stroke_paints_more_than_single() {
    let p = photo(800, 600);
    let single = template(&text_layer(
        r##","effects":{"stroke":{"width":0.10,"color":"#FF0000"}}"##,
    ));
    let double = template(&text_layer(
        r##","effects":{"stroke":{"width":0.10,"color":"#FF0000","double":true,"gap":0.08}}"##,
    ));
    let a = count(&render_img(&p, &single), red_pixels());
    let b = count(&render_img(&p, &double), red_pixels());
    assert!(
        b > a,
        "double stroke must paint more red pixels ({b} vs {a})"
    );
}

#[test]
fn gradient_fill_changes_pixels() {
    let p = photo(800, 600);
    let solid = template(&text_layer(""));
    let gradient = template(&text_layer(
        r##","effects":{"fill":{"mode":"gradient","colors":["#FF0000","#0000FF"],"angle":0}}"##,
    ));
    let a = render_img(&p, &solid);
    let b = render_img(&p, &gradient);
    let reddish = count(&b, |px| px[0] > 150 && px[2] < 120 && px[1] < 120);
    let bluish = count(&b, |px| px[2] > 150 && px[0] < 120 && px[1] < 120);
    assert!(
        reddish > 50 && bluish > 50,
        "gradient must show both stops ({reddish}/{bluish})"
    );
    assert_ne!(a.as_raw(), b.as_raw());
}

#[test]
fn shadow_offsets_ink() {
    let p = photo(800, 600);
    let plain = template(&text_layer(""));
    let shadow = template(&text_layer(
        r##","effects":{"shadow":{"offsetX":0.25,"offsetY":0.25,"blur":0,"color":"#000000","opacity":1.0}}"##,
    ));
    let a = count(&render_img(&p, &plain), ink());
    let b = count(&render_img(&p, &shadow), ink());
    assert!(b > a, "shadow must add dark pixels ({b} vs {a})");
}

#[test]
fn case_upper_paints_more_than_lower() {
    let p = photo(800, 600);
    let lower_tpl = template(
        r##"{"type":"text","id":"t1","anchor":"middle-center","offset":{"x":0,"y":0},
            "font":{"family":["JetBrains Mono"],"size":0.12,"color":"#111111"},
            "lineHeight":1.3,"content":[{"expr":"'iso'"}],"effects":{"case":"lower"}}"##,
    );
    let upper_tpl = template(
        r##"{"type":"text","id":"t1","anchor":"middle-center","offset":{"x":0,"y":0},
            "font":{"family":["JetBrains Mono"],"size":0.12,"color":"#111111"},
            "lineHeight":1.3,"content":[{"expr":"'iso'"}],"effects":{"case":"upper"}}"##,
    );
    let a = count(&render_img(&p, &lower_tpl), ink());
    let b = count(&render_img(&p, &upper_tpl), ink());
    assert!(b > a, "uppercase letters carry more ink ({b} vs {a})");
}

#[test]
fn adaptive_height_scales_font() {
    let p = photo(800, 600);
    let small = template(&text_layer(r##","height":0.06"##));
    let large = template(&text_layer(r##","height":0.35"##));
    let a = count(&render_img(&p, &small), ink());
    let b = count(&render_img(&p, &large), ink());
    assert!(
        b > a * 2,
        "target height 0.35 must render a much larger block ({b} vs {a})"
    );
}

#[test]
fn group_offset_moves_children() {
    let p = photo(800, 600);
    let at_center = template(&format!(
        r##"{{"type":"group","id":"g1","anchor":"top-left","offset":{{"x":0.0,"y":0.0}},"width":0.5,"height":0.5,"children":[{}]}}"##,
        text_layer("")
    ));
    let shifted = template(&format!(
        r##"{{"type":"group","id":"g1","anchor":"top-left","offset":{{"x":0.4,"y":0.0}},"width":0.5,"height":0.5,"children":[{}]}}"##,
        text_layer("")
    ));
    let a = render_img(&p, &at_center);
    let b = render_img(&p, &shifted);
    let mean_x = |img: &RgbaImage| -> f64 {
        let mut sx = 0f64;
        let mut n = 0f64;
        for (x, _y, px) in img.enumerate_pixels() {
            if ink()(px.0) {
                sx += x as f64;
                n += 1.0;
            }
        }
        sx / n.max(1.0)
    };
    assert!(
        mean_x(&b) > mean_x(&a) + 80.0,
        "group offset must move children right"
    );
}

#[test]
fn divider_auto_hides_without_neighbours() {
    let p = photo(800, 600);
    let divider = r##"{"type":"shape","id":"rule","anchor":"middle-center","offset":{"x":0,"y":0.2},
        "shape":"line","size":{"width":0.8,"height":0.002},"color":"#00FF00","autoHide":true}"##;
    let one_text = template(&format!("{},{}", text_layer(""), divider));
    let two_texts = template(&format!(
        "{},{},{}",
        text_layer(""),
        r##"{"type":"text","id":"t2","anchor":"middle-center","offset":{"x":0,"y":-0.2},
            "font":{"family":["JetBrains Mono"],"size":0.06,"color":"#111111"},
            "content":[{"expr":"'SECOND'"}]}"##,
        divider
    ));
    let green = |px: [u8; 4]| px[1] > 180 && px[0] < 90 && px[2] < 90;
    let a = count(&render_img(&p, &one_text), green);
    let b = count(&render_img(&p, &two_texts), green);
    assert_eq!(a, 0, "auto divider hides with a single text layer");
    assert!(
        b > 100,
        "auto divider shows when it can separate two layers"
    );
}

#[test]
fn calendar_layer_renders_month_grid() {
    let p = photo(800, 600);
    let cal = r##"{"type":"calendar","id":"cal","anchor":"middle-center","offset":{"x":0,"y":0},
        "size":0.5,"dateSource":"fixed","year":2026,"month":9,"showLunar":true,"showWeekdays":true,
        "color":"#111111","accent":"#E10600","fontFamily":["Inter"]}"##;
    let tpl = template(cal);
    let img = render_img(&p, &tpl);
    assert!(
        count(&img, ink()) > 400,
        "month calendar must render header + grid + day numbers"
    );
}

#[test]
fn crop_override_reduces_dimensions() {
    let p = photo(800, 600);
    let tpl = template(&text_layer(""));
    let opts = RenderOptions {
        format: OutputFormat::Png,
        sampling: Sampling::Full,
        overrides: Some(
            framegeist_core::TemplateOverrides::from_json(
                r##"{"crop":{"x":0,"y":0,"w":0.5,"h":0.5}}"##,
            )
            .expect("overrides"),
        ),
        ..RenderOptions::default()
    };
    let img = render_img_with(&p, &tpl, opts);
    assert_eq!(img.dimensions(), (400, 300));
}

#[test]
fn metadata_switch_strips_exif() {
    let tpl = template(&text_layer(""));
    // Photo WITH EXIF (Make = Sony) so the switch is observable.
    let tiff = build_tiff_with_makernote(b"FUJIFILM\x0c\0\0\0\x00\x00");
    let img = RgbaImage::from_pixel(400, 300, image::Rgba([90, 110, 130, 255]));
    let mut p = encode_jpeg_quality100(&img).expect("jpeg");
    framegeist_core::splice_exif_app1(&mut p, &tiff).expect("splice");
    let keep = render(&p, &tpl, &RenderOptions::default()).expect("render");
    let strip = render_with_report(
        &p,
        &tpl,
        &RenderOptions {
            overrides: Some(
                framegeist_core::TemplateOverrides::from_json(r##"{"metadata":false}"##)
                    .expect("ov"),
            ),
            ..RenderOptions::default()
        },
    )
    .expect("render")
    .0;
    assert!(
        keep.windows(6).any(|w| w == b"Exif\0\0"),
        "default export keeps EXIF"
    );
    assert!(
        !strip.windows(6).any(|w| w == b"Exif\0\0"),
        "metadata:false strips EXIF"
    );
}

#[test]
fn legacy_renderer_still_paints_text() {
    let p = photo(800, 600);
    let tpl = template(&text_layer(""));
    let modern = render_img(&p, &tpl);
    let legacy = render_img_with(
        &p,
        &tpl,
        RenderOptions {
            format: OutputFormat::Png,
            sampling: Sampling::Full,
            assets_dir: Some(assets_dir()),
            legacy_text_renderer: true,
            ..RenderOptions::default()
        },
    );
    assert!(count(&modern, ink()) > 100, "cosmic-text path paints text");
    assert!(
        count(&legacy, ink()) > 100,
        "legacy ab_glyph path still paints text"
    );
}

#[test]
fn free_collage_positions_items_and_honors_z() {
    let p1 = photo(600, 600);
    let dark = RgbaImage::from_pixel(600, 600, image::Rgba([12, 12, 12, 255]));
    let p2 = encode_jpeg_quality100(&dark).expect("jpeg");
    let spec = framegeist_core::free_collage::load_free_spec(
        r##"{"width":800,"height":600,"background":"#FFFFFF","items":[
          {"photo":0,"x":0.25,"y":0.5,"w":0.4,"z":1},
          {"photo":1,"x":0.75,"y":0.5,"w":0.4,"z":2}
        ]}"##
            .as_bytes(),
    )
    .expect("spec");
    let opts = RenderOptions {
        format: OutputFormat::Png,
        sampling: Sampling::Full,
        ..RenderOptions::default()
    };
    let out = framegeist_core::free_collage::render_free_collage(&[&p1, &p2], &spec, &opts)
        .expect("render");
    let img = image::load_from_memory(&out).expect("decode").to_rgba8();
    assert_eq!(img.dimensions(), (800, 600));
    // The photo gradient makes the left/right halves distinguishable.
    let left = img.get_pixel(200, 300).0;
    let right = img.get_pixel(600, 300).0;
    assert_ne!(left, right, "two photos must occupy different regions");
    // Background stays white outside the items.
    let corner = img.get_pixel(5, 5).0;
    assert_eq!(corner, [255, 255, 255, 255]);
}

#[test]
fn free_collage_rejects_bad_spec() {
    let bad =
        framegeist_core::free_collage::load_free_spec(br##"{"width":10,"height":10,"items":[]}"##);
    assert!(bad.is_err(), "canvas below 64px must be rejected");
}

#[test]
fn fuji_makernote_fields_are_parsed() {
    // Synthesize a little-endian TIFF with a Fujifilm MakerNote carrying film
    // mode 0x800 (Classic Negative) and dynamic range 0x200 (DR200).
    let mut mn: Vec<u8> = b"FUJIFILM".to_vec();
    mn.extend_from_slice(&12u32.to_le_bytes());
    mn.extend_from_slice(&2u16.to_le_bytes());
    let entry = |tag: u16, value: u16| {
        let mut e = Vec::new();
        e.extend_from_slice(&tag.to_le_bytes());
        e.extend_from_slice(&3u16.to_le_bytes());
        e.extend_from_slice(&1u32.to_le_bytes());
        e.extend_from_slice(&value.to_le_bytes());
        e.extend_from_slice(&0u16.to_le_bytes());
        e
    };
    mn.extend(entry(0x1401, 0x0800));
    mn.extend(entry(0x1402, 0x0200));

    let tiff = build_tiff_with_makernote(&mn);
    let img = RgbaImage::from_pixel(320, 240, image::Rgba([120, 130, 140, 255]));
    let mut jpeg = encode_jpeg_quality100(&img).expect("jpeg");
    framegeist_core::splice_exif_app1(&mut jpeg, &tiff).expect("splice");
    let info = framegeist_core::probe_exif(&jpeg).expect("probe");
    assert_eq!(info.make.as_deref(), Some("FUJIFILM"));
    assert_eq!(info.film_mode.as_deref(), Some("Classic Negative"));
    assert_eq!(info.dynamic_range.as_deref(), Some("DR200"));
    assert_eq!(info.get("film_mode").as_deref(), Some("Classic Negative"));
}

/// Minimal hand-built TIFF: IFD0(Make + ExifIFD pointer) -> Exif IFD(MakerNote).
fn build_tiff_with_makernote(makernote: &[u8]) -> Vec<u8> {
    let ifd0_off = 8usize;
    let ifd0_len = 2 + 2 * 12 + 4;
    let exif_ifd_off = ifd0_off + ifd0_len;
    let exif_ifd_len = 2 + 12 + 4;
    let make_off = exif_ifd_off + exif_ifd_len;
    let make = b"FUJIFILM\0";
    let mn_off = make_off + make.len();

    let mut out = Vec::new();
    out.extend_from_slice(b"II");
    out.extend_from_slice(&42u16.to_le_bytes());
    out.extend_from_slice(&(ifd0_off as u32).to_le_bytes());
    // IFD0
    out.extend_from_slice(&2u16.to_le_bytes());
    let e = |tag: u16, typ: u16, count: u32, value: u32, out: &mut Vec<u8>| {
        out.extend_from_slice(&tag.to_le_bytes());
        out.extend_from_slice(&typ.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&value.to_le_bytes());
    };
    e(0x010F, 2, make.len() as u32, make_off as u32, &mut out);
    e(0x8769, 4, 1, exif_ifd_off as u32, &mut out);
    out.extend_from_slice(&0u32.to_le_bytes());
    // Exif IFD
    out.extend_from_slice(&1u16.to_le_bytes());
    e(0x927C, 7, makernote.len() as u32, mn_off as u32, &mut out);
    out.extend_from_slice(&0u32.to_le_bytes());
    // Data
    out.extend_from_slice(make);
    out.extend_from_slice(makernote);
    out
}
