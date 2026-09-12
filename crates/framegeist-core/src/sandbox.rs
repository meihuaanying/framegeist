//! Template sandbox (PRD C2): templates are data, never code.
//!
//! - No network or filesystem access: `http://`, `https://`, `file://` and
//!   `../` traversal are rejected everywhere in the document.
//! - Field expressions are restricted to a whitelisted grammar
//!   (`exif.<key>` and `fmt('<literal>', exif)`).

use crate::exif::ExifInfo;
use crate::{Error, Result};
use serde_json::Value;

const FORBIDDEN_SUBSTRINGS: [&str; 3] = ["http://", "https://", "file://"];

fn walk_strings(value: &Value, f: &mut impl FnMut(&str)) {
    match value {
        Value::String(s) => f(s),
        Value::Array(items) => items.iter().for_each(|v| walk_strings(v, f)),
        Value::Object(map) => map.values().for_each(|v| walk_strings(v, f)),
        _ => {}
    }
}

pub fn check(value: &Value) -> Result<()> {
    let mut violations: Vec<String> = Vec::new();
    walk_strings(value, &mut |s: &str| {
        for bad in FORBIDDEN_SUBSTRINGS {
            if s.contains(bad) {
                violations.push(format!(
                    "forbidden substring {bad:?} in string {s:?}"
                ));
            }
        }
        if s.starts_with("../") || s.contains("/../") {
            violations.push(format!("path traversal in string {s:?}"));
        }
    });
    if violations.is_empty() {
        Ok(())
    } else {
        Err(Error::SandboxViolation(
            violations.into_iter().take(5).collect::<Vec<_>>().join("; "),
        ))
    }
}

fn is_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Grammar check for a field expression. Allowed forms:
///   exif.<key>              direct EXIF field
///   '<literal>'             constant text (C3)
///   fmt('<literal>', exif)  format string with {key} placeholders
///   if_empty(exif.<key>, '<literal>')  value or literal when missing
///   date('<format>', exif.datetime)    EXIF date reformatting
pub fn validate_expr(expr: &str) -> Result<()> {
    if expr.len() >= 2 && expr.starts_with('\'') && expr.ends_with('\'') {
        let literal = &expr[1..expr.len() - 1];
        if literal.contains('\'') || literal.contains('\\') || literal.contains('\n') {
            return Err(Error::SandboxViolation(format!(
                "literal contains forbidden characters: {expr:?}"
            )));
        }
        return Ok(());
    }
    if let Some(key) = expr.strip_prefix("exif.") {
        if is_ident(key) {
            return Ok(());
        }
        return Err(Error::SandboxViolation(format!(
            "invalid exif key in expr {expr:?}"
        )));
    }
    if let Some(rest) = expr.strip_prefix("if_empty(") {
        let inner = rest.strip_suffix(')').ok_or_else(|| {
            Error::SandboxViolation(format!("if_empty() is unterminated: {expr:?}"))
        })?;
        let (key, literal) = inner
            .split_once(", ")
            .ok_or_else(|| Error::SandboxViolation(format!("if_empty() needs two arguments: {expr:?}")))?;
        let key = key.strip_prefix("exif.").ok_or_else(|| {
            Error::SandboxViolation(format!("if_empty() first argument must be exif.<key>: {expr:?}"))
        })?;
        if !is_ident(key) {
            return Err(Error::SandboxViolation(format!(
                "invalid exif key in {expr:?}"
            )));
        }
        if !(literal.starts_with('\'') && literal.ends_with('\'') && literal.len() >= 2) {
            return Err(Error::SandboxViolation(format!(
                "if_empty() literal must be single-quoted: {expr:?}"
            )));
        }
        if literal[1..literal.len() - 1].contains('\'') {
            return Err(Error::SandboxViolation(format!(
                "if_empty() literal contains a quote: {expr:?}"
            )));
        }
        return Ok(());
    }
    if let Some(rest) = expr.strip_prefix("date(") {
        let inner = rest.strip_suffix(')').ok_or_else(|| {
            Error::SandboxViolation(format!("date() is unterminated: {expr:?}"))
        })?;
        let inner = inner.strip_prefix('\'').ok_or_else(|| {
            Error::SandboxViolation(format!(
                "date() format must be a single-quoted literal: {expr:?}"
            ))
        })?;
        let (literal, key) = inner.split_once("', ").ok_or_else(|| {
            Error::SandboxViolation(format!("date() needs two arguments: {expr:?}"))
        })?;
        if literal.contains('\'') || literal.contains('\\') || literal.contains('\n') {
            return Err(Error::SandboxViolation(format!(
                "date() format contains forbidden characters: {expr:?}"
            )));
        }
        if key != "exif.datetime" {
            return Err(Error::SandboxViolation(format!(
                "date() second argument must be exactly `exif.datetime`: {expr:?}"
            )));
        }
        return Ok(());
    }
    if expr.starts_with("fmt(") && expr.ends_with(')') {
        let inner = &expr[4..expr.len() - 1];
        let quote_pos = inner.find('\'').ok_or_else(|| {
            Error::SandboxViolation(format!("fmt() literal must be single-quoted: {expr:?}"))
        })?;
        if quote_pos != 0 {
            return Err(Error::SandboxViolation(format!(
                "fmt() literal must be the first argument: {expr:?}"
            )));
        }
        let close = match inner.rfind('\'') {
            Some(c) => c,
            None => {
                return Err(Error::SandboxViolation(format!(
                    "fmt() literal is unterminated: {expr:?}"
                )))
            }
        };
        if close == 0 {
            return Err(Error::SandboxViolation(format!(
                "fmt() literal is unterminated: {expr:?}"
            )));
        }
        let literal = &inner[1..close];
        let tail = &inner[close + 1..];
        if tail != ", exif" {
            return Err(Error::SandboxViolation(format!(
                "fmt() second argument must be exactly `exif`: {expr:?}"
            )));
        }
        if literal.contains('\'') || literal.contains('\\') || literal.contains('\n') {
            return Err(Error::SandboxViolation(format!(
                "fmt() literal contains forbidden characters: {expr:?}"
            )));
        }
        let mut rest = literal;
        while let Some(open) = rest.find('{') {
            let after = &rest[open + 1..];
            let close = after
                .find('}')
                .ok_or_else(|| Error::SandboxViolation(format!("unclosed {{ in {expr:?}")))?;
            if !is_ident(&after[..close]) {
                return Err(Error::SandboxViolation(format!(
                    "invalid placeholder key in {expr:?}"
                )));
            }
            rest = &after[close + 1..];
        }
        return Ok(());
    }
    Err(Error::SandboxViolation(format!(
        "expr {expr:?} is not in the whitelisted grammar (exif.<key> | fmt('<literal>', exif))"
    )))
}

