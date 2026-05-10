# System Menu — Design Spec

**Date:** 2026-05-10
**Scope:** Augment the existing native OS menu bar with File menu actions (New, Open, Open Folder, Save) and an Edit menu Find item.

---

## Goals

- **File menu:** Add New, Open…, Open Folder…, Save to the existing File submenu.
- **Edit menu:** Add Find (opens the CodeMirror search panel) to the existing Edit submenu.
- Preserve every item already present in Tauri 2's default menu (Skymark app menu, View, Window, Help, and all standard Edit items). macOS-injected items (Writing Tools, Dictation, Emoji & Symbols) are unaffected.

---

## Out of Scope

- Rebuilding or replacing the default Tauri menu
- Menu item enable/disable based on document state
- Any menus beyond File and Edit
- Windows/Linux platform differences in accelerator label display (handled automatically by Tauri)

---

## Architecture

Two layers:

1. **Rust (`crates/skymark-app/src/main.rs`):** Inside `setup()`, call `app.on_menu_event()` to register the event handler, then call `app.menu()` to get the existing default menu. Iterate the top-level `MenuItemKind::Submenu` items, match on `.text()` for `"File"` and `"Edit"`, and insert/append custom `MenuItem` items plus `PredefinedMenuItem::separator` items. Set `app.set_menu(menu)` is not required — the existing menu object is mutated in place via `prepend`/`append`.

2. **Frontend (`frontend/src/main.ts`):** Add one `listen("skymark://menu", ...)` call (wrapped in `isTauri()`) after the editor is created. Route the five action payloads to the existing handler code that is already used by the keyboard shortcut handler. Find calls `openSearchPanel(editor.view)` imported from `@codemirror/search`.

---

## Components

### `crates/skymark-app/src/main.rs`

**Menu event handler** — registered before menu augmentation in `setup()`:

```rust
app.on_menu_event(|app, event| {
    match event.id().as_ref() {
        "new-file" | "open-file" | "open-folder" | "save-file" | "find" => {
            let _ = app.emit("skymark://menu", event.id().as_ref());
        }
        _ => {} // PredefinedMenuItem clicks are OS-handled; they do not reach here
    }
});
```

**Menu augmentation** — also in `setup()`, after the event handler:

```rust
use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};

if let Some(menu) = app.menu() {
    for item in menu.items()? {
        if let MenuItemKind::Submenu(sub) = item {
            match sub.text()?.as_str() {
                "File" => {
                    // Prepend in reverse order so final order is:
                    // New | Open… | Open Folder… | — | Save | — | (existing Close Window)
                    let sep2  = PredefinedMenuItem::separator(app)?;
                    let save  = MenuItem::with_id(app, "save-file",   "Save",           true, Some("CmdOrCtrl+S"))?;
                    let sep1  = PredefinedMenuItem::separator(app)?;
                    let ofol  = MenuItem::with_id(app, "open-folder", "Open Folder…",   true, Some("CmdOrCtrl+Shift+O"))?;
                    let open  = MenuItem::with_id(app, "open-file",   "Open…",          true, Some("CmdOrCtrl+O"))?;
                    let new   = MenuItem::with_id(app, "new-file",    "New",            true, Some("CmdOrCtrl+N"))?;
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
```

No new imports beyond `tauri::menu::*`; `tauri::Emitter` is already used by the file-watcher code.

### `frontend/src/main.ts`

Add one import and one `listen` block. The import goes with the existing Tauri API imports at the top. The listen call goes after `createEditor` (so `editor` is in scope), wrapped in `isTauri()`:

```ts
import { listen } from "@tauri-apps/api/event";
import { openSearchPanel } from "@codemirror/search";
```

```ts
if (isTauri()) {
  void listen<string>("skymark://menu", ({ payload }) => {
    switch (payload) {
      case "new-file":
        editor.setValue("");
        preview.update("");
        files.newDocument();
        break;
      case "open-file":
        void files.openInteractive().then((content) => {
          if (content !== null) { editor.setValue(content); preview.update(content); }
        });
        break;
      case "open-folder":
        void openVault();
        break;
      case "save-file":
        void files.saveInteractive(editor.getValue());
        break;
      case "find":
        openSearchPanel(editor.view);
        break;
    }
  });
}
```

`openVault` and `files`/`editor`/`preview` are already in scope at this point in `main.ts`.

---

## Data Flow

**Example — File > Save (⌘S):**
1. User clicks menu item (or presses ⌘S, intercepted at OS level)
2. Tauri fires `on_menu_event` with id `"save-file"`
3. Rust: `app.emit("skymark://menu", "save-file")`
4. Frontend `listen` handler matches `"save-file"` → `files.saveInteractive(editor.getValue())`

**Example — Edit > Find (⌘F):**
1. User clicks menu item (or presses ⌘F)
2. `on_menu_event` fires with id `"find"`
3. Rust emits `"skymark://menu"` / `"find"`
4. Frontend handler calls `openSearchPanel(editor.view)` — CodeMirror opens its search panel

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `app.menu()` returns `None` (should not occur in practice) | `if let Some` guard — augmentation silently skipped; keyboard shortcuts still work |
| Menu item `?` propagation in `setup()` | Setup returns `tauri::Error`; app fails to start with a logged error (same as current error handling) |
| `listen` fires before editor is ready | Impossible — `listen` is called after `createEditor`; JS is single-threaded |
| `openVault` not available | `openVault` is a function defined in `main.ts` scope; always available |

---

## File Map

| Action | Path |
|--------|------|
| Modify | `crates/skymark-app/src/main.rs` |
| Modify | `frontend/src/main.ts` |

---

## Testing

**Manual verification:**
1. Launch app → File menu shows: New ⌘N, Open… ⌘O, Open Folder… ⌘⇧O, separator, Save ⌘S, separator, Close Window
2. Edit menu shows: Undo, Redo, Cut, Copy, Paste, Select All, separator, Find ⌘F (Writing Tools etc. still present below)
3. File > New clears editor, removes path from title bar
4. File > Open… shows the file picker dialog; loading a file updates editor and preview
5. File > Open Folder… opens the folder/vault picker
6. File > Save saves current file (prompts for path if unsaved new document)
7. Edit > Find opens the CodeMirror search panel in the editor
8. Keyboard shortcuts ⌘N / ⌘O / ⌘⇧O / ⌘S / ⌘F all continue working (both via menu and directly)
9. All existing Edit items (Undo, Redo, Cut, Copy, Paste, Select All, Writing Tools) still function
