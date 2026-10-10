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

/// v1.5.0: schemes that must never appear in a template string. `:` on its own is
/// fine (real templates contain `fmt('... f/{aperture} ...')`, `date('YYYY-MM-DD
/// HH:mm', ...)` and literals such as `'12:30'`), so only the scheme prefixes are
/// matched. `://` catches unknown schemes generically.
const FORBIDDEN_SCHEMES: [&str; 8] = [
    "data:",
    "javascript:",
    "vbscript:",
    "blob:",
    "ftp:",
    "file:",
    "http:",
    "https:",
];

/// v1.5.0: bound for a single template string. `load_template_from_str` also caps
/// the whole document; this keeps direct `check()` callers bounded too.
pub const MAX_STRING_LEN: usize = 64 * 1024;

fn walk_strings(value: &Value, f: &mut impl FnMut(&str)) {
    match value {
        Value::String(s) => f(s),
        Value::Array(items) => items.iter().for_each(|v| walk_strings(v, f)),
        Value::Object(map) => map.values().for_each(|v| walk_strings(v, f)),
        _ => {}
    }
}

/// v1.5.0: classify one string. `http://`/`https://`/`file://` keep their original
/// message so existing tests and docs stay accurate; everything else is reported
/// as path or scheme abuse.
fn string_violations(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    if s.chars().count() > MAX_STRING_LEN {
        out.push(format!(
            "string exceeds {} characters (got {})",
            MAX_STRING_LEN,
            s.chars().count()
        ));
        return out;
    }
    for bad in FORBIDDEN_SUBSTRINGS {
        if s.contains(bad) {
            out.push(format!("forbidden substring {bad:?} in string {s:?}"));
        }
    }
    let lower = s.to_ascii_lowercase();
    // Backslashes: Windows separators, UNC paths and `..\` traversal all of which
    // the forward-slash-only rule below could not see.
    if s.contains('\\') {
        out.push(format!("backslash in string {s:?}"));
    }
    // Traversal by path segment, not by substring: catches bare `..`, `foo/..`
    // and `a/../b` alike, and keeps matching the previous `/../` behaviour.
    if s.split('/').any(|seg| seg == "..") {
        out.push(format!("path traversal in string {s:?}"));
    }
    // Absolute locations: rooted paths (and `//host` on POSIX) plus Windows drives.
    if s.starts_with('/') || s.starts_with('\\') || s.as_bytes().get(1) == Some(&b':') {
        out.push(format!("absolute path in string {s:?}"));
    }
    // Percent-encoded separators/dots (`%2e%2e%2f`) decode to the rules above.
    if lower.contains("%2e") || lower.contains("%2f") {
        out.push(format!("percent-encoded traversal in string {s:?}"));
    }
    for scheme in FORBIDDEN_SCHEMES {
        if lower.contains(scheme) {
            out.push(format!("forbidden scheme {scheme:?} in string {s:?}"));
        }
    }
    if s.contains("://") {
        out.push(format!("forbidden scheme in string {s:?}"));
    }
    out
}

