# Skymark Phase 4 — Vault Enhancements Design Spec

- **Date:** 2026-05-08
- **Status:** Approved
- **Owner:** jinzuo

## 1. Goal

Extend vault mode with five features: multi-tab editing, file watcher (external edit detection), sidebar resize handle, broken-link detection badges, and heading search in the `Cmd+P` palette.

## 2. Scope

### In scope

- **Multi-tab editing:** open files always open in a new tab; single CodeMirror editor with swapped content on switch; tab bar strip; dirty indicator per tab; close-tab dirty guard; open tabs + sidebar width persist via `localStorage`.
- **File watcher:** watch all open tab paths via the `notify` crate; emit `file-changed` Tauri events; frontend shows a reload banner on the active tab and an indicator on inactive tabs.
- **Sidebar resize:** drag handle between sidebar and editor; width clamped 160–480px; persists to `localStorage`.
- **Broken-link detection:** scan open files for `[text](rel/path.md)` and `[[wikilink]]` links; check against vault file list; render a `⚠` badge on tree nodes with broken outgoing links.
- **Heading search:** index headings from open tabs; `Cmd+P` shows heading results below file results; `#`-prefixed query searches headings only; selecting a heading opens the file and scrolls to that line.

### Explicitly deferred

- Full-vault background heading index (only open tabs are indexed).
- Multi-level heading search (headings from files not yet opened).
- Tab persistence across vault switches (tabs are cleared on vault reopen).
- Tab drag-to-reorder.
- Wikilink autocomplete.
- Multi-tab draft recovery (Phase 5).

## 3. Architecture

### 3.1 New files

```
crates/skymark-app/src/watcher.rs   — WatcherState, watch_paths, unwatch_paths commands
frontend/src/tabs.ts                — TabHandle: tab array, active tab, tab bar DOM, persistence
frontend/src/headings.ts            — HeadingIndex: extract + search headings from open files
frontend/src/links.ts               — LinkChecker: parse + check relative links and wikilinks
```

### 3.2 Modified files

```
Cargo.toml                          — add notify-debouncer-mini to workspace.dependencies
crates/skymark-app/Cargo.toml       — add notify-debouncer-mini dependency
crates/skymark-app/src/main.rs      — manage WatcherState, register watcher commands
frontend/src/editor.ts              — add scrollToLine(line: number) to EditorHandle
frontend/src/main.ts                — wire tabs, watcher events, resize, link checker, heading search
frontend/src/palette.ts             — extend show() to accept headings + render heading results
frontend/src/tree.ts                — accept getBrokenFiles callback, render ⚠ badge
frontend/index.html                 — tab bar, reload banner, sidebar resizer
frontend/src/styles/app.css         — tab bar, reload banner, resizer, badge styles
```

### 3.3 Unchanged files

`vault.ts`, `files.ts`, `preview.ts`, `draft.ts`, `toast.ts`, `api.ts`, `smart_edit.ts`, `tokens.css`, `skymark-core/*`

### 3.4 Layering

`watcher.rs` depends only on `notify-debouncer-mini`, `tauri`, and `std`. The frontend components (`tabs.ts`, `headings.ts`, `links.ts`) have no knowledge of each other — they communicate with `main.ts` via callbacks and returned data. `palette.ts` and `tree.ts` are extended via new optional parameters, keeping their interfaces backward-compatible with any callers that do not use the new features.

## 4. Rust Backend — `watcher.rs`

### 4.1 Cargo dependency

Add to `Cargo.toml` `[workspace.dependencies]`:
```toml
notify-debouncer-mini = "0.4"
```

Add to `crates/skymark-app/Cargo.toml` `[dependencies]`:
```toml
notify-debouncer-mini.workspace = true
```

### 4.2 Data types and state

```rust
use notify_debouncer_mini::Debouncer;
use notify::RecommendedWatcher;
use std::sync::Mutex;

pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}
```

Register in `main.rs` setup:
```rust
.manage(watcher::WatcherState { debouncer: Mutex::new(None) })
```

