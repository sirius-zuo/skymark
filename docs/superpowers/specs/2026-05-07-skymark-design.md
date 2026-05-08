# Skymark — Design Spec

- **Date:** 2026-05-07
- **Status:** Approved (brainstorming phase)
- **Owner:** jinzuo

## 1. Product Summary

Skymark is a fast, smart, lightweight Markdown editor. The standalone product is a Tauri 2 desktop app for macOS (Apple Silicon + Intel), Linux (x86_64 + aarch64), and Windows (x86_64). The same Rust core is built to compile to `wasm32-unknown-unknown`, reserving a clean path to a future web app without a redesign.

Two-pane UI: a CodeMirror 6 editor on the left and a live HTML preview on the right.

### 1.1 Success Criteria

- Cold start under 1.5s on a 2020+ laptop.
- Preview update latency under 50ms on a 10k-word document.
- Per-platform installer in the 15–25MB range.
- `skymark-core` has zero UI/Tauri/JS dependencies and a green `wasm32-unknown-unknown` build is gated in CI from day one.

## 2. Scope

### 2.1 In Scope (v1)

- Two-pane editor + preview UI.
- Markdown: CommonMark + GFM + footnotes + math (KaTeX) + Mermaid + syntax-highlighted code (Prism).
- Smart editing: auto-pair brackets/quotes, auto-continue lists & blockquotes, smart-paste URL → autolink, smart-paste image → save into the vault attachments folder and insert relative link, table cell tab/shift-tab navigation, automatic column alignment on save.
- Smart navigation: live outline, fuzzy file/heading search, broken-link detection.
- Document model: open a single `.md` file (TextEdit-style, no sidebar) OR open a folder (vault mode with a sidebar tree, multi-tab editing). Mode is auto-detected from what the user opens.
- Export: HTML, PDF (via Tauri webview print-to-PDF), DOCX (via `docx-rs`).
- Settings: persisted JSON in Tauri's `app_config_dir`.
- Default light theme, optional dark theme.

### 2.2 Architected, Not Shipped (v1.1+)

These are deliberately wired into the architecture so adding them later does not require redesign:

- Optional Pandoc integration for extended export formats (epub, rtf, odt, LaTeX, etc.) and most imports.
- Symmetric import: DOCX → MD, EPUB → MD, TXT → MD, and PDF → MD as best-effort text extraction.
- Web app target reusing `skymark-core` via WASM with a different host shell.
- Plugins / custom block types.
- Backlinks and link graph.
- Themes beyond the two built-in.

### 2.3 Out of Scope (v1)

- Sync (cloud, git, etc.).
- AI features (completion, rewriting, summarization). Revisited as a separate product surface later.
- Mobile targets.
- High-quality structural PDF → MD import (the architecture supports it; the format itself caps quality).

## 3. Architecture

### 3.1 Crates and Hosts

```
skymark-core   ← pure Rust, no Tauri, no JS, builds to native + wasm32
                 owns: parser, AST, smart-edit logic, FormatConverter trait,
                       outline/link extraction, built-in HTML & DOCX exporters

skymark-app    ← Tauri 2 backend; depends on skymark-core
                 owns: Tauri commands, file system I/O, vault watcher, settings,
                       webview-print-to-PDF exporter (Tauri-only API surface)

frontend/      ← TypeScript: CodeMirror 6 + KaTeX + Mermaid + Prism
                 communicates with backend via Tauri invoke
```

A future `skymark-web` host shell can replace `skymark-app` for the browser by depending on `skymark-core` compiled to WASM and reusing the same frontend code with `invoke` swapped for direct WASM calls.

### 3.2 Layering Invariants

- `skymark-core` MUST NOT depend on `tauri`, `tauri-build`, browser-only crates, or any non-WASM-compatible crate. CI gates this with a `wasm32-unknown-unknown` build on every PR.
- The HTML rendering pipeline used by the live preview is the same code path used by `HtmlExporter`. There is one canonical Markdown → HTML pipeline; preview and export cannot drift.
- Tauri-specific APIs (windowing, file dialogs, webview print-to-PDF) live only in `skymark-app`.

### 3.3 Data Flow on Keystroke

```
keystroke → CodeMirror 6 → debounced 50ms → tauri invoke("render", text)
   → skymark-core parses → AST → HTML string → returned
   → preview pane diff-applies HTML → KaTeX/Mermaid/Prism enhance changed regions
```

