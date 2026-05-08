# Skymark Phase 3 — Vault Mode Design Spec

- **Date:** 2026-05-07
- **Status:** Approved
- **Owner:** jinzuo

## 1. Goal

Add vault mode to Skymark: open a folder, browse its Markdown files in a sidebar file tree, and jump between files with a fuzzy search palette (`Cmd/Ctrl+P`). Single-file mode (Phase 1+2) is unchanged.

## 2. Scope

### In scope

- `Cmd+Shift+O` opens a folder picker and enters vault mode.
- Sidebar file tree: flat list of `.md`/`.markdown`/`.txt` files grouped by directory, collapsible, sorted alphabetically.
- One file open at a time — the tree is a file switcher, not a tab bar.
- `Cmd+P` fuzzy search palette: filters filenames and relative paths, keyboard-navigable.
- `Cmd+\` toggles sidebar visibility.
- Titlebar shows `vault-name / filename` in vault mode.
- Dirty-file guard on file switch (prompt save/discard if current file is dirty).
- Auto-open `index.md` or `README.md` on vault open; otherwise first file alphabetically.

### Explicitly deferred

- File watcher (external edit detection) — Phase 4.
- Broken-link detection badges — Phase 4.
- Multi-tab editing — Phase 4.
- Sidebar resize handle — Phase 4.
- Fuzzy search over headings (filename-only in Phase 3).
- Persistent search index.

## 3. Architecture

### 3.1 New files

```
crates/skymark-app/src/vault.rs      scan_vault Tauri command + VaultFile struct
frontend/src/vault.ts                VaultHandle: state, open(), filter()
frontend/src/tree.ts                 File tree DOM renderer
frontend/src/palette.ts              Cmd+P fuzzy search modal
```

### 3.2 Modified files

```
crates/skymark-app/src/main.rs       Register scan_vault command
frontend/index.html                  Add #sidebar pane + #palette-overlay
frontend/src/styles/app.css          3-column layout, sidebar + palette styles
frontend/src/files.ts                Add loadFile(absPath) to FileFlow
frontend/src/main.ts                 Mode switching, vault wiring, new shortcuts
```

### 3.3 Unchanged files

`editor.ts`, `preview.ts`, `smart_edit.ts`, `draft.ts`, `toast.ts`, `api.ts`, `tokens.css`

### 3.4 Layering

`vault.rs` depends only on `tauri` (AppHandle + dialog plugin) and `std`. It has zero dependency on `skymark-core`. The frontend vault components (`vault.ts`, `tree.ts`, `palette.ts`) have no knowledge of the editor or preview — they communicate with `main.ts` via callbacks.

## 4. Rust Backend — `vault.rs`

### 4.1 Data types

```rust
#[derive(Debug, Serialize, Clone)]
pub struct VaultFile {
    pub abs_path: String,   // absolute path used by open_file / save_file
    pub rel_path: String,   // relative to vault root, e.g. "notes/intro.md"
    pub name: String,       // filename only, e.g. "intro.md"
}
```

### 4.2 Command

```rust
#[tauri::command]
pub fn scan_vault(app: AppHandle) -> Result<Option<Vec<VaultFile>>, String>
```

Behavior:
1. Shows a folder-picker dialog (`open` with `directory: true`, `multiple: false`). Returns `Ok(None)` if the user cancels.
2. Walks the selected directory recursively using `std::fs::read_dir`. Skips any file or directory whose name starts with `.` (hidden files and `.skymark`, `.git`, etc.).
3. Includes files with extensions `md`, `markdown`, or `txt` (case-insensitive).
4. Returns `Err("vault too large: …")` if more than 5 000 files match (frontend shows a toast).
5. Returns `Ok(Some(files))` sorted by `rel_path` (case-insensitive lexicographic order).

### 4.3 Capabilities

No new capabilities required. `dialog:allow-open` (already granted in `default.json`) covers folder selection with `directory: true` in Tauri 2.

### 4.4 Tests (4 unit tests, no Tauri runtime)

Test the scan logic via a path-based helper `scan_dir(root: &Path) -> Result<Option<Vec<VaultFile>>, String>` that `scan_vault` delegates to:

1. Finds `.md` files recursively across subdirectories.
2. Skips files and directories whose names start with `.`.
3. Returns files sorted by `rel_path` (case-insensitive).
4. Returns an error when more than 5 000 files are present.

## 5. Frontend Components

### 5.1 `vault.ts` — vault state handle

```ts
export interface VaultFile {
  abs_path: string;
  rel_path: string;
  name: string;
}

