use framegeist_core::{load_template_from_str, Error};

const VALID: &str = r##"{
  "meta": {
    "id": "test-template", "name": "Test", "version": "0.1.0",
    "minEngineVersion": "0.1.0", "author": "t", "license": "CC0-1.0",
    "category": "minimal"
  },
  "canvas": { "mode": "overlay" },
  "layers": [
    {
      "type": "text", "id": "a", "anchor": "bottom-left",
      "font": { "family": ["JetBrains Mono"], "size": 0.03, "color": "#111111" },
      "content": [ { "expr": "exif.model", "fallback": "n/a" } ]
    }
  ]
}"##;

fn valid_with_layer_expr(expr: &str) -> String {
    VALID.replace("exif.model", expr)
}

#[test]
fn valid_template_loads() {
    let t = load_template_from_str(VALID).expect("valid template must load");
    assert_eq!(t.meta.id, "test-template");
    assert_eq!(t.layers.len(), 1);
}

#[test]
fn unknown_field_rejected() {
    let bad = VALID.replace("\"overlay\"", "\"overlay\", \"hax\": 1");
    assert!(matches!(
        load_template_from_str(&bad),
        Err(Error::SchemaViolation(_) | Error::TemplateJson(_))
    ));
}

#[test]
fn network_reference_rejected() {
    let bad = valid_with_layer_expr("exif.model");
    let bad = bad.replace("\"Test\"", "\"Test http://evil.example\"");
    assert!(matches!(
        load_template_from_str(&bad),
        Err(Error::SandboxViolation(_))
    ));
}

#[test]
fn path_traversal_rejected() {
    let bad = valid_with_layer_expr("exif.model");
    let bad = bad.replace("\"Test\"", "\"../../etc/passwd\"");
    assert!(matches!(
        load_template_from_str(&bad),
        Err(Error::SandboxViolation(_))
    ));
}

#[test]
fn non_whitelisted_expr_rejected() {
    let bad = valid_with_layer_expr("fs.read('/etc/passwd')");
    assert!(matches!(
        load_template_from_str(&bad),
        Err(Error::SandboxViolation(_))
    ));
}

#[test]
fn uppercase_exif_key_rejected() {
    let bad = valid_with_layer_expr("exif.Model");
    assert!(matches!(
        load_template_from_str(&bad),
        Err(Error::SandboxViolation(_))
    ));
}

#[test]
fn oversized_template_rejected() {
    let big = format!("{}{}", "// pad\n".repeat(0), VALID);
    let huge: String = big
        .replace("\"Test\"", &format!("\"{}\"", "x".repeat(300 * 1024)));
    assert!(matches!(
        load_template_from_str(&huge),
        Err(Error::TemplateTooLarge { .. })
    ));
}

#[test]
fn invalid_category_rejected() {
    let bad = VALID.replace("\"minimal\"", "\"not-a-category\"");
    assert!(matches!(
        load_template_from_str(&bad),
        Err(Error::SchemaViolation(_) | Error::TemplateJson(_))
    ));
}

#[test]
fn empty_content_rejected() {
    let bad = valid_with_layer_expr("exif.model");
    let bad = bad.replace(
        "[ { \"expr\": \"exif.model\", \"fallback\": \"n/a\" } ]",
        "[ ]",
    );
    assert!(matches!(
        load_template_from_str(&bad),
        Err(Error::SchemaViolation(_))
    ));
}
