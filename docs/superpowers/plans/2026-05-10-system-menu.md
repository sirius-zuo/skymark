# System Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add File menu items (New, Open…, Open Folder…, Save) and an Edit menu Find item to Skymark's native OS menu bar by augmenting the existing Tauri 2 default menu.

**Architecture:** In `setup()`, register an `on_menu_event` handler that emits a `"skymark://menu"` event with the item ID, then walk the existing default menu's submenus and prepend/append custom items into "File" and "Edit". On the frontend, a static `listen` call routes the five payload strings to handlers that already exist (the same code used by keyboard shortcuts).

**Tech Stack:** Rust (Tauri 2 menu API: `MenuItem`, `PredefinedMenuItem`, `MenuItemKind`), TypeScript (`@tauri-apps/api/event` listen, `@codemirror/search` openSearchPanel).

---

## File Map

| Action | Path |
|--------|------|
| Modify | `crates/skymark-app/src/main.rs` |
| Modify | `frontend/src/main.ts` |

---

### Task 1: Rust — menu event handler and augmentation

Augment the default Tauri menu inside `setup()`: wire `on_menu_event` to emit `"skymark://menu"` events, then insert items into the existing File and Edit submenus.

**Files:**
- Modify: `crates/skymark-app/src/main.rs`

---

- [ ] **Step 1: Add the menu-related imports at the top of `main.rs`**

Open `crates/skymark-app/src/main.rs`. Replace the existing `use tauri::Manager;` line with:

```rust
use tauri::{Emitter, Manager};
use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};
```

The full top of the file should now read:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod draft;
mod vault;
mod watcher;

use tauri::{Emitter, Manager};
use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};
```

- [ ] **Step 2: Verify the import compiles**

Run:
```bash
cargo check -p skymark-app
```
Expected: no errors (there are no callers yet, so unused-import warnings are fine at this stage).

- [ ] **Step 3: Add `on_menu_event` handler and menu augmentation inside `setup()`**

Replace the entire `setup` closure in `main.rs` with the following. Everything before `Ok(())` is new:

```rust
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
```

- [ ] **Step 4: Verify the Rust code compiles cleanly**

Run:
```bash
cargo check -p skymark-app
```
Expected: `Finished` with no errors.

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-app/src/main.rs
git commit -m "feat: augment native OS menu with File and Edit items"
```

---

### Task 2: Frontend — menu event listener

Add a `listen("skymark://menu", …)` handler in `main.ts` that routes the five menu action payloads to the existing handler functions already used by keyboard shortcuts.

**Files:**
- Modify: `frontend/src/main.ts`

---

- [ ] **Step 1: Add static imports at the top of `main.ts`**

After line 14 (`import { invoke } from "@tauri-apps/api/core";`), insert two new import lines:

```ts
import { listen } from "@tauri-apps/api/event";
import { openSearchPanel } from "@codemirror/search";
```

The import block around those lines should look like:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openSearchPanel } from "@codemirror/search";
import { initTheme, toggleTheme, onThemeChange } from "./theme";
```

- [ ] **Step 2: Verify imports compile**

Run:
```bash
npm run build
```
Expected: build succeeds. (Both packages exist in `node_modules` already; if `@codemirror/search` is not found, run `npm install` first.)

- [ ] **Step 3: Add the menu listener block after the watcher events section**

After the closing `}` of the watcher events `if (isTauri())` block (currently around line 354), add a new section:

```ts
// ---- Menu events -----------------------------------------------------------

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

`editor`, `preview`, `files`, and `openVault` are all in scope at this point in the module.

- [ ] **Step 4: Verify TypeScript compiles and bundle builds**

Run:
```bash
npm run build
```
Expected: `dist/` produced with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat: wire frontend menu event listener to existing handlers"
```

---

### Task 3: Manual verification

Launch the app and confirm each menu item and keyboard shortcut works end-to-end.

**Prerequisites:** Task 1 and Task 2 must be complete and committed.

---

- [ ] **Step 1: Launch the app in dev mode**

Run:
```bash
npm run tauri:dev
```
Wait for the app window to open.

- [ ] **Step 2: Verify File menu layout**

Open the File menu in the macOS menu bar.

Expected order:
```
New          ⌘N
Open…        ⌘O
Open Folder… ⇧⌘O
─────────────────
Save         ⌘S
─────────────────
Close Window ⌘W
```

- [ ] **Step 3: Verify Edit menu layout**

Open the Edit menu.

Expected: Undo, Redo, Cut, Copy, Paste, Select All are present (existing items), followed by a separator, then **Find ⌘F**. Writing Tools / Dictation / Emoji & Symbols (macOS-injected) still appear below.

- [ ] **Step 4: Test File > New (⌘N)**

Click File > New (or press ⌘N). Expected: editor clears, title bar shows "Untitled", dirty indicator hidden.

- [ ] **Step 5: Test File > Open… (⌘O)**

Click File > Open… (or press ⌘O). Expected: system file picker opens. Select a `.md` file. Expected: editor and preview update with the file contents.

- [ ] **Step 6: Test File > Open Folder… (⇧⌘O)**

Click File > Open Folder… (or press ⇧⌘O). Expected: folder picker opens. Select a folder. Expected: sidebar and file tree appear.

- [ ] **Step 7: Test File > Save (⌘S)**

Type something in the editor, then click File > Save (or press ⌘S). Expected: system save dialog (if new document) or file saved silently (if existing path).

- [ ] **Step 8: Test Edit > Find (⌘F)**

Click Edit > Find (or press ⌘F). Expected: CodeMirror search panel opens at the bottom of the editor pane.

- [ ] **Step 9: Confirm existing Edit items still work**

Press ⌘Z (Undo), ⌘X (Cut), ⌘C (Copy), ⌘V (Paste). Expected: all function normally.
