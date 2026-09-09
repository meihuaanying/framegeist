use std::collections::BTreeMap;
use std::path::PathBuf;

use framegeist_core::{load_layout, render_collage, Layout, RenderOptions};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

fn all_layouts() -> Vec<Layout> {
    let dir = repo_root().join("templates/layouts");
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("layouts dir") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes = std::fs::read(&path).expect("read layout");
        let layout = load_layout(&bytes)
            .unwrap_or_else(|e| panic!("layout {} failed to load: {e}", path.display()));
        out.push(layout);
    }
    out.sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
    out
}

fn gradient(w: u32, h: u32, seed: u8) -> image::RgbaImage {
    let mut img = image::RgbaImage::new(w, h);
    for (x, y, px) in img.enumerate_pixels_mut() {
        *px = image::Rgba([
            ((x * 255) / w.max(1)) as u8 ^ seed,
            ((y * 255) / h.max(1)) as u8,
            (((x + y) * seed as u32) % 256) as u8,
            255,
        ]);
    }
    img
}

fn jpeg(img: &image::RgbaImage) -> Vec<u8> {
    framegeist_core::encode_jpeg_quality100(img).expect("jpeg")
}

#[test]
fn library_meets_c5_quota() {
    let layouts = all_layouts();
    assert!(
        layouts.len() >= 100,
        "layout library must hold >= 100 layouts (PRD C5), found {}",
        layouts.len()
    );
    let mut ids = std::collections::HashSet::new();
    for l in &layouts {
        assert!(ids.insert(l.meta.id.clone()), "duplicate layout id {}", l.meta.id);
        assert!(!l.cells.is_empty(), "layout {} has no cells", l.meta.id);
        assert!(l.meta.slots.unwrap_or(0) == l.cells.len() as u32, "slots mismatch in {}", l.meta.id);
    }
}

fn jpeg_with_exif(img: &image::RgbaImage, model: &str) -> Vec<u8> {
    let mut jpeg = jpeg(img);
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
    let mut buf = std::io::Cursor::new(Vec::new());
    writer.write(&mut buf, false).expect("exif writer");
    framegeist_core::splice_exif_app1(&mut jpeg, &buf.into_inner()).expect("splice");
    jpeg
}

#[test]
fn collage_renders_deterministically_with_exif() {
    let mut rng_state = 7u8;
    let photos: Vec<Vec<u8>> = (0..4)
        .map(|i| {
            rng_state = rng_state.wrapping_mul(31).wrapping_add(i + 1);
            let img = gradient(1200, 900, rng_state);
            if i == 0 {
                jpeg_with_exif(&img, "ILCE-7CM2")
            } else {
                jpeg(&img)
            }
        })
        .collect();
    let refs: Vec<&[u8]> = photos.iter().map(|p| p.as_slice()).collect();
    let opts = RenderOptions {
        assets_dir: Some(repo_root().join("templates/assets")),
        ..RenderOptions::default()
    };
    let layout = load_layout(&std::fs::read(repo_root().join("templates/layouts/grid-2x2-info.json")).expect("layout"))
        .expect("valid layout");
    let first = render_collage(&refs, &layout, &opts).expect("render");
    let second = render_collage(&refs, &layout, &opts).expect("render");
    assert_eq!(first, second, "collage render must be deterministic");
    let info = framegeist_core::probe_exif(&first).expect("probe");
    assert!(info.model.is_some(), "collage must retain first photo EXIF");
    assert!(first.len() > 100_000, "collage suspiciously small");
}

#[test]
fn collage_handles_more_photos_than_cells_and_fewer() {
    let photos: Vec<Vec<u8>> = (0..8)
        .map(|i| jpeg(&gradient(800, 600, i as u8 + 3)))
        .collect();
    let opts = RenderOptions::default();
    let layout = load_layout(&std::fs::read(repo_root().join("templates/layouts/hero-1-4.json")).expect("layout"))
        .expect("valid layout");
    let many: Vec<&[u8]> = photos.iter().map(|p| p.as_slice()).collect();
    let few: Vec<&[u8]> = photos.iter().take(2).map(|p| p.as_slice()).collect();
    let out_many = render_collage(&many, &layout, &opts).expect("render with extras");
    let out_few = render_collage(&few, &layout, &opts).expect("render with shortage");
    assert!(!out_many.is_empty() && !out_few.is_empty());
}

#[test]
fn invalid_layouts_rejected() {
    let base = r#"{
        "meta": { "id": "bad-layout", "name": "B", "version": "0.1.0", "author": "t", "license": "CC0-1.0" },
        "cells": [%CELLS%]
    }"#;
    let oversized = base.replace("%CELLS%", &format!(
        "[{}]",
        (0..20)
            .map(|i| format!("{{ \"x\": {i}, \"y\": 0, \"w\": 0.1, \"h\": 0.1 }}"))
            .collect::<Vec<_>>()
            .join(",")
    ));
    assert!(load_layout(oversized.as_bytes()).is_err(), "20 cells must exceed the 16-cell cap");
    let traversal = base
        .replace("%CELLS%", r#"[{ "x": 0, "y": 0, "w": 0.5, "h": 0.5 }]"#)
        .replace("\"B\"", "\"../etc/passwd\"");
    assert!(load_layout(traversal.as_bytes()).is_err(), "path traversal must be rejected");
    let out_of_bounds = base.replace("%CELLS%", r#"[{ "x": 0.5, "y": 0.5, "w": 0.6, "h": 0.6 }]"#);
    assert!(load_layout(out_of_bounds.as_bytes()).is_err(), "cell beyond canvas must be rejected");
    let zero_size = base.replace("%CELLS%", r#"[{ "x": 0, "y": 0, "w": 0, "h": 1 }]"#);
    assert!(load_layout(zero_size.as_bytes()).is_err(), "zero width must be rejected");
}

#[test]
fn layout_sizes_match_library_distribution() {
    let layouts = all_layouts();
    let mut by_slot: BTreeMap<usize, usize> = BTreeMap::new();
    for l in &layouts {
        *by_slot.entry(l.cells.len()).or_default() += 1;
    }
    assert!(by_slot.contains_key(&2) && by_slot.contains_key(&4) && by_slot.contains_key(&6),
        "library must cover 2/4/6-slot collages: {by_slot:?}");
}
