# Editor–Preview Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit `data-line` attributes on rendered HTML blocks in Rust, then drive preview scroll from CodeMirror cursor/viewport events in TypeScript.

**Architecture:** The Rust renderer annotates each block-level HTML open tag with `data-line="N"` (1-based source line). The ammonia sanitizer is configured to pass this attribute through. On the frontend, `preview.ts` exposes `scrollToLine(line)` which finds the nearest annotated element and scrolls it into view. A new `sync.ts` module returns a CodeMirror `Extension` that routes viewport and selection changes to `scrollToLine`. The extension is passed into `createEditor` at construction time via a new `extra` parameter.

**Tech Stack:** Rust, pulldown-cmark 0.13 (`into_offset_iter`), ammonia 4, TypeScript, CodeMirror 6

---

## File Map

| Action  | Path |
|---------|------|
| Modify  | `crates/skymark-core/src/sanitize.rs` |
| Modify  | `crates/skymark-core/src/render.rs` |
| Modify  | `frontend/src/preview.ts` |
| Create  | `frontend/src/sync.ts` |
| Modify  | `frontend/src/editor.ts` |
| Modify  | `frontend/src/main.ts` |

---

### Task 1: Allow `data-line` through the ammonia sanitizer

**Files:**
- Modify: `crates/skymark-core/src/sanitize.rs`

- [ ] **Step 1: Write the failing test**

Add a `tests` module at the bottom of `crates/skymark-core/src/sanitize.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_line_survives_sanitizer() {
        let html = sanitize(r#"<p data-line="3">hello</p>"#);
        assert!(
            html.contains(r#"data-line="3""#),
            "data-line was stripped: {html}"
        );
    }
}
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cargo test -p skymark-core data_line_survives_sanitizer
```

Expected: FAIL — `data-line` is stripped because it is not in the allowlist.

- [ ] **Step 3: Add `data-line` to the ammonia builder's generic attributes**

In `sanitize.rs`, after the `b.tag_attributes(tag_attrs);` call (line 47) and before `b.url_schemes(...)`, add:

```rust
b.generic_attributes(std::iter::once("data-line"));
```

The final `builder()` body should read (relevant excerpt):

```rust
b.tag_attributes(tag_attrs);

b.generic_attributes(std::iter::once("data-line"));

let url_schemes: HashSet<&'static str> = ["http", "https", "mailto"].into_iter().collect();
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cargo test -p skymark-core data_line_survives_sanitizer
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-core/src/sanitize.rs
git commit -m "feat(core): allow data-line attribute through ammonia sanitizer"
```

---

### Task 2: Inject `data-line` attributes on block elements in the renderer

**Files:**
- Modify: `crates/skymark-core/src/render.rs`

- [ ] **Step 1: Write the failing tests**

Add a `tests` module at the bottom of `crates/skymark-core/src/render.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_emits_data_line_on_blocks() {
        let html = render_html("# Hello\n\nA paragraph.\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1 on heading: {html}"
        );
        assert!(
            html.contains(r#"data-line="3""#),
            "missing data-line=3 on paragraph: {html}"
        );
    }

    #[test]
    fn render_code_block_data_line() {
        let html = render_html("```rust\nfn main() {}\n```\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1 on pre: {html}"
        );
        assert!(
            html.contains("language-rust"),
            "missing language-rust class: {html}"
        );
    }

    #[test]
    fn render_code_block_no_lang() {
        let html = render_html("```\ncode here\n```\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1: {html}"
        );
        // No class attribute when lang is empty
        assert!(
            !html.contains("class="),
            "unexpected class attribute: {html}"
        );
    }
}
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cargo test -p skymark-core render_emits_data_line render_code_block
```

Expected: FAIL — current renderer uses `push_html` and emits no `data-line` attributes.

- [ ] **Step 3: Rewrite `render.rs` with data-line injection**

Replace the entire contents of `crates/skymark-core/src/render.rs` with:

