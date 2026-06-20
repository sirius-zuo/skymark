# YAML Frontmatter Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a leading YAML frontmatter block (GitHub's `--- ... ---` rule) and render it as a key/value table in the preview/export/print pipeline, plus give the block YAML syntax highlighting in the CodeMirror editor.

**Architecture:** `skymark-core`'s `render_html` gains a pre-pass that splits a detected frontmatter block off the document, renders it as an HTML table, and parses the remainder as today with line numbers shifted to match their true position in the original file. The frontend gets a new small module (`frontmatter-lang.ts`) that overlays the YAML language parser onto the same span inside CodeMirror's Markdown language, used in place of the plain `markdown()` extension.

**Tech Stack:** Rust (`skymark-core`, pulldown-cmark, new `serde_yaml` dependency), TypeScript (CodeMirror 6, new `@codemirror/lang-yaml` dependency).

## Global Constraints

- Frontmatter detection rule (both Rust and TS implementations): the file's first line must be exactly `---`, and some later line must be exactly `---` or exactly `...`. Anywhere else, no frontmatter is detected.
- Invalid YAML, a non-mapping top-level YAML value, or an empty mapping all mean "no frontmatter to render" — fall back silently to current Markdown rendering. No error banner, no crash.
- Stats footer (word/char/token/line counts) is unaffected — out of scope, continues counting raw text including any frontmatter.
- HTML export and print already clone the live preview DOM (`frontend/src/export.ts`), so frontmatter rendering must work by changing `skymark-core`'s `render_html` only — no changes needed in `export.ts`.
- The sanitizer (`crates/skymark-core/src/sanitize.rs`) already allows `table`, `tbody`, `tr`, `td`, `br`, and `data-line` — no sanitizer changes needed.

---

### Task 1: Detect a leading YAML frontmatter span (Rust)

**Files:**
- Modify: `crates/skymark-core/Cargo.toml`
- Modify: `Cargo.toml` (workspace root)
- Modify: `crates/skymark-core/src/render.rs`

**Interfaces:**
- Produces: `fn frontmatter_span(markdown: &str) -> Option<(Range<usize>, usize)>` — on a match, returns `(yaml_body_range, frontmatter_end)` where `yaml_body_range` is the byte range of the YAML text between the two fence lines (exclusive of both fence lines), and `frontmatter_end` is the byte offset immediately after the closing fence line, including its trailing newline if present. Returns `None` if the document doesn't start with an exact `---` line, or no later line is exactly `---` or `...`.

- [ ] **Step 1: Add the `serde_yaml` dependency**

In `Cargo.toml` (workspace root), add this line to `[workspace.dependencies]`, after the existing `serde_json = "1"` line:

```toml
serde_yaml = "0.9"
```

In `crates/skymark-core/Cargo.toml`, add this line to `[dependencies]`, after `ammonia.workspace = true`:

```toml
serde_yaml.workspace = true
```

- [ ] **Step 2: Run a build to confirm the dependency resolves**

Run: `cargo check -p skymark-core`
Expected: compiles successfully (this also updates `Cargo.lock`), with `serde_yaml` now listed in `cargo tree -p skymark-core`.

- [ ] **Step 3: Write the failing tests for `frontmatter_span`**

In `crates/skymark-core/src/render.rs`, add these tests inside the existing `mod tests { ... }` block at the bottom of the file (after the existing four tests, before the closing `}`):

