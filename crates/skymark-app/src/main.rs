#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod draft;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir().map(|d| d.join("drafts")) {
                let _ = draft::gc_old_drafts_in_dir(&dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::render,
            commands::open_file,
            commands::save_file,
            draft::save_draft,
            draft::load_draft,
            draft::list_drafts,
            draft::discard_draft,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skymark");
}
