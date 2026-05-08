# Phase 4 Vault Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-tab editing, file watcher, sidebar resize, broken-link detection, and heading search to Skymark's vault mode.

**Architecture:** A new `watcher.rs` Rust module wraps `notify-debouncer-mini` and emits Tauri events when watched files change. Four new TypeScript modules (`tabs.ts`, `headings.ts`, `links.ts`, and extended `palette.ts`/`tree.ts`) each own one concern and communicate with `main.ts` via callbacks. `main.ts` wires everything together.

**Tech Stack:** Rust/Tauri 2, `notify-debouncer-mini 0.4`, TypeScript/CodeMirror 6, localStorage for persistence.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `Cargo.toml` | Modify | Add `notify-debouncer-mini` to workspace deps |
| `crates/skymark-app/Cargo.toml` | Modify | Pull workspace dep into app |
| `crates/skymark-app/src/watcher.rs` | Create | `WatcherState`, `watch_paths`, `unwatch_paths` commands |
| `crates/skymark-app/src/main.rs` | Modify | Manage `WatcherState`, register watcher commands |
| `frontend/src/editor.ts` | Modify | Add `scrollToLine(line: number)` to `EditorHandle` |
| `frontend/src/tabs.ts` | Create | `TabEntry`, `TabHandle`, `createTabHandle` |
| `frontend/src/headings.ts` | Create | `HeadingEntry`, `HeadingIndex`, `createHeadingIndex` |
| `frontend/src/links.ts` | Create | `LinkChecker`, `createLinkChecker` |
| `frontend/src/palette.ts` | Modify | Extend `show()` for heading results and `#`-prefix mode |
| `frontend/src/tree.ts` | Modify | Optional `getBrokenFiles` param, render warning badge |
| `frontend/index.html` | Modify | Add `#tab-bar`, `#sidebar-resizer`, `#reload-banner` |
| `frontend/src/styles/app.css` | Modify | Tab bar, resizer, reload banner, heading palette, badge styles; replace Phase 3 vault-mode rule |
| `frontend/src/main.ts` | Modify | Wire all new modules; tab flow, watcher events, resize, heading search |

---

### Task 1: Rust watcher

**Files:**
- Modify: `Cargo.toml`
- Modify: `crates/skymark-app/Cargo.toml`
- Create: `crates/skymark-app/src/watcher.rs`
- Modify: `crates/skymark-app/src/main.rs`

- [ ] **Step 1: Add dependency to workspace**

`Cargo.toml` — add to `[workspace.dependencies]`:
```toml
notify-debouncer-mini = "0.4"
```

`crates/skymark-app/Cargo.toml` — add to `[dependencies]`:
```toml
notify-debouncer-mini.workspace = true
```

- [ ] **Step 2: Verify Cargo resolves**

```bash
cargo fetch
```
Expected: no errors. If version 0.4 is unavailable, run `cargo search notify-debouncer-mini` and use the latest 0.x.

- [ ] **Step 3: Create `crates/skymark-app/src/watcher.rs`**

```rust
use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, Debouncer, DebounceEventResult};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

#[tauri::command]
pub fn watch_paths(
    paths: Vec<String>,
    state: tauri::State<WatcherState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    *state.debouncer.lock().unwrap() = None;

    let app_clone = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                for event in events {
                    let path = event.path.to_string_lossy().replace('\\', "/");
                    let _ = app_clone.emit("file-changed", path);
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    for path in &paths {
        debouncer
            .watcher()
            .watch(
                std::path::Path::new(path),
                notify::RecursiveMode::NonRecursive,
            )
            .map_err(|e| e.to_string())?;
    }

    *state.debouncer.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[tauri::command]
pub fn unwatch_paths(state: tauri::State<WatcherState>) -> Result<(), String> {
    *state.debouncer.lock().unwrap() = None;
    Ok(())
}
```

- [ ] **Step 4: Update `crates/skymark-app/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod draft;
mod vault;
mod watcher;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir().map(|d| d.join("drafts")) {
                let _ = draft::gc_old_drafts_in_dir(&dir);
            }
            app.manage(watcher::WatcherState {
                debouncer: std::sync::Mutex::new(None),
            });
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
            watcher::watch_paths,
            watcher::unwatch_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skymark");
}
```

- [ ] **Step 5: Compile**

```bash
cargo build -p skymark-app 2>&1 | tail -20
```
Expected: `Finished` with no errors. `use tauri::Emitter` is required for `app.emit()` in Tauri 2.

- [ ] **Step 6: Tests**

```bash
cargo test -p skymark-app 2>&1 | tail -20
```
Expected: all pass (at least 19 tests).

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml crates/skymark-app/Cargo.toml crates/skymark-app/src/watcher.rs crates/skymark-app/src/main.rs Cargo.lock
git commit -m "feat: add file watcher Rust backend (watcher.rs)"
```

---

### Task 2: `editor.ts` — `scrollToLine`

**Files:**
- Modify: `frontend/src/editor.ts`

- [ ] **Step 1: Extend the interface**

In `frontend/src/editor.ts`, replace:
```ts
export interface EditorHandle {
  view: EditorView;
  getValue(): string;
  setValue(text: string): void;
}
```
With:
```ts
export interface EditorHandle {
  view: EditorView;
  getValue(): string;
  setValue(text: string): void;
  scrollToLine(line: number): void;
}
```

- [ ] **Step 2: Add implementation**

In the `return { ... }` block of `createEditor`, add after `setValue`:
```ts
    scrollToLine(line: number) {
      const doc = view.state.doc;
      const target = doc.line(Math.min(line + 1, doc.lines));
      view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
    },
