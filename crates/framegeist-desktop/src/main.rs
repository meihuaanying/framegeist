#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("framegeist-desktop failed to start: {e}");
            std::process::exit(1);
        });
}
