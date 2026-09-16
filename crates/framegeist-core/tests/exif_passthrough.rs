//! v0.6.0 M3: export EXIF byte-level passthrough.
//!
//! Exports must keep the source EXIF verbatim (MakerNote, Fujifilm recipe,
//! unknown vendor tags) while still removing GPS + camera owner/serials by
//! default and normalizing Orientation to 1.

use std::io::Cursor;

use framegeist_core::{
    encode_jpeg_quality100, encode_png, load_template_from_str, metadata_report, probe_exif,
    raw_exif_block, render_with_report, sanitize_exif_block, splice_exif_app1, splice_png_exif,
    RenderOptions, Template,
};
use image::{Rgba, RgbaImage};
use little_exif::{
    exif_tag::ExifTag, filetype::FileExtension, ifd::ExifTagGroup, metadata::Metadata,
    rational::uR64,
};

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

fn template() -> Template {
    load_template_from_str(
        r##"{
        "meta": {
            "id": "exif-passthrough", "name": "T", "version": "0.1.0",
            "minEngineVersion": "0.1.0", "author": "t", "license": "CC0-1.0",
            "category": "minimal"
        },
        "canvas": { "mode": "overlay" },
        "layers": [ {
            "type": "text", "id": "a", "anchor": "bottom-left",
            "font": { "family": ["JetBrains Mono"], "size": 0.03, "color": "#111111" },
            "content": [ { "expr": "exif.model", "fallback": "n/a" } ]
        } ]
    }"##,
    )
    .expect("template")
}

fn rat(n: u32, d: u32) -> uR64 {
    uR64 {
        nominator: n,
        denominator: d,
    }
}

/// Source JPEG with Model + serials + owner + GPS + orientation + a custom
/// (unknown) EXIF tag, written through little_exif.
fn photo_with_full_exif() -> Vec<u8> {
    let mut jpeg = photo(320, 240, 13);
    let mut md = Metadata::new();
    md.set_tag(ExifTag::Make("FUJIFILM".into()));
    md.set_tag(ExifTag::Model("X-T5".into()));
    md.set_tag(ExifTag::Orientation(vec![6]));
    md.set_tag(ExifTag::SerialNumber("SN-12345678".into()));
    md.set_tag(ExifTag::LensSerialNumber("LS-87654321".into()));
    md.set_tag(ExifTag::OwnerName("Alice".into()));
    md.set_tag(ExifTag::GPSLatitudeRef("N".into()));
    md.set_tag(ExifTag::GPSLatitude(vec![
        rat(31, 1),
        rat(13, 1),
        rat(0, 1),
    ]));
    md.set_tag(ExifTag::GPSLongitudeRef("E".into()));
    md.set_tag(ExifTag::GPSLongitude(vec![
        rat(121, 1),
        rat(28, 1),
        rat(0, 1),
    ]));
    md.set_tag(ExifTag::UnknownSTRING(
        "synthetic-recipe-payload".into(),
        0xC7A1,
        ExifTagGroup::EXIF,
    ));
    md.write_to_vec(&mut jpeg, FileExtension::JPEG)
        .expect("write exif");
    jpeg
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
}

fn parsed_fields(tiff: &[u8]) -> Vec<(u16, exif::Context)> {
    let container = exif::Reader::new()
        .read_raw(tiff.to_vec())
        .expect("parse exif");
    container
        .fields()
        .map(|f| (f.tag.number(), f.tag.context()))
        .collect()
}

// --- hand-built TIFF fixture (little_exif cannot write MakerNotes) ---------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Order {
    Le,
    Be,
}

fn u16b(o: Order, v: u16) -> [u8; 2] {
    match o {
        Order::Le => v.to_le_bytes(),
        Order::Be => v.to_be_bytes(),
    }
}

fn u32b(o: Order, v: u32) -> [u8; 4] {
    match o {
        Order::Le => v.to_le_bytes(),
        Order::Be => v.to_be_bytes(),
    }
}