```

`doc.line()` is 1-based; `line + 1` converts from the 0-based `HeadingEntry.line`.

- [ ] **Step 3: Type-check**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/editor.ts
git commit -m "feat: add scrollToLine to EditorHandle"
```

---

### Task 3: `tabs.ts` — TabHandle

**Files:**
- Create: `frontend/src/tabs.ts`

- [ ] **Step 1: Create `frontend/src/tabs.ts`**

```ts
export interface TabEntry {
  absPath: string;
  isDirty: boolean;
  content: string;
  cursorPos: number;
  scrollTop: number;
  externallyModified: boolean;
}

export interface TabHandle {
  readonly entries: TabEntry[];
  readonly activeIdx: number;
  readonly active: TabEntry | null;
  addTab(absPath: string, content: string): void;
  closeTab(idx: number): boolean;
  activateTab(idx: number): void;
  updateActive(patch: Partial<Pick<TabEntry, 'content' | 'isDirty' | 'cursorPos' | 'scrollTop' | 'externallyModified'>>): void;
  markExternallyModified(idx: number): void;
  clearAll(): void;
  onActiveChange(listener: (entry: TabEntry | null) => void): void;
  renderBar(container: HTMLElement): void;
  persist(): void;
  restore(): Array<{ absPath: string }>;
}

export function createTabHandle(onCloseClick: (idx: number) => void): TabHandle {
  const entries: TabEntry[] = [];
  let activeIdx = -1;
  const listeners: Array<(entry: TabEntry | null) => void> = [];

  function notify(): void {
    const e = activeIdx >= 0 ? entries[activeIdx] : null;
    for (const l of listeners) l(e);
  }

  function fileBasename(absPath: string): string {
    const sep = absPath.includes("\\") ? "\\" : "/";
    const i = absPath.lastIndexOf(sep);
    return i >= 0 ? absPath.slice(i + 1) : absPath;
  }

  function doPersist(): void {
    localStorage.setItem(
      'skymark:tabs',
      JSON.stringify({ paths: entries.map(e => e.absPath), activeIdx })
    );
  }

  return {
    get entries() { return entries; },
    get activeIdx() { return activeIdx; },
    get active() { return activeIdx >= 0 ? entries[activeIdx] : null; },

    addTab(absPath, content) {
      const existing = entries.findIndex(e => e.absPath === absPath);
      if (existing !== -1) { activeIdx = existing; notify(); return; }
      entries.push({ absPath, isDirty: false, content, cursorPos: 0, scrollTop: 0, externallyModified: false });
      activeIdx = entries.length - 1;
      notify();
    },

    closeTab(idx) {
      if (entries[idx]?.isDirty) return false;
      entries.splice(idx, 1);
      if (entries.length === 0) {
        activeIdx = -1;
      } else if (activeIdx >= entries.length) {
        activeIdx = entries.length - 1;
      } else if (activeIdx > idx) {
        activeIdx--;
      }
      notify();
      doPersist();
      return true;
    },

    activateTab(idx) { activeIdx = idx; notify(); },

    updateActive(patch) {
      if (activeIdx >= 0) Object.assign(entries[activeIdx], patch);
    },

    markExternallyModified(idx) {
      if (idx >= 0 && idx < entries.length) entries[idx].externallyModified = true;
    },

    clearAll() {
      entries.splice(0, entries.length);
      activeIdx = -1;
      notify();
      doPersist();
    },

    onActiveChange(listener) { listeners.push(listener); },

    renderBar(container) {
      container.replaceChildren();
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const btn = document.createElement("button");
        btn.classList.add("tab-item");
        if (i === activeIdx) btn.classList.add("active");
        if (entry.isDirty) btn.classList.add("dirty");
        if (entry.externallyModified) btn.classList.add("ext-modified");

        if (entry.isDirty) {
          const ds = document.createElement("span");
          ds.className = "tab-dirty";
          ds.textContent = "●";
          btn.appendChild(ds);
        }
        if (entry.externallyModified) {
          const es = document.createElement("span");
          es.className = "tab-ext-modified";
          es.textContent = "⊙";
          btn.appendChild(es);
        }

        const nameSpan = document.createElement("span");
        nameSpan.className = "tab-name";
        nameSpan.textContent = fileBasename(entry.absPath);
        btn.appendChild(nameSpan);

        const closeSpan = document.createElement("span");
        closeSpan.className = "tab-close";
        closeSpan.textContent = "×";
        const ci = i;
        closeSpan.addEventListener("click", (e) => { e.stopPropagation(); onCloseClick(ci); });
        btn.appendChild(closeSpan);

        container.appendChild(btn);
      }
    },

    persist() { doPersist(); },

    restore() {
      try {
        const raw = localStorage.getItem('skymark:tabs');
        if (!raw) return [];
        const parsed = JSON.parse(raw) as { paths: unknown };
        if (!Array.isArray(parsed.paths)) return [];
        return (parsed.paths as string[]).map(p => ({ absPath: p }));
      } catch {
        return [];
      }
    },
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/tabs.ts
git commit -m "feat: add TabHandle (tabs.ts)"
```