/// Evaluate an expression against EXIF info. Returns None when any
/// referenced field is missing; the template's `fallback` then applies.
pub fn eval_expr(expr: &str, info: &ExifInfo) -> Option<String> {
    if expr.len() >= 2 && expr.starts_with('\'') && expr.ends_with('\'') {
        return Some(expr[1..expr.len() - 1].to_string());
    }
    if let Some(key) = expr.strip_prefix("exif.") {
        return info.get(key);
    }
    if let Some(rest) = expr.strip_prefix("if_empty(") {
        let inner = rest.strip_suffix(')')?;
        let (key, literal) = inner.split_once(", ")?;
        let key = key.strip_prefix("exif.")?;
        let value = info.get(key);
        let literal = &literal[1..literal.len() - 1];
        return Some(value.filter(|v| !v.is_empty()).unwrap_or_else(|| literal.to_string()));
    }
    if let Some(rest) = expr.strip_prefix("date(") {
        let inner = rest.strip_suffix(')')?;
        let inner = inner.strip_prefix('\'')?;
        let (format, key) = inner.split_once("', ")?;
        if key != "exif.datetime" {
            return None;
        }
        let raw = info.get("datetime")?;
        return format_exif_date(&raw, format);
    }
    if expr.starts_with("fmt(") && expr.ends_with(')') {
        let inner = &expr[4..expr.len() - 1];
        let close = inner.rfind('\'')?;
        let literal = inner[1..close].to_string();
        let mut out = String::with_capacity(literal.len() + 16);
        let mut rest = literal.as_str();
        while let Some(open) = rest.find('{') {
            let after = &rest[open + 1..];
            let end = after.find('}')?;
            let key = &after[..end];
            let val = info.get(key)?;
            out.push_str(&rest[..open]);
            out.push_str(&val);
            rest = &after[end + 1..];
        }
        out.push_str(rest);
        return Some(out);
    }
    None
}

