//! v1.4.0 audit regression: asset paths must not be able to point outside the
//! asset root.
//!
//! Before the fix, `is_asset_path` substituted only the three known placeholders
//! but its character class still allowed `{` and `}`, so `assets/{exif.make}`
//! passed validation verbatim. `eval_asset_path` then substituted *any*
//! `exif.<key>` — including `make`, whose bytes come straight from the camera —
//! and `resolve_asset_bytes` did a bare `dir.join(rel)`. A crafted EXIF `Make`
//! of `../../secret.png` therefore read a file outside `templates/assets/`.

use framegeist_core::exif::ExifInfo;
use framegeist_core::{eval_asset_path, is_asset_path, load_template_from_str, Error};

#[test]
fn only_the_three_known_placeholders_are_accepted() {
    // Legal: the three dynamic badge placeholders, on every allowed prefix.
    for path in [
        "@builtin/brand/{exif.brand_slug}",
        "@builtin/series/{exif.lens_series}",
        "@builtin/lens/{exif.lens_slug}",
        "@builtin/lockup/{exif.brand_slug}",
        "@builtin/game/{exif.brand_slug}",
        "@user/logo",
        "@builtin/brand/sony",
        "assets/frame.png",
    ] {
        assert!(is_asset_path(path), "{path} must stay valid");
    }

    // Illegal: any other `exif.<key>` is raw camera-controlled text.
    for path in [
        "assets/{exif.make}",
        "assets/{exif.model}.png",
        "@builtin/brand/{exif.make}",
        "@builtin/brand/{exif.lens}",
        "@builtin/brand/{exif.lenseries}",
        "@builtin/brand/{brand_slug}",
        "@builtin/brand/{}",
        "@builtin/brand/{exif.brand_slug}/../secret",
        "@builtin/brand/../../secret.png",
        "assets/..\\secret.png",
    ] {
        assert!(!is_asset_path(path), "{path} must be rejected");
    }
}

#[test]
fn eval_asset_path_refuses_non_whitelisted_tokens_and_traversal() {
    let info = ExifInfo {
        make: Some("../../etc/passwd".into()),
        model: Some("../../secret".into()),
        lens: Some("../../lens".into()),
        brand_slug: Some("sony".into()),
        lens_slug: Some("sony-fe".into()),
        lens_series: Some("sony-gm".into()),
        ..ExifInfo::default()
    };

    // The whitelisted keys still resolve.
    assert_eq!(
        eval_asset_path("@builtin/brand/{exif.brand_slug}", &info),
        Some("@builtin/brand/sony".into())
    );
    assert_eq!(
        eval_asset_path("@builtin/lens/{exif.lens_slug}", &info),
        Some("@builtin/lens/sony-fe".into())
    );
    assert_eq!(
        eval_asset_path("@builtin/series/{exif.lens_series}", &info),
        Some("@builtin/series/sony-gm".into())
    );

    // Everything else yields nothing, whatever the camera wrote.
    for path in [
        "assets/{exif.make}",
        "assets/{exif.model}.png",
        "@builtin/brand/{exif.lens}",
    ] {
        assert_eq!(
            eval_asset_path(path, &info),
            None,
            "{path} must not resolve"
        );
    }

    // Belt and braces: even a whitelisted value that smuggles traversal is dropped.
    let smuggle = ExifInfo {
        brand_slug: Some("../../secret".into()),
        ..ExifInfo::default()
    };
    assert_eq!(
        eval_asset_path("@builtin/brand/{exif.brand_slug}", &smuggle),
        None
    );
}

#[test]
fn a_template_whose_asset_could_escape_is_rejected_at_load_time() {
    let json = r##"{
  "meta": {
    "id": "asset-escape", "name": "Asset escape", "version": "1.0.0",
    "minEngineVersion": "1.0.0", "author": "t", "license": "CC0-1.0",
    "category": "minimal"
  },
  "canvas": {
    "mode": "extend",
    "background": { "type": "solid", "color": "#101418" },
    "padding": { "bottom": 0.26 }
  },
  "layers": [
    {
      "type": "image", "id": "escape", "asset": "assets/{exif.make}",
      "size": { "height": 0.06 }, "anchor": "bottom-left"
    }
  ]
}"##;
    let err = load_template_from_str(json).expect_err("escaping asset path must be rejected");
    assert!(
        matches!(err, Error::SchemaViolation(_) | Error::SandboxViolation(_)),
        "unexpected error kind: {err:?}"
    );
}