### 3.4 Diff Rendering

A full preview re-render of a 10k-word document blows the 50ms latency budget. The preview maintains a stable mapping from AST blocks to top-level DOM elements and re-renders only blocks whose AST has changed since the last render. KaTeX/Mermaid/Prism are invoked only on changed regions.

## 4. Editor & Preview

### 4.1 Editor (CodeMirror 6)

- Auto-pair brackets/quotes; auto-continue ordered/unordered lists and blockquotes when Enter is pressed on a non-empty list item; cancel continuation when Enter is pressed on an empty list item.
- Smart-paste:
  - URL on selection → wrap as `[selection](url)`.
  - URL with no selection → `<url>` autolink.
  - Image data → write to `<vault>/.attachments/<hash>.<ext>` (or sibling `<file>.attachments/` in single-file mode) and insert relative `![](path)`.
- Tables: tab / shift-tab to navigate cells; columns auto-align on save (whitespace pad to longest cell per column).
- Keyboard: `cmd/ctrl-B/I` bold/italic, `cmd/ctrl-K` link, `cmd/ctrl-1..6` heading levels.
- Markdown highlighting: CodeMirror's `@codemirror/lang-markdown` extended with grammar tweaks for math (`$…$`, `$$…$$`), Mermaid blocks, and footnotes.
- Outline: `skymark-core` exposes a heading list (level, text, source line); the frontend renders it as a sidebar (vault mode) or floating panel (single-file mode); click navigates the editor.

### 4.2 Preview Pane