### 4.3 Commands

```rust
#[tauri::command]
pub fn watch_paths(
    paths: Vec<String>,
    state: tauri::State<WatcherState>,
    app: tauri::AppHandle,
) -> Result<(), String>
```

Behavior:
1. Drop any existing debouncer (replacing the watch set).
2. Create a new `Debouncer` with 500ms debounce.
3. For each path, call `debouncer.watcher().watch(path, RecursiveMode::NonRecursive)`.
4. On debounced event, emit `"file-changed"` to all windows with the changed path as payload (normalized with `replace('\\', "/")`).
5. Store the debouncer in `state.debouncer`.

```rust
#[tauri::command]
pub fn unwatch_paths(state: tauri::State<WatcherState>) -> Result<(), String>
```

Drops the debouncer (`*state.debouncer.lock().unwrap() = None`), stopping all watches.

### 4.4 Tests

`watcher.rs` requires the Tauri event system and a real filesystem — no pure unit tests. Covered by smoke testing in Task 8.

## 5. Frontend Components

### 5.1 `tabs.ts` — tab handle

```ts
export interface TabEntry {
  absPath: string;
  isDirty: boolean;
  content: string;
  cursorPos: number;      // EditorState selection anchor (character offset)
  scrollTop: number;      // editor scroll DOM scrollTop pixels
  externallyModified: boolean;
}

export interface TabHandle {
  readonly entries: TabEntry[];
  readonly activeIdx: number;
  readonly active: TabEntry | null;
  addTab(absPath: string, content: string): void;
  closeTab(idx: number): boolean;         // returns false if dirty (caller shows confirm)
  activateTab(idx: number): void;
  updateActive(patch: Partial<Pick<TabEntry, 'content' | 'isDirty' | 'cursorPos' | 'scrollTop' | 'externallyModified'>>): void;
  markExternallyModified(idx: number): void;  // marks an inactive tab; no-op if idx is activeIdx (use updateActive instead)
  clearAll(): void;                            // closes all tabs unconditionally (no dirty guard); used on vault reopen
  onActiveChange(listener: (entry: TabEntry | null) => void): void;
  renderBar(container: HTMLElement): void; // full re-render of tab bar DOM
  persist(): void;                         // write to localStorage
  restore(): Array<{ absPath: string }>;   // read from localStorage; returns [] if nothing stored
}

export function createTabHandle(onCloseClick: (idx: number) => void): TabHandle
```

`addTab`: if a tab for `absPath` already exists, activate it instead of duplicating. Otherwise push a new `TabEntry` and activate it.

`closeTab(idx)`: if `entries[idx].isDirty`, return `false` (caller handles confirm). Otherwise splice the entry, adjust `activeIdx`, fire `onActiveChange`, call `persist()`, return `true`.

`renderBar(container)`: replaces container children with one `<button class="tab-item [active] [dirty] [ext-modified]">` per entry. Each button shows the filename (basename of absPath), a `●` if dirty, a `⊙` if externallyModified, and a `<span class="tab-close">×</span>`. Clicking the button body calls `activateTab`; clicking `×` calls `onCloseClick(idx)`.

`persist()`: `localStorage.setItem('skymark:tabs', JSON.stringify({ paths: entries.map(e => e.absPath), activeIdx }))`.

`restore()`: reads and parses `localStorage.getItem('skymark:tabs')`; returns array of `{ absPath }` objects, or `[]` on missing/invalid data.

### 5.2 `editor.ts` addition — `scrollToLine`

Add to `EditorHandle` interface:
```ts
scrollToLine(line: number): void;  // 0-based line number
```

Implementation:
```ts
scrollToLine(line) {
  const doc = view.state.doc;
  const target = doc.line(Math.min(line + 1, doc.lines)); // doc.line is 1-based
  view.dispatch({
    selection: { anchor: target.from },
    scrollIntoView: true,
  });
},
```

### 5.3 `headings.ts` — heading index

