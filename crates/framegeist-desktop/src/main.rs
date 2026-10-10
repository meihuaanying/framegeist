#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use std::path::{Path, PathBuf};

/// Extensions the app is allowed to write. Anything else (`.html`, `.exe`,
/// `.hta`, a bare `.bat`) turns "export a photo" into "drop a payload".
const ALLOWED_EXTS: [&str; 3] = ["jpg", "jpeg", "png"];

/// v1.5.0 audit: `save_to_downloads` joined a caller-supplied name onto
/// `Downloads` and wrote there. The name reached us from the web layer, whose
/// sanitising is a convenience, not a boundary -- `..\\..\\` or an absolute path
/// escaped the download folder entirely. This is the actual boundary.
fn validate_export_filename(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("export filename is empty".into());
    }
    if name.len() > 180 {
        return Err("export filename is too long".into());
    }
    // A filename is one path segment: no separators of either flavour, no drive,
    // no traversal, nothing rooted.
    if name.contains('/') || name.contains('\\') || name.contains(':') {
        return Err(format!("export filename must not contain a path: {name:?}"));
    }
    if name == "." || name == ".." || name.contains("..") {
        return Err(format!("export filename must not traverse: {name:?}"));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err("export filename must not contain control characters".into());
    }
    // Windows rejects these silently-ish or renames behind our back; refusing is
    // clearer than writing `name (1).jpg`.
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return Err(format!(
            "export filename uses a reserved device name: {name:?}"
        ));
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Err(format!(
            "export filename must not end with a space or dot: {name:?}"
        ));
    }
    Ok(())
}

fn extension_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Join `name` onto `dir` and prove the result really is inside it. Both sides
/// are canonicalized first, so neither `..` nor a symlink can walk out.
fn contained_join(dir: &Path, name: &str) -> Result<PathBuf, String> {
    validate_export_filename(name)?;
    let base =
        std::fs::canonicalize(dir).map_err(|e| format!("cannot resolve {}: {e}", dir.display()))?;
    let candidate = base.join(name);
    let parent = candidate
        .parent()
        .ok_or_else(|| "export path has no parent".to_string())?;
    let real_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("cannot resolve {}: {e}", parent.display()))?;
    if !real_parent.starts_with(&base) {
        return Err(format!("export path escapes {}: {name:?}", base.display()));
    }
    Ok(candidate)
}

/// v1.5.0 audit: the path comes back from the native save dialog, which the user
/// controls but a compromised front end could also steer. Require an absolute
/// path with an image extension so a write cannot be redirected at a script.
fn validate_export_path(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if path.is_empty() || !p.is_absolute() {
        return Err(format!("export path must be absolute: {path:?}"));
    }
    if !extension_allowed(p) {
        return Err(format!(
            "export path must end in one of {:?}: {path:?}",
            ALLOWED_EXTS
        ));
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("export path has no file name: {path:?}"))?;
    validate_export_filename(name)?;
    Ok(p.to_path_buf())
}

#[tauri::command]
fn save_file(path: String, b64: String) -> Result<(), String> {
    let target = validate_export_path(&path)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&target, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_to_downloads(filename: String, b64: String) -> Result<String, String> {
    let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
    let dir = std::path::PathBuf::from(home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = contained_join(&dir, &filename)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file, save_to_downloads])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("framegeist-desktop failed to start: {e}");
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_filenames_reject_traversal_and_separators() {
        for name in [
            "..",
            "../evil.jpg",
            "..\\evil.jpg",
            "sub/evil.jpg",
            "sub\\evil.jpg",
            "C:evil.jpg",
            "\\\\server\\share\\evil.jpg",
            "",
            " ",
            "evil.jpg\x00.png",
            "evil. ",
        ] {
            assert!(
                validate_export_filename(name).is_err(),
                "{name:?} must be rejected"
            );
        }
        assert!(validate_export_filename("framegeist_001.jpg").is_ok());
        assert!(validate_export_filename("a.b.PNG").is_ok());
    }

    #[test]
    fn export_filenames_reject_windows_device_names() {
        for name in ["CON", "con.jpg", "NUL.png", "com1.jpg"] {
            assert!(
                validate_export_filename(name).is_err(),
                "{name:?} must be rejected"
            );
        }
    }

    #[test]
    fn export_paths_must_be_absolute_images() {
        assert!(validate_export_path("out.jpg").is_err(), "relative");
        assert!(validate_export_path("").is_err(), "empty");
        let tmp = std::env::temp_dir();
        assert!(
            validate_export_path(&tmp.join("out.html").display().to_string()).is_err(),
            "html"
        );
        assert!(
            validate_export_path(&tmp.join("out.exe").display().to_string()).is_err(),
            "exe"
        );
        assert!(
            validate_export_path(&tmp.join("out.jpg").display().to_string()).is_ok(),
            "an absolute .jpg path is what the save dialog hands us"
        );
    }

    #[test]
    fn contained_join_stays_inside_the_directory() {
        let base = std::env::temp_dir().join(format!("fg-dl-{}", std::process::id()));
        let dir = base.join("Downloads");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(contained_join(&dir, "framegeist_001.jpg").is_ok());
        assert!(contained_join(&dir, "../evil.jpg").is_err());
        assert!(contained_join(&dir, "..\\evil.jpg").is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