#[derive(Clone)]
enum Val {
    Ascii(&'static str),
    Short(u16),
    Long(u32),
    Rational(Vec<(u32, u32)>),
    Undef(Vec<u8>),
}

impl Val {
    fn spec(&self, o: Order) -> (u16, u32, Vec<u8>) {
        match self {
            Val::Ascii(s) => {
                let mut b = s.as_bytes().to_vec();
                b.push(0);
                (2, b.len() as u32, b)
            }
            Val::Short(v) => (3, 1, u16b(o, *v).to_vec()),
            Val::Long(v) => (4, 1, u32b(o, *v).to_vec()),
            Val::Rational(rs) => {
                let mut b = Vec::with_capacity(rs.len() * 8);
                for (n, d) in rs {
                    b.extend(u32b(o, *n));
                    b.extend(u32b(o, *d));
                }
                (5, rs.len() as u32, b)
            }
            Val::Undef(bytes) => (7, bytes.len() as u32, bytes.clone()),
        }
    }
}

#[derive(Clone)]
struct Field {
    tag: u16,
    val: Val,
}

fn ifd_len(fields: &[Field]) -> u32 {
    2 + 12 * fields.len() as u32 + 4
}

fn encode_ifd(
    o: Order,
    fields: &[Field],
    values: &mut Vec<u8>,
    values_base: u32,
    pointer: &dyn Fn(u16) -> Option<u32>,
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend(u16b(o, fields.len() as u16));
    for f in fields {
        let (typ, count, raw) = f.val.spec(o);
        out.extend(u16b(o, f.tag));
        out.extend(u16b(o, typ));
        out.extend(u32b(o, count));
        if let Some(ptr) = pointer(f.tag) {
            out.extend(u32b(o, ptr));
        } else if raw.len() <= 4 {
            let mut v = raw;
            v.resize(4, 0);
            out.extend(v);
        } else {
            out.extend(u32b(o, values_base + values.len() as u32));
            values.extend_from_slice(&raw);
            if values.len() % 2 == 1 {
                values.push(0);
            }
        }
    }
    out.extend(u32b(o, 0)); // next-IFD pointer, patched by the caller
    out
}

struct Fixture {
    bytes: Vec<u8>,
    makernote: Vec<u8>,
    thumbnail: Vec<u8>,
    custom: &'static str,
    serial: &'static str,
}

/// IFD0(Make/Model/Orientation/custom/ExifIFD/GPS) -> ExifIFD(serial,
/// MakerNote, DateTimeOriginal), GPS IFD (4 entries), IFD1 (thumbnail).
fn build_fixture(o: Order) -> Fixture {
    let makernote = b"FUJIFILM0123-synthetic-recipe-payload".to_vec();
    let thumbnail = vec![0x10, 0x20, 0x30, 0x40, 0x50, 0x60];
    let custom = "CUSTOM-TAG-PAYLOAD";
    let serial = "SN-999988887777";
    let ifd0 = vec![
        Field {
            tag: 0x010F,
            val: Val::Ascii("FUJIFILM"),
        },
        Field {
            tag: 0x0110,
            val: Val::Ascii("X-T5"),
        },
        Field {
            tag: 0x0112,
            val: Val::Short(6),
        },
        Field {
            tag: 0xC7A1,
            val: Val::Ascii(custom),
        },
        Field {
            tag: 0x8769,
            val: Val::Long(0),
        },
        Field {
            tag: 0x8825,
            val: Val::Long(0),
        },
    ];
    let exif = vec![
        Field {
            tag: 0xA431,
            val: Val::Ascii(serial),
        },
        Field {
            tag: 0x927C,
            val: Val::Undef(makernote.clone()),
        },
        Field {
            tag: 0x9003,
            val: Val::Ascii("2026:09:16 10:00:00"),
        },
    ];
    let gps = vec![
        Field {
            tag: 0x0000,
            val: Val::Undef(vec![2, 3, 0, 0]),
        },
        Field {
            tag: 0x0001,
            val: Val::Ascii("N"),
        },
        Field {
            tag: 0x0002,
            val: Val::Rational(vec![(31, 1), (13, 1), (0, 1)]),
        },
        Field {
            tag: 0x0003,
            val: Val::Ascii("E"),
        },
        Field {
            tag: 0x0004,
            val: Val::Rational(vec![(121, 1), (28, 1), (0, 1)]),
        },
    ];
    let ifd1 = vec![
        Field {
            tag: 0x0201,
            val: Val::Long(0),
        },
        Field {
            tag: 0x0202,
            val: Val::Long(thumbnail.len() as u32),
        },
    ];

    let ifd0_off = 8u32;
    let exif_off = ifd0_off + ifd_len(&ifd0);
    let gps_off = exif_off + ifd_len(&exif);
    let ifd1_off = gps_off + ifd_len(&gps);
    let values_off = ifd1_off + ifd_len(&ifd1);

    let mut values = Vec::new();
    let mut ifd0_bytes = encode_ifd(o, &ifd0, &mut values, values_off, &|tag| match tag {
        0x8769 => Some(exif_off),
        0x8825 => Some(gps_off),
        _ => None,
    });
    let n = ifd0_bytes.len();
    ifd0_bytes[n - 4..].copy_from_slice(&u32b(o, ifd1_off));
    let exif_bytes = encode_ifd(o, &exif, &mut values, values_off, &|_| None);
    let gps_bytes = encode_ifd(o, &gps, &mut values, values_off, &|_| None);
    let mut probe_values = values.clone();
    let _ = encode_ifd(o, &ifd1, &mut probe_values, values_off, &|_| None);
    let thumb_off = values_off + probe_values.len() as u32;
    let ifd1_bytes = encode_ifd(o, &ifd1, &mut values, values_off, &|tag| {
        (tag == 0x0201).then_some(thumb_off)
    });

    let mut bytes = Vec::new();
    bytes.extend(match o {
        Order::Le => b"II",
        Order::Be => b"MM",
    });
    bytes.extend(u16b(o, 42));
    bytes.extend(u32b(o, ifd0_off));
    bytes.extend(ifd0_bytes);
    bytes.extend(exif_bytes);
    bytes.extend(gps_bytes);
    bytes.extend(ifd1_bytes);
    bytes.extend(values);
    bytes.extend(&thumbnail);

    Fixture {
        bytes,
        makernote,
        thumbnail,
        custom,
        serial,
    }
}

// --- tests -----------------------------------------------------------------

#[test]
fn export_keeps_model_strips_serial_gps_and_fixes_orientation() {
    let source = photo_with_full_exif();
    let opts = RenderOptions::default();
    let (out, report) = render_with_report(&source, &template(), &opts).expect("render");
    let report = report.expect("metadata report");
    assert!(report.passthrough, "byte-level path must be used");
    assert!(report.serial_stripped >= 3, "serials/owner removed");
    assert!(report.gps_stripped >= 2, "GPS entries removed");

    let info = probe_exif(&out).expect("probe output");
    assert_eq!(info.model.as_deref(), Some("X-T5"));
    assert_eq!(info.orientation, Some(1), "orientation normalized");
    assert!(info.gps_lat.is_none() && info.gps_lon.is_none());
    assert!(info.gps_alt.is_none());

    let tiff = raw_exif_block(&out).expect("output exif");
    let fields = parsed_fields(&tiff);
    assert!(fields.iter().any(|(n, _)| *n == 0x0110), "Model kept");
    assert!(fields.iter().any(|(n, _)| *n == 0xC7A1), "custom tag kept");
    for tag in [0xA430u16, 0xA431, 0xA435] {
        assert!(
            !fields.iter().any(|(n, _)| *n == tag),
            "tag {tag:#06x} must be stripped"
        );
    }
    assert!(
        !fields.iter().any(|(_, ctx)| *ctx == exif::Context::Gps),
        "no GPS field may survive"
    );
    assert!(
        !contains(&tiff, b"SN-12345678"),
        "serial bytes must be scrubbed, not merely unreferenced"
    );

    let report_scan = metadata_report(&source, false)
        .expect("report")
        .expect("exif");
    assert!(report_scan.passthrough);
    assert!(report_scan.serial_stripped >= 3);
}

#[test]
fn export_preserves_makernote_custom_tag_and_thumbnail_verbatim() {
    let fx = build_fixture(Order::Le);
    let mut source = photo(320, 240, 21);
    splice_exif_app1(&mut source, &fx.bytes).expect("splice source exif");

    let (out, report) =
        render_with_report(&source, &template(), &RenderOptions::default()).expect("render");
    assert!(report.expect("report").passthrough);

    let tiff = raw_exif_block(&out).expect("output exif");
    assert!(tiff.starts_with(b"II"), "LE byte order preserved");
    assert!(contains(&tiff, &fx.makernote), "MakerNote bytes verbatim");
    assert!(
        contains(&tiff, fx.custom.as_bytes()),
        "custom tag value verbatim"
    );
    assert!(contains(&tiff, &fx.thumbnail), "thumbnail bytes verbatim");

    let fields = parsed_fields(&tiff);
    assert!(fields
        .iter()
        .any(|(n, ctx)| *n == 0x927C && *ctx == exif::Context::Exif));
    assert!(fields.iter().any(|(n, _)| *n == 0xC7A1));
    assert!(!fields.iter().any(|(n, _)| *n == 0xA431));
    assert!(!contains(&tiff, fx.serial.as_bytes()), "serial value gone");
    assert!(!fields.iter().any(|(_, ctx)| *ctx == exif::Context::Gps));

    let container = exif::Reader::new().read_raw(tiff).expect("parse");
    let orientation = container
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .expect("orientation");
    match &orientation.value {
        exif::Value::Short(v) => assert_eq!(v.first(), Some(&1)),
        other => panic!("unexpected orientation {other:?}"),
    }
}

#[test]
fn big_endian_blob_is_handled_end_to_end() {
    let fx = build_fixture(Order::Be);
    let sanitized = sanitize_exif_block(&fx.bytes, false).expect("surgery");
    assert!(sanitized.tiff().starts_with(b"MM"));
    assert!(contains(sanitized.tiff(), &fx.makernote));

    let mut source = photo(320, 240, 23);
    splice_exif_app1(&mut source, &fx.bytes).expect("splice source exif");
    let (out, report) =
        render_with_report(&source, &template(), &RenderOptions::default()).expect("render");
    assert!(report.expect("report").passthrough);

    let tiff = raw_exif_block(&out).expect("output exif");
    assert!(tiff.starts_with(b"MM"), "BE byte order preserved");
    let info = probe_exif(&out).expect("probe");
    assert_eq!(info.model.as_deref(), Some("X-T5"));
    assert_eq!(info.orientation, Some(1));
    assert!(info.gps_lat.is_none());
    assert!(!parsed_fields(&tiff).iter().any(|(n, _)| *n == 0xA431));
}

#[test]
fn png_source_exif_survives_export() {
    let fx = build_fixture(Order::Le);
    let mut rgba = RgbaImage::new(96, 72);
    for (x, y, p) in rgba.enumerate_pixels_mut() {
        *p = Rgba([(x * 3) as u8, (y * 5) as u8, 90, 255]);
    }
    let mut png = encode_png(&rgba).expect("png");
    splice_png_exif(&mut png, &fx.bytes).expect("splice png exif");

    let (out, report) =
        render_with_report(&png, &template(), &RenderOptions::default()).expect("render");
    assert!(report.expect("report").passthrough, "PNG source eXIf used");
    let tiff = raw_exif_block(&out).expect("output exif");
    assert!(contains(&tiff, &fx.makernote), "MakerNote survives");
    let info = probe_exif(&out).expect("probe");
    assert_eq!(info.model.as_deref(), Some("X-T5"));
    assert_eq!(info.orientation, Some(1));
    assert!(!contains(&tiff, fx.serial.as_bytes()));
    assert!(!parsed_fields(&tiff)
        .iter()
        .any(|(_, ctx)| *ctx == exif::Context::Gps));
}

#[test]
fn webp_source_exif_survives_export() {
    use img_parts::{webp::WebP, Bytes, ImageEXIF};

    let fx = build_fixture(Order::Le);
    let mut rgba = RgbaImage::new(96, 72);
    for (x, y, p) in rgba.enumerate_pixels_mut() {
        *p = Rgba([(x * 7) as u8, (y * 3) as u8, 40, 255]);
    }
    let mut webp = Vec::new();
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut Cursor::new(&mut webp), image::ImageFormat::WebP)
        .expect("webp encode");
    let mut container = WebP::from_bytes(Bytes::copy_from_slice(&webp)).expect("webp parse");
    container.set_exif(Some(Bytes::copy_from_slice(&fx.bytes)));
    let mut webp = Vec::new();
    container
        .encoder()
        .write_to(&mut webp)
        .expect("webp exif write");

