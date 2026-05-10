# Phase 6: Export (HTML + PDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Export as HTML" (CDN-linked, serialized from the live preview DOM) and "Print / Save as PDF" (OS print dialog) behind an "Export ▾" dropdown in the titlebar.

**Architecture:** The HTML export reads `previewEl.innerHTML` — the already-enriched DOM (KaTeX rendered, hljs highlighted, Mermaid SVG) — wraps it in an HTML template with CDN CSS links (no JS needed), then writes it via a new `export_file` Tauri command. PDF export calls `window.print()` with `@media print` CSS hiding everything except the preview content. No new Tauri capabilities needed; `dialog:allow-save` already exists.

**Tech Stack:** Rust + Tauri 2 (backend), TypeScript + Vite (frontend), `@tauri-apps/plugin-dialog` (save dialog), `@tauri-apps/api/core` (IPC invoke).

---

## File Map

| Action | Path |
|--------|------|
| Modify | `crates/skymark-app/src/commands.rs` — add `export_file` command + tests |
| Modify | `crates/skymark-app/src/main.rs` — register `export_file` |
| Modify | `frontend/src/api.ts` — add `exportFile()` IPC wrapper |
| Modify | `frontend/src/preview.ts` — add `getContentEl()` to `PreviewHandle` |
| Create | `frontend/src/export.ts` — `exportHtml()` and `exportPdf()` |
| Create | `frontend/src/export-dropdown.ts` — "Export ▾" button + popover UI |
| Modify | `frontend/src/styles/app.css` — export button styles + `@media print` |
| Modify | `frontend/index.html` — add `#export-dropdown-root` to titlebar |
| Modify | `frontend/src/main.ts` — query element, mount dropdown |

---

## Task 1: `export_file` Tauri command (TDD)

**Files:**
- Modify: `crates/skymark-app/src/commands.rs`
- Modify: `crates/skymark-app/src/main.rs`

- [ ] **Step 1: Add the stub + tests to `commands.rs`**

Add the stub function and its tests. The stub always returns an error so tests can fail before the real implementation. Add both before the closing `}` of the existing `mod tests` block.

First, add the stub before `validate_markdown_path` (after `save_file`):

```rust
#[tauri::command]
pub fn export_file(path: String, _content: String) -> Result<(), String> {
    let _ = path;
    Err("not implemented".into())
}
```

Then, inside `mod tests { ... }`, add three new tests after the last existing test:

```rust
#[test]
fn export_file_writes_html_content() {
    let dir = std::env::temp_dir().join(format!("skymark-export-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("out.html");
    let content = "<h1>Hello</h1>".to_string();

    let result = export_file(path.to_string_lossy().into_owned(), content.clone());
    assert!(result.is_ok(), "expected ok, got: {:?}", result);

    let written = std::fs::read_to_string(&path).unwrap();
    assert_eq!(written, content);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn export_file_rejects_relative_path() {
    let result = export_file("relative/out.html".into(), "x".into());
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("absolute"), "error should mention absolute");
}

#[test]
fn export_file_rejects_non_html_extension() {
    let result = export_file("/tmp/out.pdf".into(), "x".into());
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("html"), "error should mention html");
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test -p skymark-app export_file 2>&1 | tail -20
```

Expected: 3 failures — `export_file_writes_html_content` fails because the stub returns `Err("not implemented")`.

- [ ] **Step 3: Replace the stub with the real implementation**

Replace the stub `export_file` function with:

```rust
#[tauri::command]
pub fn export_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    match p.extension().and_then(|e| e.to_str()) {
        Some("html") => {}
        _ => return Err("only .html extension is supported for export".into()),
    }
    let parent = p.parent().ok_or_else(|| "path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
    let tmp = parent.join(format!(
        ".{}.tmp",
        p.file_name().and_then(|s| s.to_str()).unwrap_or("export")
    ));
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test -p skymark-app export_file 2>&1 | tail -20
```

Expected: `test result: ok. 3 passed; 0 failed`

- [ ] **Step 5: Register `export_file` in `main.rs`**

Open `crates/skymark-app/src/main.rs`. The `invoke_handler` block currently ends with `watcher::unwatch_paths`. Add `commands::export_file` to the list:

```rust
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
```

- [ ] **Step 6: Run full test suite**

```bash
cargo test -p skymark-app 2>&1 | tail -10
```

Expected: all existing tests still pass plus the 3 new ones.

- [ ] **Step 7: Commit**

```bash
git add crates/skymark-app/src/commands.rs crates/skymark-app/src/main.rs
git commit -m "feat: add export_file Tauri command"
```