```rust
    #[test]
    fn frontmatter_span_detects_basic_block() {
        let md = "---\nname: skill\n---\n\nbody\n";
        let (yaml_range, end) = frontmatter_span(md).expect("expected frontmatter");
        assert_eq!(&md[yaml_range], "name: skill\n");
        assert_eq!(&md[end..], "\nbody\n");
    }

    #[test]
    fn frontmatter_span_accepts_dots_closing_fence() {
        let md = "---\nname: skill\n...\nbody\n";
        let (yaml_range, end) = frontmatter_span(md).expect("expected frontmatter");
        assert_eq!(&md[yaml_range], "name: skill\n");
        assert_eq!(&md[end..], "body\n");
    }

    #[test]
    fn frontmatter_span_none_when_dashes_not_first_line() {
        let md = "# Heading\n\n---\nnot frontmatter\n---\n";
        assert!(frontmatter_span(md).is_none());
    }

    #[test]
    fn frontmatter_span_none_without_closing_fence() {
        let md = "---\nname: skill\n\nbody\n";
        assert!(frontmatter_span(md).is_none());
    }

    #[test]
    fn frontmatter_span_handles_empty_yaml_body() {
        let md = "---\n---\n\nbody\n";
        let (yaml_range, end) = frontmatter_span(md).expect("expected frontmatter");
        assert_eq!(&md[yaml_range], "");
        assert_eq!(&md[end..], "\nbody\n");
    }

    #[test]
    fn frontmatter_span_handles_crlf_line_endings() {
        let md = "---\r\nname: skill\r\n---\r\n\r\nbody\r\n";
        let (yaml_range, end) = frontmatter_span(md).expect("expected frontmatter");
        assert_eq!(&md[yaml_range], "name: skill\r\n");
        assert_eq!(&md[end..], "\r\nbody\r\n");
    }
```