```rust
use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag};
use thiserror::Error;

use crate::sanitize::sanitize;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("internal render error: {0}")]
    Internal(String),
}

/// Convert a Markdown source string to a sanitized HTML fragment.
///
/// Pipeline: pulldown-cmark (CommonMark + GFM extensions) -> HTML buffer -> sanitizer.
/// Block-level open tags carry a `data-line="N"` attribute (1-based source line)
/// for editor-preview scroll sync.
pub fn render_html(markdown: &str) -> Result<String, RenderError> {
    if markdown.is_empty() {
        return Ok(String::new());
    }
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(markdown.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    let mut html_buf = String::new();
    let parser = Parser::new_ext(markdown, gfm_options());
    for (event, range) in parser.into_offset_iter() {
        if let Event::Start(ref tag) = event {
            if is_block_tag(tag) {
                let line = byte_to_line(range.start, &line_starts);
                html_buf.push_str(&block_open_tag(tag, line));
                continue;
            }
        }
        html::push_html(&mut html_buf, std::iter::once(event));
    }
    Ok(sanitize(&html_buf))
}

fn gfm_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH
}

/// Returns the 1-based line number for a given byte offset.
fn byte_to_line(offset: usize, line_starts: &[usize]) -> usize {
    line_starts.partition_point(|&s| s <= offset)
}

fn is_block_tag(tag: &Tag) -> bool {
    matches!(
        tag,
        Tag::Paragraph
            | Tag::Heading { .. }
            | Tag::CodeBlock(_)
            | Tag::BlockQuote(_)
            | Tag::List(_)
            | Tag::Item
            | Tag::Table(_)
    )
}

fn block_open_tag(tag: &Tag, line: usize) -> String {
    match tag {
        Tag::Paragraph => format!("<p data-line=\"{line}\">"),
        Tag::Heading { level, .. } => {
            format!("<h{} data-line=\"{line}\">", *level as u8)
        }
        Tag::CodeBlock(CodeBlockKind::Indented) => {
            format!("<pre data-line=\"{line}\"><code>")
        }
        Tag::CodeBlock(CodeBlockKind::Fenced(lang)) => {
            if lang.is_empty() {
                format!("<pre data-line=\"{line}\"><code>")
            } else {
                format!("<pre data-line=\"{line}\"><code class=\"language-{lang}\">")
            }
        }
        Tag::BlockQuote(_) => format!("<blockquote data-line=\"{line}\">"),
        Tag::List(None) => format!("<ul data-line=\"{line}\">"),
        Tag::List(Some(n)) => format!("<ol start=\"{n}\" data-line=\"{line}\">"),
        Tag::Item => format!("<li data-line=\"{line}\">"),
        Tag::Table(_) => format!("<table data-line=\"{line}\">"),
        _ => unreachable!("block_open_tag called with non-block tag"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_emits_data_line_on_blocks() {
        let html = render_html("# Hello\n\nA paragraph.\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1 on heading: {html}"
        );
        assert!(
            html.contains(r#"data-line="3""#),
            "missing data-line=3 on paragraph: {html}"
        );
    }

    #[test]
    fn render_code_block_data_line() {
        let html = render_html("```rust\nfn main() {}\n```\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1 on pre: {html}"
        );
        assert!(
            html.contains("language-rust"),
            "missing language-rust class: {html}"
        );
    }

    #[test]
    fn render_code_block_no_lang() {
        let html = render_html("```\ncode here\n```\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1: {html}"
        );
        assert!(
            !html.contains("class="),
            "unexpected class attribute on code: {html}"
        );
    }
}
```

- [ ] **Step 4: Run all core tests and verify they pass**

```bash
cargo test -p skymark-core
```

Expected: all tests PASS, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-core/src/render.rs
git commit -m "feat(core): inject data-line attributes on block elements for preview sync"
```

---

### Task 3: Add `scrollToLine` to the preview pane

**Files:**
- Modify: `frontend/src/preview.ts`

- [ ] **Step 1: Add `scrollToLine` to the `PreviewHandle` interface**

In `frontend/src/preview.ts`, replace the interface (lines 6–9):

```ts
export interface PreviewHandle {
  update(text: string): void;
  getContentEl(): HTMLElement;
  scrollToLine(line: number): void;
}
```

- [ ] **Step 2: Implement `scrollToLine` in the returned object**

In the `return { ... }` block (starting at line 47), add `scrollToLine` after `getContentEl`:

```ts
    getContentEl(): HTMLElement {
      return content;
    },
    scrollToLine(line: number): void {
      const markers = Array.from(
        content.querySelectorAll<HTMLElement>("[data-line]")
      );
      if (markers.length === 0) return;

      // Find the last marker whose data-line value is <= the requested line.
      // Markers are in DOM order which matches ascending data-line order.
      let target: HTMLElement | null = null;
      for (const el of markers) {
        const n = parseInt(el.getAttribute("data-line") ?? "0", 10);
        if (n <= line) target = el;
        else break;
      }

      if (target) {
        target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        // All block markers are after the cursor line — scroll preview to top.
        host.scrollTop = 0;
      }
    },
```

The complete `return` block in `createPreview` should now be:

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
    scrollToLine(line: number): void {
      const markers = Array.from(
        content.querySelectorAll<HTMLElement>("[data-line]")
      );
      if (markers.length === 0) return;

      let target: HTMLElement | null = null;
      for (const el of markers) {
        const n = parseInt(el.getAttribute("data-line") ?? "0", 10);
        if (n <= line) target = el;
        else break;
      }

      if (target) {
        target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        host.scrollTop = 0;
      }
    },
  };
```

