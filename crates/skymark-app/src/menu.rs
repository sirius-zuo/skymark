//! Menu construction for Skymark.

use tauri::{menu::IsMenuItem, menu::PredefinedMenuItem, App};

/// File menu: New | Open... | sep | Save | sep | Print...
/// Edit menu: Find (appended after Select All)
pub fn build_menu(app: &App) -> Result<(), tauri::Error> {
    if let Some(menu) = app.menu() {
        for item in menu.items()? {
            if let tauri::menu::MenuItemKind::Submenu(sub) = item.kind() {
                if let "File" = sub.text()?.as_str() {
                    let print = tauri::menu::MenuItem::with_id(
                        app,
                        "print-file",
                        "Print\u{2026}",
                        true,
                        Some("CmdOrCtrl+P"),
                    )?;
                    let sep2 = PredefinedMenuItem::separator(app)?;
                    let save = tauri::menu::MenuItem::with_id(
                        app,
                        "save-file",
                        "Save",
                        true,
                        Some("CmdOrCtrl+S"),
                    )?;
                    let sep1 = PredefinedMenuItem::separator(app)?;
                    let open = tauri::menu::MenuItem::with_id(
                        app,
                        "open-file",
                        "Open\u{2026}",
                        true,
                        Some("CmdOrCtrl+O"),
                    )?;
                    let new = tauri::menu::MenuItem::with_id(
                        app,
                        "new-file",
                        "New",
                        true,
                        Some("CmdOrCtrl+N"),
                    )?;
                    sub.prepend(&print)?;
                    sub.prepend(&sep2)?;
                    sub.prepend(&save)?;
                    sub.prepend(&sep1)?;
                    sub.prepend(&open)?;
                    sub.prepend(&new)?;
                } else if let "Edit" = sub.text()?.as_str() {
                    let sep = PredefinedMenuItem::separator(app)?;
                    let find = tauri::menu::MenuItem::with_id(
                        app,
                        "find",
                        "Find",
                        true,
                        Some("CmdOrCtrl+F"),
                    )?;
                    sub.append(&sep)?;
                    sub.append(&find)?;
                }
            }
        }
    }
    Ok(())
}
