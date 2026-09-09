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
///   exif.<key>          direct EXIF field
///   fmt('<literal>', exif)  format string with {key} placeholders
pub fn validate_expr(expr: &str) -> Result<()> {
    if let Some(key) = expr.strip_prefix("exif.") {
        if is_ident(key) {
            return Ok(());
        }
        return Err(Error::SandboxViolation(format!(
            "invalid exif key in expr {expr:?}"
        )));
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
    if let Some(key) = expr.strip_prefix("exif.") {
        return info.get(key);
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
    fn validate_expr_rejects_injection() {
        assert!(validate_expr("http://evil").is_err());
        assert!(validate_expr("exif.UPPER").is_err());
        assert!(validate_expr("fmt('a'); drop").is_err());
        assert!(validate_expr("fmt('{../path}', exif)").is_err());
        assert!(validate_expr("system('rm -rf')").is_err());
    }
}
