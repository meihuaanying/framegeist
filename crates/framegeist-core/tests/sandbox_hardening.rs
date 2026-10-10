//! v1.4.0 audit regression: sandbox must reject malformed expressions and must
//! never panic, no matter how hostile the template text is.
//!
//! Before the fix, `validate_exprs` only walked `Layer::Text`, so info-block
//! lines were never validated; `text_fit::block_lines` then handed them straight
//! to `eval_expr_locale`, where the `if_empty` / `fmt` branches sliced string
//! ranges out of bounds. `if_empty(exif.model, )`, `if_empty(exif.model, x)`
//! and `fmt(')` each panicked the whole render (CLI exit 101).
//!
//! Both layers are asserted here: the load-time whitelist (so a malicious
//! template is rejected before rendering) and the evaluator itself (so no
//! reachable input can panic even if validation is ever bypassed).

use framegeist_core::{load_template_from_str, sandbox, Error};

/// A complete, valid template whose only variable part is the info-block line
/// expression. Built in memory: the gate forbids depending on gitignored
/// derived files, and a fixture keeps the regression hermetic.
fn template_with_line_expr(expr: &str) -> String {
    format!(
        r##"{{
  "meta": {{
    "id": "sandbox-hardening", "name": "Sandbox hardening", "version": "1.0.0",
    "minEngineVersion": "1.0.0", "author": "t", "license": "CC0-1.0",
    "category": "minimal"
  }},
  "canvas": {{
    "mode": "extend",
    "background": {{ "type": "solid", "color": "#101418" }},
    "padding": {{ "bottom": 0.26 }}
  }},
  "layers": [],
  "infoBlock": {{
    "side": "bottom",
    "font": {{ "family": ["Inter"] }},
    "lines": [ {{ "expr": {expr}, "fallback": "framegeist", "role": "detail" }} ]
  }}
}}"##,
        expr = serde_json::to_string(expr).unwrap()
    )
}

/// The three payloads that reproduced the panic, plus close relatives.
const PANIC_PAYLOADS: [&str; 6] = [
    "if_empty(exif.model, )",
    "if_empty(exif.model, x)",
    "fmt(')",
    "fmt('",
    "if_empty(",
    "'",
];

#[test]
fn info_block_lines_are_validated_at_load_time() {
    for payload in PANIC_PAYLOADS {
        let err = load_template_from_str(&template_with_line_expr(payload))
            .err()
            .unwrap_or_else(|| panic!("payload {payload:?} must be rejected at load time"));
        assert!(
            matches!(err, Error::SchemaViolation(_) | Error::SandboxViolation(_)),
            "payload {payload:?} produced the wrong error kind: {err:?}"
        );
        // The message must name the offending line so the failure is actionable.
        let text = err.to_string();
        assert!(
            text.contains("infoBlock.lines[0].expr"),
            "payload {payload:?} error should point at the line: {text}"
        );
    }
}

