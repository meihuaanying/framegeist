//! v0.5.0 override regressions: tint background, canvas margin, card
//! radius/shadow/border, frame rotation and their validation ranges.

use framegeist_core::{
    encode_jpeg_quality100, load_template_from_str, render_rgba, Error, RenderOptions, Template,
    TemplateOverrides,
};
use image::RgbaImage;

fn photo(w: u32, h: u32, rgb: [u8; 3]) -> Vec<u8> {
    let img = RgbaImage::from_pixel(w, h, image::Rgba([rgb[0], rgb[1], rgb[2], 255]));
    encode_jpeg_quality100(&img).expect("jpeg")
}

fn template(canvas: &str, layers: &str) -> Template {
    let json = format!(
        r##"{{
          "meta": {{"id":"v5-override-test","name":"V5 Override Test","version":"1.0.0","minEngineVersion":"0.4.0","author":"FrameGeist","license":"CC0-1.0","category":"minimal"}},
          "canvas": {canvas},
          "layers": [{layers}]
        }}"##
    );
    load_template_from_str(&json).expect("template loads")
}

fn render(photo: &[u8], tpl: &Template, overrides_json: &str) -> RgbaImage {
    let opts = RenderOptions {
        overrides: Some(TemplateOverrides::from_json(overrides_json).expect("overrides valid")),
        ..RenderOptions::default()
    };
    render_rgba(photo, tpl, &opts).expect("render")
}

fn png_bytes(img: &RgbaImage) -> Vec<u8> {
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgba8(img.clone())
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .expect("png");
    bytes
}

fn assets_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../templates/assets")
}

fn render_with_fonts(photo: &[u8], tpl: &Template) -> RgbaImage {
    let opts = RenderOptions {
        assets_dir: Some(assets_dir()),
        ..RenderOptions::default()
    };
    render_rgba(photo, tpl, &opts).expect("render")
}

fn count(img: &RgbaImage, pred: impl Fn([u8; 4]) -> bool) -> usize {
    img.pixels().filter(|p| pred(p.0)).count()
}

fn ink() -> impl Fn([u8; 4]) -> bool {
    |p: [u8; 4]| p[0] < 140 && p[1] < 140 && p[2] < 140
}

fn red_pixels() -> impl Fn([u8; 4]) -> bool {
    |px: [u8; 4]| px[0] > 200 && px[1] < 60 && px[2] < 60
}

