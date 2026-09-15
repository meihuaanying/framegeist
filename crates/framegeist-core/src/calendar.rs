//! v0.5.0 calendar layer: month grid with best-effort lunar day labels.
//! Lunar conversion uses the classic 1900–2100 compressed table (public
//! algorithm); out-of-range dates fall back to solar-only labeling, never
//! invented values.

use image::RgbaImage;

use crate::exif::ExifInfo;
use crate::render::CanvasGeometry;
use crate::template::{parse_hex_color, CalendarLayer};
use crate::text_shape::Shaper;

const LUNAR_INFO: [u32; 201] = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
    0x0d520,
];

fn leap_month(year: i32) -> u32 {
    LUNAR_INFO[(year - 1900) as usize] & 0xf
}

fn leap_days(year: i32) -> u32 {
    if leap_month(year) == 0 {
        0
    } else if LUNAR_INFO[(year - 1900) as usize] & 0x10000 != 0 {
        30
    } else {
        29
    }
}

fn month_days(year: i32, month: u32) -> u32 {
    if LUNAR_INFO[(year - 1900) as usize] & (0x10000 >> month) != 0 {
        30
    } else {
        29
    }
}

fn lunar_year_days(year: i32) -> u32 {
    let mut sum = 0;
    for m in 1..=12 {
        sum += month_days(year, m);
    }
    sum + leap_days(year)
}

fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    // Howard Hinnant's algorithm; only used for date arithmetic.
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Solar date -> (lunar year, month, day, is_leap). `None` outside 1900–2100.
pub fn solar_to_lunar(y: i32, m: u32, d: u32) -> Option<(i32, u32, u32, bool)> {
    if !(1900..=2100).contains(&y) {
        return None;
    }
    let base = days_from_civil(1900, 1, 31);
    let target = days_from_civil(y, m, d);
    let mut offset = target - base;
    if offset < 0 {
        return None;
    }
    let mut year = 1900;
    loop {
        let days = lunar_year_days(year) as i64;
        if offset < days {
            break;
        }
        offset -= days;
        year += 1;
        if year > 2100 {
            return None;
        }
    }
    let leap = leap_month(year);
    let mut month = 1u32;
    let mut is_leap = false;
    loop {
        let days = if is_leap {
            leap_days(year)
        } else {
            month_days(year, month)
        } as i64;
        if offset < days {
            break;
        }
        offset -= days;
        if leap > 0 && month == leap && !is_leap {
            is_leap = true;
        } else {
            is_leap = false;
            month += 1;
        }
        if month > 12 {
            return None;
        }
    }
    Some((year, month, offset as u32 + 1, is_leap))
}

const LUNAR_MONTHS: [&str; 12] = [
    "正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月",
];