---

### Task 4: `headings.ts` — HeadingIndex

**Files:**
- Create: `frontend/src/headings.ts`

- [ ] **Step 1: Create `frontend/src/headings.ts`**

```ts
export interface HeadingEntry {
  text: string;
  level: number;
  line: number;
  absPath: string;
  relPath: string;
  fileName: string;
}

export interface HeadingIndex {
  index(absPath: string, relPath: string, fileName: string, content: string): void;
  remove(absPath: string): void;
  getAll(): HeadingEntry[];
  search(query: string): HeadingEntry[];
}

export function createHeadingIndex(): HeadingIndex {
  const store = new Map<string, HeadingEntry[]>();

  function allSorted(): HeadingEntry[] {
    const all: HeadingEntry[] = [];
    for (const es of store.values()) all.push(...es);
    all.sort((a, b) =>
      a.absPath < b.absPath ? -1 : a.absPath > b.absPath ? 1 : a.line - b.line
    );
    return all;
  }

  return {
    index(absPath, relPath, fileName, content) {
      const result: HeadingEntry[] = [];
      const re = /^(#{1,6}) +(.+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const level = m[1].length;
        const text = m[2].trim();
        const line = content.slice(0, m.index).split("\n").length - 1;
        result.push({ text, level, line, absPath, relPath, fileName });
      }
      store.set(absPath, result);
    },

    remove(absPath) { store.delete(absPath); },

    getAll() { return allSorted(); },

    search(query) {
      const all = allSorted();
      if (!query) return all.slice(0, 50);
      const q = query.toLowerCase();
      return all.filter(e => subsequenceMatch(e.text.toLowerCase(), q)).slice(0, 50);
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

- [ ] **Step 2: Type-check**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/headings.ts
git commit -m "feat: add HeadingIndex (headings.ts)"
```

---

### Task 5: `links.ts` — LinkChecker

**Files:**
- Create: `frontend/src/links.ts`

- [ ] **Step 1: Create `frontend/src/links.ts`**

```ts
import { VaultFile } from "./vault";

export interface LinkChecker {
  update(absPath: string, content: string, vaultFiles: VaultFile[]): void;
  getBrokenFiles(): Set<string>;
  remove(absPath: string): void;
  clear(): void;
}

export function createLinkChecker(): LinkChecker {
  const broken = new Set<string>();

  function dirOf(absPath: string): string {
    const sep = absPath.includes("\\") ? "\\" : "/";
    const i = absPath.lastIndexOf(sep);
    return i >= 0 ? absPath.slice(0, i) : "";
  }

  function normSep(p: string): string { return p.replace(/\\/g, "/"); }

  function resolvedMdLink(target: string, absPath: string, vaultFiles: VaultFile[]): boolean {
    if (/^https?:\/\//i.test(target) || target.startsWith("#")) return true;
    const resolved = normSep(dirOf(absPath) + "/" + target);
    return vaultFiles.some(f => normSep(f.abs_path) === resolved);
  }

  function resolvedWikilink(name: string, vaultFiles: VaultFile[]): boolean {
    const lower = name.toLowerCase().replace(/\.md$/i, "");
    return vaultFiles.some(f => f.name.toLowerCase().replace(/\.md$/i, "") === lower);
  }

  return {
    update(absPath, content, vaultFiles) {
      let hasBroken = false;

      const mdRe = /\[(?:[^\]]*)\]\(([^)#]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = mdRe.exec(content)) !== null) {
        if (!resolvedMdLink(m[1], absPath, vaultFiles)) { hasBroken = true; break; }
      }

      if (!hasBroken) {
        const wikiRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
        while ((m = wikiRe.exec(content)) !== null) {
          if (!resolvedWikilink(m[1].trim(), vaultFiles)) { hasBroken = true; break; }
        }
      }

      if (hasBroken) broken.add(absPath);
      else broken.delete(absPath);
    },

    getBrokenFiles() { return new Set(broken); },
    remove(absPath) { broken.delete(absPath); },
    clear() { broken.clear(); },
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/links.ts
git commit -m "feat: add LinkChecker (links.ts)"
```

---

### Task 6: `palette.ts` — heading results and `#`-prefix mode

**Files:**
- Modify: `frontend/src/palette.ts`

- [ ] **Step 1: Replace `frontend/src/palette.ts` entirely**