---

## Task 2: Frontend API bridge

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Append `exportFile` to `api.ts`**

Open `frontend/src/api.ts`. Add the following before the `function escapeHtml` definition at the bottom:

```ts
export async function exportFile(path: string, content: string): Promise<void> {
  await invoke<void>("export_file", { path, content });
}
```

The `invoke` import already exists at the top of the file.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors related to `api.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add exportFile IPC wrapper"
```

---

## Task 3: Expose `getContentEl` from preview

**Files:**
- Modify: `frontend/src/preview.ts`

- [ ] **Step 1: Add `getContentEl` to the `PreviewHandle` interface**

Open `frontend/src/preview.ts`. The interface currently is:

```ts
export interface PreviewHandle {
  update(text: string): void;
}
```

Change it to:

```ts
export interface PreviewHandle {
  update(text: string): void;
  getContentEl(): HTMLElement;
}
```

- [ ] **Step 2: Add `getContentEl` to the returned object**

The `createPreview` function currently returns:

```ts
  return {
    update(text: string): void {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        inflight += 1;
        const id = inflight;
        void commit(text, id);
      }, 50);
    },
  };
```

Change it to:

```ts
  return {
    update(text: string): void {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        inflight += 1;
        const id = inflight;
        void commit(text, id);
      }, 50);
    },
    getContentEl(): HTMLElement {
      return content;
    },
  };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/preview.ts
git commit -m "feat: expose getContentEl on PreviewHandle"
```

---

## Task 4: Create `export.ts`

**Files:**
- Create: `frontend/src/export.ts`

- [ ] **Step 1: Create the file**

Create `frontend/src/export.ts` with the following content:

```ts
import { save } from "@tauri-apps/plugin-dialog";
import { exportFile } from "./api";
import { showToast } from "./toast";

export async function exportHtml(previewEl: HTMLElement, title: string): Promise<void> {
  const bodyHtml = previewEl.innerHTML;
  const html = buildHtml(title, bodyHtml);
  const path = await save({ filters: [{ name: "HTML", extensions: ["html"] }] });
  if (path === null) return;
  try {
    await exportFile(path, html);
    const filename = path.split(/[/\\]/).pop() ?? path;
    showToast(`Exported to ${filename}`);
  } catch (err) {
    showToast(`Export failed: ${String(err)}`);
  }
}

export function exportPdf(): void {
  window.print();
}

function buildHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeTitle(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11/styles/github.min.css" />
  <style>
    body { max-width: 800px; margin: 40px auto; padding: 0 24px; font-family: system-ui, sans-serif; line-height: 1.6; color: #1c1917; }
    pre { background: #f5f5f4; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
    code { font-family: ui-monospace, monospace; font-size: 0.9em; }
    blockquote { border-left: 4px solid #d6d3d1; margin: 0; padding-left: 16px; color: #78716c; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e7e5e4; padding: 8px 12px; text-align: left; }
    img { max-width: 100%; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeTitle(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/export.ts
git commit -m "feat: add exportHtml and exportPdf functions"
```

---

## Task 5: Create `export-dropdown.ts`

**Files:**
- Create: `frontend/src/export-dropdown.ts`

- [ ] **Step 1: Create the file**

Create `frontend/src/export-dropdown.ts` with the following content:

```ts
import { exportHtml, exportPdf } from "./export";

export interface ExportDropdownHandle {
  el: HTMLElement;
}

export function createExportDropdown(
  previewEl: HTMLElement,
  getTitle: () => string
): ExportDropdownHandle {
  const root = document.createElement("div");
  root.className = "export-dropdown";

  const btn = document.createElement("button");
  btn.className = "export-btn";
  btn.textContent = "Export ▾";
  btn.setAttribute("aria-label", "Export document");

  const menu = document.createElement("div");
  menu.className = "export-menu";
  menu.hidden = true;

  const htmlItem = document.createElement("button");
  htmlItem.textContent = "Export as HTML";
  htmlItem.addEventListener("click", () => {
    menu.hidden = true;
    void exportHtml(previewEl, getTitle());
  });

  const pdfItem = document.createElement("button");
  pdfItem.textContent = "Print / Save as PDF";
  pdfItem.addEventListener("click", () => {
    menu.hidden = true;
    exportPdf();
  });

  menu.appendChild(htmlItem);
  menu.appendChild(pdfItem);
  root.appendChild(btn);
  root.appendChild(menu);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  document.addEventListener("mousedown", (e) => {
    if (!root.contains(e.target as Node)) {
      menu.hidden = true;
    }
  });

  return { el: root };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/export-dropdown.ts
git commit -m "feat: add export dropdown UI component"
```