pub fn check(value: &Value) -> Result<()> {
    let mut violations: Vec<String> = Vec::new();
    walk_strings(value, &mut |s: &str| {
        violations.extend(string_violations(s))
    });
    if violations.is_empty() {
        Ok(())
    } else {
        Err(Error::SandboxViolation(
            violations
                .into_iter()
                .take(5)
                .collect::<Vec<_>>()
                .join("; "),
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
        let (key, literal) = inner.split_once(", ").ok_or_else(|| {
            Error::SandboxViolation(format!("if_empty() needs two arguments: {expr:?}"))
        })?;
        let key = key.strip_prefix("exif.").ok_or_else(|| {
            Error::SandboxViolation(format!(
                "if_empty() first argument must be exif.<key>: {expr:?}"
            ))
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
        let inner = rest
            .strip_suffix(')')
            .ok_or_else(|| Error::SandboxViolation(format!("date() is unterminated: {expr:?}")))?;
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

/// Separator the shipped templates use to put several expressions on one line:
/// U+00B7 MIDDLE DOT with a single space on each side.
const EXPR_JOINER: char = '\u{b7}';

/// v1.4.0 audit: split a line expression on its ` · ` joiners.
///
/// Quote-aware, because the same sequence occurs *inside* literals —
/// `fmt('01 · CAMERA · {model_pretty}', exif)` is one atom, not three. Returns
/// `Err` when a joiner outside quotes is not exactly ` · `, so ` ·`, `x ·y` and
/// `x· y` cannot smuggle text through.
fn split_expr_atoms(expr: &str) -> Result<Vec<&str>> {
    let mut atoms: Vec<&str> = Vec::new();
    let mut start = 0usize;
    let mut in_quote = false;
    let mut prev: Option<char> = None;
    let mut iter = expr.char_indices().peekable();
    while let Some((i, c)) = iter.next() {
        match c {
            '\'' => in_quote = !in_quote,
            EXPR_JOINER if !in_quote => {
                let spaced_before = prev == Some(' ');
                let spaced_after = matches!(iter.peek(), Some((_, ' ')));
                if !spaced_before || !spaced_after {
                    return Err(Error::SandboxViolation(format!(
                        "expression joiner must be ` · ` (U+00B7 with one space each side): {expr:?}"
                    )));
                }
                // `prev` is an ASCII space, so `i - 1` is a char boundary.
                atoms.push(expr[start..i - 1].trim());
                // Skip the dot's two UTF-8 bytes and the following space.
                iter.next();
                start = i + '·'.len_utf8() + 1;
            }
            _ => {}
        }
        prev = Some(c);
    }
    atoms.push(expr[start..].trim());
    Ok(atoms)
}

/// Grammar check for an `infoBlock` line expression.
///
/// v1.4.0 audit: `validate_info_block` used to accept any non-empty string, so
/// `if_empty(exif.model, )` and `fmt(')` survived loading and then panicked
/// `eval_expr_locale` (CLI exit 101). Validating each line with `validate_expr`
/// alone would fail the other way: 28 of the 204 shipped templates put several
/// expressions on one line joined by ` · `, for example
/// ```text
/// fmt('{focal}MM', exif) · fmt('F{aperture}', exif) · exif.shutter · fmt('ISO{iso}', exif)
/// ```
/// The evaluator returns `None` for such a sequence — the line then falls back
/// to its `fallback` text, which is what those templates have always rendered —
/// so the joiner belongs to the grammar we must accept, not to the errors we
/// must raise. Split quote-aware and validate every atom.
pub fn validate_info_expr(expr: &str) -> Result<()> {
    for atom in split_expr_atoms(expr)? {
        validate_expr(atom)?;
    }
    Ok(())
}

/// Evaluate an expression against EXIF info. Returns None when any
/// referenced field is missing; the template's `fallback` then applies.
pub fn eval_expr(expr: &str, info: &ExifInfo) -> Option<String> {
    eval_expr_locale(expr, info, "")
}

/// v0.6.0: locale-aware expression evaluation. `locale` is `"zh"` or `"en"`
/// (empty = language-neutral ISO-style dates).
pub fn eval_expr_locale(expr: &str, info: &ExifInfo, locale: &str) -> Option<String> {
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
        // v1.5.0 hardening: the fallback must be a quoted literal. `validate_expr`
        // enforces this, but infoBlock expressions historically bypassed it, and
        // slicing a bare `x` / empty string here panicked the renderer.
        if literal.len() < 2 || !literal.starts_with('\'') || !literal.ends_with('\'') {
            return None;
        }
        let literal = &literal[1..literal.len() - 1];
        return Some(
            value
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| literal.to_string()),
        );
    }
    if let Some(rest) = expr.strip_prefix("date(") {
        let inner = rest.strip_suffix(')')?;
        let inner = inner.strip_prefix('\'')?;
        let (format, key) = inner.split_once("', ")?;
        if key != "exif.datetime" {
            return None;
        }
        let raw = info.get("datetime")?;
        let format = match format {
            "LOCAL" if locale == "zh" => "YYYY\u{5e74}M\u{6708}D\u{65e5}",
            "LOCAL" if locale == "en" => "MMMU D, YYYY",
            "LOCAL" => "YYYY.MM.DD",
            other => other,
        };
        return format_exif_date(&raw, format);
    }
    if expr.starts_with("fmt(") && expr.ends_with(')') {
        let inner = &expr[4..expr.len() - 1];
        let close = inner.rfind('\'')?;
        // v1.5.0 hardening: `fmt(')` leaves inner == "'" and close == 0, so the
        // slice below used to panic. A missing terminator is a malformed
        // expression, not a fatal error: return None and let the fallback apply.
        if close < 1 || inner.len() < 2 {
            return None;
        }
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
    let digits: Vec<u32> = raw.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() < 14 {
        return None;
    }
    let num = |slice: &[u32]| -> u32 { slice.iter().fold(0u32, |acc, d| acc * 10 + d) };
    let year = num(&digits[0..4]);
    let month = num(&digits[4..6]);
    let day = num(&digits[6..8]);
    let hour = num(&digits[8..10]);
    let minute = num(&digits[10..12]);
    let second = num(&digits[12..14]);

    const MONTHS: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    let month_name = MONTHS
        .get(month.saturating_sub(1) as usize)
        .copied()
        .unwrap_or("");
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
            "MMMU" => month_name
                .chars()
                .take(3)
                .collect::<String>()
                .to_uppercase(),
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

    const TOKENS: [&str; 13] = [
        "YYYY", "MMMM", "MMMU", "MMM", "MM", "M", "DD", "Do", "D", "HH", "mm", "SS", "WW",
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
    fn local_date_follows_locale() {
        let info = ExifInfo {
            datetime: Some("2026:05:02 15:13:35".into()),
            ..ExifInfo::default()
        };
        let expr = "date('LOCAL', exif.datetime)";
        assert_eq!(
            eval_expr_locale(expr, &info, "zh").as_deref(),
            Some("2026\u{5e74}5\u{6708}2\u{65e5}")
        );
        assert_eq!(
            eval_expr_locale(expr, &info, "en").as_deref(),
            Some("MAY 2, 2026")
        );
        assert_eq!(
            eval_expr_locale(expr, &info, "").as_deref(),
            Some("2026.05.02")
        );
        assert_eq!(eval_expr(expr, &info).as_deref(), Some("2026.05.02"));
    }

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
        assert_eq!(eval_expr(expr, &info).as_deref(), Some("24mm  ISO200"));
        assert_eq!(eval_expr("fmt('{aperture}', exif)", &info), None);
    }

    #[test]
    fn constant_text_expr() {
        assert_eq!(
            eval_expr("'FrameGeist'", &ExifInfo::default()).as_deref(),
            Some("FrameGeist")
        );
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
        assert_eq!(
            eval_expr("date('YYYY-MM-DD', exif.datetime)", &without),
            None
        );
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

    // ---- v1.4.0 audit: `check` used to match only a leading `../` or an inner
    // `/../`, so `..\`, a bare `..`, percent-encoded traversal, absolute paths and
    // foreign URL schemes all sailed through into template strings.
    #[test]
    fn check_rejects_traversal_absolute_paths_and_foreign_schemes() {
        let cases = [
            ("windows backslash traversal", "..\\secret.png"),
            ("bare dot dot", ".."),
            ("trailing dot dot segment", "foo/.."),
            ("inner dot dot segment", "a/../b"),
            ("absolute posix path", "/etc/passwd"),
            ("windows drive path", "C:\\Windows\\system32"),
            ("unc share", "\\\\server\\share"),
            ("percent encoded dots", "%2e%2e/%2e%2e/etc/passwd"),
            ("percent encoded slash", "a%2f..%2fb"),
            ("uppercase percent encoding", "%2E%2E%2F"),
            ("data url", "data:text/html;base64,PHNjcmlwdD4="),
            ("javascript url", "javascript:alert(1)"),
            ("vbscript url", "vbscript:msgbox(1)"),
            ("blob url", "blob:https://example.com/uuid"),
            ("ftp url", "ftp://example.com/x.png"),
            ("file url", "file:///etc/passwd"),
            ("protocol relative", "//evil.example/x.png"),
            ("http url", "http://example.com/x.png"),
            ("https url", "https://example.com/x.png"),
        ];
        for (name, payload) in cases {
            let doc = serde_json::json!({ "layers": [{ "asset": payload }] });
            assert!(
                check(&doc).is_err(),
                "{name} ({payload:?}) must be rejected"
            );
        }
    }

    #[test]
    fn check_accepts_the_strings_real_templates_use() {
        // The tightened rules must not touch these: colons appear inside format
        // patterns and time literals, so a naive "contains `:`" rule would break
        // every single template in the library.
        for payload in [
            "fmt('{focal}mm · f/{aperture} · {shutter} · ISO{iso}', exif)",
            "date('LOCAL', exif.datetime)",
            "date('YYYY-MM-DD HH:mm', exif.datetime)",
            "'12:30'",
            "'f/1.8'",
            "@builtin/brand/{exif.brand_slug}",
            "@builtin/series/sony-gm",
            "FrameGeist photo frame",
        ] {
            let doc = serde_json::json!({ "layers": [{ "asset": payload }] });
            assert!(
                check(&doc).is_ok(),
                "{payload:?} must stay legal, got {:?}",
                check(&doc)
            );
        }
    }

    #[test]
    fn check_bounds_string_length() {
        let ok = "a".repeat(MAX_STRING_LEN);
        assert!(check(&serde_json::json!({ "s": ok })).is_ok());
        let too_long = "a".repeat(MAX_STRING_LEN + 1);
        assert!(check(&serde_json::json!({ "s": too_long })).is_err());
    }
}
