# Format Toolbar Design

## Overview

Add a fixed format toolbar strip above the CodeMirror editor to make common Markdown formatting actions discoverable and clickable. The toolbar complements existing keyboard shortcuts without replacing them.

## Placement

Fixed strip rendered inside `.editor-pane`, immediately above the CodeMirror mount point. Always visible — no show/hide on selection. Does not consume vertical writing space beyond its own height (~28px).

## Button Groups

Five groups separated by 1px dividers:

| Group | Buttons | Behavior |
|---|---|---|
| Inline | B  I  S  ` ` | Wraps selection in markers. If no selection, inserts markers with cursor placed inside. |
| Headings | H1  H2  H3 | Toggles `#` / `##` / `###` prefix on the current line. Clicking the active heading removes it. Mutually exclusive — setting one clears the others. |
| Lists | •  1.  ☑ | Toggles `- ` / `1. ` / `- [ ] ` prefix on all selected lines. Mutually exclusive within the group. |
| Block | 🔗  ❝ | Link wraps selection as `[text](url)`. Blockquote prefixes line with `> `. |
| Insert | 🖼  ∑  $$  ```  ⬡ | Inserts a fixed template snippet at cursor. |

### Insert group templates

| Button | Inserts |
|---|---|
| 🖼 | `![alt](url)` with cursor on `alt` |
| ∑ | `$expr$` with cursor on `expr` |
| $$ | `$$\nexpr\n$$` with cursor on `expr` |
| ``` | ```` ```\n\n``` ```` with cursor on blank line |
| ⬡ | ```` ```mermaid\ngraph TD;\n\n``` ```` with cursor on blank line |

## Architecture

### New file: `frontend/src/toolbar.ts`

Exports one function:

```ts
export function createToolbar(el: HTMLElement, view: EditorView): void
```

- Builds the toolbar DOM (buttons + separators) imperationally and appends to `el`.
- All buttons use `mousedown` + `e.preventDefault()` to prevent the editor losing focus.
- On click, calls the appropriate exported editor function with `view`.
- No state of its own — the toolbar is stateless; active-state highlighting is not required in v1.

### Modified: `frontend/src/editor.ts`

Three exported functions (two new, one promoted from private):

```ts
// Currently private — promote to export
export function wrapSelection(view: EditorView, prefix: string, suffix: string): void

// New — toggle a line-level prefix, with optional mutual-exclusion group
export function toggleLinePrefix(
  view: EditorView,
  prefix: string,
  group?: string[]   // list of prefixes that are mutually exclusive with this one
): void

// New — insert a template string at cursor, with optional cursor offset
export function insertTemplate(view: EditorView, template: string, cursorOffset?: number): void
```

**`toggleLinePrefix` semantics:**

1. Collect all lines that overlap the current selection.
2. If every line already starts with `prefix`, remove it (toggle off).
3. Otherwise, for each line: strip any prefix in `group`, then prepend `prefix`.

**`insertTemplate` semantics:**

Inserts `template` at each cursor/selection head (replacing selections). If `cursorOffset` is provided, positions the cursor `cursorOffset` characters from the start of the inserted text.

### Modified: `frontend/index.html`

Add inside `.editor-pane`, before the CodeMirror mount div:

```html
<div id="format-toolbar"></div>
```

### Modified: `frontend/src/styles/app.css`

Toolbar strip uses existing CSS tokens:

```css
#format-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-wrap: wrap;
  flex-shrink: 0;
}
```

Toolbar buttons (class `.tb-btn`):

```css
.tb-btn {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 3px 7px;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  line-height: 1;
}
.tb-btn:hover {
  background: var(--color-bg);
  border-color: var(--color-border);
}
```

Separators (class `.tb-sep`):

```css
.tb-sep {
  width: 1px;
  height: 16px;
  background: var(--color-border);
  margin: 0 4px;
  flex-shrink: 0;
}
```

### Modified: `frontend/src/main.ts`

After editor initialisation (where `editor.view` is available):

```ts
import { createToolbar } from "./toolbar";
createToolbar(document.getElementById("format-toolbar")!, editor.view);
```

## Data Flow

```
User clicks toolbar button
  → mousedown handler calls e.preventDefault()
  → handler calls exported editor function (wrapSelection / toggleLinePrefix / insertTemplate)
    → function dispatches a CodeMirror transaction
      → EditorView updates (text + cursor)
  → editor focus remains (never lost)
```

## Testing

- Unit-test `toggleLinePrefix` with single-line and multi-line selections: toggle on, toggle off, mutual exclusion.
- Unit-test `insertTemplate` with and without a selection, with and without `cursorOffset`.
- Manual smoke-test all 16 buttons in both light and dark themes.
- Verify toolbar is hidden when `editor-pane` is hidden (vault-only view without open file) — no special code needed; it inherits pane visibility.

## Out of Scope (v1)

- Active-state highlighting (showing which heading/list is active at cursor)
- Keyboard shortcut labels in tooltips beyond the existing `title` attribute
- Drag-to-reorder buttons
- User-configurable button set