- HTML produced by `skymark-core::render_html(text)` — the same function `HtmlExporter` calls.
- KaTeX renders `$…$` and `$$…$$`. Loaded eagerly because math is enabled by default in v1.
- Mermaid renders ` ```mermaid ` blocks. Lazy-loaded on first encounter to keep cold start tight when no diagrams are present.
- Prism renders syntax-highlighted code blocks. Language packs lazy-loaded by language tag.
- Scroll sync: the parser emits a per-block source-line range; `data-source-line` attributes on top-level preview elements drive bidirectional scroll mapping between editor and preview.
- Update strategy: 50ms debounce; per-block diff render; KaTeX/Mermaid/Prism only re-run on changed blocks.

### 4.3 Document & Vault Model

- Opening a `.md` file enters single-file mode: no sidebar, single document, single editor pane. Recent-files list in settings.
- Opening a folder enters vault mode: file tree sidebar (sorted by name), multi-tab editor, vault-wide fuzzy search (`cmd/ctrl-P`) over filenames + headings, ranked by recent use. Recent-vaults list in settings.
- Broken-link detection: passive scan on save; the file tree shows a small badge on files containing broken outbound links.
- File watcher (the `notify` crate) detects external edits and triggers a prompt-or-merge flow when the user has local unsaved changes; otherwise the buffer is updated silently.

### 4.4 Settings

- JSON file in Tauri's `app_config_dir`.
- Toggles: math on/off (default on), Mermaid on/off (default on), theme (light default, dark optional), editor font, preview font, attachment folder name, preview update mode, fuzzy-search index size cap.

## 5. Visual Identity

- Default light theme; dark theme as an opt-in toggle, not the default.
- Typography: a single high-quality variable sans for UI (Inter) and a serif/mono pair for editor body and code (Source Serif or iA Writer Quattro for body; JetBrains Mono or Berkeley Mono for code). No icon noise.
- Generous whitespace: ≥1.5 line-height in the editor, content max-width on preview for readability, ample sidebar padding.
- Restrained palette: one accent color, one muted background, neutrals everywhere else.
- No skeuomorphism, no heavy borders, no decorative gradients.
- A single `tokens.css` file owns colors, spacing, typography. Components consume tokens, never raw values. Future themes ship as alternate tokens files.

## 6. Format Conversion (Symmetric Import/Export)

### 6.1 Trait

```rust
// skymark-core
pub trait FormatConverter {
    fn id(&self) -> &str;
    fn supports_export(&self) -> bool;
    fn supports_import(&self) -> bool;
    fn export(&self, ast: &MarkdownAst, opts: &ExportOpts) -> Result<Vec<u8>>;
    fn import(&self, bytes: &[u8], opts: &ImportOpts) -> Result<MarkdownAst>;
}
```

A converter MAY support only one direction; consumers query `supports_export`/`supports_import` before calling. `skymark-core` exposes a `ConverterRegistry` that holds the built-in providers; `skymark-app` adds its host-only providers (e.g., `WebviewPdfExporter`) into the same registry at startup. The frontend export/import dialogs enumerate the merged registry and present converters with the matching capability.

### 6.2 v1 Providers (Built-in)

- `HtmlExporter` — AST → HTML string. Also drives the live preview pipeline.
- `DocxRsExporter` — AST → DOCX bytes via `docx-rs`. Walks AST nodes and emits paragraphs, headings, ordered/unordered lists, tables, fenced code blocks, basic inline formatting (bold/italic/strikethrough/inline code), links, images.
- `WebviewPdfExporter` — lives in `skymark-app` (it requires the Tauri webview API). Renders the current preview through the webview's print-to-PDF, producing a PDF that visually matches the preview pane. Invoked from the same export menu as the core converters.

### 6.3 v1.1 Providers (Architected, Not Shipped)

- `PandocConverter` — detects Pandoc on PATH or in an app-managed location; if absent, prompts a one-time download. Bidirectional for any Pandoc-supported format.
- `EpubImporter`, `DocxImporter`, `TxtImporter` — Rust-native imports for users without Pandoc.
- `PdfImporter` — best-effort text extraction via `pdf-extract`. The UI must explicitly warn that structure (headings, lists, tables) may be lost.

## 7. Cross-Platform Packaging

- Build via `cargo tauri build` per target on a GitHub Actions matrix.
- macOS: universal binary covering Apple Silicon and Intel → signed and notarized `.dmg`. Code-signing setup is a one-time chore tracked outside this spec; an Apple Developer account is required before alpha distribution.
- Linux: `.deb`, `.rpm`, and `AppImage` for x86_64 and aarch64.
- Windows: `.msi` for x86_64. arm64 is a stretch goal contingent on Tauri 2's bundler reliability for that target.
- CI caches `cargo` and `node_modules`. Build artifacts are uploaded per platform and per PR for smoke testing.
- The WASM build of `skymark-core` runs in CI on every PR — guarding the future web-app path is a continuous invariant, not a one-time check.

## 8. Testing Strategy

- `skymark-core`:
  - Unit tests for parser, AST manipulation, smart-edit primitives (list continuation, table alignment, smart-paste URL).
  - Golden-file tests for each `FormatConverter`: input Markdown fixtures → expected HTML / DOCX bytes. DOCX golden files compared by canonical XML diff (not raw bytes) to avoid spurious failures from zip metadata.
- `skymark-app`:
  - Integration tests for Tauri commands using Tauri's mock app context (`tauri::test::mock_app`).
- Frontend:
  - Playwright end-to-end tests against a built dev binary, covering: open file → type → preview updates within budget; export PDF; export DOCX; open vault → fuzzy search; broken-link badge appears.
- Performance:
  - A perf test asserts the 50ms preview-latency budget on a 10k-word fixture, run in CI on a fixed-size runner. A regression alert fires if median or p95 crosses budget.

## 9. Risks

- **DOCX exporter scope creep.** `docx-rs` is low-level. v1 commits to a defined subset (paragraphs, headings, lists, tables, fenced code, basic inline formatting, images). Anything beyond that subset (footnotes in DOCX, rendered math in DOCX) is v1.1 and uses Pandoc. The export dialog surfaces this so users do not silently lose content.
- **Preview latency on huge documents.** The 50ms target holds at 10k words. Beyond ~50k words, the diff-render heuristic may need a virtualized preview. Out of scope for v1; flagged for monitoring.
- **macOS code signing & notarization.** Requires an Apple Developer account; not blocking the design but blocks shipping. Owner sets this up before alpha.
- **PDF → MD quality ceiling.** Even with the architecture in place, PDFs do not carry semantic structure. Marketing must not promise "full-fidelity" PDF import.

## 10. Open Items

- Final font choices (Inter is locked for UI; the editor body and code fonts are a design polish call before alpha).
- Pandoc download / packaging strategy for v1.1: bundled vs. detected vs. on-demand download. Decided when v1.1 starts.
