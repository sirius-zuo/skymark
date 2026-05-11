#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod draft;
mod menu;
mod storage;
mod vault;
mod watcher;

use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir().map(|d| d.join("drafts")) {
                let _ = draft::gc_old_drafts_in_dir(&dir);
            }
            app.manage(storage::StdStorage);
            app.manage(draft::DraftState {
                write_lock: std::sync::Mutex::new(()),
            });
            app.manage(watcher::WatcherState {
                debouncer: std::sync::Mutex::new(None),
                watched_paths: std::sync::Mutex::new(std::collections::HashSet::new()),
            });

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "new-file" | "open-file" | "open-folder" | "save-file" | "find" => {
                    let _ = app.emit("skymark://menu", event.id().as_ref());
                }
                _ => {}
            });

            menu::build_menu(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::render,
            commands::open_file,
            commands::save_file,
            commands::export_file,
            draft::save_draft,
            draft::load_draft,
            draft::list_drafts,
            draft::discard_draft,
            vault::scan_vault,
            watcher::add_watch,
            watcher::remove_watch,
            watcher::clear_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skymark");
}