export interface VaultHandle {
  readonly root: string | null;
  readonly files: VaultFile[];
  open(): Promise<boolean>;            // calls scan_vault; returns false if cancelled or error
  filter(query: string): VaultFile[];  // in-memory subsequence fuzzy filter
}

export function createVaultHandle(): VaultHandle
```

`filter(query)`: returns files whose `rel_path` contains all characters of `query` in order (subsequence match, case-insensitive). Returns up to 50 results. Empty query returns all files.

`open()`: calls `invoke("scan_vault")`. On success, updates internal `root` and `files`. On the "vault too large" error string, calls `showToast(err)` and returns `false`.

### 5.2 `tree.ts` — sidebar file tree renderer

```ts
export interface TreeHandle {
  render(files: VaultFile[], activeAbsPath: string | null): void;
  setActive(absPath: string): void;
}

export function createTree(
  container: HTMLElement,
  onSelect: (file: VaultFile) => void
): TreeHandle
```

- Groups `VaultFile[]` by directory segments of `rel_path`.
- Renders a nested `<ul>/<li>` structure. Directories have a toggle button; collapsed state is kept in a `Set<string>` of collapsed directory paths (persisted only for the session).
- Clicking a file `<li>` calls `onSelect(file)`.
- `render()` replaces the container's children entirely (called once on vault open and after any re-scan).
- `setActive(absPath)` adds/moves the `.active` CSS class to the matching `<li>`.
- No `innerHTML` — all elements created with `document.createElement`.

### 5.3 `palette.ts` — fuzzy search modal

```ts
export interface PaletteHandle {
  show(files: VaultFile[], onSelect: (file: VaultFile) => void): void;
  hide(): void;
}

export function createPalette(overlayEl: HTMLElement): PaletteHandle
```

- `show()` focuses the text input and renders a filtered list (max 50 items).
- Input `oninput` re-filters using subsequence match (same algorithm as `vault.ts`).
- Keyboard: `ArrowUp`/`ArrowDown` moves cursor, `Enter` selects, `Escape` hides.
- `hide()` clears the input and removes focus.
- The overlay element is created once in `index.html`; `show`/`hide` toggle a `.visible` CSS class.
- No `innerHTML` — items built with `document.createElement` and `textContent`.

### 5.4 `files.ts` addition — `loadFile`

Add to `FileFlow` interface:

```ts
loadFile(absPath: string): Promise<string>;  // loads content; updates state.path; clears isDirty
```

Implementation calls `openFile(absPath)` from `api.ts` (already exists), updates `state.path`, sets `state.isDirty = false`, fires `emit()`.

### 5.5 `main.ts` — mode switching

**New shortcuts:**

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+Shift+O` | Open vault folder |
| `Cmd/Ctrl+P` | Toggle palette (vault mode only) |
| `Cmd/Ctrl+\` | Toggle sidebar visibility |

**Vault open flow:**
1. `vault.open()` → if `false`, do nothing.
2. Show `#sidebar`, add `.vault-mode` to `.panes`.
3. `tree.render(vault.files, null)`.
4. Auto-open: find `index.md` or `README.md` (case-insensitive) in vault root; else use `vault.files[0]`. If vault is empty, show a toast and stay in the current state.
5. Load the auto-selected file via `openVaultFile(file)`.

**`openVaultFile(file)` helper (internal to `main.ts`):**
1. If `files.state.isDirty` → `confirm("Save changes to <current file>?")`. Yes → `files.saveInteractive(editor.getValue())`. No → proceed. Cancel → abort.
2. `const content = await files.loadFile(file.abs_path)`.
3. `editor.setValue(content); preview.update(content)`.
4. `tree.setActive(file.abs_path)`.
5. Update titlebar: `<vault-folder-name> / <filename>`.

**Titlebar:** add a `<span id="vault-name">` element before `doc-title`. Show it (with a `/` separator) when a vault is open, hide it otherwise.

## 6. Layout & CSS

### 6.1 HTML additions (`index.html`)

