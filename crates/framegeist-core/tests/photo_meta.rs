//! v0.6.0 photo metadata: EXIF injection (container-level) and shrink with
//! metadata carry-over.

use framegeist_core::{
    encode_jpeg_quality100, inject_exif, jpeg_exif, jpeg_icc, probe_exif, shrink_jpeg,
};
use image::{Rgba, RgbaImage};
use little_exif::{exif_tag::ExifTag, filetype::FileExtension, metadata::Metadata};

fn photo(w: u32, h: u32, seed: u8) -> Vec<u8> {
    let mut img = RgbaImage::new(w, h);
    for (x, y, p) in img.enumerate_pixels_mut() {
        *p = Rgba([
            ((x * 255) / w.max(1)) as u8,
            ((y * 255) / h.max(1)) as u8 ^ seed,
            ((x + y) as u8).wrapping_mul(seed),
            255,
        ]);
    }
    encode_jpeg_quality100(&img).expect("jpeg")
}

fn with_exif(mut jpeg: Vec<u8>, make: &str, model: &str, lens: &str) -> Vec<u8> {
    let mut md = Metadata::new();
    md.set_tag(ExifTag::Make(make.into()));
    md.set_tag(ExifTag::Model(model.into()));
    md.set_tag(ExifTag::LensModel(lens.into()));
    md.set_tag(ExifTag::DateTimeOriginal("2026:05:02 15:13:35".into()));
    md.write_to_vec(&mut jpeg, FileExtension::JPEG)
        .expect("write exif");
    jpeg
}

fn rgba(bytes: &[u8]) -> RgbaImage {
    image::load_from_memory(bytes).expect("decode").to_rgba8()
}

#[test]
fn inject_copies_exif_without_touching_pixels() {
    let target = photo(320, 240, 7);
    assert!(jpeg_exif(&target).unwrap().is_none(), "target starts clean");
    let source = with_exif(
        photo(64, 64, 3),
        "SONY",
        "ILCE-7RM3",
        "Viltrox AF 35/1.2 LAB FE",
    );
    let out = inject_exif(&target, &source).expect("inject");
    let info = probe_exif(&out).expect("probe");
    assert_eq!(info.make.as_deref(), Some("SONY"));
    assert_eq!(info.model.as_deref(), Some("ILCE-7RM3"));
    assert_eq!(info.lens.as_deref(), Some("Viltrox AF 35/1.2 LAB FE"));
    let (a, b) = (rgba(&target), rgba(&out));
    assert_eq!(a.dimensions(), b.dimensions());
    assert_eq!(a.as_raw(), b.as_raw(), "pixels must be byte-identical");
}

#[test]
fn inject_rejects_source_without_exif() {
    let target = photo(64, 64, 1);
    let source = photo(64, 64, 2);
    assert!(inject_exif(&target, &source).is_err());
}

#[test]
fn shrink_resizes_and_carries_exif_and_icc() {
    use img_parts::jpeg::Jpeg;
    use img_parts::{Bytes, ImageICC};

    let src = with_exif(
        photo(1200, 800, 5),
        "Canon",
        "Canon EOS R7",
        "16-300mm F3.5-6.7 DC OS | Contemporary 025",
    );
    let mut jpeg = Jpeg::from_bytes(Bytes::copy_from_slice(&src)).expect("parse");
    jpeg.set_icc_profile(Some(Bytes::from_static(b"FAKEICC")));
    let mut with_icc = Vec::new();
    jpeg.encoder().write_to(&mut with_icc).expect("write");

    let out = shrink_jpeg(&with_icc, 512, 92).expect("shrink");
    let dims = image::load_from_memory(&out)
        .expect("decode")
        .to_rgba8()
        .dimensions();
    assert_eq!(dims, (512, 341));
    let info = probe_exif(&out).expect("probe");
    assert_eq!(info.model.as_deref(), Some("Canon EOS R7"));
    assert_eq!(jpeg_icc(&out).unwrap().as_deref(), Some(&b"FAKEICC"[..]));
}

#[test]
fn shrink_never_upscales() {
    let src = photo(200, 100, 9);
    let out = shrink_jpeg(&src, 512, 92).expect("shrink");
    let dims = image::load_from_memory(&out)
        .expect("decode")
        .to_rgba8()
        .dimensions();
    assert_eq!(dims, (200, 100));
}