- [ ] **Step 3: Type-check**

```bash
npm run build
```

Expected: builds without TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/preview.ts
git commit -m "feat(frontend): add scrollToLine to PreviewHandle"
```

---

### Task 4: Create `sync.ts` — CodeMirror extension for editor→preview sync

**Files:**
- Create: `frontend/src/sync.ts`

- [ ] **Step 1: Create the file**

Create `frontend/src/sync.ts` with:

```ts
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { PreviewHandle } from "./preview";

/**
 * Returns a CodeMirror Extension that drives preview scroll from editor
 * viewport changes (immediate) and cursor moves (100ms debounce).
 * Pass the returned extension into createEditor's `extra` parameter.
 */
export function createSyncExtension(preview: PreviewHandle): Extension {
  let cursorTimer: number | null = null;

  return EditorView.updateListener.of((update) => {
    if (update.viewportChanged) {
      // Scroll sync: use the top-visible line immediately.
      const line = update.view.state.doc.lineAt(
        update.view.viewport.from
      ).number;
      preview.scrollToLine(line);
      // Cancel any pending cursor sync; viewport change takes priority.
      if (cursorTimer !== null) {
        window.clearTimeout(cursorTimer);
        cursorTimer = null;
      }
      return;
    }

    if (update.selectionSet && !update.docChanged) {
      // Cursor sync: debounce 100ms to avoid firing on every keystroke.
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
}
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: builds without TypeScript errors. (`sync.ts` is not yet imported anywhere, so the only verification is that the file itself is type-correct when the build processes it as part of the project.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/sync.ts
git commit -m "feat(frontend): add createSyncExtension for editor-to-preview scroll sync"
```

---

### Task 5: Wire the sync extension into the editor and main bootstrap

**Files:**
- Modify: `frontend/src/editor.ts`
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Add `Extension` to the `@codemirror/state` import in `editor.ts`**

In `frontend/src/editor.ts`, replace line 1:

```ts
import { EditorState, EditorSelection, RangeSetBuilder } from "@codemirror/state";
```

with:

```ts
import { EditorState, EditorSelection, RangeSetBuilder, type Extension } from "@codemirror/state";
```

- [ ] **Step 2: Add the `extra` parameter to `createEditor`**

In `frontend/src/editor.ts`, replace the function signature on line 109:

```ts
export function createEditor(parent: HTMLElement, onChange: DocChangeListener): EditorHandle {
```

with:

```ts
export function createEditor(
  parent: HTMLElement,
  onChange: DocChangeListener,
  extra: Extension[] = []
): EditorHandle {
```

- [ ] **Step 3: Spread `extra` into the extensions array**

In the same function, find the `extensions: [` array (lines 114–163). Add `...extra,` as the last entry before the closing `]`:

```ts
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        ...extra,
      ],
```

- [ ] **Step 4: Wire up in `main.ts`**

In `frontend/src/main.ts`, add the import at the top of the file with the other imports:

```ts
import { createSyncExtension } from "./sync";
```

Between the `const preview = createPreview(previewHost);` line (line 63) and the `const editor = createEditor(...)` call (line 73), insert:

```ts
const syncExt = createSyncExtension(preview);
```

Then replace the entire `createEditor(...)` call with:

```ts
const editor = createEditor(
  editorHost,
  (text) => {
    preview.update(text);
    files.markDirty();
    drafts.onDocChange(files.state.path, () => editor.getValue());
    if (tabs.active) {
      tabs.updateActive({ content: text, isDirty: true });
      rebindTabBar();
    }
  },
  [syncExt]
);
```

- [ ] **Step 5: Type-check and build**

```bash
npm run build
```

Expected: full build completes without TypeScript errors.

- [ ] **Step 6: Run Rust tests to verify nothing regressed**

```bash
cargo test -p skymark-core
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/editor.ts frontend/src/main.ts
git commit -m "feat(frontend): wire sync extension into editor for cursor/scroll following"
```

---

## Manual Verification

Start the dev server:

```bash
npm run tauri:dev
```

Open a document with headings, paragraphs, a fenced code block, and a table. Then verify:

1. Click on a line below the code block in the editor → preview scrolls to show the code block.
2. Click on a heading line → preview scrolls to that heading.
3. Scroll the editor pane to the bottom → preview follows to the bottom.
4. Scroll the editor back to the top → preview returns to top.
5. Type a character → preview does NOT scroll (cursor sync is suppressed when `docChanged`).