```html
<!-- inside .panes, before editor-pane -->
<section class="pane sidebar-pane" id="sidebar" hidden></section>

<!-- after #toast-root -->
<div id="palette-overlay"></div>
```

### 6.2 CSS additions (`app.css`)

```css
/* vault mode 3-column layout */
.panes.vault-mode { grid-template-columns: 220px 1fr 1fr; }

/* sidebar */
.sidebar-pane {
  border-right: var(--pane-divider);
  background: var(--color-bg);
  overflow-y: auto;
  font-size: 13px;
  user-select: none;
}

.sidebar-pane ul { list-style: none; margin: 0; padding: 0; }
.sidebar-pane li { padding: 0; }
.sidebar-pane .tree-file {
  display: block;
  padding: var(--space-1) var(--space-3);
  color: var(--color-text);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar-pane .tree-file:hover { background: var(--color-border); }
.sidebar-pane .tree-file.active { background: var(--color-accent); color: var(--color-surface); }
.sidebar-pane .tree-dir-toggle {
  display: block;
  padding: var(--space-1) var(--space-3);
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
}
.sidebar-pane .tree-dir-toggle:hover { color: var(--color-text); }

/* palette overlay */
#palette-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  z-index: 200;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
}
#palette-overlay.visible { display: flex; }

.palette-card {
  background: var(--color-surface);
  border: var(--pane-divider);
  border-radius: 8px;
  width: 560px;
  max-width: calc(100vw - 48px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.palette-input {
  border: none;
  border-bottom: var(--pane-divider);
  padding: var(--space-3) var(--space-4);
  font-size: 14px;
  font-family: var(--font-ui);
  outline: none;
  width: 100%;
}
.palette-results {
  max-height: 320px;
  overflow-y: auto;
}
.palette-item {
  display: block;
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text);
}
.palette-item:hover,
.palette-item.selected { background: var(--color-border); }
.palette-item .palette-item-name { font-weight: 500; }
.palette-item .palette-item-path { color: var(--color-text-muted); margin-left: var(--space-2); font-size: 12px; }
```

## 7. Keyboard Shortcuts (full updated table)

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+O` | Open file (single-file mode) |
| `Cmd/Ctrl+Shift+O` | Open vault (folder) |
| `Cmd/Ctrl+S` | Save file |
| `Cmd/Ctrl+N` | New document |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `Cmd/Ctrl+F` | Find in editor |
| `Cmd/Ctrl+P` | Fuzzy file search (vault mode only) |
| `Cmd/Ctrl+\` | Toggle sidebar |

## 8. Error Handling

| Scenario | Handling |
|---|---|
| Vault folder picker cancelled | `vault.open()` returns `false`; no state change |
| Vault > 5 000 files | `scan_vault` returns error string; frontend shows toast |
| Vault is empty (no `.md`/`.markdown`/`.txt` files) | Toast "No Markdown files found in this folder"; sidebar shown but empty |
| File load fails after tree/palette select | Toast with error message; editor content unchanged |
| Dirty file on switch — user cancels | File switch aborted; current file stays active |

## 9. Definition of Done

- [ ] `cargo test --workspace` passes (skymark-app ≥18: existing 14 + 4 vault tests).
- [ ] `npx tsc -p frontend/tsconfig.json --noEmit` clean.
- [ ] `Cmd+Shift+O` opens a folder picker and renders the file tree.
- [ ] Clicking a file in the tree loads it in the editor and preview.
- [ ] `Cmd+P` opens the palette; typing filters by filename; Enter loads the selected file.
- [ ] `Cmd+\` toggles the sidebar.
- [ ] Dirty-file guard fires on file switch.
- [ ] Single-file mode (`Cmd+O`) unchanged — no sidebar, no palette.
- [ ] Hidden files and directories (`.git`, `.skymark`, etc.) not shown.
- [ ] All commits authored as `zuojin@gmail.com`.

## 10. What Phase 4 Inherits

Phase 4 builds on Phase 3's vault infrastructure:
- File watcher (`notify` crate) for external edit detection.
- Broken-link detection badges on tree nodes.
- Sidebar resize handle.
- Multi-tab editing (per-tab editor state, dirty tracking, draft handles).
- Fuzzy search extended to headings.
