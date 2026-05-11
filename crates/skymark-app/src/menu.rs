//! Menu construction for Skymark.
//!
//! Extracted from `main.rs` to reduce its size and isolate menu logic.

use tauri::{App, menu::IsMenuItem, menu::PredefinedMenuItem};

/// Build and prepend/append menu items to the app menu.
///
/// File menu: New | Open… | Open Folder… | — | Save | — (reverse-prepend)
/// Edit menu: Find (append after Select All)
pub fn build_menu(app: &App) -> Result<(), tauri::Error> {
    if let Some(menu) = app.menu() {
        for item in menu.items()? {
            match item.kind() {
                tauri::menu::MenuItemKind::Submenu(sub) => {
                    match sub.text()?.as_str() {
                        "File" => {
                            let sep2 = PredefinedMenuItem::separator(app)?;
                            let save = tauri::menu::MenuItem::with_id(
                                app, "save-file", "Save", true, Some("CmdOrCtrl+S"),
                            )?;
                            let sep1 = PredefinedMenuItem::separator(app)?;
                            let ofol = tauri::menu::MenuItem::with_id(
                                app, "open-folder", "Open Folder…", true, Some("CmdOrCtrl+Shift+O"),
                            )?;
                            let open = tauri::menu::MenuItem::with_id(
                                app, "open-file", "Open…", true, Some("CmdOrCtrl+O"),
                            )?;
                            let new = tauri::menu::MenuItem::with_id(
                                app, "new-file", "New", true, Some("CmdOrCtrl+N"),
                            )?;
                            sub.prepend(&sep2)?;
                            sub.prepend(&save)?;
                            sub.prepend(&sep1)?;
                            sub.prepend(&ofol)?;
                            sub.prepend(&open)?;
                            sub.prepend(&new)?;
                        }
                        "Edit" => {
                            let sep = PredefinedMenuItem::separator(app)?;
                            let find = tauri::menu::MenuItem::with_id(
                                app, "find", "Find", true, Some("CmdOrCtrl+F"),
                            )?;
                            sub.append(&sep)?;
                            sub.append(&find)?;
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}