```ts
import { VaultFile } from "./vault";
import { HeadingEntry } from "./headings";

export interface PaletteHandle {
  show(
    files: VaultFile[],
    onSelect: (file: VaultFile) => void,
    headings?: HeadingEntry[],
    onSelectHeading?: (heading: HeadingEntry) => void,
  ): void;
  hide(): void;
}

type NavItem =
  | { type: 'file'; file: VaultFile }
  | { type: 'heading'; heading: HeadingEntry };

export function createPalette(overlayEl: HTMLElement): PaletteHandle {
  let currentOnSelect: ((file: VaultFile) => void) | null = null;
  let currentOnSelectHeading: ((h: HeadingEntry) => void) | null = null;
  let allFiles: VaultFile[] = [];
  let allHeadings: HeadingEntry[] = [];
  let navItems: NavItem[] = [];
  let selectedIdx = 0;

  const card = document.createElement("div");
  card.className = "palette-card";

  const input = document.createElement("input");
  input.className = "palette-input";
  input.type = "text";
  input.placeholder = "Go to file… (# for headings)";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");

  const resultsList = document.createElement("div");
  resultsList.className = "palette-results";

  card.appendChild(input);
  card.appendChild(resultsList);
  overlayEl.appendChild(card);

  overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) hide(); });

  function subseq(text: string, query: string): boolean {
    let qi = 0;
    for (let i = 0; i < text.length && qi < query.length; i++) {
      if (text[i] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  function renderResults(files: VaultFile[], headings: HeadingEntry[]): void {
    navItems = [];
    resultsList.replaceChildren();

    for (const f of files) {
      navItems.push({ type: 'file', file: f });
      const item = document.createElement("div");
      item.classList.add("palette-item");
      const nameSpan = document.createElement("span");
      nameSpan.className = "palette-item-name";
      nameSpan.textContent = f.name;
      const pathSpan = document.createElement("span");
      pathSpan.className = "palette-item-path";
      pathSpan.textContent = f.rel_path;
      item.appendChild(nameSpan);
      item.appendChild(pathSpan);
      const capturedFile = f;
      item.addEventListener("click", () => { if (currentOnSelect) currentOnSelect(capturedFile); hide(); });
      resultsList.appendChild(item);
    }

    if (headings.length > 0) {
      const divider = document.createElement("div");
      divider.className = "palette-divider";
      divider.textContent = "Headings";
      resultsList.appendChild(divider);

      for (const h of headings) {
        navItems.push({ type: 'heading', heading: h });
        const item = document.createElement("div");
        item.classList.add("palette-item");
        const levelSpan = document.createElement("span");
        levelSpan.className = "palette-item-level";
        levelSpan.textContent = `H${h.level}`;
        const nameSpan = document.createElement("span");
        nameSpan.className = "palette-item-name";
        nameSpan.textContent = h.text;
        const pathSpan = document.createElement("span");
        pathSpan.className = "palette-item-path";
        pathSpan.textContent = h.fileName;
        item.appendChild(levelSpan);
        item.appendChild(nameSpan);
        item.appendChild(pathSpan);
        const capturedH = h;
        item.addEventListener("click", () => { if (currentOnSelectHeading) currentOnSelectHeading(capturedH); hide(); });
        resultsList.appendChild(item);
      }
    }

    selectedIdx = 0;
    resultsList.querySelectorAll<HTMLElement>(".palette-item")[0]?.classList.add("selected");
  }

  function updateSelected(newIdx: number): void {
    const items = resultsList.querySelectorAll<HTMLElement>(".palette-item");
    items[selectedIdx]?.classList.remove("selected");
    selectedIdx = Math.max(0, Math.min(newIdx, navItems.length - 1));
    items[selectedIdx]?.classList.add("selected");
    items[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }

  function refresh(): void {
    const raw = input.value;
    if (raw.startsWith("#")) {
      const q = raw.slice(1).trim().toLowerCase();
      const matched = q
        ? allHeadings.filter(h => subseq(h.text.toLowerCase(), q)).slice(0, 50)
        : allHeadings.slice(0, 50);
      renderResults([], matched);
    } else {
      const q = raw.toLowerCase();
      const ff = q ? allFiles.filter(f => subseq(f.rel_path.toLowerCase(), q)).slice(0, 50) : allFiles.slice(0, 50);
      const hh = q ? allHeadings.filter(h => subseq(h.text.toLowerCase(), q)).slice(0, 10) : allHeadings.slice(0, 10);
      renderResults(ff, hh);
    }
  }

  input.addEventListener("input", refresh);

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); updateSelected(selectedIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); updateSelected(selectedIdx - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const nav = navItems[selectedIdx];
      if (!nav) return;
      if (nav.type === 'file' && currentOnSelect) currentOnSelect(nav.file);
      else if (nav.type === 'heading' && currentOnSelectHeading) currentOnSelectHeading(nav.heading);
      hide();
    } else if (e.key === "Escape") { e.preventDefault(); hide(); }
  });

  function hide(): void {
    overlayEl.classList.remove("visible");
    input.value = "";
    resultsList.replaceChildren();
    navItems = [];
    currentOnSelect = null;
    currentOnSelectHeading = null;
  }

  return {
    show(files, onSelect, headings, onSelectHeading) {
      currentOnSelect = onSelect;
      currentOnSelectHeading = onSelectHeading ?? null;
      allFiles = files;
      allHeadings = headings ?? [];
      overlayEl.classList.add("visible");
      input.value = "";
      renderResults(files.slice(0, 50), allHeadings.slice(0, 10));
      input.focus();
    },
    hide,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/palette.ts
git commit -m "feat: extend palette with heading results and # prefix mode"
```

---

### Task 7: `tree.ts` — broken-link badge

**Files:**
- Modify: `frontend/src/tree.ts`

- [ ] **Step 1: Replace `frontend/src/tree.ts` entirely**

