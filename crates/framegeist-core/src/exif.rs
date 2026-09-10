use std::io::Cursor;

use crate::{Error, Result};

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ExifInfo {
    pub make: Option<String>,
    pub model: Option<String>,
    pub model_pretty: Option<String>,
    pub lens: Option<String>,
    pub focal_mm: Option<f64>,
    pub aperture: Option<f64>,
    pub shutter: Option<String>,
    pub iso: Option<u16>,
    pub datetime: Option<String>,
    pub orientation: Option<u16>,
    pub brand_slug: Option<String>,
    pub lens_slug: Option<String>,
}

impl ExifInfo {
    pub fn get(&self, key: &str) -> Option<String> {
        match key {
            "make" => self.make.clone(),
            "model" => self.model.clone(),
            "model_pretty" => self.model_pretty.clone().or_else(|| self.model.clone()),
            "lens" => self.lens.clone(),
            "focal" => self.focal_mm.map(|f| format!("{:.0}", f)),
            "aperture" => self.aperture.map(|f| format!("{:.1}", f)),
            "shutter" => self.shutter.clone(),
            "iso" => self.iso.map(|v| v.to_string()),
            "datetime" => self.datetime.clone(),
            "orientation" => self.orientation.map(|v| v.to_string()),
            "brand_slug" => self.brand_slug.clone(),
            "lens_slug" => self.lens_slug.clone(),
            _ => None,
        }
    }
}

fn rational(field: &exif::Field) -> Option<f64> {
    match &field.value {
        exif::Value::Rational(v) => v.first().map(|r| r.to_f64()),
        _ => None,
    }
}

fn u16_value(field: &exif::Field) -> Option<u16> {
    match &field.value {
        exif::Value::Short(v) => v.first().copied(),
        _ => None,
    }
}

fn ascii_value(field: &exif::Field) -> Option<String> {
    match &field.value {
        exif::Value::Ascii(parts) => {
            let bytes: Vec<u8> = parts.concat();
            let s = String::from_utf8_lossy(&bytes).trim_matches('\0').to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        _ => None,
    }
}

fn format_shutter(seconds: f64) -> String {
    if seconds >= 1.0 {
        format!("{:.1}s", seconds)
    } else {
        format!("1/{}s", (1.0 / seconds).round() as u64)
    }
}

/// Map raw camera model codes to vendor-official names (PRD B5).
/// The table is a code-level seed; a data-file override ships with v1.x.
fn prettify_model(model: &str) -> Option<&'static str> {
    match model {
        "ILCE-7CM2" => Some("Sony \u{03b1}7C II"),
        "ILCE-7M4" => Some("Sony \u{03b1}7 IV"),
        "ILCE-6700" => Some("Sony \u{03b1}6700"),
        "X-T5" => Some("Fujifilm X-T5"),
        "X100VI" => Some("Fujifilm X100VI"),
        "NIKON Z fc" => Some("Nikon Z fc"),
        _ => None,
    }
}

pub fn probe_exif(photo: &[u8]) -> Result<ExifInfo> {
    let mut cursor = Cursor::new(photo);
    let container = match exif::Reader::new().read_from_container(&mut cursor) {
        Ok(e) => e,
        Err(_) => return Ok(ExifInfo::default()),
    };
    let get = |tag: exif::Tag, ctx: exif::In| -> Option<&exif::Field> {
        container.get_field(tag, ctx)
    };
    let mut info = ExifInfo::default();
    info.make = get(exif::Tag::Make, exif::In::PRIMARY).and_then(ascii_value);
    info.model = get(exif::Tag::Model, exif::In::PRIMARY).and_then(ascii_value);
    info.lens = get(exif::Tag::LensModel, exif::In::PRIMARY).and_then(ascii_value);
    info.aperture = get(exif::Tag::FNumber, exif::In::PRIMARY).and_then(rational);
    info.focal_mm = get(exif::Tag::FocalLength, exif::In::PRIMARY).and_then(rational);
    info.iso = get(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY).and_then(u16_value);
    info.orientation = get(exif::Tag::Orientation, exif::In::PRIMARY).and_then(u16_value);
    info.datetime = get(exif::Tag::DateTimeOriginal, exif::In(2))
        .or_else(|| get(exif::Tag::DateTimeOriginal, exif::In::PRIMARY))
        .and_then(ascii_value);
    info.shutter = get(exif::Tag::ExposureTime, exif::In::PRIMARY)
        .and_then(rational)
        .map(format_shutter);
    info.model_pretty = info
        .model
        .as_deref()
        .and_then(prettify_model)
        .map(|s| s.to_string());
    info.brand_slug = crate::brand::brand_slug(info.make.as_deref(), info.model.as_deref());
    info.lens_slug = crate::brand::lens_slug(info.lens.as_deref());
    Ok(info)
}

