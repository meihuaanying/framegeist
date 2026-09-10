#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;

#[tauri::command]
fn save_file(path: String, b64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_to_downloads(filename: String, b64: String) -> Result<String, String> {
    let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
    let dir = std::path::PathBuf::from(home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(filename);
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