#[test]
fn background_tint_override_uses_photo_average() {
    let tpl = template(
        r##"{"mode":"extend","padding":{"left":0.3,"right":0.3},"background":{"type":"solid","color":"#FFFFFF"}}"##,
        "",
    );
    let p = photo(400, 200, [255, 0, 0]);
    let solid = render(&p, &tpl, "{}");
    let tinted = render(&p, &tpl, r##"{"background":"tint"}"##);
    let solid_margin = solid.get_pixel(5, 100).0;
    let tint_margin = tinted.get_pixel(5, 100).0;
    assert_eq!(
        solid_margin,
        [255, 255, 255, 255],
        "template solid margin stays white"
    );
    assert!(
        red_pixels()(tint_margin),
        "tint override must fill the margin with the photo average, got {tint_margin:?}"
    );
    assert_ne!(
        solid.as_raw(),
        tinted.as_raw(),
        "tint must change background pixels vs solid"
    );
}

#[test]
fn margin_override_adds_padding_and_feeds_aspect() {
    let tpl = template(
        r##"{"mode":"extend","padding":{"top":0.1,"right":0.1,"bottom":0.1,"left":0.1},"background":{"type":"solid","color":"#FFFFFF"}}"##,
        "",
    );
    let p = photo(400, 200, [255, 0, 0]);
    let base = render(&p, &tpl, "{}");
    let padded = render(&p, &tpl, r##"{"margin":0.1}"##);
    assert_eq!(base.dimensions(), (480, 240), "0.1 padding -> 480x240");
    assert_eq!(
        padded.dimensions(),
        (560, 280),
        "margin 0.1 adds 0.1*w/h to every side"
    );
    // The photo itself is untouched: only the padding grows around it.
    assert_eq!(
        count(&padded, red_pixels()),
        count(&base, red_pixels()),
        "margin must not rescale the photo"
    );
    // Aspect expansion sees the margin-expanded base and stays consistent.
    let square = render(&p, &tpl, r##"{"margin":0.1,"aspect":"1:1"}"##);
    assert_eq!(
        square.dimensions(),
        (560, 560),
        "aspect 1:1 expands the margin-padded 560x280 base"
    );
}

#[test]
fn card_radius_override_rounds_corners() {
    let plain_tpl = template(r##"{"mode":"overlay"}"##, "");
    let radius_tpl = template(r##"{"mode":"overlay","radius":0.2}"##, "");
    let p = photo(400, 300, [255, 0, 0]);
    let plain = render(&p, &plain_tpl, "{}");
    let rounded = render(&p, &plain_tpl, r##"{"card":{"radius":0.2}}"##);
    let disabled = render(&p, &radius_tpl, r##"{"card":{"enabled":false}}"##);
    assert_eq!(
        plain.get_pixel(1, 1).0[3],
        255,
        "plain card corner is opaque"
    );
    assert_eq!(
        rounded.get_pixel(1, 1).0[3],
        0,
        "card radius must cut the corner to transparent"
    );
    assert_eq!(
        disabled.get_pixel(1, 1).0[3],
        255,
        "card.enabled:false removes the decoration (incl. template radius)"
    );
    let center = rounded.get_pixel(200, 150).0;
    assert_eq!(center[3], 255);
    assert!(red_pixels()(center), "card center stays photo red");
}

#[test]
fn card_shadow_override_darkens_backdrop() {
    let tpl = template(
        r##"{"mode":"extend","padding":{"top":0.2,"right":0.2,"bottom":0.2,"left":0.2},"background":{"type":"solid","color":"#FFFFFF"}}"##,
        "",
    );
    let p = photo(400, 200, [255, 0, 0]);
    let plain = render(&p, &tpl, "{}");
    let shadowed = render(
        &p,
        &tpl,
        r##"{"card":{"shadow":{"blur":0.2,"opacity":0.6,"offsetX":0.05,"offsetY":0.05}}}"##,
    );
    let (w, h) = shadowed.dimensions();
    let photo_right = w - (0.2 * 400.0) as u32;
    let probe = (photo_right + 6, h / 2);
    assert!(
        plain.get_pixel(probe.0, probe.1).0[0] > 240,
        "without override the margin stays white"
    );
    assert!(
        shadowed.get_pixel(probe.0, probe.1).0[0] < 235,
        "card shadow must darken the backdrop, got {:?}",
        shadowed.get_pixel(probe.0, probe.1).0
    );
}

#[test]
fn card_border_override_paints_ring_outside_card() {
    let tpl = template(
        r##"{"mode":"extend","padding":{"top":0.15,"right":0.15,"bottom":0.15,"left":0.15},"background":{"type":"solid","color":"#FFFFFF"}}"##,
        "",
    );
    let p = photo(400, 200, [255, 0, 0]);
    let blue = |px: [u8; 4]| px[2] > 180 && px[0] < 90 && px[1] < 90;
    let plain = render(&p, &tpl, "{}");
    let bordered = render(
        &p,
        &tpl,
        r##"{"card":{"border":{"width":0.03,"color":"#0000FF"}}}"##,
    );
    assert_eq!(count(&plain, blue), 0, "no border without override");
    assert!(
        count(&bordered, blue) > 500,
        "border ring must paint blue pixels, got {}",
        count(&bordered, blue)
    );
    // Border width 0.03 * min(400, 200) = 6px, drawn just outside the photo.
    let pad_left = (0.15 * 400.0) as u32;
    let probe = bordered.get_pixel(pad_left - 3, 100).0;
    assert!(blue(probe), "border sits on the card edge, got {probe:?}");
}

#[test]
fn card_inner_shadow_override_darkens_card_edges() {
    let tpl = template(r##"{"mode":"overlay"}"##, "");
    let p = photo(400, 300, [255, 0, 0]);
    let plain = render(&p, &tpl, "{}");
    let shadowed = render(
        &p,
        &tpl,
        r##"{"card":{"innerShadow":{"blur":0.08,"opacity":0.8,"offsetX":0.05,"offsetY":0.05}}}"##,
    );
    assert_ne!(
        plain.as_raw(),
        shadowed.as_raw(),
        "inner shadow must change pixels vs without"
    );
    let plain_edge = plain.get_pixel(3, 150).0;
    let edge = shadowed.get_pixel(3, 150).0;
    let corner = shadowed.get_pixel(3, 3).0;
    assert!(red_pixels()(plain_edge), "plain edge stays photo red");
    assert!(
        edge[0] < plain_edge[0] - 60,
        "left edge region must darken, got {edge:?} vs {plain_edge:?}"
    );
    assert!(
        corner[0] < plain_edge[0] - 60,
        "top-left corner region must darken, got {corner:?}"
    );
    let center = shadowed.get_pixel(200, 150).0;
    assert_eq!(
        center,
        plain.get_pixel(200, 150).0,
        "card center stays untouched by the inner shadow"
    );
    let disabled = render(
        &p,
        &tpl,
        r##"{"card":{"innerShadow":{"enabled":false,"blur":0.08,"opacity":1.0}}}"##,
    );
    assert_eq!(
        plain.as_raw(),
        disabled.as_raw(),
        "innerShadow.enabled:false renders like no override"
    );
    let card_off = render(
        &p,
        &tpl,
        r##"{"card":{"enabled":false,"innerShadow":{"blur":0.08,"opacity":1.0}}}"##,
    );
    assert_eq!(
        plain.as_raw(),
        card_off.as_raw(),
        "card.enabled:false disables the inner shadow too"
    );
}

#[test]
fn frame_rotation_changes_output_pixels() {
    fn frame_template(rotation: &str) -> Template {
        let json = format!(
            r##"{{
              "meta": {{"id":"v5-frame-rot","name":"Frame Rot","version":"1.0.0","minEngineVersion":"0.4.0","author":"FrameGeist","license":"CC0-1.0","category":"camera"}},
              "canvas": {{"mode":"overlay","frame":{{"asset":"@builtin/frame/test-frame","autoDetect":false,"rotation":{rotation}}}}},
              "layers": []
            }}"##
        );
        load_template_from_str(&json).expect("frame template valid")
    }
    let mut frame = RgbaImage::new(200, 150);
    for (x, y, px) in frame.enumerate_pixels_mut() {
        *px = if (30..170).contains(&x) && (20..130).contains(&y) {
            image::Rgba([0, 0, 255, 255])
        } else {
            image::Rgba([0, 0, 0, 0])
        };
    }
    let assets = std::collections::HashMap::from([(
        "@builtin/frame/test-frame".to_string(),
        png_bytes(&frame),
    )]);
    let p = photo(400, 300, [255, 0, 0]);
    let render_rot = |rotation: &str| {
        let opts = RenderOptions {
            assets: Some(assets.clone()),
            ..RenderOptions::default()
        };
        render_rgba(&p, &frame_template(rotation), &opts).expect("render")
    };
    let straight = render_rot("0");
    let rotated = render_rot("90");
    assert_ne!(
        straight.as_raw(),
        rotated.as_raw(),
        "frame rotation must change output pixels"
    );
    let changed = straight
        .pixels()
        .zip(rotated.pixels())
        .filter(|(a, b)| a.0 != b.0)
        .count();
    assert!(
        changed > 10_000,
        "rotated frame should move a large area, changed {changed} px"
    );
}

#[test]
fn overrides_validation_rejects_bad_and_accepts_valid() {
    for bad in [
        r##"{"margin":0.6}"##,
        r##"{"margin":-0.1}"##,
        r##"{"card":{"radius":0.3}}"##,
        r##"{"card":{"shadow":{"blur":0.6}}}"##,
        r##"{"card":{"shadow":{"opacity":1.5}}}"##,
        r##"{"card":{"shadow":{"offsetY":-0.7}}}"##,
        r##"{"card":{"border":{"width":0.06,"color":"#000000"}}}"##,
        r##"{"card":{"border":{"width":0.01,"color":"red"}}}"##,
        r##"{"card":{"innerShadow":{"blur":0.6}}}"##,
        r##"{"card":{"innerShadow":{"opacity":1.2}}}"##,
        r##"{"card":{"innerShadow":{"offsetX":-0.6}}}"##,
        r##"{"card":{"innerShadow":{"offsetY":0.6}}}"##,
        r##"{"card":{"innerShadow":{"hax":true}}}"##,
        r##"{"card":{"hax":true}}"##,
        r##"{"background":"sepia"}"##,
        r##"{"textureAsset":"../evil.png"}"##,
        r##"{"textureAsset":"http://evil.example/x.png"}"##,
    ] {
        assert!(
            TemplateOverrides::from_json(bad).is_err(),
            "overrides must reject {bad}"
        );
    }
    for good in [
        r##"{"background":"tint"}"##,
        r##"{"background":"texture"}"##,
        r##"{"background":"texture","textureAsset":"assets/paper.png"}"##,
        r##"{"background":"texture","textureAsset":"@user/paper"}"##,
        r##"{"margin":0.5}"##,
        r##"{"card":{"enabled":true,"radius":0.25,"shadow":{"blur":0.5,"opacity":1,"offsetX":-0.5,"offsetY":0.5},"border":{"width":0.05,"color":"#FFFFFF"}}}"##,
        r##"{"card":{"enabled":false}}"##,
        r##"{"card":{"innerShadow":{}}}"##,
        r##"{"card":{"innerShadow":{"enabled":true,"blur":0.5,"opacity":1,"offsetX":-0.5,"offsetY":0.5}}}"##,
        r##"{"card":{"innerShadow":{"enabled":false}}}"##,
    ] {
        assert!(
            TemplateOverrides::from_json(good).is_ok(),
            "overrides must accept {good}"
        );
    }
}

#[test]
fn frame_rotation_validation_rejects_out_of_range() {
    fn tpl(rotation: &str) -> String {
        format!(
            r##"{{"meta":{{"id":"v5-frame-rot","name":"F","version":"1.0.0","minEngineVersion":"0.4.0","author":"t","license":"CC0-1.0","category":"camera"}},
            "canvas":{{"mode":"overlay","frame":{{"asset":"@builtin/frame/x","rotation":{rotation}}}}},
            "layers":[]}}"##
        )
    }
    assert!(load_template_from_str(&tpl("360")).is_ok());
    assert!(load_template_from_str(&tpl("-360")).is_ok());
    assert!(matches!(
        load_template_from_str(&tpl("400")),
        Err(Error::SchemaViolation(_))
    ));
    assert!(load_template_from_str(&tpl("-361")).is_err());
}

#[test]
fn background_texture_override_changes_pixels() {
    let tpl = template(
        r##"{"mode":"extend","padding":{"top":0.2,"right":0.2,"bottom":0.2,"left":0.2},"background":{"type":"solid","color":"#FFFFFF"}}"##,
        "",
    );
    let p = photo(400, 200, [255, 0, 0]);
    let solid = render(&p, &tpl, "{}");
    let texture = render(&p, &tpl, r##"{"background":"texture"}"##);
    assert_eq!(solid.get_pixel(5, 100).0, [255, 255, 255, 255]);
    let px = texture.get_pixel(5, 100).0;
    assert_ne!(
        px,
        [255, 255, 255, 255],
        "procedural paper grain must tint the margin"
    );
    assert!(
        px[0] > 220 && px[0] < 255,
        "texture stays subtle over the base color, got {px:?}"
    );
    assert_ne!(
        solid.as_raw(),
        texture.as_raw(),
        "texture background must change pixels"
    );
    // Asset texture resolved from the in-memory map, still blended subtly.
    let mut swatch = RgbaImage::new(4, 4);
    for (_, _, s) in swatch.enumerate_pixels_mut() {
        *s = image::Rgba([0, 0, 255, 255]);
    }
    let assets =
        std::collections::HashMap::from([("@user/texture".to_string(), png_bytes(&swatch))]);
    let opts = RenderOptions {
        overrides: Some(
            TemplateOverrides::from_json(
                r##"{"background":"texture","textureAsset":"@user/texture"}"##,
            )
            .expect("overrides"),
        ),
        assets: Some(assets),
        ..RenderOptions::default()
    };
    let textured = render_rgba(&p, &tpl, &opts).expect("render");
    let px = textured.get_pixel(5, 100).0;
    assert!(
        px[2] > px[0] + 10,
        "blue texture asset must tint the margin, got {px:?}"
    );
}

#[test]
fn background_texture_template_asset_is_validated() {
    // Valid package texture assets load (template() panics otherwise).
    let _valid = template(
        r##"{"mode":"extend","padding":{"top":0.1,"right":0.1,"bottom":0.1,"left":0.1},"background":{"type":"texture","asset":"assets/paper.png"}}"##,
        "",
    );
    let bad = r##"{"meta":{"id":"v5-tex","name":"Tex","version":"1.0.0","minEngineVersion":"0.4.0","author":"t","license":"CC0-1.0","category":"minimal"},"canvas":{"mode":"extend","background":{"type":"texture","asset":"paper.png"}},"layers":[]}"##;
    assert!(
        matches!(load_template_from_str(bad), Err(Error::SchemaViolation(_))),
        "background.asset outside @builtin/@user/assets must be rejected"
    );
}

#[test]
fn calendar_week_view_paints_seven_day_cells() {
    let cal = |view: &str, weekdays: bool, lunar: bool| {
        format!(
            r##"{{"type":"calendar","id":"cal","anchor":"middle-center","offset":{{"x":0,"y":0}},
            "size":0.5,"dateSource":"fixed","year":2026,"month":9,"view":"{view}",
            "showLunar":{lunar},"showWeekdays":{weekdays},"color":"#111111","accent":"#E10600","fontFamily":["Inter"]}}"##
        )
    };
    let p = photo(800, 600, [210, 210, 210]);
    let full = render_with_fonts(
        &p,
        &template(r##"{"mode":"overlay"}"##, &cal("week", true, true)),
    );
    let bare = render_with_fonts(
        &p,
        &template(r##"{"mode":"overlay"}"##, &cal("week", false, false)),
    );
    let full_ink = count(&full, ink());
    let bare_ink = count(&bare, ink());
    assert!(
        full_ink > bare_ink,
        "week view must paint more than the bare day row ({full_ink} vs {bare_ink})"
    );
    // size 0.5 on an 800px canvas -> 400px block, 7 columns of ~57px.
    let unit = 0.5 * 800.0 / 7.0;
    let mut painted = 0;
    for i in 0..7 {
        let x0 = (200.0 + i as f32 * unit).floor() as u32;
        let x1 = (200.0 + (i as f32 + 1.0) * unit).ceil() as u32;
        let hit = (0..600).any(|y| (x0..x1).any(|x| ink()(full.get_pixel(x, y).0)));
        painted += hit as usize;
    }
    assert_eq!(painted, 7, "week view must address all seven day cells");
}

#[test]
fn calendar_binding_guides_add_small_decoration() {
    let cal = |binding: bool| {
        format!(
            r##"{{"type":"calendar","id":"cal","anchor":"middle-center","offset":{{"x":0,"y":0}},
            "size":0.5,"dateSource":"fixed","year":2026,"month":9,"view":"month","binding":{binding},
            "showLunar":true,"showWeekdays":true,"color":"#111111","accent":"#E10600","fontFamily":["Inter"]}}"##
        )
    };
    let p = photo(800, 600, [210, 210, 210]);
    let plain = render_with_fonts(&p, &template(r##"{"mode":"overlay"}"##, &cal(false)));
    let bound = render_with_fonts(&p, &template(r##"{"mode":"overlay"}"##, &cal(true)));
    assert_ne!(
        plain.as_raw(),
        bound.as_raw(),
        "binding:true must change pixels"
    );
    let changed = plain
        .pixels()
        .zip(bound.pixels())
        .filter(|(a, b)| a.0 != b.0)
        .count();
    assert!(
        changed > 20,
        "binding guides must be visible, changed {changed} px"
    );
    assert!(
        changed < 4000,
        "binding is a decoration, not a fill (changed {changed} px)"
    );
}

#[test]
fn calendar_binding_and_view_are_validated() {
    let cal = |extra: &str| {
        format!(
            r##"{{"meta":{{"id":"v5-cal","name":"Cal","version":"1.0.0","minEngineVersion":"0.4.0","author":"t","license":"CC0-1.0","category":"calendar"}},
            "canvas":{{"mode":"overlay"}},
            "layers":[{{"type":"calendar","id":"cal","anchor":"middle-center","size":0.3,"dateSource":"fixed","year":2026,"month":9{extra}}}]}}"##
        )
    };
    assert!(load_template_from_str(&cal(r##","view":"week","binding":true"##)).is_ok());
    assert!(load_template_from_str(&cal(r##","view":"fortnight""##)).is_err());
    assert!(load_template_from_str(&cal(r##","binding":"yes""##)).is_err());
    assert!(load_template_from_str(&cal(r##","bindingg":true"##)).is_err());
}