---

## Task 6: Wire into app (CSS + HTML + main.ts)

**Files:**
- Modify: `frontend/src/styles/app.css`
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Add export styles and `@media print` to `app.css`**

Open `frontend/src/styles/app.css`. Find the line `.theme-toggle-btn:hover { color: var(--color-text); }` and add the following immediately after it:

```css
.export-dropdown { position: relative; }
.export-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 0 var(--space-1);
  line-height: 1;
  color: var(--color-text-muted);
}
.export-btn:hover { color: var(--color-text); }
.export-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  min-width: 180px;
  z-index: 100;
}
.export-menu button {
  display: block;
  width: 100%;
  padding: 8px 14px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text);
}
.export-menu button:hover { background: var(--color-border); }

@media print {
  .titlebar, #tab-bar, .editor-pane, #sidebar, #sidebar-resizer,
  #toast-root, #palette-overlay { display: none !important; }
  .panes { display: block; }
  .preview-pane { width: 100%; border: none; padding: 0; }
  .preview-content { max-width: none; }
}
```

- [ ] **Step 2: Add `#export-dropdown-root` to `index.html`**

Open `frontend/index.html`. The titlebar currently ends with:

```html
        <span style="flex:1"></span>
        <button id="theme-toggle" class="theme-toggle-btn" aria-label="Toggle theme">&#x1F319;</button>
      </header>
```

Change it to:

```html
        <span style="flex:1"></span>
        <button id="theme-toggle" class="theme-toggle-btn" aria-label="Toggle theme">&#x1F319;</button>
        <div id="export-dropdown-root"></div>
      </header>
```

- [ ] **Step 3: Add element query to `main.ts`**

Open `frontend/src/main.ts`.

Add the import at the top with the other imports (after line 14):

```ts
import { createExportDropdown } from "./export-dropdown";
```

After line 29 (`const themeToggleEl = ...`), add:

```ts
const exportDropdownRootEl = document.getElementById("export-dropdown-root") as HTMLElement | null;
```

- [ ] **Step 4: Add to null-guard in `main.ts`**

The null guard currently reads (lines 31-35):

```ts
if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl ||
    !vaultPrefixEl || !dirtyEl || !panesEl || !tabBarEl || !reloadBannerEl ||
    !reloadConfirmEl || !reloadDismissEl || !sidebarResizerEl || !themeToggleEl) {
  throw new Error("missing layout host elements");
}
```

Change it to:

```ts
if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl ||
    !vaultPrefixEl || !dirtyEl || !panesEl || !tabBarEl || !reloadBannerEl ||
    !reloadConfirmEl || !reloadDismissEl || !sidebarResizerEl || !themeToggleEl ||
    !exportDropdownRootEl) {
  throw new Error("missing layout host elements");
}
```

- [ ] **Step 5: Add const assignment and mount dropdown in `main.ts`**

After the existing const reassignments block (after `const themeToggle = themeToggleEl;`, line 48), add:

```ts
const exportDropdownRoot = exportDropdownRootEl;
```

Then after line 73 (`onThemeChange(() => { preview.update(editor.getValue()); });`), add:

```ts
const exportDropdown = createExportDropdown(preview.getContentEl(), () => title.textContent ?? "Untitled");
exportDropdownRoot.appendChild(exportDropdown.el);
```

- [ ] **Step 6: Verify TypeScript compiles cleanly**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 7: Run Rust tests to confirm nothing broken**

```bash
cargo test -p skymark-app 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/styles/app.css frontend/index.html frontend/src/main.ts
git commit -m "feat: wire export dropdown into app"
```

---

## Manual Verification Checklist

After all tasks complete, run `npm run tauri:dev` and verify:

1. **Export button visible** — "Export ▾" button appears in the titlebar to the right of the theme toggle
2. **Dropdown opens/closes** — clicking the button opens the menu; clicking outside closes it
3. **HTML export** — open a document with a heading, code block, `$x^2$`, and a Mermaid flowchart; click "Export as HTML"; save to Desktop; open in browser (requires internet) — all four elements render correctly
4. **Toast** — "Exported to filename.html" appears after successful export
5. **Print** — click "Print / Save as PDF"; verify only the preview content appears in the print preview (no editor, no sidebar, no titlebar)
6. **Cancel** — click "Export as HTML" then cancel the dialog; verify no toast and no error
