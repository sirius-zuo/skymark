# Skymark Phase 3: Vault Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vault mode — open a folder, browse its Markdown files in a collapsible sidebar tree, and jump between files with a `Cmd/Ctrl+P` fuzzy search palette.

**Architecture:** The Rust backend exposes a single `scan_vault(path)` command that walks a directory and returns a flat `Vec<VaultFile>`. The frontend dialog picks the folder, passes the path to Rust, and owns all display logic (tree grouping, fuzzy filtering, palette UI). Mode switching (single-file vs vault) is handled entirely in `main.ts` with no changes to `editor.ts`, `preview.ts`, `draft.ts`, or `toast.ts`.

**Tech Stack:** Rust stable, Tauri 2, TypeScript, CodeMirror 6, `@tauri-apps/plugin-dialog` (already installed), `@tauri-apps/api/core` (already installed)

---

## File Structure

```
crates/skymark-app/src/
  vault.rs           NEW — scan_vault command + scan_dir testable helper
  main.rs            MODIFY — add mod vault, register scan_vault

frontend/src/
  vault.ts           NEW — VaultHandle: open(), filter(), state
  tree.ts            NEW — TreeHandle: DOM file tree renderer
  palette.ts         NEW — PaletteHandle: Cmd+P fuzzy search modal
  files.ts           MODIFY — add loadFile() to FileFlow
  main.ts            MODIFY — vault mode switching, new shortcuts
  styles/app.css     MODIFY — 3-column layout, sidebar + palette CSS

frontend/
  index.html         MODIFY — add #sidebar pane, #palette-overlay
```

---

## Task 1: vault.rs — Rust backend (TDD)