    let (out, report) =
        render_with_report(&webp, &template(), &RenderOptions::default()).expect("render");
    assert!(report.expect("report").passthrough, "WebP source EXIF used");
    let tiff = raw_exif_block(&out).expect("output exif");
    assert!(contains(&tiff, &fx.makernote), "MakerNote survives");
    let info = probe_exif(&out).expect("probe");
    assert_eq!(info.model.as_deref(), Some("X-T5"));
    assert!(!contains(&tiff, fx.serial.as_bytes()));
    assert!(!parsed_fields(&tiff)
        .iter()
        .any(|(_, ctx)| *ctx == exif::Context::Gps));
}

#[test]
fn keep_gps_retains_gps_entries_in_export() {
    let fx = build_fixture(Order::Le);
    let mut source = photo(320, 240, 29);
    splice_exif_app1(&mut source, &fx.bytes).expect("splice source exif");

    let opts = RenderOptions {
        keep_gps: true,
        ..RenderOptions::default()
    };
    let (out, report) = render_with_report(&source, &template(), &opts).expect("render");
    let report = report.expect("report");
    assert!(report.passthrough);
    assert_eq!(report.gps_stripped, 0, "GPS kept on request");
    assert_eq!(report.serial_stripped, 1, "serials still stripped");

    let info = probe_exif(&out).expect("probe");
    let tiff = raw_exif_block(&out).expect("output exif");
    assert!(
        info.gps_lat.is_some() && info.gps_lon.is_some(),
        "gps kept: lat={:?} lon={:?}",
        info.gps_lat,
        info.gps_lon
    );
    assert!(parsed_fields(&tiff)
        .iter()
        .any(|(_, ctx)| *ctx == exif::Context::Gps));
    assert!(!contains(&tiff, fx.serial.as_bytes()));
}