/// Reformat an EXIF datetime (`YYYY:MM:DD HH:MM:SS`) according to a token
/// format. Tokens (longest match first): YYYY, MMMM, MMM, MM, M, DD, Do, D,
/// HH, mm, SS, WW (English weekday). Other characters pass through.
fn format_exif_date(raw: &str, format: &str) -> Option<String> {
    let digits: Vec<u32> = raw
        .chars()
        .filter_map(|c| c.to_digit(10))
        .collect();
    if digits.len() < 14 {
        return None;
    }
    let num = |slice: &[u32]| -> u32 {
        slice.iter().fold(0u32, |acc, d| acc * 10 + d)
    };
    let year = num(&digits[0..4]);
    let month = num(&digits[4..6]);
    let day = num(&digits[6..8]);
    let hour = num(&digits[8..10]);
    let minute = num(&digits[10..12]);
    let second = num(&digits[12..14]);

    const MONTHS: [&str; 12] = [
        "January", "February", "March", "April", "May", "June", "July", "August", "September",
        "October", "November", "December",
    ];
    let month_name = MONTHS.get(month.saturating_sub(1) as usize).copied().unwrap_or("");
    let weekday = crate::exif::weekday_en(raw).unwrap_or("");
    let ordinal = |d: u32| -> String {
        let suffix = if (11..=13).contains(&(d % 100)) {
            "th"
        } else {
            match d % 10 {
                1 => "st",
                2 => "nd",
                3 => "rd",
                _ => "th",
            }
        };
        format!("{d}{suffix}")
    };
    let token_value = |token: &str| -> String {
        match token {
            "YYYY" => format!("{year:04}"),
            "MMMM" => month_name.to_string(),
            "MMM" => month_name.chars().take(3).collect(),
            "MM" => format!("{month:02}"),
            "M" => month.to_string(),
            "DD" => format!("{day:02}"),
            "Do" => ordinal(day),
            "D" => day.to_string(),
            "HH" => format!("{hour:02}"),
            "mm" => format!("{minute:02}"),
            "SS" => format!("{second:02}"),
            "WW" => weekday.to_string(),
            _ => String::new(),
        }
    };

    const TOKENS: [&str; 12] = [
        "YYYY", "MMMM", "MMM", "MM", "M", "DD", "Do", "D", "HH", "mm", "SS", "WW",
    ];
    let mut out = String::with_capacity(format.len());
    let mut rest = format;
    'outer: while !rest.is_empty() {
        for token in TOKENS {
            if let Some(after) = rest.strip_prefix(token) {
                out.push_str(&token_value(token));
                rest = after;
                continue 'outer;
            }
        }
        let ch = rest.chars().next()?;
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_expr_evaluates() {
        let info = ExifInfo {
            model: Some("X-T5".into()),
            ..ExifInfo::default()
        };
        assert_eq!(eval_expr("exif.model", &info).as_deref(), Some("X-T5"));
        assert_eq!(eval_expr("exif.missing", &info), None);
    }

    #[test]
    fn fmt_expr_evaluates_and_requires_all_fields() {
        let info = ExifInfo {
            focal_mm: Some(24.0),
            iso: Some(200),
            ..ExifInfo::default()
        };
        let expr = "fmt('{focal}mm  ISO{iso}', exif)";
        assert_eq!(
            eval_expr(expr, &info).as_deref(),
            Some("24mm  ISO200")
        );
        assert_eq!(eval_expr("fmt('{aperture}', exif)", &info), None);
    }

    #[test]
    fn constant_text_expr() {
        assert_eq!(eval_expr("'FrameGeist'", &ExifInfo::default()).as_deref(), Some("FrameGeist"));
        assert!(validate_expr("'KODAK 400 1'").is_ok());
        assert!(validate_expr("'has 'quote' inside'").is_err());
    }

    #[test]
    fn if_empty_and_date_exprs() {
        let with = ExifInfo {
            model: Some("X-T5".into()),
            datetime: Some("2026:09:09 10:00:00".into()),
            ..ExifInfo::default()
        };
        let without = ExifInfo::default();
        assert_eq!(
            eval_expr("if_empty(exif.model, 'Unknown Camera')", &with).as_deref(),
            Some("X-T5")
        );
        assert_eq!(
            eval_expr("if_empty(exif.model, 'Unknown Camera')", &without).as_deref(),
            Some("Unknown Camera")
        );
        assert_eq!(
            eval_expr("date('YYYY-MM-DD HH:mm', exif.datetime)", &with).as_deref(),
            Some("2026-09-09 10:00")
        );
        assert_eq!(eval_expr("date('YYYY-MM-DD', exif.datetime)", &without), None);
        assert!(validate_expr("date('YYYY-MM-DD', exif.datetime)").is_ok());
        assert!(validate_expr("date('YYYY-MM-DD', exif.model)").is_err());
        assert!(validate_expr("if_empty(exif.model, 'ok')").is_ok());
        assert!(validate_expr("if_empty(exif.model, exif.model)").is_err());
    }

    #[test]
    fn validate_expr_rejects_injection() {
        assert!(validate_expr("http://evil").is_err());
        assert!(validate_expr("exif.UPPER").is_err());
        assert!(validate_expr("fmt('a'); drop").is_err());
        assert!(validate_expr("fmt('{../path}', exif)").is_err());
        assert!(validate_expr("system('rm -rf')").is_err());
    }
}
