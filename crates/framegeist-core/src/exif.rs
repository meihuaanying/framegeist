use std::io::Cursor;

use img_parts::{jpeg::Jpeg, png::Png, webp::WebP, Bytes, ImageEXIF};

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
    /// v0.5.0: best-effort Fujifilm recipe fields (MakerNote). Unknown values
    /// stay `None` instead of being invented.
    pub film_mode: Option<String>,
    pub wb_mode: Option<String>,
    pub wb_shift_r: Option<String>,
    pub wb_shift_b: Option<String>,
    pub grain: Option<String>,
    pub color_chrome: Option<String>,
    pub chrome_fx_blue: Option<String>,
    pub dynamic_range: Option<String>,
    pub highlight_tone: Option<String>,
    pub shadow_tone: Option<String>,
    pub fuji_sharpness: Option<String>,
    pub fuji_saturation: Option<String>,
    pub fuji_noise_reduction: Option<String>,
    pub fuji_clarity: Option<String>,
    pub fuji_lut1: Option<String>,
    pub fuji_lut2: Option<String>,
}

/// v0.6.0 polish: "25.0s" -> "25s" (keep sub-second decimals and fractions).
fn trim_shutter(raw: &str) -> String {
    if let Some(num) = raw.strip_suffix("s") {
        if let Ok(v) = num.parse::<f64>() {
            if (v.fract()).abs() < 0.001 {
                return format!("{}s", v.round() as i64);
            }
        }
    }
    raw.to_string()
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
    Some(
        [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ][idx],
    )
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
    /// v0.6.0: merge user/editor supplied EXIF overrides (preview-only values).
    /// Unknown keys are ignored; numbers are formatted like the original tags.
    pub fn apply_overrides(&mut self, map: &serde_json::Map<String, serde_json::Value>) {
        fn text(v: &serde_json::Value) -> Option<String> {
            match v {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Number(n) => Some(n.to_string()),
                serde_json::Value::Bool(b) => Some(b.to_string()),
                _ => None,
            }
        }
        fn number(v: &serde_json::Value) -> Option<f64> {
            match v {
                serde_json::Value::Number(n) => n.as_f64(),
                serde_json::Value::String(s) => s.parse().ok(),
                _ => None,
            }
        }
        for (key, value) in map {
            match key.as_str() {
                "make" => self.make = text(value),
                "model" => self.model = text(value),
                "model_pretty" => self.model_pretty = text(value),
                "lens" => self.lens = text(value),
                "focal" | "focal_mm" => self.focal_mm = number(value),
                "aperture" => self.aperture = number(value),
                "shutter" => self.shutter = text(value),
                "iso" => {
                    self.iso = number(value).map(|v| v.round().clamp(0.0, u16::MAX as f64) as u16)
                }
                "datetime" => self.datetime = text(value),
                "brand_slug" => self.brand_slug = text(value),
                "lens_slug" => self.lens_slug = text(value),
                "lens_series" => self.lens_series = text(value),
                "film_mode" => self.film_mode = text(value),
                "wb_mode" => self.wb_mode = text(value),
                "wb_shift_r" => self.wb_shift_r = text(value),
                "wb_shift_b" => self.wb_shift_b = text(value),
                "grain" => self.grain = text(value),
                "color_chrome" => self.color_chrome = text(value),
                "chrome_fx_blue" => self.chrome_fx_blue = text(value),
                "dynamic_range" => self.dynamic_range = text(value),
                "highlight_tone" => self.highlight_tone = text(value),
                "shadow_tone" => self.shadow_tone = text(value),
                "fuji_sharpness" => self.fuji_sharpness = text(value),
                "fuji_saturation" => self.fuji_saturation = text(value),
                "fuji_nr" => self.fuji_noise_reduction = text(value),
                "fuji_clarity" => self.fuji_clarity = text(value),
                _ => {}
            }
        }
    }

    pub fn get(&self, key: &str) -> Option<String> {
        match key {
            "make" => self.make.clone(),
            "model" => self.model.clone(),
            "model_pretty" => self.model_pretty.clone().or_else(|| self.model.clone()),
            "lens" => self.lens.clone(),
            "focal" => self.focal_mm.map(|f| format!("{:.0}", f)),
            "aperture" => self.aperture.map(|f| {
                if (f.fract()).abs() < 0.001 {
                    format!("{f:.0}")
                } else {
                    format!("{f:.1}")
                }
            }),
            "shutter" => self.shutter.as_deref().map(trim_shutter),
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
            "weekday" => self
                .datetime
                .as_deref()
                .and_then(weekday_en)
                .map(String::from),
            "weekday_cn" => self
                .datetime
                .as_deref()
                .and_then(weekday_cn)
                .map(String::from),
            // v0.5.0 Fujifilm recipe (best effort; None hides the line).
            "film_mode" => self.film_mode.clone(),
            "wb_mode" => self.wb_mode.clone(),
            "wb_shift_r" => self.wb_shift_r.clone(),
            "wb_shift_b" => self.wb_shift_b.clone(),
            "grain" => self.grain.clone(),
            "color_chrome" => self.color_chrome.clone(),
            "chrome_fx_blue" => self.chrome_fx_blue.clone(),
            "dynamic_range" => self.dynamic_range.clone(),
            "highlight_tone" => self.highlight_tone.clone(),
            "shadow_tone" => self.shadow_tone.clone(),
            "fuji_sharpness" => self.fuji_sharpness.clone(),
            "fuji_saturation" => self.fuji_saturation.clone(),
            "fuji_nr" => self.fuji_noise_reduction.clone(),
            "fuji_clarity" => self.fuji_clarity.clone(),
            "fuji_lut1" => self.fuji_lut1.clone(),
            "fuji_lut2" => self.fuji_lut2.clone(),
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
            let s = String::from_utf8_lossy(&bytes)
                .trim_matches('\0')
                .to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
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

fn shorten_option(c: &str) -> Option<String> {
    let t = c.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Best-effort Fujifilm MakerNote parser (v0.5.0 T2/§3.1). Only the
/// well-documented recipe tags are mapped; unrecognized values are hidden
/// rather than invented.
fn parse_fuji(container: &exif::Exif, info: &mut ExifInfo) {
    let is_fuji = info
        .make
        .as_deref()
        .is_some_and(|m| m.to_ascii_lowercase().contains("fuji"));
    if !is_fuji {
        return;
    }
    let Some(bytes) = container
        .fields()
        .find(|f| f.tag.number() == 0x927C)
        .and_then(|f| match &f.value {
            exif::Value::Undefined(v, _) => Some(v.clone()),
            _ => None,
        })
    else {
        return;
    };
    if bytes.len() < 12 || &bytes[..8] != b"FUJIFILM" {
        return;
    }
    let off = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
    if off + 2 > bytes.len() {
        return;
    }
    let ifd = &bytes[off..];
    let count = u16::from_le_bytes([ifd[0], ifd[1]]) as usize;
    let table = &ifd[2..];
    let short_of = |tag: u16| -> Option<u16> {
        for i in 0..count {
            let e = table.get(i * 12..i * 12 + 12)?;
            let t = u16::from_le_bytes([e[0], e[1]]);
            if t != tag {
                continue;
            }
            let typ = u16::from_le_bytes([e[2], e[3]]);
            if typ != 3 {
                return None;
            }
            return Some(u16::from_le_bytes([e[8], e[9]]));
        }
        None
    };
    let ascii_of = |tag: u16| -> Option<String> {
        for i in 0..count {
            let e = table.get(i * 12..i * 12 + 12)?;
            let t = u16::from_le_bytes([e[0], e[1]]);
            if t != tag {
                continue;
            }
            let typ = u16::from_le_bytes([e[2], e[3]]);
            let cnt = u32::from_le_bytes([e[4], e[5], e[6], e[7]]) as usize;
            if typ != 2 || cnt == 0 || cnt > 256 {
                return None;
            }
            let raw = if cnt <= 4 {
                e[8..12].to_vec()
            } else {
                let start = off + u32::from_le_bytes([e[8], e[9], e[10], e[11]]) as usize;
                bytes.get(start..start + cnt)?.to_vec()
            };
            return shorten_option(&String::from_utf8_lossy(&raw));
        }
        None
    };
    let shorts_of = |tag: u16| -> Option<(i16, i16)> {
        for i in 0..count {
            let e = table.get(i * 12..i * 12 + 12)?;
            let t = u16::from_le_bytes([e[0], e[1]]);
            if t != tag {
                continue;
            }
            let typ = u16::from_le_bytes([e[2], e[3]]);
            let cnt = u32::from_le_bytes([e[4], e[5], e[6], e[7]]);
            if typ != 3 || cnt != 2 {
                return None;
            }
            return Some((
                i16::from_le_bytes([e[8], e[9]]),
                i16::from_le_bytes([e[10], e[11]]),
            ));
        }
        None
    };
    let i32_of = |tag: u16| -> Option<i32> {
        for i in 0..count {
            let e = table.get(i * 12..i * 12 + 12)?;
            let t = u16::from_le_bytes([e[0], e[1]]);
            if t != tag {
                continue;
            }
            let typ = u16::from_le_bytes([e[2], e[3]]);
            let cnt = u32::from_le_bytes([e[4], e[5], e[6], e[7]]);
            if cnt != 1 {
                return None;
            }
            return match typ {
                3 => Some(u16::from_le_bytes([e[8], e[9]]) as i32),
                8 => Some(i16::from_le_bytes([e[8], e[9]]) as i32),
                9 => Some(i32::from_le_bytes([e[8], e[9], e[10], e[11]])),
                _ => None,
            };
        }
        None
    };

    info.film_mode = short_of(0x1401).and_then(|v| {
        Some(
            match v {
                0x000 => "Provia / Standard",
                0x100 => "Studio Portrait",
                0x110 => "Studio Portrait Enhanced",
                0x120 => "Studio Portrait Smooth Skin",
                0x130 => "Studio Portrait Sharp",
                0x200 => "Velvia / Vivid",
                0x300 => "Studio Portrait Ex",
                0x400 => "Velvia",
                0x500 => "Pro Neg. Std",
                0x501 => "Pro Neg. Hi",
                0x600 => "Classic Chrome",
                0x700 => "Eterna",
                0x800 => "Classic Negative",
                0x900 => "Bleach Bypass",
                0xa00 => "Nostalgic Neg",
                0xb00 => "Reala ACE",
                _ => return None,
            }
            .to_string(),
        )
    });
    info.wb_mode = short_of(0x1002).and_then(|v| {
        Some(
            match v {
                0x000 => "Auto",
                0x100 => "Daylight",
                0x200 => "Cloudy",
                0x300 => "Daylight Fluorescent",
                0x400 => "Day White Fluorescent",
                0x500 => "White Fluorescent",
                0x600 => "Incandescent",
                0xf00 => "Custom",
                0x1000 => "Kelvin",
                _ => return None,
            }
            .to_string(),
        )
    });
    if let Some((r, b)) = shorts_of(0x100a) {
        if r != 0 {
            info.wb_shift_r = Some(format!("{r:+}"));
        }
        if b != 0 {
            info.wb_shift_b = Some(format!("{b:+}"));
        }
    }
    info.fuji_sharpness = short_of(0x1001).and_then(|v| {
        Some(
            match v {
                1 => "-2 (Softest)",
                2 => "-1 (Soft)",
                3 => "0 (Normal)",
                4 => "+1 (Hard)",
                5 => "+2 (Hardest)",
                _ => return None,
            }
            .to_string(),
        )
    });
    info.fuji_saturation = short_of(0x1003).and_then(|v| {
        Some(
            match v {
                0 => "Normal",
                0x80 => "Medium High",
                0x100 => "High",
                0x180 => "Medium Low",
                0x200 => "Low",
                0x300 => "B&W",
                _ => return None,
            }
            .to_string(),
        )
    });
    info.dynamic_range = short_of(0x1402)
        .and_then(|v| {
            Some(
                match v {
                    0x000 => "Auto",
                    0x100 => "DR100",
                    0x200 => "DR200",
                    0x300 => "DR400",
                    0x400 => "DR800",
                    0x800 => "Film Simulation",
                    _ => return None,
                }
                .to_string(),
            )
        })
        .or_else(|| ascii_of(0x1402));
    let tone = |v: u16| -> Option<String> {
        let signed = v as i16;
        if !(-64..=64).contains(&signed) {
            return None;
        }
        Some(format!("{:+.1}", signed as f64 / 16.0))
    };
    info.shadow_tone = short_of(0x1040).and_then(tone);
    info.highlight_tone = short_of(0x1041).and_then(tone);
    info.grain = short_of(0x1047).and_then(|v| {
        Some(
            match v {
                0 => "Off",
                1 => "Weak",
                2 => "Strong",
                _ => return None,
            }
            .to_string(),
        )
    });
    info.color_chrome = short_of(0x1048).and_then(|v| {
        Some(
            match v {
                0 => "Off",
                1 => "Weak",
                2 => "Strong",
                _ => return None,
            }
            .to_string(),
        )
    });
    info.chrome_fx_blue = short_of(0x1049).and_then(|v| {
        Some(
            match v {
                0 => "Off",
                1 => "Weak",
                2 => "Strong",
                _ => return None,
            }
            .to_string(),
        )
    });
    // NoiseReduction: newer bodies carry 0x100e, older ones 0x100b. Values
    // follow the ExifTool FujiFilm table; 0x100b's 0x100 ("n/a") stays hidden.
    info.fuji_noise_reduction = short_of(0x100e)
        .and_then(|v| {
            Some(
                match v {
                    0x000 => "0 (normal)",
                    0x100 => "+2 (strong)",
                    0x180 => "+1 (medium strong)",
                    0x1c0 => "+3 (very strong)",
                    0x1e0 => "+4 (strongest)",
                    0x200 => "-2 (weak)",
                    0x280 => "-1 (medium weak)",
                    0x2c0 => "-3 (very weak)",
                    0x2e0 => "-4 (weakest)",
                    _ => return None,
                }
                .to_string(),
            )
        })
        .or_else(|| {
            short_of(0x100b).and_then(|v| {
                Some(
                    match v {
                        0x40 => "Low",
                        0x80 => "Normal",
                        _ => return None,
                    }
                    .to_string(),
                )
            })
        });
    // Clarity (0x100f): signed value in thousandths, -5..+5.
    info.fuji_clarity = i32_of(0x100f).and_then(|v| {
        if v % 1000 != 0 || !(-5000..=5000).contains(&v) {
            return None;
        }
        Some(match v / 1000 {
            0 => "0".to_string(),
            n => format!("{n:+}"),
        })
    });
    // LUT1 / LUT2 (+ transparency) have no Fujifilm MakerNote tag: ExifTool's
    // FujiFilm table defines no LUT entries (LUT metadata is a Panasonic/Sony
    // feature), and the captured fixture carries none, so `fuji_lut1` /
    // `fuji_lut2` stay None instead of guessing a tag number.
}

pub fn probe_exif(photo: &[u8]) -> Result<ExifInfo> {
    let mut cursor = Cursor::new(photo);
    let container = match exif::Reader::new().read_from_container(&mut cursor) {
        Ok(e) => e,
        Err(_) => return Ok(ExifInfo::default()),
    };
    let get =
        |tag: exif::Tag, ctx: exif::In| -> Option<&exif::Field> { container.get_field(tag, ctx) };
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
    parse_fuji(&container, &mut info);
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
    /// v0.6.0 M3: true when the export copied the source EXIF byte-for-byte
    /// (MakerNote/vendor tags preserved) instead of rebuilding a whitelist.
    pub passthrough: bool,
}

/// Serial-number tags stripped regardless of settings (PRD B3).
const SERIAL_TAGS: [u16; 2] = [0xA431, 0xA435]; // BodySerialNumber, LensSerialNumber

/// v0.6.0 M3: raw EXIF TIFF block (no `Exif\0\0` wrapper) from a JPEG APP1,
/// PNG eXIf chunk or WebP EXIF chunk. `None` for unsupported containers or
/// when the source carries no EXIF.
pub fn raw_exif_block(source: &[u8]) -> Option<Vec<u8>> {
    let bytes = Bytes::copy_from_slice(source);
    if source.starts_with(&[0xFF, 0xD8]) {
        Jpeg::from_bytes(bytes).ok()?.exif().map(|b| b.to_vec())
    } else if source.starts_with(&[0x89, b'P', b'N', b'G']) {
        Png::from_bytes(bytes).ok()?.exif().map(|b| b.to_vec())
    } else if source.len() >= 12 && &source[..4] == b"RIFF" && &source[8..12] == b"WEBP" {
        WebP::from_bytes(bytes).ok()?.exif().map(|b| b.to_vec())
    } else {
        None
    }
}

/// v0.6.0 M3 export passthrough: edit the source EXIF blob instead of
/// rebuilding it. GPS + camera owner/serials are removed (GPS only unless
/// `keep_gps`) and Orientation is normalized to 1; every other byte,
/// including MakerNote and unknown vendor tags, survives verbatim.
///
/// `Ok(None)` when the source has no EXIF block; `Err` when a block exists
/// but is malformed (callers fall back to the whitelist rebuild).
pub fn passthrough_exif_tiff(
    source: &[u8],
    keep_gps: bool,
) -> Result<Option<(Vec<u8>, MetadataReport)>> {
    let Some(raw) = raw_exif_block(source) else {
        return Ok(None);
    };
    let sanitized = crate::exif_surgery::sanitize_exif_block(&raw, keep_gps)?;
    let report = sanitized.report;
    Ok(Some((sanitized.into_tiff(), report)))
}

/// Cleaned EXIF write-back with metadata report (PRD B3):
/// GPS and serials are removed unless `keep_gps` (user opt-in, B3).
///
/// v0.6.0 M3: tries the byte-level passthrough first (source EXIF preserved
/// verbatim except the removed tags + Orientation->1) and only falls back to
/// the whitelist rebuild when the source EXIF is malformed/unreadable; the
/// whitelist fallback honors `final_size` (Orientation->1 + PixelXDimension/
/// PixelYDimension of the output).
pub fn cleaned_exif_tiff_full(
    photo: &[u8],
    final_size: Option<(u32, u32)>,
    keep_gps: bool,
) -> Result<Option<(Vec<u8>, MetadataReport)>> {
    if let Ok(Some(hit)) = passthrough_exif_tiff(photo, keep_gps) {
        return Ok(Some(hit));
    }
    cleaned_exif_tiff_whitelist(photo, final_size, keep_gps)
}

/// Legacy whitelist rebuild (fallback path): only whitelisted tags survive.
pub(crate) fn cleaned_exif_tiff_whitelist(
    photo: &[u8],
    final_size: Option<(u32, u32)>,
    keep_gps: bool,
) -> Result<Option<(Vec<u8>, MetadataReport)>> {
    let mut cursor = Cursor::new(photo);
    let source = match exif::Reader::new().read_from_container(&mut cursor) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    let mut report = MetadataReport {
        keep_gps,
        ..MetadataReport::default()
    };
    let mut kept: Vec<exif::Field> = Vec::new();
    for f in source.fields() {
        let code = f.tag.number();
        let is_gps = f.tag.context() == exif::Context::Gps;
        if is_gps {
            report.gps_stripped += 1;
        }
        if SERIAL_TAGS.contains(&code) {
            report.serial_stripped += 1;
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_display_is_polished() {
        let info = ExifInfo {
            aperture: Some(4.0),
            focal_mm: Some(24.0),
            shutter: Some("25.0s".into()),
            ..ExifInfo::default()
        };
        assert_eq!(info.get("aperture").as_deref(), Some("4"));
        assert_eq!(info.get("focal").as_deref(), Some("24"));
        assert_eq!(info.get("shutter").as_deref(), Some("25s"));
        let info = ExifInfo {
            aperture: Some(1.8),
            shutter: Some("1/250s".into()),
            ..ExifInfo::default()
        };
        assert_eq!(info.get("aperture").as_deref(), Some("1.8"));
        assert_eq!(info.get("shutter").as_deref(), Some("1/250s"));
    }

    #[test]
    fn overrides_merge_whitelisted_keys() {
        let mut info = ExifInfo::default();
        let map = serde_json::json!({
            "model": "ILCE-7RM3",
            "focal": 35,
            "aperture": "1.2",
            "iso": 100,
            "not_a_key": "ignored",
            "object": {"nested": true}
        });
        info.apply_overrides(map.as_object().expect("object"));
        assert_eq!(info.model.as_deref(), Some("ILCE-7RM3"));
        assert_eq!(info.get("focal").as_deref(), Some("35"));
        assert_eq!(info.get("aperture").as_deref(), Some("1.2"));
        assert_eq!(info.iso, Some(100));
    }
}
