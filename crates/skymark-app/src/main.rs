#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod draft;
mod vault;
mod watcher;

use tauri::{Emitter, Manager};
use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir().map(|d| d.join("drafts")) {
                let _ = draft::gc_old_drafts_in_dir(&dir);
            }
            app.manage(watcher::WatcherState {
                debouncer: std::sync::Mutex::new(None),
            });

            app.on_menu_event(|app, event| {
                match event.id().as_ref() {
                    "new-file" | "open-file" | "open-folder" | "save-file" | "find" => {
                        let _ = app.emit("skymark://menu", event.id().as_ref());
                    }
                    _ => {}
                }
            });

            if let Some(menu) = app.menu() {
                for item in menu.items()? {
                    if let MenuItemKind::Submenu(sub) = item {
                        match sub.text()?.as_str() {
                            "File" => {
                                // Prepend in reverse order so final order is:
                                // New | Open… | Open Folder… | — | Save | — | (existing Close Window)
                                let sep2  = PredefinedMenuItem::separator(app)?;
                                let save  = MenuItem::with_id(app, "save-file",   "Save",          true, Some("CmdOrCtrl+S"))?;
                                let sep1  = PredefinedMenuItem::separator(app)?;
                                let ofol  = MenuItem::with_id(app, "open-folder", "Open Folder…",  true, Some("CmdOrCtrl+Shift+O"))?;
                                let open  = MenuItem::with_id(app, "open-file",   "Open…",         true, Some("CmdOrCtrl+O"))?;
                                let new   = MenuItem::with_id(app, "new-file",    "New",           true, Some("CmdOrCtrl+N"))?;
                                sub.prepend(&sep2)?;
                                sub.prepend(&save)?;
                                sub.prepend(&sep1)?;
                                sub.prepend(&ofol)?;
                                sub.prepend(&open)?;
                                sub.prepend(&new)?;
                            }
                            "Edit" => {
                                // Append after Select All; macOS injects Writing Tools etc. below
                                let sep  = PredefinedMenuItem::separator(app)?;
                                let find = MenuItem::with_id(app, "find", "Find", true, Some("CmdOrCtrl+F"))?;
                                sub.append(&sep)?;
                                sub.append(&find)?;
                            }
                            _ => {}
                        }
                    }
                }
            }

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
            watcher::watch_paths,
            watcher::unwatch_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skymark");
}
