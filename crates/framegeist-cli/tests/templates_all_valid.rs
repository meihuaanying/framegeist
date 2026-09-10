use std::path::PathBuf;

use framegeist_core::{load_template, Category, Template};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}
fn all_templates() -> Vec<(String, PathBuf, Template)> {
    let dir = repo_root().join("templates");
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("templates dir") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes = std::fs::read(&path).expect("read template");
        let tpl = load_template(&bytes)
            .unwrap_or_else(|e| panic!("template {} failed to load: {e}", path.display()));
        out.push((tpl.meta.id.clone(), path, tpl));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

#[test]
fn library_meets_c4_quota() {
    let templates = all_templates();
    assert!(
        templates.len() >= 60,
        "built-in library must hold >= 60 templates, found {}",
        templates.len()
    );
    let mut by_category = std::collections::BTreeMap::new();
    for (_, _, tpl) in &templates {
        *by_category.entry(tpl.meta.category).or_insert(0usize) += 1;
    }
    let categories = [
        Category::ClassicWhite,
        Category::Film,
        Category::Polaroid,
        Category::Gallery,
        Category::Technical,
        Category::Magazine,
        Category::Minimal,
        Category::FrameShell,
    ];
    for cat in categories {
        let count = by_category.get(&cat).copied().unwrap_or(0);
        assert!(
            count >= 7,
            "category {cat} holds {count} templates, needs >= 7"
        );
    }
}

#[test]
fn unique_ids_and_valid_versions() {
    let templates = all_templates();
    let mut seen = std::collections::HashSet::new();
    for (id, path, tpl) in &templates {
        assert!(seen.insert(id.clone()), "duplicate template id {id}");
        let semver_ok = |s: &str| s.split('.').filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())).count() == 3;
        assert!(semver_ok(&tpl.meta.version), "bad version in {}", path.display());
        assert!(semver_ok(&tpl.meta.min_engine_version), "bad minEngineVersion in {}", path.display());
    }
}

#[test]
fn every_template_renders_via_engine() {
    // Render each template against an in-memory synthetic photo (test-photos
    // are derived artifacts, so nothing on disk is assumed here).
    let mut img = image::RgbaImage::new(1600, 1200);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Rgba([
            ((x * 255) / 1600) as u8,
            ((y * 255) / 1200) as u8,
            (((x + y) * 3) % 256) as u8,
            255,
        ]);
    }
    let photo = framegeist_core::encode_jpeg_quality100(&img).expect("synthetic photo");
    let opts = framegeist_core::RenderOptions {
        assets_dir: Some(repo_root().join("templates/assets")),
        ..framegeist_core::RenderOptions::default()
    };
    for (id, _, tpl) in all_templates() {
        let out = framegeist_core::render(&photo, &tpl, &opts)
            .unwrap_or_else(|e| panic!("render failed for {id}: {e}"));
        assert_eq!(&out[0..2], &[0xFF, 0xD8], "{id} produced non-JPEG");
    }
}
}