```ts
import { VaultFile } from "./vault";

export interface TreeHandle {
  render(files: VaultFile[], activeAbsPath: string | null): void;
  setActive(absPath: string): void;
}

export function createTree(
  container: HTMLElement,
  onSelect: (file: VaultFile) => void,
  getBrokenFiles?: () => Set<string>,
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
    for (const f of rootFiles) ul.appendChild(makeFileItem(f));

    const sortedDirs = [...dirMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [dir, dirFiles] of sortedDirs) {
      const li = document.createElement("li");
      const toggle = document.createElement("span");
      toggle.className = "tree-dir-toggle";
      const isCollapsed = collapsed.has(dir);
      toggle.textContent = (isCollapsed ? "▶ " : "▼ ") + dir;
      toggle.addEventListener("click", () => {
        if (collapsed.has(dir)) collapsed.delete(dir); else collapsed.add(dir);
        rerender();
      });
      li.appendChild(toggle);

      if (!isCollapsed) {
        const subUl = document.createElement("ul");
        subUl.style.paddingLeft = "12px";
        for (const f of dirFiles) subUl.appendChild(makeFileItem(f));
        li.appendChild(subUl);
      }
      ul.appendChild(li);
    }

    container.replaceChildren(ul);
  }

  function makeFileItem(f: VaultFile): HTMLElement {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.classList.add("tree-file");
    if (f.abs_path === currentActive) span.classList.add("active");
    span.textContent = f.name;
    span.title = f.rel_path;
    span.addEventListener("click", () => onSelect(f));
    li.appendChild(span);

    if (getBrokenFiles && getBrokenFiles().has(f.abs_path)) {
      const badge = document.createElement("span");
      badge.className = "tree-badge-broken";
      badge.title = "Contains broken links";
      badge.textContent = "⚠";
      li.appendChild(badge);
    }

    return li;
  }

  return {
    render(files, activeAbsPath) {
      collapsed.clear();
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

- [ ] **Step 2: Type-check**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/tree.ts
git commit -m "feat: add broken-link badge to tree sidebar"
```

---

### Task 8: HTML + CSS

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/styles/app.css`

- [ ] **Step 1: Replace `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Skymark</title>
    <link rel="stylesheet" href="./src/styles/tokens.css" />
    <link rel="stylesheet" href="./src/styles/app.css" />
  </head>
  <body>
    <div id="app">
      <header class="titlebar">
        <span id="vault-prefix" hidden></span>
        <span class="doc-title" id="doc-title">Untitled</span>
        <span class="dirty-indicator" id="dirty-indicator" hidden>&#x25CF;</span>
      </header>
      <div id="tab-bar" hidden></div>
      <main class="panes">
        <section class="pane sidebar-pane" id="sidebar" hidden></section>
        <div id="sidebar-resizer" hidden></div>
        <section class="pane editor-pane" id="editor">
          <div id="reload-banner" hidden>
            <span id="reload-banner-msg">This file was changed on disk.</span>
            <button id="reload-confirm">Reload</button>
            <button id="reload-dismiss">Keep Mine</button>
          </div>
        </section>
        <section class="pane preview-pane" id="preview"></section>
      </main>
    </div>
    <script type="module" src="./src/main.ts"></script>
    <div id="toast-root"></div>
    <div id="palette-overlay"></div>
  </body>
</html>
```

- [ ] **Step 2: Update the Phase 3 vault-mode rule in `app.css`**

Find:
```css
.panes.vault-mode { grid-template-columns: 220px 1fr 1fr; }
```
Replace with (4 columns: sidebar / 4px resizer / editor / preview):
```css
.panes.vault-mode { grid-template-columns: 220px 4px 1fr 1fr; }
```

- [ ] **Step 3: Append new styles to `app.css`**

Add at the end of `frontend/src/styles/app.css`:

```css
/* ---- Tab bar ---------------------------------------------------------------- */

#tab-bar {
  display: flex;
  align-items: stretch;
  height: 34px;
  background: var(--color-bg);
  border-bottom: var(--pane-divider);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  user-select: none;
  flex-shrink: 0;
}
#tab-bar::-webkit-scrollbar { display: none; }

.tab-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-3);
  min-width: 80px;
  max-width: 200px;
  background: none;
  border: none;
  border-right: var(--pane-divider);
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-item:hover { background: var(--color-border); }
.tab-item.active { background: var(--color-surface); color: var(--color-text); }
.tab-item .tab-dirty { color: var(--color-accent); flex-shrink: 0; }
.tab-item .tab-ext-modified { color: var(--color-text-muted); flex-shrink: 0; }
.tab-item .tab-close { margin-left: auto; padding: 0 2px; flex-shrink: 0; opacity: 0.5; }
.tab-item .tab-close:hover { opacity: 1; }

/* ---- Sidebar resizer -------------------------------------------------------- */

#sidebar-resizer { width: 4px; cursor: col-resize; background: transparent; flex-shrink: 0; }
#sidebar-resizer:hover,
#sidebar-resizer:active { background: var(--color-accent); }

/* ---- Reload banner ---------------------------------------------------------- */

#reload-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-surface);
  border-bottom: var(--pane-divider);
  font-size: 12px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