```ts
export interface HeadingEntry {
  text: string;
  level: number;        // 1–6
  line: number;         // 0-based line number
  absPath: string;
  relPath: string;
  fileName: string;
}

export interface HeadingIndex {
  index(absPath: string, relPath: string, fileName: string, content: string): void;
  remove(absPath: string): void;
  getAll(): HeadingEntry[];               // all indexed headings sorted by absPath then line (no cap)
  search(query: string): HeadingEntry[];  // subsequence match on text, up to 50
}

export function createHeadingIndex(): HeadingIndex
```

`index()`: parses headings from `content` using `/^(#{1,6}) +(.+)/gm`. Replaces any existing entries for `absPath`.

`search(query)`: empty query returns all indexed headings (up to 50, sorted by absPath then line). Non-empty uses subsequence match on `heading.text.toLowerCase()`.

### 5.4 `links.ts` — link checker

```ts
export interface LinkChecker {
  update(absPath: string, content: string, vaultFiles: VaultFile[]): void;
  getBrokenFiles(): Set<string>;   // abs paths of files with ≥1 broken outgoing link
  remove(absPath: string): void;
  clear(): void;
}

export function createLinkChecker(): LinkChecker
```

`update()`: extracts all link targets from `content`:
- Relative Markdown: `/\[(?:[^\]]*)\]\(([^)#]+)\)/g` — capture group 1 is the target path. Resolve relative to the file's directory within the vault (strip the file's dir prefix from `absPath`, join with target). Check if any `VaultFile.abs_path` matches. Ignore http/https URLs and anchor-only links (`#...`).
- Wikilinks: `/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g` — capture group 1 is the target name. Match against `VaultFile.name` (case-insensitive, with or without `.md` extension).

If any link target is unresolvable, the file's `absPath` is added to the broken set.

`remove(absPath)`: removes the entry for that file from the broken set.

`clear()`: resets all state.

### 5.5 `palette.ts` extension

`show()` gains optional heading parameters:

```ts
export interface PaletteHandle {
  show(
    files: VaultFile[],
    onSelect: (file: VaultFile) => void,
    headings?: HeadingEntry[],
    onSelectHeading?: (heading: HeadingEntry) => void,
  ): void;
  hide(): void;
}
```

Query logic:
- Query starts with `#`: strip `#`, search headings only using subsequence match on `heading.text`.
- Otherwise: show file results (existing behavior, up to 50), then if `headings` is provided, show a `<div class="palette-divider">Headings</div>` separator and up to 10 heading results below.

Heading result items: `<span class="palette-item-name">` for heading text, `<span class="palette-item-level">H{n}</span>` badge, `<span class="palette-item-path">` for filename.

`updateSelected` is extended to work across both file and heading result items.

### 5.6 `tree.ts` extension

`createTree` gains an optional third parameter:

```ts
export function createTree(
  container: HTMLElement,
  onSelect: (file: VaultFile) => void,
  getBrokenFiles?: () => Set<string>,
): TreeHandle
```

In `makeFileItem`: if `getBrokenFiles` is provided and `f.abs_path` is in the returned set, append `<span class="tree-badge-broken" title="Contains broken links">⚠</span>` after the file name span.

### 5.7 `main.ts` — wiring

**New DOM references:**
- `tabBarEl` = `#tab-bar`
- `reloadBannerEl` = `#reload-banner`
- `reloadConfirmEl` = `#reload-confirm` (button inside banner)
- `reloadDismissEl` = `#reload-dismiss` (button inside banner)
- `sidebarResizerEl` = `#sidebar-resizer`

**New instances:**
```ts
const tabs = createTabHandle((idx) => handleCloseTab(idx));
const headings = createHeadingIndex();
const links = createLinkChecker();
```

**`tree` creation updated:**
```ts
const tree = createTree(sidebarEl, (file) => { void openVaultFile(file); }, () => links.getBrokenFiles());
```