#[test]
fn evaluator_never_panics_on_malformed_expressions() {
    let info = framegeist_core::exif::ExifInfo::default();
    let mut cases: Vec<String> = PANIC_PAYLOADS.iter().map(|s| s.to_string()).collect();
    // More shapes that reach the slicing code through different branches.
    // NB: `''` is *valid* (an empty literal) and deliberately absent here.
    cases.extend(
        [
            "fmt('{}', exif)",
            "if_empty(exif.model, ')",
            "if_empty(, 'x')",
            "date('",
            "date('LOCAL'",
            "exif.",
            "fmt('{}', )",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    // Pathologically nested input: used to be able to drive very deep recursion.
    for expr in &cases {
        // If this panicked the test binary would abort; reaching the assertion is
        // the contract. Malformed input must simply produce no value.
        let out = sandbox::eval_expr_locale(expr, &info, "zh");
        assert!(
            out.is_none(),
            "malformed expression {expr:?} should evaluate to None, got {out:?}"
        );
    }

    // Pathologically large / deeply nested but syntactically well-formed input.
    // The evaluator must stay total; the *size* bound belongs to `check`, so here
    // only "does not panic" is asserted.
    let heavy = [
        format!("'{}'", "a".repeat(70_000)),
        format!("fmt('{}', exif)", "{focal}".repeat(2048)),
        format!("if_empty(exif.model, '{}')", "c".repeat(70_000)),
    ];
    for expr in &heavy {
        let _ = sandbox::eval_expr_locale(expr, &info, "zh");
    }
    // ...and the size bound itself is enforced where it belongs.
    assert!(
        sandbox::check(&serde_json::json!({ "s": "a".repeat(sandbox::MAX_STRING_LEN + 1) }))
            .is_err(),
        "a string past MAX_STRING_LEN must be rejected by check()"
    );
}

#[test]
fn legal_expressions_keep_working() {
    let info = framegeist_core::exif::ExifInfo {
        model: Some("ILCE-7RM3".into()),
        focal_mm: Some(35.0),
        ..framegeist_core::exif::ExifInfo::default()
    };

    assert_eq!(
        sandbox::eval_expr_locale("if_empty(exif.model, 'Unknown Camera')", &info, "zh"),
        Some("ILCE-7RM3".into())
    );
    assert_eq!(
        sandbox::eval_expr_locale("fmt('{focal}mm', exif)", &info, "zh"),
        Some("35mm".into())
    );
    assert_eq!(
        sandbox::eval_expr_locale("'framegeist'", &info, "zh"),
        Some("framegeist".into())
    );
    // A date expression over a non-datetime input yields no value rather than a panic.
    assert_eq!(
        sandbox::eval_expr_locale("date('LOCAL', exif.datetime)", &info, "zh"),
        None
    );

    let info2 = framegeist_core::exif::ExifInfo {
        datetime: Some("20260914123045".into()),
        ..framegeist_core::exif::ExifInfo::default()
    };
    // 'LOCAL' means "locale default", whose exact pattern is locale-dependent, so
    // only assert it produced the right day; the deterministic case is below.
    let local = sandbox::eval_expr_locale("date('LOCAL', exif.datetime)", &info2, "zh")
        .expect("a valid datetime must format under 'LOCAL'");
    assert!(
        local.contains("2026") && local.contains("14"),
        "'LOCAL' date should name the day, got {local:?}"
    );
    assert_eq!(
        sandbox::eval_expr_locale("date('YYYY/MM/DD', exif.datetime)", &info2, "zh"),
        Some("2026/09/14".into())
    );

    // And the whole template with a legal info-block line still loads.
    assert!(load_template_from_str(&template_with_line_expr(
        "fmt('{focal}mm f/{aperture}', exif)"
    ))
    .is_ok());
}

/// U+00B7 MIDDLE DOT with one space each side -- the joiner 28 shipped templates
/// use to put several expressions on one info line.
const JOIN: &str = " \u{b7} ";

#[test]
fn joined_expressions_are_accepted_because_the_library_uses_them() {
    // Every shape found in the 204 shipped templates, verbatim.
    for expr in [
        "exif.model_pretty \u{b7} exif.lens",
        "exif.lens \u{b7} date('LOCAL', exif.datetime)",
        "exif.gps_latlon \u{b7} fmt('ALT {gps_alt}', exif)",
        "fmt('{focal}MM', exif) \u{b7} fmt('F{aperture}', exif) \u{b7} exif.shutter \u{b7} fmt('ISO{iso}', exif)",
        // The joiner also appears *inside* literals; that must not split them.
        "fmt('01 \u{b7} CAMERA \u{b7} {model_pretty}', exif) \u{b7} '05 \u{b7} LIGHT \u{b7} NOTES'",
    ] {
        assert!(
            sandbox::validate_info_expr(expr).is_ok(),
            "{expr:?} must stay valid: {:?}",
            sandbox::validate_info_expr(expr)
        );
        assert!(
            load_template_from_str(&template_with_line_expr(expr)).is_ok(),
            "{expr:?} must load"
        );
    }
    // Surrounding whitespace is trimmed, so a double-spaced joiner is fine.
    assert!(sandbox::validate_info_expr("exif.model  \u{b7}  exif.lens").is_ok());
    // The split is only for validation: the evaluator still treats the whole line
    // as one expression, returns None, and the line falls back -- exactly the
    // behaviour these templates have always had.
    let info = framegeist_core::exif::ExifInfo::default();
    assert_eq!(
        sandbox::eval_expr_locale(&format!("exif.model{JOIN}exif.lens"), &info, "zh"),
        None
    );
}

#[test]
fn malformed_joiners_and_atoms_are_rejected() {
    for expr in [
        // Joiner must be exactly " · " on at least one side of the dot; atoms are
        // trimmed, so extra whitespace is tolerated (a formatting variation, not
        // a smuggling vector) but a bare dot is not.
        "exif.model \u{b7}exif.lens",
        "exif.model\u{b7} exif.lens",
        "exif.model\u{b7}exif.lens",
        "exif.model \u{b7}\u{b7} exif.lens",
        // Empty atom.
        "\u{b7} exif.lens",
        "exif.model \u{b7} ",
        // One bad atom poisons the line.
        "exif.model \u{b7} fmt(')",
        "exif.model \u{b7} exif.UPPER",
        "exif.model \u{b7} if_empty(exif.model, x)",
    ] {
        assert!(
            sandbox::validate_info_expr(expr).is_err(),
            "{expr:?} must be rejected"
        );
        let err = load_template_from_str(&template_with_line_expr(expr))
            .expect_err("{expr:?} must not load");
        assert!(
            matches!(err, Error::SchemaViolation(_) | Error::SandboxViolation(_)),
            "{expr:?}: wrong error kind {err:?}"
        );
    }
}

#[test]
fn empty_and_blank_line_expressions_are_still_rejected() {
    for expr in ["", "   ", "\t"] {
        let err = load_template_from_str(&template_with_line_expr(expr)).unwrap_err();
        assert!(
            matches!(err, Error::SchemaViolation(_) | Error::SandboxViolation(_)),
            "blank expr {expr:?} should be rejected, got {err:?}"
        );
    }
}
