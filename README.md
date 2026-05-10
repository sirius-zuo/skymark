# Skymark

A fast, lightweight Markdown editor for the desktop. Built with Rust and Tauri 2.

Two-pane layout: write Markdown on the left, see live HTML preview on the right.

---

## Features

- **Live preview** — updates as you type, ~50ms debounce
- **CommonMark + GFM** — tables, strikethrough, task lists, fenced code blocks
- **Open / Save** — open any `.md`, `.markdown`, or `.txt` file; save with keyboard shortcuts
- **Dirty tracking** — a `●` in the titlebar shows unsaved changes
- **XSS-safe preview** — all HTML is sanitized before display; `<script>` tags, inline event handlers, and `javascript:` URLs are stripped at the render boundary
- **Cross-platform** — macOS (Apple Silicon + Intel), Linux, Windows

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + O` | Open file |
| `Cmd/Ctrl + S` | Save file (prompts for path on first save) |
| `Cmd/Ctrl + N` | New document |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Cmd/Ctrl + F` | Find in editor |

---

## Getting started

See [BUILD.md](BUILD.md) for prerequisites and build instructions.

**Quick start (development):**
```bash
npm install
npm run tauri:dev
```

---

## Architecture

Skymark is split into three layers:

- **`skymark-core`** — pure Rust library. Converts Markdown to sanitized HTML using [pulldown-cmark](https://github.com/raphlinus/pulldown-cmark) and [ammonia](https://github.com/notriddle/ammonia). No Tauri dependency; compiles to `wasm32-unknown-unknown` for future web use.
- **`skymark-app`** — Tauri 2 backend. Exposes `render`, `open_file`, and `save_file` commands. Saves files atomically (write-temp-then-rename). Deny-by-default capability model — only `dialog:allow-open` and `dialog:allow-save` are granted.
- **Frontend** — Vite + TypeScript. [CodeMirror 6](https://codemirror.net) editor with Markdown syntax highlighting. Preview rendered via `DOMParser` + `replaceChildren` (never `innerHTML`).

---

## Roadmap

| Phase | Focus |
|-------|-------|
| **Phase 1** ✅ | Core editor, live preview, open/save, security baseline, CI |
| **Phase 2** ✅ | Smart editing (auto-pair, list continuation), draft auto-save, crash recovery |
| **Phase 3** ✅ | Vault mode (folder of files), file tree sidebar, fuzzy file search |
| **Phase 4** ✅ | Multi-tab editing, file watcher, sidebar resize, broken-link detection, heading search |
| **Phase 5** ✅ | Math (KaTeX), Mermaid diagrams, syntax highlighting in preview, dark/light theme |
| Phase 6 | Export: HTML, PDF, DOCX |
| Phase 7 | Multi-platform release packaging, auto-update |