**`palette` call updated** (in Cmd+P handler):
```ts
palette.show(
  vault.files,
  (file) => { void openVaultFile(file); },
  headings.getAll(),        // all indexed headings passed; palette filters internally
  (h) => { void openHeading(h); },
);
```

**Tab switch flow** (`activateTab(idx)` wrapper in main.ts):
1. Save active tab state: `tabs.updateActive({ content: editor.getValue(), cursorPos: editor.view.state.selection.main.anchor, scrollTop: editor.view.scrollDOM.scrollTop })`.
2. `tabs.activateTab(idx)`.
3. `editor.setValue(entry.content)`, `files.clearDirty()`.
4. Restore cursor: `editor.view.dispatch({ selection: { anchor: entry.cursorPos }, scrollIntoView: true })`.
5. Restore scroll: `editor.view.scrollDOM.scrollTop = entry.scrollTop`.
6. `tree.setActive(entry.absPath)`, `updateTitlebar(entry.absPath)`.
7. Update reload banner visibility (show if `entry.externallyModified`).
8. `tabs.renderBar(tabBarEl)`.

**`openVaultFile`** updated: calls `tabs.addTab(file.abs_path, content)` after `files.loadFile`. No longer directly calls `tree.setActive` / `updateTitlebar` — those are handled by the tab switch flow.

**`openHeading(h)` helper:**
1. Check if tab for `h.absPath` exists; if not, load file via `files.loadFile` and `tabs.addTab`.
2. Activate the tab.
3. `editor.scrollToLine(h.line)`.

**File watcher events:**
```ts
await listen<string>("file-changed", (event) => {
  const changedPath = event.payload;
  const tabIdx = tabs.entries.findIndex(e => e.absPath === changedPath);
  if (tabIdx === -1) return;
  if (tabIdx === tabs.activeIdx) {
    reloadBannerEl.hidden = false;
  } else {
    tabs.markExternallyModified(tabIdx);
    tabs.renderBar(tabBarEl);
  }
});
```

`reloadConfirmEl.addEventListener("click", ...)`: re-reads file via `openFile(activeAbsPath)`, updates tab content, `editor.setValue`, `files.clearDirty()`, hides banner, sets `externallyModified: false`.

`reloadDismissEl.addEventListener("click", ...)`: hides banner, sets `externallyModified: false`.

**Sidebar resize:**
```ts
sidebarResizerEl.addEventListener("pointerdown", (e) => {
  const startX = e.clientX;
  const startWidth = sidebarEl.offsetWidth;
  sidebarResizerEl.setPointerCapture(e.pointerId);

  const onMove = (e: PointerEvent) => {
    const w = Math.min(480, Math.max(160, startWidth + e.clientX - startX));
    panesEl.style.gridTemplateColumns = `${w}px 4px 1fr 1fr`;
    localStorage.setItem('skymark:sidebar-width', String(w));
  };
  const onUp = () => {
    sidebarResizerEl.removeEventListener("pointermove", onMove);
    sidebarResizerEl.removeEventListener("pointerup", onUp);
  };
  sidebarResizerEl.addEventListener("pointermove", onMove);
  sidebarResizerEl.addEventListener("pointerup", onUp);
});
```

On startup: read `localStorage.getItem('skymark:sidebar-width')` and apply to `panesEl.style.gridTemplateColumns` if vault mode is active.

**Startup tab restoration:**
```ts
const saved = tabs.restore();
for (const { absPath } of saved) {
  try {
    const opened = await openFile(absPath);
    tabs.addTab(opened.path, opened.content);
    headings.index(opened.path, opened.path.slice(vault.root!.length + 1), basename(opened.path), opened.content);
    links.update(opened.path, opened.content, vault.files);
  } catch {
    // file no longer exists — skip silently
  }
}
```

**On vault open:** `tabs.clearAll()` to clear existing tabs (no dirty guard — vault switch implies intent to switch context). Then proceed with auto-open as Phase 3.

## 6. Layout & CSS

### 6.1 HTML additions (`index.html`)

