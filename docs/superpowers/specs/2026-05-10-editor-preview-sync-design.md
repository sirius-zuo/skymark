# Editor–Preview Sync — Design Spec

**Date:** 2026-05-10
**Scope:** Cursor following and scroll following from the editor pane to the preview pane. One direction only: editor → preview.

---

## Goals

- **Cursor following:** when the cursor moves to a different line in the editor (without typing), the preview scrolls to show the corresponding rendered content.
- **Scroll following:** when the editor pane is scrolled, the preview pane scrolls to maintain alignment with the top-visible line.
- Always-on; no toggle.

---

## Out of Scope

- Preview → editor reverse sync
- Per-character or intra-line precision (line-level is sufficient)
- Syncing during active typing (document changes trigger a re-render; sync fires on the next cursor/scroll event after the new HTML is in the DOM)

---

## Architecture

Two layers connected by `data-line` attributes on rendered HTML block elements:

1. **Rust (`skymark-core`)**: `render()` uses `parser.into_offset_iter()` to access source byte offsets alongside each event. It builds a line-start offset table, then loops over events. For block-start events it emits the opening HTML tag directly with a `data-line="N"` attribute. All other events pass through `push_html` unchanged. The ammonia sanitizer config adds `"data-line"` to `generic_attributes` so the attribute survives sanitization.

2. **Frontend**: `preview.ts` gains `scrollToLine(line)` which queries the rendered DOM for `[data-line]` elements and scrolls the closest match into view. A new `sync.ts` module registers a single CodeMirror `updateListener` that routes viewport changes and cursor moves to `scrollToLine`.

---

## Components

### `crates/skymark-core/src/lib.rs`

**`render(text: &str) -> String`** — rewritten rendering loop:

1. Build a `Vec<usize>` of line-start byte offsets:
   ```rust
   let line_starts: Vec<usize> = std::iter::once(0)
       .chain(text.match_indices('\n').map(|(i, _)| i + 1))
       .collect();
   ```
   Convert byte offset → 1-based line number:
   ```rust
   fn byte_to_line(offset: usize, line_starts: &[usize]) -> usize {
       line_starts.partition_point(|&s| s <= offset)
   }
   ```

2. Replace `push_html(&mut html, parser)` with a loop over `parser.into_offset_iter()`:
   ```rust
   for (event, range) in parser.into_offset_iter() {
       match event {
           Event::Start(ref tag) if is_block_tag(tag) => {
               let line = byte_to_line(range.start, &line_starts);
               html.push_str(&block_open_tag(tag, line));
           }
           other => push_html(&mut html, std::iter::once(other)),
       }
   }
   ```

3. **`is_block_tag(tag)`** returns `true` for: `Paragraph`, `Heading`, `CodeBlock`, `BlockQuote`, `List`, `Item`, `Table`.

4. **`block_open_tag(tag, line) -> String`** emits the correct HTML opening tag with `data-line="N"`:

   | Tag | Output |
   |-----|--------|
   | `Paragraph` | `<p data-line="N">` |
   | `Heading { level: L, .. }` | `<hL data-line="N">` |
   | `CodeBlock(Indented)` | `<pre data-line="N"><code>` |
   | `CodeBlock(Fenced(lang))` | `<pre data-line="N"><code class="language-lang">` (omit class if lang is empty) |
   | `BlockQuote` | `<blockquote data-line="N">` |
   | `List(None)` | `<ul data-line="N">` |
   | `List(Some(n))` | `<ol start="n" data-line="N">` |
   | `Item` | `<li data-line="N">` |
   | `Table(_)` | `<table data-line="N">` |

5. **Ammonia config** — add `data-line` to allowed attributes:
   ```rust
   builder.generic_attributes(std::iter::once("data-line"));
   ```
   (or `add_generic_attributes` if using the builder pattern already in use)

**Rust unit test** in `lib.rs`:
```rust
#[test]
fn render_emits_data_line_on_blocks() {
    let html = render("# Hello\n\nA paragraph.\n");
    assert!(html.contains("data-line=\"1\""));  // heading on line 1
    assert!(html.contains("data-line=\"3\""));  // paragraph on line 3
}
```

---

### `frontend/src/preview.ts`

Add `scrollToLine(line: number): void` to `PreviewHandle`:

```ts
export interface PreviewHandle {
  update(text: string): void;
  getContentEl(): HTMLElement;
  scrollToLine(line: number): void;
}
```

Implementation inside `createPreview`:

```ts
scrollToLine(line: number): void {
  const markers = Array.from(
    content.querySelectorAll<HTMLElement>("[data-line]")
  );
  if (markers.length === 0) return;

  // Find last marker with data-line <= line
  let target: HTMLElement | null = null;
  for (const el of markers) {
    const n = parseInt(el.getAttribute("data-line") ?? "0", 10);
    if (n <= line) target = el;
    else break;
  }

  if (target) {
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } else {
    // All markers are after the cursor line — scroll to top
    host.scrollTop = 0;
  }
},
```