#[test]
fn fuzz_truncated_and_flipped_exif_never_panics() {
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
    }

    let le = build_fixture(Order::Le).bytes;
    let be = build_fixture(Order::Be).bytes;
    let little = raw_exif_block(&photo_with_full_exif()).expect("little_exif block extracted");
    let bases = [le, be, little];

    let mut rng = Rng(0x1234_5678_9ABC_DEF0);
    let mut valid = 0usize;
    let mut fallback = 0usize;
    for i in 0..10_000u32 {
        let base = &bases[(rng.next() % bases.len() as u64) as usize];
        let mut data = base.clone();
        match rng.next() % 4 {
            0 => {
                let len = (rng.next() as usize) % (data.len() + 1);
                data.truncate(len);
            }
            1 => {
                for _ in 0..1 + rng.next() % 4 {
                    if data.is_empty() {
                        break;
                    }
                    let pos = (rng.next() as usize) % data.len();
                    data[pos] ^= (rng.next() & 0xFF) as u8;
                }
            }
            2 => {
                if !data.is_empty() {
                    let pos = (rng.next() as usize) % data.len();
                    data[pos] = 0xFF;
                }
            }
            _ => {
                if !data.is_empty() {
                    let pos = (rng.next() as usize) % data.len();
                    data[pos] = 0x00;
                }
            }
        }

        let keep_gps = rng.next().is_multiple_of(2);
        match sanitize_exif_block(&data, keep_gps) {
            Ok(sanitized) => {
                valid += 1;
                // Our output must never panic downstream parsers either.
                let _ = exif::Reader::new().read_raw(sanitized.into_tiff());
            }
            Err(_) => fallback += 1,
        }

        // Container-level pipeline (passthrough + whitelist fallback) on a
        // subset: errors or a clean `None` only.
        if i % 50 == 0 {
            let mut jpeg = photo(64, 48, (i % 200) as u8);
            if splice_exif_app1(&mut jpeg, &data).is_ok() {
                let _ = framegeist_core::cleaned_exif_tiff(&jpeg);
                let _ = metadata_report(&jpeg, keep_gps);
            }
        }
    }
    assert_eq!(valid + fallback, 10_000);
    assert!(valid > 0, "some mutations must remain parseable");
}
