# YAML frontmatter rendering

## Problem

Many Markdown files (Jekyll/Hugo posts, Claude agentic skill files like `SKILL.md`) start with a `---`-delimited YAML frontmatter block. Skymark's renderer has no concept of this: pulldown-cmark parses the leading `---` as a thematic break and the YAML body as a stray paragraph, and a `key: value` line immediately followed by another `---` gets reinterpreted as a Setext `<h2>` heading. The result is garbled, unreadable preview output for any file that has frontmatter.

GitHub renders the same files by parsing the YAML and showing it as a plain key/value table above the rendered body. Skymark should do the same.

## Goals

- Detect a leading YAML frontmatter block using GitHub's exact rule and render it as a key/value table in the preview, instead of letting pulldown-cmark mangle it.
- Because HTML export and print both reuse the live preview DOM (`export.ts` clones `previewEl`), this fixes export/print for free — no separate plumbing needed there.
- Give the frontmatter block its own YAML syntax highlighting in the CodeMirror editor pane.

## Non-goals

- Stats footer (word/char/token/line counts) — unchanged. Continues counting the raw document text, frontmatter included.
- Invalid or non-mapping YAML — falls back silently to today's (pre-existing, buggy-but-harmless) rendering. No error banner, no crash.
- New-document frontmatter scaffolding/templates.
- Frontmatter detection anywhere other than the very start of the file (e.g. no support for frontmatter after leading blank lines).
- Perfect editor/preview parity on invalid-but-fenced YAML: the editor's overlay highlights any correctly-fenced block as YAML regardless of whether the YAML inside it actually parses, while the preview only renders a table for a valid mapping and otherwise falls back to plain Markdown rendering. This is a second, narrower known divergence beyond the no-closing-fence case above — cosmetic only (highlighting vs. no highlighting in the editor), never a rendering-correctness issue, since the preview's fallback behavior is unaffected.

## Design

### Detection rule (shared intent, implemented twice)

A block counts as frontmatter only if:
1. The file's first line is exactly `---` (byte offset 0).
2. Scanning forward, some later line is exactly `---` or exactly `...` (the closing fence).

If either condition fails, there is no frontmatter — render exactly as today. This rule is implemented independently in both the Rust renderer and the CodeMirror extension (no shared code is feasible across that boundary); both follow the same two conditions above.

### Component 1: `skymark-core` (Rust) — detection + table rendering

In `render.rs`, `render_html` gains a pre-pass before the existing pulldown-cmark loop:

1. **Detect.** Scan the raw markdown text for the frontmatter span per the rule above. If not found, proceed exactly as today (no behavior change for documents without frontmatter).
2. **Parse.** Parse the YAML body between the fences with `serde_yaml` (new dependency on `skymark-core`). If parsing errors, or the top-level value isn't a mapping, treat this as "no frontmatter found" and fall back to today's rendering untouched.
3. **Build the table.** Construct an HTML `<table data-line="1">` with one row per top-level key:
   - Scalars (string/number/bool/null) render as escaped text (null → empty cell).
   - Sequences render as a comma-joined list of their (stringified, escaped) scalar items.
   - Nested mappings render as multiple `key: value` lines within the cell (one per nested key, recursing for deeper nesting, each level indented two spaces — mirrors YAML's own indentation convention).
   - All text goes through the existing `html_escape` helper before being placed in cells.
   This table HTML is prepended to `html_buf`, before anything else.
4. **Suppress the frontmatter region from the normal parse.** Run the existing pulldown-cmark `into_offset_iter()` loop over the **full, unmodified** markdown string (so all byte-offset/line-number math for the rest of the document is untouched). For each `(event, range)`, if `range.end` falls within the detected frontmatter span, skip emitting HTML for it. This discards whatever pulldown-cmark made of the frontmatter region (thematic breaks, stray paragraphs, accidental Setext headings) without needing to special-case how it was parsed.

Render caching is unaffected — the existing cache key is a hash of the full input markdown, which already includes the frontmatter text.

### Component 2: CodeMirror editor highlighting (TypeScript)

Add `@codemirror/lang-yaml` as a new frontend dependency.

In `editor.ts`, define a small Lezer-markdown extension and pass it via `markdown({ extensions: [frontmatterExtension] })`:

- A `parseBlock` rule (tried `before: "HorizontalRule"`) that fires only when `cx.lineStart === 0` and the current line is exactly `---`, then scans forward for a closing `---`/`...` line, consuming everything between (and including the fences) into a single `YAMLFrontmatter` block node. If no closing fence is found before EOF, the rule declines (returns `false`) and default Markdown parsing takes over, consistent with the Rust-side fallback behavior.
- A `wrap: parseMixed(...)` that nests the `@codemirror/lang-yaml` parser inside the matched `YAMLFrontmatter` node's content, so keys/strings/etc. get YAML token highlighting instead of default Markdown paragraph/heading styling.

This is the highest-uncertainty part of the change — Lezer's mixed-parsing API is narrower than the Rust side's plain string scanning, so the exact `parseBlock`/`parseMixed` wiring may need small adjustments during implementation. The fallback (decline to match, let default Markdown parsing proceed) keeps failure modes safe: worst case is the block stays styled as plain Markdown, same as today.

## Testing

- Rust unit tests in `render.rs` (alongside existing ones):
  - A document with valid mapping frontmatter renders a `<table>` with one row per key, and the body below renders normally with correct `data-line` values (i.e. unaffected by the frontmatter's byte length).
  - Nested mapping values render as multi-line cells.
  - Sequence values render as comma-joined lists.
  - A document where `---` is *not* the first line is untouched (frontmatter detection doesn't fire mid-document).
  - A document with an unterminated frontmatter fence (no closing `---`/`...`) falls back to current rendering.
  - A document with invalid YAML between the fences falls back to current rendering.
  - A document where the frontmatter parses to a non-mapping (e.g. a YAML scalar or list) falls back to current rendering.
- Manual verification in the running app: open a `SKILL.md`-style file, confirm the preview shows a clean key/value table (including the nested `metadata.type` case) followed by normal rendering of the rest of the document; confirm the editor pane shows YAML highlighting inside the frontmatter block; confirm HTML export and print both include the rendered table.
