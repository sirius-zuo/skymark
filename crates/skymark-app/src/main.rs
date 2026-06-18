#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod dir;
mod draft;
#[cfg(target_os = "macos")]
mod macos_open;
mod menu;
mod storage;
mod watcher;

use tauri::{Emitter, Manager};

struct PendingOpen(std::sync::Mutex<Option<String>>);

#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
fn get_app_version() -> String {
    std::env::var("TAURI_PACKAGE_VERSION").unwrap_or_else(|_| "0.0.0".to_string())
}

fn main() {
    tauri::Builder::default()
        // Managed here (not in setup) so it's available before RunEvent::Opened fires,
        // which on macOS can happen before the setup closure runs.
        .manage(PendingOpen(std::sync::Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Ok(d) = app.path().app_data_dir().map(|d| d.join("drafts")) {
                let _ = draft::gc_old_drafts_in_dir(&d);
            }
            app.manage(storage::StdStorage);
            app.manage(draft::DraftState {
                write_lock: std::sync::Mutex::new(()),
            });
            app.manage(watcher::WatcherState {
                debouncer: std::sync::Mutex::new(None),
                watched_paths: std::sync::Mutex::new(std::collections::HashSet::new()),
                mtimes: std::sync::Arc::new(
                    std::sync::Mutex::new(std::collections::HashMap::new()),
                ),
            });

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "new-file" | "open-file" | "save-file" | "find" | "print-file"
                | "close-all-tabs" | "check-for-updates" => {
                    let _ = app.emit("skymark://menu", event.id().as_ref());
                }
                _ => {}
            });

            menu::build_menu(app)?;
            #[cfg(target_os = "macos")]
            macos_open::install(app.handle());
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
            dir::list_dir,
            watcher::add_watch,
            watcher::remove_watch,
            watcher::clear_all,
            take_pending_open,
            get_app_version,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Skymark")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                use std::io::Write as _;
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open("/tmp/skymark_ae.log")
                {
                    let _ = writeln!(
                        f,
                        "[pid={}] RunEvent::Opened: {} url(s)",
                        std::process::id(),
                        urls.len()
                    );
                }
                for url in urls {
                    if url.scheme() == "file" {
                        if let Ok(path) = url.to_file_path() {
                            let path_str = path.to_string_lossy().into_owned();
                            if let Some(state) = _app_handle.try_state::<PendingOpen>() {
                                *state.0.lock().unwrap() = Some(path_str.clone());
                            }
                            // Do NOT emit skymark://open-file here. On macOS,
                            // macos_open.rs handles the Apple Event and emits it.
                            // Emitting from both places causes two concurrent
                            // openFileByPath calls for the same file on each open.
                            break;
                        }
                    }
                }
            }
        });
}