```html
<!-- after <header class="titlebar"> -->
<div id="tab-bar" hidden></div>

<!-- inside .panes, between sidebar and editor -->
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
```

### 6.2 CSS additions (`app.css`)

```css
/* ── Tab bar ────────────────────────────────────────────────────────────── */

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
.tab-item .tab-close {
  margin-left: auto;
  padding: 0 2px;
  flex-shrink: 0;
  opacity: 0.5;
}
.tab-item .tab-close:hover { opacity: 1; }

/* ── Sidebar resizer ────────────────────────────────────────────────────── */

#sidebar-resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
}
#sidebar-resizer:hover,
#sidebar-resizer:active { background: var(--color-accent); }

/* ── Vault mode layout (replaces Phase 3 rule: was `220px 1fr 1fr`) ─────── */

.panes.vault-mode { grid-template-columns: var(--sidebar-width, 220px) 4px 1fr 1fr; }

/* ── Reload banner ──────────────────────────────────────────────────────── */

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

/* ── Heading palette items ──────────────────────────────────────────────── */

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

/* ── Broken-link badge ──────────────────────────────────────────────────── */

.tree-badge-broken {
  margin-left: var(--space-1);
  font-size: 11px;
  color: var(--color-accent);
  flex-shrink: 0;
}
```

### 6.3 CSS variable update

Add to `tokens.css` (or inline in vault-mode rule):
```css
:root { --sidebar-width: 220px; }
```

The resize handler sets `panesEl.style.gridTemplateColumns` directly (as shown in §5.7) — no CSS variable needed on the element.

## 7. Keyboard Shortcuts (full updated table)

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+O` | Open file (always opens in new tab) |
| `Cmd/Ctrl+Shift+O` | Open vault (folder) |
| `Cmd/Ctrl+S` | Save active tab |
| `Cmd/Ctrl+N` | New document (new empty tab) |
| `Cmd/Ctrl+W` | Close active tab |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `Cmd/Ctrl+F` | Find in editor |
| `Cmd/Ctrl+P` | Fuzzy file + heading search (vault mode only) |
| `Cmd/Ctrl+\` | Toggle sidebar |

## 8. Error Handling

| Scenario | Handling |
|---|---|
| Restored tab file no longer exists | Skip silently (file removed between sessions) |
| `watch_paths` fails (permissions, OS limit) | Log to console; toast "File watching unavailable" |
| `file-changed` fires for file with no open tab | Ignore |
| Broken wikilink target ambiguous (multiple matches) | Treat as resolved (not broken) — conservative |
| Tab close with dirty content | `confirm("Discard unsaved changes to <filename>?")` — Cancel aborts close |
| Vault reopened with open tabs | Close all tabs without dirty-guard (vault switch = intentional) |

## 9. Definition of Done

- [ ] `cargo test --workspace` passes (skymark-app ≥18, skymark-core ≥38).
- [ ] `npx tsc -p frontend/tsconfig.json --noEmit` clean.
- [ ] `npm run build` clean.
- [ ] Opening files always adds a new tab; clicking an already-open file activates its tab.
- [ ] `Cmd+W` closes active tab; dirty tab shows confirm.
- [ ] Tab bar and sidebar width persist across app restarts.
- [ ] Editing a file externally triggers the reload banner on the active tab.
- [ ] Drag-resizing the sidebar updates the layout live; width is remembered.
- [ ] `⚠` badge appears on tree nodes for files with broken links.
- [ ] `Cmd+P` shows heading results; selecting one opens file and scrolls to heading.
- [ ] `#query` in palette searches headings only.
- [ ] All commits authored as `zuojin@gmail.com`.

## 10. What Phase 5 Inherits

- Multi-tab draft recovery (per-tab draft key on startup).
- File watcher integration with broken-link re-scan (external edits trigger link re-check).
- Full-vault heading index (background batch read of all files on vault open).
- Tab drag-to-reorder.
- Math rendering (KaTeX) in preview — original roadmap Phase 4.