/// Tag numbers allowed to survive into exported metadata (PRD B2/B3).
/// GPS (IFD 0x8825 and its entries) and device serial numbers are
/// deliberately excluded by whitelist design.
const WHITELIST: [u16; 10] = [
    0x010F, // Make
    0x0110, // Model
    0x0112, // Orientation
    0x829A, // ExposureTime
    0x829D, // FNumber
    0x8827, // ISOSpeedRatings / PhotographicSensitivity
    0x9003, // DateTimeOriginal
    0x920A, // FocalLength
    0xA432, // LensSpecification
    0xA434, // LensModel
];

/// Build a cleaned EXIF TIFF blob from the source photo (no report needed).
pub fn cleaned_exif_tiff(photo: &[u8]) -> Result<Option<Vec<u8>>> {
    Ok(cleaned_exif_tiff_full(photo, None, false)?.map(|(blob, _)| blob))
}

/// Metadata cleanup report without building the blob (PRD B3 pre-export view).
pub fn metadata_report(photo: &[u8], keep_gps: bool) -> Result<Option<MetadataReport>> {
    Ok(cleaned_exif_tiff_full(photo, None, keep_gps)?.map(|(_, r)| r))
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct MetadataReport {
    pub kept: usize,
    pub gps_stripped: usize,
    pub serial_stripped: usize,
    pub keep_gps: bool,
}

/// Serial-number tags stripped regardless of settings (PRD B3).
const SERIAL_TAGS: [u16; 2] = [0xA431, 0xA435]; // BodySerialNumber, LensSerialNumber

/// Cleaned EXIF write-back with metadata report (PRD B3):
/// GPS and serials are removed unless `keep_gps` (user opt-in, B3);
/// `final_size` normalizes Orientation to 1 and records final pixel dims.
pub fn cleaned_exif_tiff_full(
    photo: &[u8],
    final_size: Option<(u32, u32)>,
    keep_gps: bool,
) -> Result<Option<(Vec<u8>, MetadataReport)>> {
    let mut cursor = Cursor::new(photo);
    let source = match exif::Reader::new().read_from_container(&mut cursor) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    let mut report = MetadataReport { keep_gps, ..MetadataReport::default() };
    let mut kept: Vec<exif::Field> = Vec::new();
    for f in source.fields() {
        let code = f.tag.number();
        let is_gps = f.tag.context() == exif::Context::Gps;
        if is_gps { report.gps_stripped += 1; }
        if SERIAL_TAGS.contains(&code) { report.serial_stripped += 1; }
        if WHITELIST.contains(&code) || (keep_gps && is_gps) {
            kept.push(exif::Field {
                tag: f.tag,
                ifd_num: exif::In::PRIMARY,
                value: f.value.clone(),
            });
        }
    }
    report.kept = kept.len();
    if kept.is_empty() {
        return Ok(None);
    }
    if let Some((w, h)) = final_size {
        for field in kept.iter_mut() {
            if field.tag == exif::Tag::Orientation {
                field.value = exif::Value::Short(vec![1]);
            }
        }
        kept.push(exif::Field {
            tag: exif::Tag(exif::Context::Exif, 0xA002),
            ifd_num: exif::In::PRIMARY,
            value: exif::Value::Long(vec![w]),
        });
        kept.push(exif::Field {
            tag: exif::Tag(exif::Context::Exif, 0xA003),
            ifd_num: exif::In::PRIMARY,
            value: exif::Value::Long(vec![h]),
        });
    }
    let mut writer = exif::experimental::Writer::new();
    for field in &kept {
        writer.push_field(field);
    }
    let mut buf = Cursor::new(Vec::new());
    writer
        .write(&mut buf, false)
        .map_err(|e| Error::Exif(e.to_string()))?;
    Ok(Some((buf.into_inner(), report)))
}