Note: `markers` is already in DOM order, which matches ascending `data-line` order because the Rust renderer emits them sequentially.

---

### `frontend/src/sync.ts` (new file)

```ts
import { EditorView } from "@codemirror/view";
import type { PreviewHandle } from "./preview";

export function createSync(
  view: EditorView,
  preview: PreviewHandle
): { destroy(): void } {
  let cursorTimer: number | null = null;

  const extension = EditorView.updateListener.of((update) => {
    if (update.viewportChanged) {
      // Scroll sync: use top-visible line immediately
      const line = update.view.state.doc.lineAt(
        update.view.viewport.from
      ).number;
      preview.scrollToLine(line);
      // Cancel any pending cursor sync (viewport change takes priority)
      if (cursorTimer !== null) {
        window.clearTimeout(cursorTimer);
        cursorTimer = null;
      }
      return;
    }

    if (update.selectionSet && !update.docChanged) {
      // Cursor sync: debounce 100ms to avoid firing on every keystroke
      if (cursorTimer !== null) window.clearTimeout(cursorTimer);
      cursorTimer = window.setTimeout(() => {
        cursorTimer = null;
        const line = update.view.state.doc.lineAt(
          update.view.state.selection.main.head
        ).number;
        preview.scrollToLine(line);
      }, 100);
    }
  });

  // Note: the updateListener extension must be registered at EditorView
  // construction time. The implementation plan resolves the exact wiring
  // (callback parameter on createEditor, or Compartment injection).

  return {
    destroy(): void {
      if (cursorTimer !== null) window.clearTimeout(cursorTimer);
    },
  };
}
```

**Implementation note:** CodeMirror does not support adding `updateListener` extensions to an already-created view via `dispatch`. The correct pattern is to pass the sync extension into `createEditor` at construction time, or use a `Compartment` to inject it after creation. The implementation plan will choose the cleanest approach — likely adding an optional `extensions` parameter to `createEditor`, or passing the update handler via a callback.

---

### `frontend/src/main.ts`

Add one import and one call after editor and preview are initialized:

```ts
import { createSync } from "./sync";

// After: const editor = createEditor(...)
// After: const preview = createPreview(...)
createSync(editor.view, preview);
```

No `destroy()` call needed (app lifetime = sync lifetime).

---

## Data Flow

**Scroll sync:**
1. User scrolls editor → CodeMirror `updateListener` fires, `update.viewportChanged = true`
2. `sync.ts` reads `view.state.doc.lineAt(view.viewport.from).number` → e.g. `42`
3. `preview.scrollToLine(42)` queries `[data-line]` elements, finds `<p data-line="40">` as closest ≤ 42
4. `element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })` — preview scrolls

**Cursor sync:**
1. User moves cursor (arrow key, click) → `update.selectionSet = true`, `update.docChanged = false`
2. 100ms debounce fires → reads cursor line
3. Same `scrollToLine` path as above

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No `[data-line]` elements (pre-first-render) | `scrollToLine` no-ops — `querySelectorAll` returns empty NodeList |
| Cursor line before all block markers | `host.scrollTop = 0` (scroll preview to top) |
| `data-line` attribute missing or non-numeric | `parseInt` returns `NaN`; `NaN <= line` is `false` — element skipped safely |
| Very fast scrolling | Viewport events fire at browser rate; `scrollIntoView` is a cheap DOM call — no debounce needed |
| Document re-render replaces DOM | New `[data-line]` elements replace old ones; next sync event queries fresh elements |
| `update.selectionSet` fires during typing | `update.docChanged = true` → cursor sync branch skipped; preview re-renders via the existing `onChange` path |

---

## Testing

**Rust unit tests (`crates/skymark-core/src/lib.rs`):**
- `render_emits_data_line_on_blocks` — verifies heading and paragraph get correct `data-line` values
- `render_data_line_survives_ammonia` — verifies `data-line` is not stripped from output (same as above since `render` includes sanitization)
- `render_code_block_data_line` — fenced code block with language tag gets `data-line` on `<pre>`

**Manual verification:**
1. Open a document with headings, paragraphs, a code block, and a table
2. Click on a line under the code block in the editor → preview scrolls to show the code block
3. Click on a heading → preview scrolls to that heading
4. Scroll the editor to the bottom → preview follows to the bottom
5. Scroll editor back to top → preview returns to top

---

## File Map

| Action | Path |
|--------|------|
| Modify | `crates/skymark-core/src/lib.rs` |
| Modify | `frontend/src/preview.ts` |
| Create | `frontend/src/sync.ts` |
| Modify | `frontend/src/main.ts` |