**Files:**
- Create: `crates/skymark-app/src/vault.rs`
- Modify: `crates/skymark-app/src/main.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/skymark-app/src/vault.rs` with only the test module (no implementation yet):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("skymark-vault-{}-{}", label, std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_finds_md_files_recursively() {
        let dir = tmpdir("finds-md");
        let sub = dir.join("notes");
        fs::create_dir_all(&sub).unwrap();
        fs::write(dir.join("readme.md"), "").unwrap();
        fs::write(sub.join("intro.markdown"), "").unwrap();
        fs::write(sub.join("skip.rs"), "").unwrap();

        let files = scan_dir(&dir, 5_000).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|f| f.name == "readme.md"));
        assert!(files.iter().any(|f| f.name == "intro.markdown"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_skips_hidden_files_and_dirs() {
        let dir = tmpdir("skips-hidden");
        let git = dir.join(".git");
        fs::create_dir_all(&git).unwrap();
        fs::write(dir.join("visible.md"), "").unwrap();
        fs::write(dir.join(".hidden.md"), "").unwrap();
        fs::write(git.join("inside.md"), "").unwrap();

        let files = scan_dir(&dir, 5_000).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "visible.md");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_returns_sorted_by_rel_path() {
        let dir = tmpdir("sorted");
        fs::write(dir.join("z-last.md"), "").unwrap();
        fs::write(dir.join("a-first.md"), "").unwrap();
        fs::write(dir.join("m-middle.md"), "").unwrap();

        let files = scan_dir(&dir, 5_000).unwrap();
        assert_eq!(files[0].name, "a-first.md");
        assert_eq!(files[1].name, "m-middle.md");
        assert_eq!(files[2].name, "z-last.md");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_errors_when_exceeds_max_files() {
        let dir = tmpdir("cap");
        for i in 0..11u32 {
            fs::write(dir.join(format!("f{i}.md")), "").unwrap();
        }

        let result = scan_dir(&dir, 10);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("vault too large"));

        fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 2: Run — must fail**

```bash
cargo test -p skymark-app vault
```

Expected: compile error — `scan_dir` not found.

- [ ] **Step 3: Implement `vault.rs`**

Replace `crates/skymark-app/src/vault.rs` with:

```rust
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
pub struct VaultFile {
    pub abs_path: String,
    pub rel_path: String,
    pub name: String,
}

/// Testable scan helper. `max_files` lets tests use a small cap.
pub fn scan_dir(root: &Path, max_files: usize) -> Result<Vec<VaultFile>, String> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    if files.len() > max_files {
        return Err(format!(
            "vault too large: {} files found (limit {max_files})",
            files.len()
        ));
    }
    files.sort_by(|a, b| {
        a.rel_path
            .to_ascii_lowercase()
            .cmp(&b.rel_path.to_ascii_lowercase())
    });
    Ok(files)
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<VaultFile>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read_dir {dir:?}: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let os_name = entry.file_name();
        let name = os_name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            collect_files(root, &path, out)?;
        } else if ft.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(ext.as_str(), "md" | "markdown" | "txt") {
                let rel = path
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/"); // normalise Windows separators
                out.push(VaultFile {
                    abs_path: path.to_string_lossy().into_owned(),
                    rel_path: rel,
                    name: name.into_owned(),
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn scan_vault(path: String) -> Result<Vec<VaultFile>, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("vault path must be absolute".into());
    }
    if !p.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    scan_dir(&p, 5_000)
}

#[cfg(test)]
mod tests {
    // ... (added in Step 1)
}
```

- [ ] **Step 4: Register in `main.rs`**

Replace `crates/skymark-app/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod draft;
mod vault;

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
            vault::scan_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skymark");
}
```

- [ ] **Step 5: Run — all tests must pass**

```bash
cargo test -p skymark-app
```

Expected: 14 existing + 4 vault = 18 tests, all passing.

Also run clippy:

```bash
cargo clippy -p skymark-app -- -D warnings
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add crates/skymark-app/
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(app): vault backend — scan_vault command with hidden-file filter and cap"
```

---

## Task 2: files.ts — add `loadFile`

**Files:**
- Modify: `frontend/src/files.ts`

- [ ] **Step 1: Add `loadFile` to the `FileFlow` interface**

In `frontend/src/files.ts`, replace the `FileFlow` interface:

```ts
export interface FileFlow {
  state: DocumentState;
  onStateChange(listener: (s: DocumentState) => void): void;
  onAfterSave(listener: (path: string) => void): void;
  markDirty(): void;
  openInteractive(): Promise<string | null>;
  saveInteractive(content: string): Promise<boolean>;
  loadFile(absPath: string): Promise<string>;
  newDocument(): void;
}
```

- [ ] **Step 2: Implement `loadFile` in `createFileFlow`**

Inside `createFileFlow()`, add `loadFile` to the returned object (after `saveInteractive`, before `newDocument`):

```ts
    async loadFile(absPath) {
      const opened = await openFile(absPath);
      state.path = opened.path;
      state.isDirty = false;
      emit();
      return opened.content;
    },
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/files.ts
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): add loadFile to FileFlow for vault file switching"
```

---

## Task 3: vault.ts — VaultHandle

**Files:**
- Create: `frontend/src/vault.ts`

- [ ] **Step 1: Create `frontend/src/vault.ts`**

```ts
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { showToast } from "./toast";

export interface VaultFile {
  abs_path: string;
  rel_path: string;
  name: string;
}

export interface VaultHandle {
  readonly root: string | null;
  readonly files: VaultFile[];
  open(): Promise<boolean>;
  filter(query: string): VaultFile[];
}

export function createVaultHandle(): VaultHandle {
  let root: string | null = null;
  let files: VaultFile[] = [];

  return {
    get root() { return root; },
    get files() { return files; },

    async open() {
      if (!isTauri()) return false;
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return false;
      try {
        const result = await invoke<VaultFile[]>("scan_vault", { path: picked });
        root = picked;
        files = result;
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(msg.startsWith("vault too large") ? msg : `Failed to open vault: ${msg}`);
        return false;
      }
    },

    filter(query) {
      if (!query) return files.slice(0, 50);
      const q = query.toLowerCase();
      return files
        .filter(f => subsequenceMatch(f.rel_path.toLowerCase(), q))
        .slice(0, 50);
    },
  };
}

function subsequenceMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/vault.ts
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): VaultHandle — scan_vault wrapper with in-memory fuzzy filter"
```

---

## Task 4: tree.ts — file tree renderer

**Files:**
- Create: `frontend/src/tree.ts`

- [ ] **Step 1: Create `frontend/src/tree.ts`**

```ts
import { VaultFile } from "./vault";

export interface TreeHandle {
  render(files: VaultFile[], activeAbsPath: string | null): void;
  setActive(absPath: string): void;
}

export function createTree(
  container: HTMLElement,
  onSelect: (file: VaultFile) => void
): TreeHandle {
  const collapsed = new Set<string>();
  let currentFiles: VaultFile[] = [];
  let currentActive: string | null = null;

  function rerender(): void {
    const rootFiles: VaultFile[] = [];
    const dirMap = new Map<string, VaultFile[]>();

    for (const f of currentFiles) {
      const slash = f.rel_path.indexOf("/");
      if (slash === -1) {
        rootFiles.push(f);
      } else {
        const dir = f.rel_path.slice(0, slash);
        if (!dirMap.has(dir)) dirMap.set(dir, []);
        dirMap.get(dir)!.push(f);
      }
    }

    const ul = document.createElement("ul");

    for (const f of rootFiles) {
      ul.appendChild(makeFileItem(f));
    }

    const sortedDirs = [...dirMap.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    for (const [dir, dirFiles] of sortedDirs) {
      const li = document.createElement("li");
      const toggle = document.createElement("span");
      toggle.className = "tree-dir-toggle";
      const isCollapsed = collapsed.has(dir);
      toggle.textContent = (isCollapsed ? "▶ " : "▼ ") + dir;
      toggle.addEventListener("click", () => {
        if (collapsed.has(dir)) collapsed.delete(dir);
        else collapsed.add(dir);
        rerender();
      });
      li.appendChild(toggle);

      if (!isCollapsed) {
        const subUl = document.createElement("ul");
        subUl.style.paddingLeft = "12px";
        for (const f of dirFiles) {
          subUl.appendChild(makeFileItem(f));
        }
        li.appendChild(subUl);
      }

      ul.appendChild(li);
    }

    container.replaceChildren(ul);
  }

  function makeFileItem(f: VaultFile): HTMLElement {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "tree-file" + (f.abs_path === currentActive ? " active" : "");
    span.textContent = f.name;
    span.title = f.rel_path;
    span.addEventListener("click", () => onSelect(f));
    li.appendChild(span);
    return li;
  }

  return {
    render(files, activeAbsPath) {
      currentFiles = files;
      currentActive = activeAbsPath;
      rerender();
    },
    setActive(absPath) {
      currentActive = absPath;
      rerender();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/tree.ts
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): collapsible file tree sidebar renderer"
```

---

## Task 5: palette.ts — fuzzy search modal

**Files:**
- Create: `frontend/src/palette.ts`

- [ ] **Step 1: Create `frontend/src/palette.ts`**

```ts
import { VaultFile } from "./vault";

export interface PaletteHandle {
  show(files: VaultFile[], onSelect: (file: VaultFile) => void): void;
  hide(): void;
}

export function createPalette(overlayEl: HTMLElement): PaletteHandle {
  let currentOnSelect: ((file: VaultFile) => void) | null = null;
  let allFiles: VaultFile[] = [];
  let filteredFiles: VaultFile[] = [];
  let selectedIdx = 0;

  const card = document.createElement("div");
  card.className = "palette-card";

  const input = document.createElement("input");
  input.className = "palette-input";
  input.type = "text";
  input.placeholder = "Go to file…";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");

  const resultsList = document.createElement("div");
  resultsList.className = "palette-results";

  card.appendChild(input);
  card.appendChild(resultsList);
  overlayEl.appendChild(card);

  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) hide();
  });

  function renderResults(files: VaultFile[]): void {
    filteredFiles = files;
    selectedIdx = 0;
    resultsList.replaceChildren();
    for (let i = 0; i < files.length; i++) {
      const item = document.createElement("div");
      item.className = "palette-item" + (i === 0 ? " selected" : "");

      const nameSpan = document.createElement("span");
      nameSpan.className = "palette-item-name";
      nameSpan.textContent = files[i].name;

      const pathSpan = document.createElement("span");
      pathSpan.className = "palette-item-path";
      pathSpan.textContent = files[i].rel_path;

      item.appendChild(nameSpan);
      item.appendChild(pathSpan);

      const idx = i;
      item.addEventListener("click", () => {
        if (currentOnSelect) currentOnSelect(files[idx]);
        hide();
      });
      resultsList.appendChild(item);
    }
  }

  function updateSelected(newIdx: number): void {
    const items = resultsList.querySelectorAll<HTMLElement>(".palette-item");
    items[selectedIdx]?.classList.remove("selected");
    selectedIdx = Math.max(0, Math.min(newIdx, filteredFiles.length - 1));
    items[selectedIdx]?.classList.add("selected");
    items[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    const filtered = q
      ? allFiles.filter(f => subsequenceMatch(f.rel_path.toLowerCase(), q)).slice(0, 50)
      : allFiles.slice(0, 50);
    renderResults(filtered);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      updateSelected(selectedIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      updateSelected(selectedIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredFiles[selectedIdx] && currentOnSelect) {
        currentOnSelect(filteredFiles[selectedIdx]);
        hide();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  });

  function hide(): void {
    overlayEl.classList.remove("visible");
    input.value = "";
    resultsList.replaceChildren();
    currentOnSelect = null;
  }

  return {
    show(files, onSelect) {
      currentOnSelect = onSelect;
      allFiles = files;
      overlayEl.classList.add("visible");
      input.value = "";
      renderResults(files.slice(0, 50));
      input.focus();
    },
    hide,
  };
}

function subsequenceMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/palette.ts
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): Cmd+P fuzzy search palette with keyboard navigation"
```

---

## Task 6: Layout — index.html and app.css

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/styles/app.css`

- [ ] **Step 1: Add sidebar pane and palette overlay to `index.html`**

Read `frontend/index.html`. Make two edits:

**Edit 1** — add `#sidebar` before the editor pane inside `<main class="panes">`:

```html
      <main class="panes">
        <section class="pane sidebar-pane" id="sidebar" hidden></section>
        <section class="pane editor-pane" id="editor"></section>
        <section class="pane preview-pane" id="preview"></section>
      </main>
```

**Edit 2** — add `#palette-overlay` after `<div id="toast-root"></div>`:

```html
    <div id="toast-root"></div>
    <div id="palette-overlay"></div>
```

Also add `<span id="vault-prefix" hidden></span>` before `<span class="doc-title"` inside the titlebar header:

```html
      <header class="titlebar">
        <span id="vault-prefix" hidden></span>
        <span class="doc-title" id="doc-title">Untitled</span>
        <span class="dirty-indicator" id="dirty-indicator" hidden>●</span>
      </header>
```

- [ ] **Step 2: Add CSS to `app.css`**

Read `frontend/src/styles/app.css`. Append at the end of the file:

```css
/* ── Vault mode layout ─────────────────────────────────────────────────── */

.panes.vault-mode { grid-template-columns: 220px 1fr 1fr; }

/* ── Sidebar ───────────────────────────────────────────────────────────── */

.sidebar-pane {
  border-right: var(--pane-divider);
  background: var(--color-bg);
  overflow-y: auto;
  font-size: 13px;
  user-select: none;
}

.sidebar-pane ul { list-style: none; margin: 0; padding: 0; }
.sidebar-pane li { padding: 0; }

.tree-file {
  display: block;
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text);
}
.tree-file:hover { background: var(--color-border); }
.tree-file.active { background: var(--color-accent); color: var(--color-surface); }

.tree-dir-toggle {
  display: block;
  padding: var(--space-1) var(--space-3);
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
}
.tree-dir-toggle:hover { color: var(--color-text); }

/* ── Palette overlay ───────────────────────────────────────────────────── */

#palette-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
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
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
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
  background: var(--color-surface);
  color: var(--color-text);
}

.palette-results {
  max-height: 320px;
  overflow-y: auto;
}

.palette-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.palette-item:hover,
.palette-item.selected { background: var(--color-border); }

.palette-item-name { font-weight: 500; font-size: 13px; color: var(--color-text); flex-shrink: 0; }
.palette-item-path { font-size: 12px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; }

/* ── Vault titlebar prefix ─────────────────────────────────────────────── */

#vault-prefix {
  font-weight: 500;
  color: var(--color-text-muted);
  margin-right: var(--space-1);
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/src/styles/app.css
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): vault layout — sidebar pane, palette overlay, 3-column CSS"
```

---

## Task 7: main.ts — vault mode wiring

**Files:**
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Read current `frontend/src/main.ts`**

Confirm current imports and wiring before replacing.

- [ ] **Step 2: Replace `frontend/src/main.ts`**

```ts
import { createEditor } from "./editor";
import { createPreview } from "./preview";
import { createFileFlow } from "./files";
import { createDraftHandle } from "./draft";
import { showToast } from "./toast";
import { isTauri } from "./api";
import { createVaultHandle, VaultFile } from "./vault";
import { createTree } from "./tree";
import { createPalette } from "./palette";

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
const sidebarEl = document.getElementById("sidebar") as HTMLElement | null;
const paletteOverlayEl = document.getElementById("palette-overlay") as HTMLElement | null;
const titleEl = document.getElementById("doc-title") as HTMLElement | null;
const vaultPrefixEl = document.getElementById("vault-prefix") as HTMLElement | null;
const dirtyEl = document.getElementById("dirty-indicator") as HTMLElement | null;
const panesEl = document.querySelector(".panes") as HTMLElement | null;

if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl || !vaultPrefixEl || !dirtyEl || !panesEl) {
  throw new Error("missing layout host elements");
}

const preview = createPreview(previewHost);
const files = createFileFlow();
const drafts = createDraftHandle();
const vault = createVaultHandle();
const tree = createTree(sidebarEl, (file) => { void openVaultFile(file); });
const palette = createPalette(paletteOverlayEl);

const editor = createEditor(editorHost, (text) => {
  preview.update(text);
  files.markDirty();
  drafts.onDocChange(files.state.path, () => editor.getValue());
});

files.onStateChange((s) => {
  updateTitlebar(s.path);
  dirtyEl.hidden = !s.isDirty;
});

files.onAfterSave((path) => {
  drafts.onExplicitSave(path);
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);

// ── Keyboard shortcuts ──────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  if (e.key === "o" || e.key === "O") {
    if (e.shiftKey) {
      // Cmd+Shift+O — open vault folder
      e.preventDefault();
      void openVault();
    } else {
      // Cmd+O — open single file
      e.preventDefault();
      void (async () => {
        const content = await files.openInteractive();
        if (content !== null) {
          editor.setValue(content);
          preview.update(content);
        }
      })();
    }
  } else if (e.key === "s" || e.key === "S") {
    e.preventDefault();
    void files.saveInteractive(editor.getValue());
  } else if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    editor.setValue("");
    preview.update("");
    files.newDocument();
  } else if ((e.key === "p" || e.key === "P") && vault.root) {
    // Cmd+P — palette (vault mode only)
    e.preventDefault();
    palette.show(vault.files, (file) => { void openVaultFile(file); });
  } else if (e.key === "\\" || e.key === "|") {
    // Cmd+\ — toggle sidebar
    if (vault.root) {
      e.preventDefault();
      toggleSidebar();
    }
  }
});

// ── Vault helpers ───────────────────────────────────────────────────────

async function openVault(): Promise<void> {
  const ok = await vault.open();
  if (!ok) return;

  sidebarEl.hidden = false;
  panesEl.classList.add("vault-mode");
  tree.render(vault.files, null);

  // Auto-open: prefer index.md or README.md at root, else first file.
  const autoFile =
    vault.files.find(f => /^(index|readme)\.md$/i.test(f.name)) ??
    vault.files[0];

  if (!autoFile) {
    showToast("No Markdown files found in this folder");
    return;
  }

  await openVaultFile(autoFile);
}

async function openVaultFile(file: VaultFile): Promise<void> {
  if (files.state.isDirty) {
    const currentName = files.state.path ? basename(files.state.path) : "Untitled";
    const save = confirm(`Save changes to "${currentName}"?`);
    if (save) {
      const saved = await files.saveInteractive(editor.getValue());
      if (!saved) return;
    }
  }

  const content = await files.loadFile(file.abs_path);
  editor.setValue(content);
  preview.update(content);
  tree.setActive(file.abs_path);
  updateTitlebar(file.abs_path);
}

function toggleSidebar(): void {
  sidebarEl.hidden = !sidebarEl.hidden;
}

function updateTitlebar(filePath: string | null): void {
  titleEl.textContent = filePath ? basename(filePath) : "Untitled";
  if (vault.root) {
    vaultPrefixEl.textContent = basename(vault.root) + " /";
    vaultPrefixEl.hidden = false;
  } else {
    vaultPrefixEl.hidden = true;
  }
}

// ── Draft recovery on launch ────────────────────────────────────────────

void (async () => {
  const recoverable = await drafts.checkRecovery();
  if (recoverable.length === 0) return;

  const draft = recoverable[0];
  const label = draft.original_path ? basename(draft.original_path) : "Untitled";

  if (draft.needs_resolution) {
    const keepDraft = confirm(
      `"${label}" was modified externally since your last edit.\n\n` +
      "OK = restore your unsaved draft\n" +
      "Cancel = use the version on disk"
    );
    if (keepDraft) {
      const content = await drafts.recoverDraft(draft.draft_key);
      editor.setValue(content);
      preview.update(content);
      showToast(`Restored draft of "${label}"`);
    } else {
      await drafts.dismissDraft(draft.draft_key);
    }
  } else {
    const content = await drafts.recoverDraft(draft.draft_key);
    editor.setValue(content);
    preview.update(content);
    showToast(`Recovered unsaved changes to "${label}"`);
  }
})().catch((err) => console.error("[skymark] draft recovery failed:", err));

// ── Save-on-close ───────────────────────────────────────────────────────

if (isTauri()) {
  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    let closing = false;
    await win.onCloseRequested(async (event: { preventDefault(): void }) => {
      if (!files.state.isDirty) return;
      if (closing) { event.preventDefault(); return; }
      closing = true;
      event.preventDefault();
      const saved = await files.saveInteractive(editor.getValue());
      if (!saved) {
        const discard = confirm("Discard unsaved changes and close?");
        if (!discard) { closing = false; return; }
      }
      await win.destroy();
    });
  })();
}

// ── Utilities ──────────────────────────────────────────────────────────

function basename(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx >= 0 ? path.slice(idx + 1) : path;
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.ts
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): vault mode wiring — Cmd+Shift+O, Cmd+P, Cmd+\\ shortcuts"
```

---

## Task 8: Smoke verification

**Files:** *(verification only — no source changes)*

- [ ] **Step 1: Run full Rust test suite**

```bash
cargo test --workspace
```

Expected: skymark-core ≥38, skymark-app ≥18 (14 existing + 4 vault). All passing.

- [ ] **Step 2: WASM gate**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build -p skymark-core --target wasm32-unknown-unknown --release
```

Expected: build succeeds (vault.rs not in skymark-core — no impact).

- [ ] **Step 3: Frontend typecheck**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```

Expected: clean.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run `npm run tauri:dev` and verify:

1. `Cmd+Shift+O` → folder picker opens → select a folder with `.md` files → sidebar appears with file tree.
2. Click a file in the sidebar → editor loads its content, preview updates, active file highlighted.
3. `Cmd+P` → palette opens → type letters → list filters by filename → `Enter` opens selected file.
4. `Escape` → palette closes.
5. `Cmd+\` → sidebar toggles hidden/visible.
6. Edit a file and try to switch to another in the tree → save prompt appears.
7. `Cmd+O` → single-file dialog still works, no sidebar shown.
8. Hidden folder (`.git`) not shown in tree; `.hidden.md` files not shown.
9. Titlebar shows `vault-name / filename` in vault mode.

---

## Phase 3 Definition of Done

- [ ] `cargo test --workspace` passes (skymark-core ≥38, skymark-app ≥18).
- [ ] `cargo build -p skymark-core --target wasm32-unknown-unknown --release` succeeds.
- [ ] `npx tsc -p frontend/tsconfig.json --noEmit` clean.
- [ ] `Cmd+Shift+O` opens a folder and renders the tree.
- [ ] Clicking a file in the tree loads it.
- [ ] `Cmd+P` filters by filename; `Enter` opens; `Escape` closes.
- [ ] `Cmd+\` toggles sidebar.
- [ ] Dirty-file guard fires on file switch.
- [ ] Hidden files/dirs not shown.
- [ ] Single-file mode (`Cmd+O`) unchanged.
- [ ] All commits authored as `zuojin@gmail.com`.

---

## What Phase 4 inherits

- File watcher (`notify` crate): `scan_vault` result is stale after external edits — Phase 4 adds live refresh.
- Broken-link detection: passive scan on save, badge on tree nodes.
- Sidebar resize handle.
- Multi-tab editing with per-tab document state.
- Fuzzy search extended to headings.