#reload-banner button {
  padding: var(--space-1) var(--space-3);
  font-family: var(--font-ui);
  font-size: 12px;
  border: var(--pane-divider);
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-bg);
  color: var(--color-text);
}
#reload-banner button:hover { background: var(--color-border); }

/* ---- Heading palette items -------------------------------------------------- */

.palette-divider {
  padding: var(--space-1) var(--space-4);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-top: var(--pane-divider);
  margin-top: var(--space-1);
}
.palette-item-level {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: 3px;
  padding: 0 3px;
  flex-shrink: 0;
}

/* ---- Broken-link badge ----------------------------------------------------- */

.tree-badge-broken {
  margin-left: var(--space-1);
  font-size: 11px;
  color: var(--color-accent);
  flex-shrink: 0;
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/src/styles/app.css
git commit -m "feat: add tab bar, reload banner, and sidebar resizer to layout"
```

---

### Task 9: `main.ts` — full wiring

**Files:**
- Modify: `frontend/src/main.ts`

Read the file at `frontend/src/main.ts` before modifying it.

- [ ] **Step 1: Replace `frontend/src/main.ts` entirely**

```ts
import { createEditor } from "./editor";
import { createPreview } from "./preview";
import { createFileFlow } from "./files";
import { createDraftHandle } from "./draft";
import { showToast } from "./toast";
import { isTauri, openFile } from "./api";
import { createVaultHandle, VaultFile } from "./vault";
import { createTree } from "./tree";
import { createPalette } from "./palette";
import { createTabHandle } from "./tabs";
import { createHeadingIndex, HeadingEntry } from "./headings";
import { createLinkChecker } from "./links";
import { invoke } from "@tauri-apps/api/core";

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
const sidebarEl = document.getElementById("sidebar") as HTMLElement | null;
const paletteOverlayEl = document.getElementById("palette-overlay") as HTMLElement | null;
const titleEl = document.getElementById("doc-title") as HTMLElement | null;
const vaultPrefixEl = document.getElementById("vault-prefix") as HTMLElement | null;
const dirtyEl = document.getElementById("dirty-indicator") as HTMLElement | null;
const panesEl = document.querySelector(".panes") as HTMLElement | null;
const tabBarEl = document.getElementById("tab-bar") as HTMLElement | null;
const reloadBannerEl = document.getElementById("reload-banner") as HTMLElement | null;
const reloadConfirmEl = document.getElementById("reload-confirm") as HTMLElement | null;
const reloadDismissEl = document.getElementById("reload-dismiss") as HTMLElement | null;
const sidebarResizerEl = document.getElementById("sidebar-resizer") as HTMLElement | null;

if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl ||
    !vaultPrefixEl || !dirtyEl || !panesEl || !tabBarEl || !reloadBannerEl ||
    !reloadConfirmEl || !reloadDismissEl || !sidebarResizerEl) {
  throw new Error("missing layout host elements");
}

const sidebar = sidebarEl;
const paletteOverlay = paletteOverlayEl;
const title = titleEl;
const vaultPrefix = vaultPrefixEl;
const dirty = dirtyEl;
const panes = panesEl;
const tabBar = tabBarEl;
const reloadBanner = reloadBannerEl;
const reloadConfirm = reloadConfirmEl;
const reloadDismiss = reloadDismissEl;
const sidebarResizer = sidebarResizerEl;

const preview = createPreview(previewHost);
const files = createFileFlow();
const drafts = createDraftHandle();
const vault = createVaultHandle();
const headings = createHeadingIndex();
const links = createLinkChecker();
const tabs = createTabHandle((idx) => { void handleCloseTab(idx); });
const tree = createTree(sidebar, (file) => { void openVaultFile(file); }, () => links.getBrokenFiles());
const palette = createPalette(paletteOverlay);

const editor = createEditor(editorHost, (text) => {
  preview.update(text);
  files.markDirty();
  drafts.onDocChange(files.state.path, () => editor.getValue());
  if (tabs.active) {
    tabs.updateActive({ content: text, isDirty: true });
    rebindTabBar();
  }
});

files.onStateChange((s) => {
  updateTitlebar(s.path);
  dirty.hidden = !s.isDirty;
});

files.onAfterSave((_path) => {
  drafts.onExplicitSave(_path);
  tabs.updateActive({ isDirty: false });
  rebindTabBar();
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);

// ---- Keyboard shortcuts ----------------------------------------------------

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  if (e.key === "o" || e.key === "O") {
    if (e.shiftKey) {
      e.preventDefault();
      void openVault();
    } else {
      e.preventDefault();
      void (async () => {
        const content = await files.openInteractive();
        if (content !== null) { editor.setValue(content); preview.update(content); }
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
  } else if (e.key === "w" || e.key === "W") {
    if (tabs.active) { e.preventDefault(); void handleCloseTab(tabs.activeIdx); }
  } else if ((e.key === "p" || e.key === "P") && vault.root) {
    e.preventDefault();
    palette.show(
      vault.files,
      (file) => { void openVaultFile(file); },
      headings.getAll(),
      (h) => { void openHeading(h); },
    );
  } else if (e.key === "\\" || e.key === "|") {
    if (vault.root) { e.preventDefault(); toggleSidebar(); }
  }
});

// ---- Tab helpers -----------------------------------------------------------

function rebindTabBar(): void {
  tabs.renderBar(tabBar);
  tabBar.querySelectorAll<HTMLElement>(".tab-item").forEach((btn, i) => {
    btn.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("tab-close")) return;
      switchTab(i);
    });
  });
}

