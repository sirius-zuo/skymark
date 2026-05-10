# Phase 6: Export — Design Spec

**Date:** 2026-05-09
**Scope:** HTML export (CDN-linked) + PDF export via OS print dialog. DOCX is explicitly out of scope.

---

## Goals

- Let users export the current document as a standalone `.html` file that renders correctly in any browser with an internet connection (CDN-linked KaTeX CSS + highlight.js CSS, no JavaScript required in the export).
- Let users save the document as PDF via the OS print dialog (`window.print()`), with the editor and sidebar hidden so only the preview content prints.
- No new system dependencies. No new Tauri capabilities beyond what already exists.

---

## Out of Scope

- DOCX export (deferred indefinitely — LLM-assisted conversion covers this use case better)
- Self-contained / offline HTML (base64 fonts would inflate file size ~500KB)
- Batch export of vault files
- Custom CSS or templates in the export

---

## Architecture

Three new pieces slot into the existing Phase 1–5 stack:

1. **`frontend/src/export.ts`** — pure logic: two exported functions (`exportHtml`, `exportPdf`).
2. **`frontend/src/export-dropdown.ts`** — UI: "Export ▾" button + popover menu wired to those functions.
3. **`crates/skymark-app/src/commands.rs`** — one new Tauri command: `export_file`.

The HTML export works by serializing the already-enriched preview DOM (`previewContentEl.innerHTML`) rather than re-rendering from Markdown. This means KaTeX-rendered math, Mermaid SVGs, and hljs-highlighted code are all baked into the export without requiring JavaScript in the output file.

---

## Components

### `frontend/src/export.ts`

Two exported functions:

**`exportHtml(previewEl: HTMLElement, title: string): Promise<void>`**

1. Serialize `previewEl.innerHTML`.
2. Assemble the HTML template (see template spec below).
3. Call Tauri save dialog (`@tauri-apps/plugin-dialog` `save()`) with filter `{ name: "HTML", extensions: ["html"] }`.
4. If user cancels (dialog returns `null`): return silently.
5. Call `exportFile(path, assembledHtml)` from `api.ts`.
6. Show toast: `"Exported to {filename}"` on success; `"Export failed: {error}"` on error.

**`exportPdf(): void`**

Calls `window.print()`. The `@media print` CSS handles layout.

**HTML template** assembled by `exportHtml`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
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
{previewEl.innerHTML}
</body>
</html>
```

No JavaScript in the export. KaTeX math is pre-rendered HTML; Mermaid is inline SVG; hljs classes are already applied — only CDN CSS is needed.

### `frontend/src/export-dropdown.ts`

Returns `{ el: HTMLElement }`. The element is a `<div class="export-dropdown">` containing:
- A `<button class="export-btn">Export ▾</button>`
- A `<div class="export-menu" hidden>` with two `<button>` items: "Export as HTML" and "Print / Save as PDF"

Behavior:
- Clicking the export button toggles `hidden` on the menu.
- Clicking outside the component closes the menu (one `mousedown` listener on `document`).
- Clicking a menu item calls the corresponding function and closes the menu.

Constructor signature: `createExportDropdown(previewEl: HTMLElement, getTitle: () => string): { el: HTMLElement }`

### `crates/skymark-app/src/commands.rs`

New command:

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
    let tmp = parent.join(format!(".{}.tmp", p.file_name().and_then(|s| s.to_str()).unwrap_or("export")));
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}
```

Registered in `main.rs` `invoke_handler`.

### `frontend/src/api.ts`

New function appended:

```ts
export async function exportFile(path: string, content: string): Promise<void> {
  await invoke<void>("export_file", { path, content });
}
```

### `frontend/index.html`

Add inside `.titlebar`, after the theme-toggle button:

```html
<div id="export-dropdown-root"></div>
```

### `frontend/src/main.ts`

```ts
import { createExportDropdown } from "./export-dropdown";

const exportDropdownRoot = document.getElementById("export-dropdown-root") as HTMLElement;
// (add to the existing null-guard)

const exportDropdown = createExportDropdown(preview.getContentEl(), () => title.textContent ?? "Untitled");
exportDropdownRoot.appendChild(exportDropdown.el);
```

Note: `preview.getContentEl()` requires adding `getContentEl(): HTMLElement` to the `PreviewHandle` interface in `preview.ts` and returning the internal `content` div from `createPreview`.

### `frontend/src/styles/app.css`

Export button styles (matching existing theme-toggle style):

```css
.export-dropdown { position: relative; }
.export-btn { background: none; border: none; cursor: pointer; font-size: 16px; padding: 0 var(--space-1); line-height: 1; color: var(--color-text-muted); }
.export-btn:hover { color: var(--color-text); }
.export-menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; min-width: 180px; z-index: 100; }
.export-menu button { display: block; width: 100%; padding: 8px 14px; text-align: left; background: none; border: none; cursor: pointer; color: var(--color-text); }
.export-menu button:hover { background: var(--color-border); }
```

Print styles:

```css
@media print {
  .titlebar, #tab-bar, .editor-pane, #sidebar, #sidebar-resizer, #toast-root, #palette-overlay { display: none !important; }
  .panes { display: block; }
  .preview-pane { width: 100%; border: none; padding: 0; }
  .preview-content { max-width: none; }
}
```

---

## Capabilities

No changes to `capabilities/default.json`. `dialog:allow-save` already grants the save dialog permission needed for the HTML export path picker.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Save dialog cancelled | Return silently, no toast |
| `export_file` rejects path | Toast: "Export failed: {error message}" |
| `export_file` write error | Toast: "Export failed: {error message}" |
| Preview is empty | Valid export — produces HTML file with empty body |

---

## Testing

**Rust unit tests (in `commands.rs`):**
- `export_file` writes content to a temp `.html` path and reads it back correctly
- `export_file` rejects a relative path
- `export_file` rejects a non-`.html` extension (e.g., `.pdf`, `.md`)

**Manual verification:**
1. Open a document containing: an H1 heading, a fenced code block with language tag, a `$x^2$` math expression, and a Mermaid flowchart
2. Export as HTML → open in browser → verify all four features render correctly (code highlighted, math typeset, diagram visible)
3. Print / Save as PDF → verify editor and sidebar are hidden in the print preview, only document content shows

---

## File Map

| Action | Path |
|--------|------|
| Create | `frontend/src/export.ts` |
| Create | `frontend/src/export-dropdown.ts` |
| Modify | `frontend/src/api.ts` |
| Modify | `frontend/src/main.ts` |
| Modify | `frontend/src/preview.ts` (add `getContentEl(): HTMLElement` to `PreviewHandle`) |
| Modify | `frontend/src/styles/app.css` |
| Modify | `frontend/index.html` |
| Modify | `crates/skymark-app/src/commands.rs` |
| Modify | `crates/skymark-app/src/main.rs` |
