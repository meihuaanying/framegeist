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
    pub lens_series: Option<String>,
    /// v0.4.0: GPS coordinates (decimal degrees) + altitude in meters.
    /// Rendered into watermarks only when `keep_gps` is on (PRD B3).
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub gps_alt: Option<f64>,
}

fn format_dms(value: f64, positive: char, negative: char) -> String {
    let hemisphere = if value < 0.0 { negative } else { positive };
    let abs = value.abs();
    let mut deg = abs.floor() as u32;
    let minutes_total = (abs - deg as f64) * 60.0;
    let mut minutes = minutes_total.floor() as u32;
    let mut secs = ((minutes_total - minutes as f64) * 60.0).round() as u32;
    if secs >= 60 {
        secs = 0;
        minutes += 1;
        if minutes >= 60 {
            minutes = 0;
            deg += 1;
        }
    }
    format!("{deg}\u{b0}{minutes}'{secs}\"{hemisphere}")
}

pub(crate) fn weekday_en(datetime: &str) -> Option<&'static str> {
    let digits: Vec<u32> = datetime.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() < 8 {
        return None;
    }
    let y = digits[0..4].iter().fold(0i64, |a, d| a * 10 + *d as i64);
    let m = digits[4..6].iter().fold(0i64, |a, d| a * 10 + *d as i64);
    let day = digits[6..8].iter().fold(0i64, |a, d| a * 10 + *d as i64);
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) {
        return None;
    }
    // Zeller's congruence (Gregorian): h = 0 Saturday, 1 Sunday, 2 Monday …
    let (y2, m2) = if m <= 2 { (y - 1, m + 12) } else { (y, m) };
    let k = y2 % 100;
    let j = y2 / 100;
    let h = (day + (13 * (m2 + 1)) / 5 + k + k / 4 + j / 4 + 5 * j) % 7;
    let idx = ((h + 5) % 7) as usize; // Monday=0 … Sunday=6
    Some(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][idx])
}

fn weekday_cn(datetime: &str) -> Option<&'static str> {
    let en = weekday_en(datetime)?;
    Some(match en {
        "Monday" => "星期一",
        "Tuesday" => "星期二",
        "Wednesday" => "星期三",
        "Thursday" => "星期四",
        "Friday" => "星期五",
        "Saturday" => "星期六",
        _ => "星期日",
    })
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
            "lens_series" => self.lens_series.clone(),
            "gps_lat" => self.gps_lat.map(|v| format_dms(v, 'N', 'S')),
            "gps_lon" => self.gps_lon.map(|v| format_dms(v, 'E', 'W')),
            "gps_latlon" => match (self.gps_lat, self.gps_lon) {
                (Some(lat), Some(lon)) => Some(format!(
                    "{} {}",
                    format_dms(lat, 'N', 'S'),
                    format_dms(lon, 'E', 'W')
                )),
                _ => None,
            },
            "gps_alt" => self.gps_alt.map(|v| format!("{}m", v.round() as i64)),
            "weekday" => self.datetime.as_deref().and_then(weekday_en).map(String::from),
            "weekday_cn" => self.datetime.as_deref().and_then(weekday_cn).map(String::from),
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

fn rational_triplet(field: &exif::Field) -> Option<f64> {
    match &field.value {
        exif::Value::Rational(v) if v.len() >= 3 => {
            let d = v[0].to_f64();
            let m = v[1].to_f64();
            let s = v[2].to_f64();
            if d.is_finite() && m.is_finite() && s.is_finite() {
                Some(d + m / 60.0 + s / 3600.0)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn ascii_string(field: &exif::Field) -> Option<String> {
    ascii_value(field)
}

/// GPS fields live in their own IFD; locate by tag context.
fn gps_field(container: &exif::Exif, tag: exif::Tag) -> Option<&exif::Field> {
    container
        .fields()
        .find(|f| f.tag == tag && f.tag.context() == exif::Context::Gps)
}

fn parse_gps(container: &exif::Exif, info: &mut ExifInfo) {
    let lat = gps_field(container, exif::Tag::GPSLatitude)
        .and_then(rational_triplet)
        .map(|v| {
            if gps_field(container, exif::Tag::GPSLatitudeRef)
                .and_then(ascii_string)
                .is_some_and(|r| r.starts_with('S'))
            {
                -v
            } else {
                v
            }
        });
    let lon = gps_field(container, exif::Tag::GPSLongitude)
        .and_then(rational_triplet)
        .map(|v| {
            if gps_field(container, exif::Tag::GPSLongitudeRef)
                .and_then(ascii_string)
                .is_some_and(|r| r.starts_with('W'))
            {
                -v
            } else {
                v
            }
        });
    let alt = gps_field(container, exif::Tag::GPSAltitude).and_then(rational);
    let below = gps_field(container, exif::Tag::GPSAltitudeRef)
        .map(|f| matches!(&f.value, exif::Value::Byte(v) if v.first() == Some(&1)))
        .unwrap_or(false);
    info.gps_lat = lat;
    info.gps_lon = lon;
    info.gps_alt = alt.map(|v| if below { -v } else { v });
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
    info.lens_series = crate::brand::lens_series(info.lens.as_deref());
    parse_gps(&container, &mut info);
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