function switchTab(idx: number): void {
  if (tabs.active) {
    tabs.updateActive({
      content: editor.getValue(),
      cursorPos: editor.view.state.selection.main.anchor,
      scrollTop: editor.view.scrollDOM.scrollTop,
    });
  }
  tabs.activateTab(idx);
  const entry = tabs.active!;
  editor.setValue(entry.content);
  files.clearDirty();
  editor.view.dispatch({ selection: { anchor: entry.cursorPos }, scrollIntoView: true });
  editor.view.scrollDOM.scrollTop = entry.scrollTop;
  preview.update(entry.content);
  tree.setActive(entry.absPath);
  updateTitlebar(entry.absPath);
  reloadBanner.hidden = !entry.externallyModified;
  rebindTabBar();
}

async function handleCloseTab(idx: number): Promise<void> {
  const entry = tabs.entries[idx];
  if (!entry) return;
  if (entry.isDirty) {
    const discard = confirm(`Discard unsaved changes to "${basename(entry.absPath)}"?`);
    if (!discard) return;
    entry.isDirty = false;
  }
  tabs.closeTab(idx);
  const active = tabs.active;
  if (active) {
    editor.setValue(active.content);
    files.clearDirty();
    preview.update(active.content);
    tree.setActive(active.absPath);
    updateTitlebar(active.absPath);
    reloadBanner.hidden = !active.externallyModified;
  } else {
    editor.setValue("");
    preview.update("");
    files.newDocument();
    reloadBanner.hidden = true;
  }
  rebindTabBar();
  void watchCurrentTabs();
}

// ---- Vault helpers ---------------------------------------------------------

async function openVault(): Promise<void> {
  const ok = await vault.open();
  if (!ok) return;

  const prevPaths = tabs.entries.map(e => e.absPath);
  tabs.clearAll();
  for (const p of prevPaths) headings.remove(p);
  links.clear();

  sidebar.hidden = false;
  sidebarResizer.hidden = false;
  tabBar.hidden = false;
  panes.classList.add("vault-mode");

  const savedWidth = localStorage.getItem('skymark:sidebar-width');
  if (savedWidth) panes.style.gridTemplateColumns = `${savedWidth}px 4px 1fr 1fr`;

  tree.render(vault.files, null);

  const autoFile =
    vault.files.find(f => /^(index|readme)\.md$/i.test(f.name)) ??
    vault.files[0];

  if (!autoFile) {
    showToast("No Markdown files found in this folder");
    return;
  }

  await openVaultFile(autoFile);
  void watchCurrentTabs();
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

  const existing = tabs.entries.findIndex(e => e.absPath === file.abs_path);
  if (existing !== -1) { switchTab(existing); return; }

  if (tabs.active) {
    tabs.updateActive({
      content: editor.getValue(),
      cursorPos: editor.view.state.selection.main.anchor,
      scrollTop: editor.view.scrollDOM.scrollTop,
    });
  }

  const content = await files.loadFile(file.abs_path);
  tabs.addTab(file.abs_path, content);
  editor.setValue(content);
  files.clearDirty();
  preview.update(content);
  tree.setActive(file.abs_path);
  updateTitlebar(file.abs_path);
  reloadBanner.hidden = true;

  headings.index(file.abs_path, file.rel_path, file.name, content);
  links.update(file.abs_path, content, vault.files);
  tabs.persist();
  rebindTabBar();
  void watchCurrentTabs();
}

async function openHeading(h: HeadingEntry): Promise<void> {
  const existing = tabs.entries.findIndex(e => e.absPath === h.absPath);
  if (existing !== -1) {
    switchTab(existing);
  } else {
    const content = await files.loadFile(h.absPath);
    tabs.addTab(h.absPath, content);
    editor.setValue(content);
    files.clearDirty();
    preview.update(content);
    tree.setActive(h.absPath);
    updateTitlebar(h.absPath);
    reloadBanner.hidden = true;
    headings.index(h.absPath, h.relPath, h.fileName, content);
    links.update(h.absPath, content, vault.files);
    tabs.persist();
    rebindTabBar();
    void watchCurrentTabs();
  }
  editor.scrollToLine(h.line);
}

async function watchCurrentTabs(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("watch_paths", { paths: tabs.entries.map(e => e.absPath) });
  } catch {
    showToast("File watching unavailable");
  }
}

// ---- Watcher events --------------------------------------------------------

if (isTauri()) {
  void (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("file-changed", (event) => {
      const changedPath = event.payload;
      const tabIdx = tabs.entries.findIndex(e => e.absPath === changedPath);
      if (tabIdx === -1) return;
      if (tabIdx === tabs.activeIdx) {
        reloadBanner.hidden = false;
      } else {
        tabs.markExternallyModified(tabIdx);
        rebindTabBar();
      }
    });
  })();
}