- [ ] **Step 4: Run the tests to verify they fail to compile (the function doesn't exist yet)**

Run: `cargo test -p skymark-core frontmatter_span`
Expected: FAIL with `cannot find function `frontmatter_span` in this scope`.

- [ ] **Step 5: Implement `frontmatter_span`**

In `crates/skymark-core/src/render.rs`, add this import at the top of the file, alongside the existing `use` statements:

```rust
use std::ops::Range;
```

Add this function after `collect_heading_slugs` (which ends just before `pub fn render_html`):

```rust
/// Detects a leading YAML frontmatter block per GitHub's rule: the
/// document's first line is exactly `---`, and some later line is exactly
/// `---` or `...`. Returns the byte range of the YAML body between the
/// fences (excluding both fence lines) and the byte offset immediately
/// after the closing fence's line (including its trailing newline, if
/// present). Returns `None` if either condition isn't met.
fn frontmatter_span(markdown: &str) -> Option<(Range<usize>, usize)> {
    let mut lines = markdown.split('\n');
    let first = lines.next()?;
    if first.trim_end_matches('\r') != "---" {
        return None;
    }
    // The first line must be followed by a newline for a closing fence to
    // exist at all.
    if markdown.as_bytes().get(first.len()) != Some(&b'\n') {
        return None;
    }
    let yaml_start = first.len() + 1;
    let mut offset = yaml_start;
    for line in lines {
        let trimmed = line.trim_end_matches('\r');
        if trimmed == "---" || trimmed == "..." {
            let yaml_end = offset;
            let fence_end = offset + line.len();
            let frontmatter_end = if markdown.as_bytes().get(fence_end) == Some(&b'\n') {
                fence_end + 1
            } else {
                fence_end
            };
            return Some((yaml_start..yaml_end, frontmatter_end));
        }
        offset += line.len() + 1;
    }
    None
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p skymark-core frontmatter_span`
Expected: PASS — all 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml Cargo.lock crates/skymark-core/Cargo.toml crates/skymark-core/src/render.rs
git commit -m "feat: detect leading YAML frontmatter span in skymark-core"
```

---

### Task 2: Render a YAML mapping as an HTML table (Rust)

**Files:**
- Modify: `crates/skymark-core/src/render.rs`

**Interfaces:**
- Consumes: nothing from Task 1 (this is a pure YAML-to-HTML converter; it operates on a YAML string, not on `frontmatter_span`'s output).
- Produces: `fn render_frontmatter_table(yaml_body: &str) -> Option<String>` — `Some(html)` containing a `<table data-line="1">...</table>` fragment when `yaml_body` parses to a non-empty YAML mapping; `None` for invalid YAML, a non-mapping top-level value, or an empty mapping.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `mod tests { ... }` block in `crates/skymark-core/src/render.rs`, after the tests added in Task 1:

```rust
    #[test]
    fn render_frontmatter_table_simple_mapping() {
        let html = render_frontmatter_table("name: skill\ndescription: a test\n").unwrap();
        assert_eq!(
            html,
            "<table data-line=\"1\"><tbody><tr><td>name</td><td>skill</td></tr><tr><td>description</td><td>a test</td></tr></tbody></table>"
        );
    }

    #[test]
    fn render_frontmatter_table_nested_mapping() {
        let html = render_frontmatter_table("metadata:\n  type: feedback\n").unwrap();
        assert_eq!(
            html,
            "<table data-line=\"1\"><tbody><tr><td>metadata</td><td>&nbsp;&nbsp;type: feedback</td></tr></tbody></table>"
        );
    }

    #[test]
    fn render_frontmatter_table_sequence_value() {
        let html = render_frontmatter_table("tags:\n  - a\n  - b\n").unwrap();
        assert_eq!(
            html,
            "<table data-line=\"1\"><tbody><tr><td>tags</td><td>a, b</td></tr></tbody></table>"
        );
    }

    #[test]
    fn render_frontmatter_table_escapes_html() {
        let html = render_frontmatter_table("title: \"<script>alert(1)</script>\"\n").unwrap();
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(!html.contains("<script>"));
    }

    #[test]
    fn render_frontmatter_table_none_for_non_mapping() {
        assert!(render_frontmatter_table("just a string\n").is_none());
    }

    #[test]
    fn render_frontmatter_table_none_for_invalid_yaml() {
        assert!(render_frontmatter_table("key: [unclosed\n").is_none());
    }

    #[test]
    fn render_frontmatter_table_none_for_empty_mapping() {
        assert!(render_frontmatter_table("").is_none());
        assert!(render_frontmatter_table("{}\n").is_none());
    }
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `cargo test -p skymark-core render_frontmatter_table`
Expected: FAIL with `cannot find function `render_frontmatter_table` in this scope`.

- [ ] **Step 3: Implement the YAML-to-HTML conversion functions**

In `crates/skymark-core/src/render.rs`, add this import alongside the existing `use` statements:

```rust
use serde_yaml::Value;
```

Add these three functions directly after `frontmatter_span` (added in Task 1) and before `pub fn render_html`:

```rust
/// Converts a YAML scalar key to its string form for use as a table row
/// label. Frontmatter keys are conventionally plain strings; the other
/// branches handle YAML's more permissive key types without panicking.
fn yaml_key_to_string(key: &Value) -> String {
    match key {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::Null => "null".to_string(),
        other => format!("{other:?}"),
    }
}

/// Renders a YAML value as HTML for a frontmatter table cell. Scalars
/// become HTML-escaped text; sequences become a comma-joined list; mappings
/// become one `key: value` line per entry (indented two spaces per nesting
/// level, joined with `<br>`), recursing for further nesting.
fn render_yaml_value(value: &Value, depth: usize) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(b) => html_escape(&b.to_string()),
        Value::Number(n) => html_escape(&n.to_string()),
        Value::String(s) => html_escape(s),
        Value::Sequence(seq) => seq
            .iter()
            .map(|v| render_yaml_value(v, depth))
            .collect::<Vec<_>>()
            .join(", "),
        Value::Mapping(map) => {
            let indent = "&nbsp;&nbsp;".repeat(depth + 1);
            map.iter()
                .map(|(k, v)| {
                    let key = html_escape(&yaml_key_to_string(k));
                    let val = render_yaml_value(v, depth + 1);
                    format!("{indent}{key}: {val}")
                })
                .collect::<Vec<_>>()
                .join("<br>")
        }
        Value::Tagged(t) => render_yaml_value(&t.value, depth),
    }
}

/// Parses `yaml_body` and, if it is a non-empty YAML mapping, renders it as
/// an HTML table (one row per top-level key). Returns `None` for invalid
/// YAML, a non-mapping top-level value, or an empty mapping — callers
/// should treat `None` as "no frontmatter to render" and fall back to
/// normal Markdown rendering of the whole document.
fn render_frontmatter_table(yaml_body: &str) -> Option<String> {
    let value: Value = serde_yaml::from_str(yaml_body).ok()?;
    let Value::Mapping(map) = value else { return None };
    if map.is_empty() {
        return None;
    }
    let mut html = String::from("<table data-line=\"1\"><tbody>");
    for (k, v) in &map {
        let key = html_escape(&yaml_key_to_string(k));
        let val = render_yaml_value(v, 0);
        html.push_str(&format!("<tr><td>{key}</td><td>{val}</td></tr>"));
    }
    html.push_str("</tbody></table>");
    Some(html)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p skymark-core render_frontmatter_table`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-core/src/render.rs
git commit -m "feat: render YAML frontmatter mappings as HTML tables"
```

---

### Task 3: Wire frontmatter detection and table rendering into `render_html` (Rust)

**Files:**
- Modify: `crates/skymark-core/src/render.rs`

**Interfaces:**
- Consumes: `frontmatter_span` (Task 1) and `render_frontmatter_table` (Task 2), exactly as defined above.
- Produces: no new public API — `render_html`'s existing signature and behavior for non-frontmatter documents are unchanged; documents with valid frontmatter now get a table prepended and their body's `data-line` numbers reflect their true position in the original document.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `mod tests { ... }` block in `crates/skymark-core/src/render.rs`, after the tests added in Task 2:

```rust
    #[test]
    fn render_html_renders_frontmatter_table_then_body() {
        let html = render_html("---\nname: skill\ndescription: a test\n---\n\n# Heading\n").unwrap();
        assert!(
            html.contains("<table data-line=\"1\"><tbody><tr><td>name</td><td>skill</td></tr><tr><td>description</td><td>a test</td></tr></tbody></table>"),
            "missing frontmatter table: {html}"
        );
        // Document lines: 1 ---, 2 name, 3 description, 4 ---, 5 blank, 6 # Heading.
        assert!(
            html.contains(r#"data-line="6""#),
            "heading should carry the original document's line number: {html}"
        );
    }

    #[test]
    fn render_html_falls_back_when_no_closing_fence() {
        let html = render_html("---\nname: skill\n\n# Heading\n").unwrap();
        assert!(!html.contains("<table"), "should not render a table: {html}");
        assert!(
            html.contains("name: skill"),
            "frontmatter-like text should render as ordinary content: {html}"
        );
    }

    #[test]
    fn render_html_falls_back_for_invalid_yaml() {
        let html = render_html("---\nkey: [unclosed\n---\n\n# Heading\n").unwrap();
        assert!(!html.contains("<table"), "should not render a table: {html}");
    }

    #[test]
    fn render_html_ignores_dashes_not_at_document_start() {
        let html = render_html("# Heading\n\n---\n\nMore text.\n").unwrap();
        assert!(
            !html.contains("<table"),
            "should not treat mid-document --- as frontmatter: {html}"
        );
        assert!(
            html.contains("<hr"),
            "--- after a blank line following content should still render as a thematic break: {html}"
        );
    }

    #[test]
    fn render_html_unaffected_when_no_frontmatter() {
        let html = render_html("# Hello\n\nA paragraph.\n").unwrap();
        assert!(!html.contains("<table"));
        assert!(html.contains(r#"data-line="1""#));
        assert!(html.contains(r#"data-line="3""#));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p skymark-core render_html`
Expected: FAIL — `render_html_renders_frontmatter_table_then_body` fails (no table present yet); the others currently pass by coincidence (today's behavior already happens to satisfy them), which is fine — they'll continue to pass and serve as regression checks once the change lands.

- [ ] **Step 3: Modify `render_html`**

In `crates/skymark-core/src/render.rs`, replace the body of `pub fn render_html` — specifically the section from the `// Full render pipeline` comment down to (but not including) the final `let result = sanitize(&html_buf);` line — with:

```rust
    // Split off a leading YAML frontmatter block, if one is present and
    // parses to a non-empty mapping. `body` and `line_offset` let the rest
    // of the pipeline behave exactly as if `body` were the whole document,
    // just with line numbers shifted to match their position in the
    // original `markdown` string.
    let (frontmatter_html, body, line_offset) = match frontmatter_span(markdown) {
        Some((yaml_range, frontmatter_end)) => {
            match render_frontmatter_table(&markdown[yaml_range]) {
                Some(table_html) => {
                    let consumed_lines = markdown[..frontmatter_end].matches('\n').count();
                    (Some(table_html), &markdown[frontmatter_end..], consumed_lines)
                }
                None => (None, markdown, 0),
            }
        }
        None => (None, markdown, 0),
    };

    // Full render pipeline
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(body.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    let heading_slugs = collect_heading_slugs(body);
    let mut heading_idx = 0;
    let mut html_buf = String::new();
    if let Some(table_html) = &frontmatter_html {
        html_buf.push_str(table_html);
    }
    let parser = Parser::new_ext(body, gfm_options());
    for (event, range) in parser.into_offset_iter() {
        if let Event::Start(ref tag) = event {
            if is_block_tag(tag) {
                let line = byte_to_line(range.start, &line_starts) + line_offset;
                if matches!(tag, Tag::Heading { .. }) {
                    let slug = heading_slugs
                        .get(heading_idx)
                        .map(String::as_str)
                        .unwrap_or("");
                    heading_idx += 1;
                    html_buf.push_str(&heading_open_tag(tag, line, slug));
                } else {
                    html_buf.push_str(&block_open_tag(tag, line));
                }
                continue;
            }
        }
        html::push_html(&mut html_buf, std::iter::once(event));
    }
```

Leave the rest of the function (`let result = sanitize(&html_buf);` through the end) unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p skymark-core`
Expected: PASS — the full `skymark-core` test suite passes, including all tests from Tasks 1-3 and the pre-existing tests in `render.rs` and `sanitize.rs`.

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-core/src/render.rs
git commit -m "feat: render leading YAML frontmatter as a table in render_html"
```

---

### Task 4: YAML syntax highlighting for the frontmatter block in the editor (TypeScript)

**Files:**
- Modify: `package.json`
- Create: `frontend/src/frontmatter-lang.ts`
- Create: `frontend/src/frontmatter-lang.test.ts`
- Modify: `frontend/src/editor.ts:4` (import), `frontend/src/editor.ts:203` (usage)

**Interfaces:**
- Produces: `export function detectFrontmatterSpan(text: string): { from: number; to: number } | null` — returns the byte range from the start of the document through the end of the closing fence line (both fence lines included), or `null` if no frontmatter block is detected. Used to tell the editor's YAML overlay which bytes to re-highlight; mirrors `frontmatter_span` in `crates/skymark-core/src/render.rs` in spirit (same detection rule), but returns a different range shape since this one is for highlighting a whole block rather than extracting a YAML body to parse.
- Produces: `export function markdownWithFrontmatter(): Extension` — a CodeMirror `Extension` combining `@codemirror/lang-markdown`'s `markdown()` with a YAML highlighting overlay over the detected frontmatter span. Replaces the bare `markdown()` call in `editor.ts`.

- [ ] **Step 1: Add the `@codemirror/lang-yaml` dependency**

In `package.json`, add this line to `dependencies`, alphabetically after `"@codemirror/lang-markdown"`:

```json
    "@codemirror/lang-yaml": "^6.1.3",
```

Run: `npm install`
Expected: installs `@codemirror/lang-yaml` and its new transitive dependency `@lezer/yaml`, updating `package-lock.json`.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/frontmatter-lang.test.ts`:

```ts
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { NodeProp } from "@lezer/common";
import { describe, it, expect } from "vitest";
import { detectFrontmatterSpan, markdownWithFrontmatter } from "./frontmatter-lang";

describe("detectFrontmatterSpan", () => {
  it("finds the span from the start of the document through the closing fence", () => {
    const doc = "---\nname: skill\n---\n\n# Heading\n";
    const span = detectFrontmatterSpan(doc);
    expect(span).not.toBeNull();
    expect(doc.slice(span!.from, span!.to)).toBe("---\nname: skill\n---");
  });

  it("returns null when --- is not the first line", () => {
    expect(detectFrontmatterSpan("# Heading\n\n---\nnot frontmatter\n---\n")).toBeNull();
  });

  it("returns null when there is no closing fence", () => {
    expect(detectFrontmatterSpan("---\nname: skill\n\n# Heading\n")).toBeNull();
  });

  it("accepts ... as a closing fence", () => {
    const doc = "---\nname: skill\n...\nbody\n";
    const span = detectFrontmatterSpan(doc);
    expect(span).not.toBeNull();
    expect(doc.slice(span!.from, span!.to)).toBe("---\nname: skill\n...");
  });

  it("handles an empty frontmatter body", () => {
    const doc = "---\n---\n\nbody\n";
    const span = detectFrontmatterSpan(doc);
    expect(span).not.toBeNull();
    expect(doc.slice(span!.from, span!.to)).toBe("---\n---");
  });
});

function mountedOverlay(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdownWithFrontmatter()] });
  return syntaxTree(state).topNode.tree?.prop(NodeProp.mounted);
}

describe("markdownWithFrontmatter", () => {
  it("mounts a YAML overlay over the detected frontmatter span", () => {
    const doc = "---\nname: skill\n---\n\n# Heading\n";
    const mounted = mountedOverlay(doc);
    expect(mounted).toBeDefined();
    expect(mounted?.overlay?.[0].from).toBe(0);
    expect(mounted?.overlay?.[0].to).toBe(19);
  });

  it("does not mount an overlay when there's no closing fence", () => {
    expect(mountedOverlay("---\nJust text, no closing fence\nmore text below\n")).toBeUndefined();
  });

  it("does not mount an overlay when --- is not the first line", () => {
    expect(mountedOverlay("# Heading\n\n---\nnot frontmatter\n---\n")).toBeUndefined();
  });

  it("still parses the body as markdown after the frontmatter block", () => {
    const doc = "---\nname: skill\n---\n\n# Heading\n";
    const state = EditorState.create({ doc, extensions: [markdownWithFrontmatter()] });
    const headingPos = doc.indexOf("# Heading") + 2;
    const node = syntaxTree(state).resolve(headingPos, 1);
    expect(node.name).toBe("ATXHeading1");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/frontmatter-lang.test.ts`
Expected: FAIL with `Failed to resolve import "./frontmatter-lang"`.

- [ ] **Step 4: Implement `frontmatter-lang.ts`**

Create `frontend/src/frontmatter-lang.ts`:

```ts
import type { Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { parseMixed, type Input, type NestedParse, type SyntaxNodeRef } from "@lezer/common";

export interface Span {
  from: number;
  to: number;
}

/**
 * Detects a leading YAML frontmatter block per GitHub's rule: the
 * document's first line is exactly `---`, and some later line is exactly
 * `---` or `...`. Returns the byte range from the start of the document
 * through the end of the closing fence line (both fence lines included),
 * or null if no such block exists.
 *
 * Mirrors the detection rule in `frontmatter_span`
 * (crates/skymark-core/src/render.rs) — kept as an independent
 * implementation since the two run in different languages.
 */
export function detectFrontmatterSpan(text: string): Span | null {
  const lines = text.split("\n");
  const first = lines[0]?.replace(/\r$/, "") ?? "";
  if (first !== "---") return null;

  let offset = (lines[0]?.length ?? 0) + 1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/\r$/, "");
    if (trimmed === "---" || trimmed === "...") {
      return { from: 0, to: offset + line.length };
    }
    offset += line.length + 1;
  }
  return null;
}

const frontmatterOverlay = {
  wrap: parseMixed((node: SyntaxNodeRef, input: Input): NestedParse | null => {
    if (node.type.name !== "Document" || node.from !== 0) return null;
    const span = detectFrontmatterSpan(input.read(0, input.length));
    if (!span) return null;
    return { parser: yamlLanguage.parser, overlay: [span] };
  }),
};

/** Markdown language support with YAML frontmatter highlighted as an overlay. */
export function markdownWithFrontmatter(): Extension {
  return markdown({ extensions: frontmatterOverlay });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/frontmatter-lang.test.ts`
Expected: PASS — all 9 tests pass.

- [ ] **Step 6: Wire `markdownWithFrontmatter` into the editor**

In `frontend/src/editor.ts`, replace line 4:

```ts
import { markdown } from "@codemirror/lang-markdown";
```

with:

```ts
import { markdownWithFrontmatter } from "./frontmatter-lang";
```

Then replace line 203 (inside `createEditor`'s extensions array):

```ts
        markdown(),
```

with:

```ts
        markdownWithFrontmatter(),
```

- [ ] **Step 7: Run the full frontend test suite and type-check to confirm no regressions**

Run: `npm run test`
Expected: PASS — all existing test files (`editor.test.ts`, `stats.test.ts`, `sync.test.ts`, etc.) and the new `frontmatter-lang.test.ts` pass.

Run: `npm run build`
Expected: TypeScript compiles with no errors and Vite produces a build.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json frontend/src/frontmatter-lang.ts frontend/src/frontmatter-lang.test.ts frontend/src/editor.ts
git commit -m "feat: highlight YAML frontmatter blocks in the editor"
```

---

### Task 5: Manual verification

**Files:** none (no code changes — this task confirms the feature end-to-end in the running app)

- [ ] **Step 1: Start the dev app**

Run: `npm run tauri:dev`
Expected: the Tauri window opens with Skymark's editor.

- [ ] **Step 2: Verify the preview table for valid frontmatter**

In the editor pane, type (or paste) exactly:

```
---
name: using-superpowers
description: Use when starting any conversation
metadata:
  type: feedback
---

# Heading

Some body text.
```

Expected: the preview pane shows a two-column table at the top with rows `name` / `using-superpowers`, `description` / `Use when starting any conversation`, and `metadata` / `type: feedback` (on its own indented line within the cell) — followed by a normally-rendered `<h1>Heading</h1>` and paragraph below. No raw `---` or YAML text leaks into the rendered body.

- [ ] **Step 3: Verify editor-preview scroll sync still works**

Click inside the `# Heading` line in the editor. Expected: the preview scrolls to (or stays at) the heading — sync isn't thrown off by the frontmatter table occupying the top of the preview.

- [ ] **Step 4: Verify editor YAML highlighting**

Look at the editor pane for the same document. Expected: the `---` fence lines and the YAML keys/values between them are colored distinctly from the Markdown body below (YAML token colors, not Markdown heading/paragraph colors).

- [ ] **Step 5: Verify fallback behavior**

Replace the document with:

```
---
This is just a thematic break, not frontmatter, and it never closes.

# Heading
```

Expected: the preview renders this as ordinary Markdown (no table) — exactly as it did before this change. The editor may or may not highlight part of this as YAML (a known, narrow limitation when no closing fence exists — see Task 4); the preview's behavior is what matters for correctness.

- [ ] **Step 6: Verify HTML export includes the table**

With the Step 2 document loaded, click **Export ▾ → Export as HTML**, save the file, and open it in a browser. Expected: the exported HTML contains the same frontmatter table seen in the preview.

- [ ] **Step 7: Verify print/PDF includes the table**

With the Step 2 document loaded, use **Export ▾ → Print / Save as PDF** (or `Cmd/Ctrl+P`). Expected: the print preview shows the frontmatter table at the top of the document, above the heading.