/// Short label for a lunar day: 初一..三十, or the month name on day 1.
pub fn lunar_label(day: u32, month: u32, is_leap: bool) -> String {
    if day == 1 {
        let mut s = String::new();
        if is_leap {
            s.push('闰');
        }
        s.push_str(LUNAR_MONTHS[(month - 1).min(11) as usize]);
        s
    } else {
        const TENS: [&str; 4] = ["初", "十", "廿", "三"];
        const UNITS: [&str; 10] = ["十", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
        if day == 10 {
            return "初十".into();
        }
        if day == 20 {
            return "二十".into();
        }
        if day == 30 {
            return "三十".into();
        }
        let tens = (day / 10) as usize;
        let unit = (day % 10) as usize;
        format!("{}{}", TENS[tens.min(3)], UNITS[unit.min(9)])
    }
}

fn parse_date(datetime: &Option<String>) -> Option<(i32, u32, u32)> {
    let s = datetime.as_ref()?;
    let bytes: Vec<&str> = s.split(&[':', ' ', '-'][..]).collect();
    if bytes.len() < 3 {
        return None;
    }
    let y = bytes[0].parse::<i32>().ok()?;
    let m = bytes[1].parse::<u32>().ok()?;
    let d = bytes[2].parse::<u32>().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some((y, m, d))
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn weekday_of(y: i32, m: u32, d: u32) -> u32 {
    // 0 = Monday … 6 = Sunday.
    let days = days_from_civil(y, m, d);
    ((days % 7 + 10) % 7) as u32
}

/// Days since epoch -> (year, month, day); inverse of `days_from_civil`.
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    ((if m <= 2 { y + 1 } else { y }) as i32, m, d)
}

/// Monday of the week containing `(y, m, d)` (Monday-first week rows).
fn week_start(y: i32, m: u32, d: u32) -> (i32, u32, u32) {
    let monday = days_from_civil(y, m, d) - weekday_of(y, m, d) as i64;
    civil_from_days(monday)
}

/// Draw a calendar layer onto the canvas. `geo` sizes/positions the layer.
#[allow(clippy::too_many_arguments)]
pub(crate) fn draw_calendar_layer(
    canvas: &mut RgbaImage,
    layer: &CalendarLayer,
    info: &ExifInfo,
    shaper: &mut Shaper,
    geo: &CanvasGeometry,
    frame: (u32, u32),
) {
    let (fw, fh) = frame;
    let fwf = fw as f32;
    let fhf = fh as f32;
    let size = layer.size as f32;
    let box_w = (size * fwf).max(24.0);
    let box_h = match layer.view.as_deref() {
        Some("strip") => box_w * 0.16,
        Some("day") => box_w * 0.9,
        Some("week") => box_w * 0.2,
        _ => box_w * 0.82,
    };

    // Date source.
    let explicit = layer
        .year
        .zip(layer.month)
        .map(|(y, m)| (y, m, 1u32));
    let date = match layer.date_source.as_deref() {
        Some("fixed") => explicit,
        _ => parse_date(&info.datetime).or(explicit),
    };
    let Some((year, month, _)) = date else {
        return;
    };
    let today_day = date.map(|(_, _, d)| d).unwrap_or(1);

    let box_x = anchor_x(layer, box_w, geo, fwf, fhf);
    let box_y = anchor_y(layer, box_h, geo, fwf, fhf);

    let color = parse_hex_color(layer.color.as_deref().unwrap_or("#1A1A1A")).unwrap_or([26, 26, 26, 255]);
    let accent = parse_hex_color(layer.accent.as_deref().unwrap_or("#E10600")).unwrap_or([225, 6, 0, 255]);
    let families: Vec<String> = if layer.font_family.is_empty() {
        vec!["Inter".into()]
    } else {
        layer.font_family.clone()
    };
    let unit = box_w / 7.0;

    match layer.view.as_deref() {
        Some("day") => {
            // Big day number card.
            let num = format!("{:02}", today_day);
            let size_px = box_h * 0.6;
            let (tw, th) = crate::text_art::draw_solid_text(
                canvas,
                shaper,
                &num,
                &families,
                size_px,
                accent,
                (box_x + (box_w - size_px * 0.62).max(0.0) / 2.0).round() as i32,
                (box_y + box_h * 0.08).round() as i32,
                1.0,
            );
            let _ = (tw, th);
            if let Some(t) = &info.datetime {
                let label = &t[..10.min(t.len())];
                crate::text_art::draw_solid_text(
                    canvas,
                    shaper,
                    label,
                    &families,
                    unit * 0.22,
                    color,
                    (box_x + box_w * 0.08).round() as i32,
                    (box_y + box_h * 0.75).round() as i32,
                    1.0,
                );
            }
        }
        Some("strip") => {
            let mut text = format!("{year}.{month:02}");
            if let Some((y, m, d)) = date {
                if let Some((_ly, lm, ld, is_leap)) = solar_to_lunar(y, m, d) {
                    let mut ml = String::new();
                    if is_leap {
                        ml.push('闰');
                    }
                    ml.push_str(LUNAR_MONTHS[(lm - 1).min(11) as usize]);
                    text = format!("{text}  {ml}{}", lunar_label(ld, lm, is_leap));
                }
            }
            crate::text_art::draw_solid_text(
                canvas,
                shaper,
                &text,
                &families,
                box_h * 0.72,
                color,
                box_x.round() as i32,
                box_y.round() as i32,
                1.0,
            );
            crate::render::draw_rect(
                canvas,
                box_x,
                box_y + box_h * 0.92,
                box_w,
                (fhf * 0.0015).max(1.0),
                accent,
                1.0,
            );
        }
        Some("week") => {
            // Week view: Monday-first row for the week containing the date.
            let (wy, wm, wd) = week_start(year, month, today_day);
            let monday = days_from_civil(wy, wm, wd);
            let mut y0 = box_y;
            if layer.show_weekdays {
                let names = ["一", "二", "三", "四", "五", "六", "日"];
                for (i, n) in names.iter().enumerate() {
                    crate::text_art::draw_solid_text(
                        canvas,
                        shaper,
                        n,
                        &families,
                        unit * 0.24,
                        color,
                        (box_x + unit * i as f32 + unit * 0.34).round() as i32,
                        y0.round() as i32,
                        0.7,
                    );
                }
                y0 += unit * 0.34;
            }
            for i in 0..7i64 {
                let (dy, dm, dd) = civil_from_days(monday + i);
                let cx = box_x + unit * i as f32;
                let is_selected = dy == year && dm == month && dd == today_day;
                let day_color = if is_selected { accent } else { color };
                crate::text_art::draw_solid_text(
                    canvas,
                    shaper,
                    &format!("{dd}"),
                    &families,
                    unit * 0.3,
                    day_color,
                    (cx + unit * 0.18).round() as i32,
                    y0.round() as i32,
                    if is_selected { 1.0 } else { 0.9 },
                );
                if layer.show_lunar {
                    if let Some((_ly, lm, ld, is_leap)) = solar_to_lunar(dy, dm, dd) {
                        let label = lunar_label(ld, lm, is_leap);
                        crate::text_art::draw_solid_text(
                            canvas,
                            shaper,
                            &label,
                            &families,
                            unit * 0.16,
                            color,
                            (cx + unit * 0.14).round() as i32,
                            (y0 + unit * 0.33).round() as i32,
                            0.55,
                        );
                    }
                }
                if is_selected {
                    crate::render::draw_rect(
                        canvas,
                        cx + unit * 0.08,
                        y0 - unit * 0.04,
                        unit * 0.06,
                        unit * 0.06,
                        accent,
                        0.9,
                    );
                }
            }
        }
        _ => {
            // Month view: header + weekday row + 6×7 grid.
            let header = format!("{year}.{month:02}");
            let header_size = unit * 0.42;
            let (hw, _hh) = crate::text_art::draw_solid_text(
                canvas,
                shaper,
                &header,
                &families,
                header_size,
                color,
                box_x.round() as i32,
                box_y.round() as i32,
                1.0,
            );
            crate::render::draw_rect(
                canvas,
                box_x,
                box_y + header_size * 1.15,
                box_w,
                (fhf * 0.0012).max(1.0),
                color,
                0.35,
            );
            let mut y0 = box_y + header_size * 1.5;
            if layer.show_weekdays {
                let names = ["一", "二", "三", "四", "五", "六", "日"];
                for (i, n) in names.iter().enumerate() {
                    crate::text_art::draw_solid_text(
                        canvas,
                        shaper,
                        n,
                        &families,
                        unit * 0.24,
                        color,
                        (box_x + unit * i as f32 + unit * 0.34).round() as i32,
                        y0.round() as i32,
                        0.7,
                    );
                }
                y0 += unit * 0.34;
            }
            let first_wd = weekday_of(year, month, 1);
            let dim = days_in_month(year, month);
            let row_h = (box_h - (y0 - box_y)) / 6.0;
            let grid_top = y0;
            for day in 1..=dim {
                let idx = first_wd + day - 1;
                let col = (idx % 7) as f32;
                let row = (idx / 7) as f32;
                let cx = box_x + col * unit;
                let cy = y0 + row * row_h;
                let is_today = day == today_day;
                let day_color = if is_today { accent } else { color };
                crate::text_art::draw_solid_text(
                    canvas,
                    shaper,
                    &format!("{day}"),
                    &families,
                    unit * 0.3,
                    day_color,
                    (cx + unit * 0.18).round() as i32,
                    cy.round() as i32,
                    if is_today { 1.0 } else { 0.9 },
                );
                if layer.show_lunar {
                    if let Some((_ly, lm, ld, is_leap)) = solar_to_lunar(year, month, day) {
                        let label = lunar_label(ld, lm, is_leap);
                        crate::text_art::draw_solid_text(
                            canvas,
                            shaper,
                            &label,
                            &families,
                            unit * 0.16,
                            color,
                            (cx + unit * 0.14).round() as i32,
                            (cy + unit * 0.33).round() as i32,
                            0.55,
                        );
                    }
                }
                if is_today {
                    crate::render::draw_rect(
                        canvas,
                        cx + unit * 0.08,
                        cy - unit * 0.04,
                        unit * 0.06,
                        unit * 0.06,
                        accent,
                        0.9,
                    );
                }
            }
            if layer.binding.unwrap_or(false) {
                draw_binding_guides(
                    canvas,
                    box_x,
                    box_y,
                    box_w,
                    box_h,
                    unit,
                    hw,
                    grid_top,
                    color,
                    (fhf * 0.0014).max(1.0),
                );
            }
        }
    }
}

/// v0.5.0 calendar binding-edge decoration (month view): a dashed vertical
/// crease through the block center plus evenly spaced notches along the top
/// edge, painted in `color` at low opacity. The crease runs down the gap
/// between the centre day columns and the notches skip the header text run,
/// so day/lunar glyphs are never overpainted.
#[allow(clippy::too_many_arguments)]
fn draw_binding_guides(
    canvas: &mut RgbaImage,
    box_x: f32,
    box_y: f32,
    box_w: f32,
    box_h: f32,
    unit: f32,
    header_w: u32,
    grid_top: f32,
    color: [u8; 4],
    line_w: f32,
) {
    let opacity = 0.18;
    // Dashed crease at the block's horizontal centre (column 3/4 boundary).
    let crease_x = box_x + box_w * 0.5 - line_w * 0.5;
    let bottom = box_y + box_h * 0.96;
    let dash = unit * 0.16;
    let gap = unit * 0.12;
    let mut y = grid_top.max(box_y + box_h * 0.08);
    while y < bottom {
        let h = dash.min(bottom - y);
        crate::render::draw_rect(canvas, crease_x, y, line_w, h, color, opacity);
        y += dash + gap;
    }
    // Notch marks evenly spaced along the top edge, skipping the header run.
    let notch_w = unit * 0.22;
    let header_end = box_x + header_w as f32 + unit * 0.15;
    for i in 0..7 {
        let x = box_x + unit * (i as f32 + 0.5) - notch_w * 0.5;
        if header_w > 0 && x < header_end {
            continue;
        }
        crate::render::draw_rect(canvas, x, box_y, notch_w, line_w, color, opacity);
    }
}

fn anchor_x(layer: &CalendarLayer, w: f32, _geo: &CanvasGeometry, fw: f32, _fh: f32) -> f32 {
    use crate::template::Anchor;
    let off = layer.offset.x as f32 * fw;
    match layer.anchor {
        Anchor::TopLeft | Anchor::MiddleLeft | Anchor::BottomLeft => off,
        Anchor::TopCenter | Anchor::MiddleCenter | Anchor::BottomCenter => (fw - w) / 2.0 + off,
        _ => fw + off - w,
    }
}

fn anchor_y(layer: &CalendarLayer, h: f32, _geo: &CanvasGeometry, _fw: f32, fh: f32) -> f32 {
    use crate::template::Anchor;
    let off = layer.offset.y as f32 * fh;
    match layer.anchor {
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight => off,
        Anchor::MiddleLeft | Anchor::MiddleCenter | Anchor::MiddleRight => (fh - h) / 2.0 + off,
        _ => fh + off - h,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lunar_new_year_dates_are_lunar_day_one() {
        // Known Chinese New Year dates (public references).
        assert_eq!(solar_to_lunar(2024, 2, 10), Some((2024, 1, 1, false)));
        assert_eq!(solar_to_lunar(2025, 1, 29), Some((2025, 1, 1, false)));
        assert_eq!(solar_to_lunar(2023, 1, 22), Some((2023, 1, 1, false)));
        assert_eq!(solar_to_lunar(2020, 1, 25), Some((2020, 1, 1, false)));
    }

    #[test]
    fn lunar_day_before_new_year_is_twelfth_month() {
        assert_eq!(solar_to_lunar(2024, 2, 9), Some((2023, 12, 30, false)));
    }

    #[test]
    fn lunar_labels_are_correct() {
        assert_eq!(lunar_label(1, 1, false), "正月");
        assert_eq!(lunar_label(10, 1, false), "初十");
        assert_eq!(lunar_label(15, 1, false), "十五");
        assert_eq!(lunar_label(20, 1, false), "二十");
        assert_eq!(lunar_label(30, 1, false), "三十");
        assert_eq!(lunar_label(1, 4, true), "闰四月");
    }

    #[test]
    fn lunar_out_of_range_hides() {
        assert_eq!(solar_to_lunar(1899, 1, 1), None);
        assert_eq!(solar_to_lunar(2101, 1, 1), None);
    }

    #[test]
    fn weekday_monday_is_zero() {
        // 2026-09-14 is a Monday.
        assert_eq!(weekday_of(2026, 9, 14), 0);
        assert_eq!(weekday_of(2026, 9, 20), 6);
    }

    #[test]
    fn week_starts_on_monday() {
        // Monday 2026-09-14 … Sunday 2026-09-20 share one week.
        assert_eq!(week_start(2026, 9, 14), (2026, 9, 14));
        assert_eq!(week_start(2026, 9, 16), (2026, 9, 14));
        assert_eq!(week_start(2026, 9, 20), (2026, 9, 14));
        // Crosses a month boundary: 2026-10-01 is a Thursday.
        assert_eq!(week_start(2026, 10, 1), (2026, 9, 28));
    }

    #[test]
    fn civil_from_days_inverts_days_from_civil() {
        for (y, m, d) in [(1900, 1, 1), (2000, 2, 29), (2026, 9, 16), (2100, 12, 31)] {
            assert_eq!(civil_from_days(days_from_civil(y, m, d)), (y, m, d));
        }
    }
}