reloadConfirm.addEventListener("click", () => {
  const active = tabs.active;
  if (!active) return;
  void (async () => {
    const content = await files.loadFile(active.absPath);
    tabs.updateActive({ content, externallyModified: false });
    editor.setValue(content);
    files.clearDirty();
    preview.update(content);
    reloadBanner.hidden = true;
    rebindTabBar();
  })();
});

reloadDismiss.addEventListener("click", () => {
  tabs.updateActive({ externallyModified: false });
  reloadBanner.hidden = true;
  rebindTabBar();
});

// ---- Sidebar resize --------------------------------------------------------

sidebarResizer.addEventListener("pointerdown", (e) => {
  const startX = e.clientX;
  const startWidth = sidebar.offsetWidth;
  sidebarResizer.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => {
    const w = Math.min(480, Math.max(160, startWidth + ev.clientX - startX));
    panes.style.gridTemplateColumns = `${w}px 4px 1fr 1fr`;
    localStorage.setItem('skymark:sidebar-width', String(w));
  };
  const onUp = () => {
    sidebarResizer.removeEventListener("pointermove", onMove);
    sidebarResizer.removeEventListener("pointerup", onUp);
  };
  sidebarResizer.addEventListener("pointermove", onMove);
  sidebarResizer.addEventListener("pointerup", onUp);
});

function toggleSidebar(): void {
  sidebar.hidden = !sidebar.hidden;
  sidebarResizer.hidden = sidebar.hidden;
}

function updateTitlebar(filePath: string | null): void {
  title.textContent = filePath ? basename(filePath) : "Untitled";
  if (vault.root) {
    vaultPrefix.textContent = basename(vault.root) + " /";
    vaultPrefix.hidden = false;
  } else {
    vaultPrefix.hidden = true;
  }
}

// ---- Draft recovery on launch ----------------------------------------------

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

// ---- Startup tab restoration -----------------------------------------------

void (async () => {
  if (!vault.root) return;
  const saved = tabs.restore();
  for (const { absPath } of saved) {
    try {
      const opened = await openFile(absPath);
      const relPath = opened.path.slice(vault.root!.length + 1);
      const fileName = basename(opened.path);
      tabs.addTab(opened.path, opened.content);
      headings.index(opened.path, relPath, fileName, opened.content);
      links.update(opened.path, opened.content, vault.files);
    } catch {
      // file no longer exists
    }
  }
  if (tabs.active) {
    editor.setValue(tabs.active.content);
    files.clearDirty();
    preview.update(tabs.active.content);
    tree.setActive(tabs.active.absPath);
    updateTitlebar(tabs.active.absPath);
    rebindTabBar();
    void watchCurrentTabs();
  }
})();

// ---- Save-on-close ---------------------------------------------------------

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

// ---- Utilities -------------------------------------------------------------

function basename(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx >= 0 ? path.slice(idx + 1) : path;
}
```

**TypeScript issues to watch for:**

- `files.onAfterSave` passes the saved path to a callback. If the `onAfterSave` callback type is `(path: string) => void`, rename `_path` to `path` in the callback. If TypeScript complains about an unused `path` parameter, prefix it: `(_path)`.
- `tabs.active!` in `switchTab` — safe because `activateTab` was just called.
- The double `// file no longer exists` empty catch is valid TypeScript with `strict` mode when there is no exception variable.

- [ ] **Step 2: Type-check**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | tail -20
```
Expected: `built in` success, no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat: wire tabs, watcher, resize, headings, and link checker in main.ts"
```

---

### Task 10: Smoke test

- [ ] **Step 1: Full test suite**

```bash
cargo test --workspace 2>&1 | tail -20
```
Expected: all pass (skymark-app at least 19 tests).

- [ ] **Step 2: TypeScript clean**

```bash
npx tsc -p frontend/tsconfig.json --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 3: Build clean**

```bash
npm run build 2>&1 | tail -10
```
Expected: `built in` line, no errors.

- [ ] **Step 4: Launch**

```bash
npm run tauri:dev
```

- [ ] **Step 5: Multi-tab — open vault (`Cmd+Shift+O`), open two files from sidebar, verify two tabs appear. Click between them — content switches, no false dirty. Edit a file, verify `●` on its tab. `Cmd+W` on dirty tab — confirm dialog appears.**

- [ ] **Step 6: Sidebar resize — drag the 4px resizer; width changes live. Quit and relaunch — width restored.**

- [ ] **Step 7: File watcher — open a file, then from terminal append to it. Reload banner appears within ~1 second. "Reload" updates editor. Edit a background tab externally — `⊙` appears on its tab button.**

- [ ] **Step 8: Broken-link badge — create a file with `[bad](missing.md)`, open it in vault mode. `⚠` badge appears next to it in the sidebar.**

- [ ] **Step 9: Heading search — open a file with `# H1` and `## H2`. `Cmd+P` shows heading results below the divider. Type `#h` — only headings show. Click a heading — file opens and scrolls to that line.**

- [ ] **Step 10: Commit any fixes**

```bash
git add -p
git commit -m "fix: smoke test corrections"
```

---

## Definition of Done

- `cargo test --workspace` passes (skymark-app at least 19 tests).
- `npx tsc -p frontend/tsconfig.json --noEmit` exits clean.
- `npm run build` exits clean.
- All smoke-test steps pass.
- All commits authored as `zuojin@gmail.com`.
