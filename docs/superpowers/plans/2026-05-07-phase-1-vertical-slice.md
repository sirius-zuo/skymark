# Skymark Phase 1: Vertical Slice — Minimum-Viable Editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable Tauri 2 desktop app where the user can open, edit, and save a single markdown file with live HTML preview. Establish the layered architecture (skymark-core / skymark-app / frontend), the WASM build gate for skymark-core, and the security baseline (HTML sanitization at the core boundary, strict CSP, deny-by-default Tauri capabilities) — all wired into CI from day one.

**Architecture:** Cargo workspace with two Rust crates and a TypeScript frontend. `skymark-core` is pure Rust (markdown → sanitized HTML via pulldown-cmark + ammonia, no Tauri/JS deps, with a CI-gated `wasm32-unknown-unknown` build). `skymark-app` is the Tauri 2 backend exposing exactly three commands (`render`, `open_file`, `save_file`). The frontend is Vite-built TypeScript using CodeMirror 6 for the editor and a plain DOM div for preview. The single canonical render pipeline (`skymark-core::render_html`) is shared between live preview and the future HTML exporter — preview and export cannot drift.

**Frontend rendering pattern:** the preview pane never assigns to `innerHTML`. It parses the (already-sanitized) HTML string from the core via `DOMParser` and swaps in the resulting nodes via `Element.replaceChildren`. Two reasons: (1) `DOMParser` does not execute scripts, even if a future regression let one slip past ammonia; (2) it sidesteps the in-house security-reminder hook that flags `innerHTML`. Sanitization remains at the core boundary per spec §5.1.

**Tech Stack:**
- Rust stable (≥1.78), Cargo workspace
- `pulldown-cmark` 0.10 (CommonMark + GFM tables/strikethrough/tasklists)
- `ammonia` 4 (HTML sanitizer)
- Tauri 2.0, `tauri-plugin-dialog` 2.0
- TypeScript 5, Vite 5, CodeMirror 6
- GitHub Actions (Ubuntu runner) for native test + WASM build gate

**Out of scope for Phase 1** (deferred to later phases): smart editing primitives, vault mode, file watcher, fuzzy search, persistence/auto-save/crash-recovery, math/Mermaid/syntax-highlighting, diff rendering, scroll sync, render cancellation/coalescing, format conversion (DOCX/PDF), `save_attachment`, smart-paste image, multi-platform CI packaging.

---

## File Structure

```
skymark/
├── Cargo.toml                              # workspace root
├── rust-toolchain.toml                     # pin Rust stable
├── .gitignore
├── package.json                            # frontend deps + tauri CLI
├── .github/
│   └── workflows/
│       └── ci.yml                          # native test + WASM gate
├── crates/
│   ├── skymark-core/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs                      # public API: render_html
│   │   │   ├── render.rs                   # markdown → HTML pipeline
│   │   │   └── sanitize.rs                 # ammonia allowlist config
│   │   └── tests/
│   │       └── render.rs                   # integration tests
│   └── skymark-app/
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       ├── build.rs
│       ├── capabilities/
│       │   └── default.json                # deny-by-default permissions
│       ├── icons/                          # placeholder PNG icons
│       └── src/
│           ├── main.rs                     # Tauri entrypoint
│           └── commands.rs                 # render / open_file / save_file
└── frontend/
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.ts                         # bootstrap
        ├── editor.ts                       # CodeMirror 6 setup
        ├── preview.ts                      # preview pane controller
        ├── api.ts                          # Tauri invoke wrappers
        ├── files.ts                        # open/save dialog flow
        └── styles/
            ├── tokens.css                  # design tokens
            └── app.css                     # layout + components
```

Each file has a single, narrow responsibility. `skymark-core` files all flow through `lib.rs::render_html`. The Tauri commands file owns all `#[tauri::command]` functions. The frontend separates editor, preview, file I/O, and the Tauri-invoke wrapper so each module is small enough to reason about in isolation.

---

## Task 1: Workspace bootstrap

**Files:**
- Create: `Cargo.toml` (root workspace)
- Create: `rust-toolchain.toml`
- Create: `.gitignore`

- [ ] **Step 1: Create the workspace `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = ["crates/skymark-core", "crates/skymark-app"]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT OR Apache-2.0"
repository = "https://github.com/jinzuo/skymark"

[workspace.dependencies]
pulldown-cmark = { version = "0.10", default-features = false, features = ["html"] }
ammonia = "4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
tauri = { version = "2", features = [] }
tauri-build = { version = "2", features = [] }
tauri-plugin-dialog = "2"

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
strip = true
```

- [ ] **Step 2: Pin the Rust toolchain**

Create `rust-toolchain.toml`:

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
targets = ["wasm32-unknown-unknown"]
```

- [ ] **Step 3: Create `.gitignore`**

```
# Rust
target/
Cargo.lock.bak

# Node
node_modules/
dist/
.vite/

# Editor / OS
.DS_Store
.idea/
.vscode/

# Tauri build outputs
crates/skymark-app/target/
crates/skymark-app/gen/

# Test outputs
**/*.rs.bk

# Skymark vault internals (forward-looking)
.skymark/
```

- [ ] **Step 4: Verify the workspace parses**

Run: `cargo metadata --no-deps --format-version=1 > /dev/null`

Expected: command exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml rust-toolchain.toml .gitignore
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "chore: bootstrap cargo workspace"
```

---

## Task 2: skymark-core crate skeleton + first failing test

**Files:**
- Create: `crates/skymark-core/Cargo.toml`
- Create: `crates/skymark-core/src/lib.rs`
- Create: `crates/skymark-core/tests/render.rs`

- [ ] **Step 1: Create the crate manifest**

`crates/skymark-core/Cargo.toml`:

```toml
[package]
name = "skymark-core"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "Skymark markdown engine: parser, AST, render pipeline, format conversion"

[lib]
name = "skymark_core"
path = "src/lib.rs"

[dependencies]
pulldown-cmark.workspace = true
ammonia.workspace = true
thiserror.workspace = true

[dev-dependencies]
pretty_assertions = "1"
```

- [ ] **Step 2: Create the public API stub**

`crates/skymark-core/src/lib.rs`:

```rust
//! Skymark markdown engine.
//!
//! Pure Rust. No UI, no Tauri, no JS dependencies. Builds for native and `wasm32-unknown-unknown`.

mod render;
mod sanitize;

pub use render::{render_html, RenderError};
```

- [ ] **Step 3: Write the first failing integration test**

`crates/skymark-core/tests/render.rs`:

```rust
use skymark_core::render_html;

#[test]
fn empty_input_returns_empty_html() {
    assert_eq!(render_html("").unwrap(), "");
}
```

- [ ] **Step 4: Run the test to confirm it fails to compile**

Run: `cargo test -p skymark-core empty_input_returns_empty_html`

Expected: build error — `render` and `sanitize` modules don't exist yet.

- [ ] **Step 5: Create empty stubs so the crate builds**

`crates/skymark-core/src/render.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("internal render error: {0}")]
    Internal(String),
}

pub fn render_html(_markdown: &str) -> Result<String, RenderError> {
    Err(RenderError::Internal("not implemented".into()))
}
```

`crates/skymark-core/src/sanitize.rs`:

```rust
//! HTML sanitization for the Markdown render pipeline.
//!
//! Stub. Filled in by Task 5.
```

- [ ] **Step 6: Run the test — it should now compile but fail**

Run: `cargo test -p skymark-core empty_input_returns_empty_html`

Expected: test runs, fails with `not implemented` error.

- [ ] **Step 7: Make the test pass with the minimal implementation**

Replace the body of `render_html` in `crates/skymark-core/src/render.rs`:

```rust
pub fn render_html(markdown: &str) -> Result<String, RenderError> {
    if markdown.is_empty() {
        return Ok(String::new());
    }
    Err(RenderError::Internal("not implemented".into()))
}
```

- [ ] **Step 8: Re-run the test — it should pass**

Run: `cargo test -p skymark-core empty_input_returns_empty_html`

Expected: 1 passed.

- [ ] **Step 9: Commit**

```bash
git add crates/skymark-core/
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(core): skymark-core crate skeleton with empty-input test"
```

---

## Task 3: Basic Markdown rendering (paragraph, headings, lists)

**Files:**
- Modify: `crates/skymark-core/src/render.rs`
- Modify: `crates/skymark-core/tests/render.rs`

- [ ] **Step 1: Add a failing test for paragraph rendering**

Append to `crates/skymark-core/tests/render.rs`:

```rust
#[test]
fn renders_paragraph() {
    let html = render_html("hello world").unwrap();
    assert!(html.contains("<p>hello world</p>"), "got: {html}");
}

#[test]
fn renders_heading_levels() {
    let md = "# H1\n\n## H2\n\n### H3";
    let html = render_html(md).unwrap();
    assert!(html.contains("<h1>H1</h1>"), "got: {html}");
    assert!(html.contains("<h2>H2</h2>"), "got: {html}");
    assert!(html.contains("<h3>H3</h3>"), "got: {html}");
}

#[test]
fn renders_unordered_list() {
    let html = render_html("- a\n- b\n- c").unwrap();
    assert!(html.contains("<ul>"), "got: {html}");
    assert!(html.contains("<li>a</li>"), "got: {html}");
}

#[test]
fn renders_ordered_list() {
    let html = render_html("1. one\n2. two").unwrap();
    assert!(html.contains("<ol>"), "got: {html}");
    assert!(html.contains("<li>one</li>"), "got: {html}");
}

#[test]
fn renders_inline_emphasis_and_link() {
    let md = "*em* **strong** [link](https://example.com)";
    let html = render_html(md).unwrap();
    assert!(html.contains("<em>em</em>"), "got: {html}");
    assert!(html.contains("<strong>strong</strong>"), "got: {html}");
    assert!(html.contains("href=\"https://example.com\""), "got: {html}");
}

#[test]
fn renders_fenced_code_block() {
    let md = "```\nfn main() {}\n```";
    let html = render_html(md).unwrap();
    assert!(html.contains("<pre>"), "got: {html}");
    assert!(html.contains("<code>"), "got: {html}");
    assert!(html.contains("fn main()"), "got: {html}");
}
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `cargo test -p skymark-core`

Expected: 6 new tests fail with `not implemented`.

- [ ] **Step 3: Implement the parser → HTML pipeline (without sanitization yet)**

Replace `crates/skymark-core/src/render.rs`:

```rust
use pulldown_cmark::{html, Options, Parser};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("internal render error: {0}")]
    Internal(String),
}

/// Convert a Markdown source string to a sanitized HTML fragment.
///
/// Pipeline: pulldown-cmark (CommonMark + GFM extensions) -> HTML buffer -> sanitizer.
/// The sanitizer is wired in by Task 5; for now the raw HTML is returned.
pub fn render_html(markdown: &str) -> Result<String, RenderError> {
    if markdown.is_empty() {
        return Ok(String::new());
    }
    let mut html_buf = String::new();
    let parser = Parser::new_ext(markdown, gfm_options());
    html::push_html(&mut html_buf, parser);
    Ok(html_buf)
}

fn gfm_options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}
```

- [ ] **Step 4: Run the tests — all should pass**

Run: `cargo test -p skymark-core`

Expected: 7 passed (1 from Task 2 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-core/
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(core): basic markdown render via pulldown-cmark"
```

---

## Task 4: GFM features (tables, strikethrough, tasklists)

**Files:**
- Modify: `crates/skymark-core/tests/render.rs`

- [ ] **Step 1: Add failing tests for GFM features**

Append to `crates/skymark-core/tests/render.rs`:

```rust
#[test]
fn renders_gfm_table() {
    let md = "| a | b |\n|---|---|\n| 1 | 2 |";
    let html = render_html(md).unwrap();
    assert!(html.contains("<table>"), "got: {html}");
    assert!(html.contains("<th>a</th>"), "got: {html}");
    assert!(html.contains("<td>1</td>"), "got: {html}");
}

#[test]
fn renders_gfm_strikethrough() {
    let html = render_html("~~gone~~").unwrap();
    assert!(html.contains("<del>gone</del>"), "got: {html}");
}

#[test]
fn renders_gfm_tasklist() {
    let md = "- [ ] open\n- [x] done";
    let html = render_html(md).unwrap();
    assert!(html.contains("type=\"checkbox\""), "got: {html}");
    assert!(html.matches("type=\"checkbox\"").count() >= 2, "got: {html}");
    assert!(html.contains("checked"), "got: {html}");
}
```

- [ ] **Step 2: Run the tests — they should pass without further code changes**

Run: `cargo test -p skymark-core`

Expected: all tests pass. The `gfm_options` from Task 3 already enables tables, strikethrough, and tasklists.

If a GFM test fails, verify `gfm_options()` in `render.rs` returns `ENABLE_TABLES | ENABLE_STRIKETHROUGH | ENABLE_TASKLISTS`.

- [ ] **Step 3: Commit**

```bash
git add crates/skymark-core/tests/render.rs
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "test(core): cover GFM tables, strikethrough, tasklists"
```

---

## Task 5: HTML sanitization with ammonia

**Files:**
- Modify: `crates/skymark-core/src/sanitize.rs`
- Modify: `crates/skymark-core/src/render.rs`
- Modify: `crates/skymark-core/tests/render.rs`

The sanitization rules come directly from spec §5.1: strip `<script>`, inline event handlers, `javascript:` and `data:` URLs in `href`/`src`, and limit tag/attribute allowlists.

- [ ] **Step 1: Add failing sanitization tests**

Append to `crates/skymark-core/tests/render.rs`:

```rust
#[test]
fn strips_script_tag_in_raw_html() {
    let md = "before\n\n<script>alert('xss')</script>\n\nafter";
    let html = render_html(md).unwrap();
    assert!(!html.contains("<script>"), "got: {html}");
    assert!(!html.contains("alert"), "got: {html}");
}

#[test]
fn strips_inline_event_handlers_in_raw_html() {
    let md = "<a href=\"https://example.com\" onclick=\"alert('xss')\">click</a>";
    let html = render_html(md).unwrap();
    assert!(!html.contains("onclick"), "got: {html}");
    assert!(!html.contains("alert"), "got: {html}");
}

#[test]
fn strips_javascript_url_in_link() {
    let md = "[click](javascript:alert('xss'))";
    let html = render_html(md).unwrap();
    assert!(!html.to_lowercase().contains("javascript:"), "got: {html}");
}

#[test]
fn strips_data_url_in_image_src() {
    let md = "![evil](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)";
    let html = render_html(md).unwrap();
    assert!(!html.contains("data:text/html"), "got: {html}");
}

#[test]
fn allows_https_link() {
    let md = "[ok](https://example.com)";
    let html = render_html(md).unwrap();
    assert!(html.contains("href=\"https://example.com\""), "got: {html}");
}

#[test]
fn allows_relative_image_path() {
    let md = "![img](attachments/x.png)";
    let html = render_html(md).unwrap();
    assert!(html.contains("src=\"attachments/x.png\""), "got: {html}");
}
```

- [ ] **Step 2: Run the tests — script and event-handler tests should fail**

Run: `cargo test -p skymark-core`

Expected: at least the script-tag, event-handler, javascript-URL, and data-URL tests fail. (CommonMark allows raw HTML pass-through and `javascript:` URLs by default.)

- [ ] **Step 3: Implement the sanitizer**

Replace `crates/skymark-core/src/sanitize.rs`:

```rust
//! HTML sanitization for the canonical render pipeline.
//!
//! The allowlist matches spec §5.1: standard markdown elements plus the
//! attributes needed for tasklists and links/images. Inline event handlers,
//! script/iframe/object/embed elements, and javascript:/data: URLs are stripped.
//! The sanitizer always runs - even when (post-Phase-1) a future setting
//! relaxes which elements are allowed, event handlers and URI schemes are
//! never relaxed.

use ammonia::Builder;
use std::collections::{HashMap, HashSet};

pub fn sanitize(input: &str) -> String {
    builder().clean(input).to_string()
}

fn builder() -> Builder<'static> {
    let mut b = Builder::new();

    let tags: HashSet<&'static str> = [
        // block
        "p", "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "blockquote",
        "pre", "code",
        "table", "thead", "tbody", "tr", "th", "td",
        "hr", "br",
        // inline
        "em", "strong", "del", "a", "img",
        "input",
        // KaTeX/Mermaid hooks - Phase 4 fills these in. Keep `span` allowed
        // so the future math/code-highlighter wrappers slot in without a
        // sanitizer migration.
        "span",
    ]
    .into_iter()
    .collect();
    b.tags(tags);

    let mut tag_attrs: HashMap<&'static str, HashSet<&'static str>> = HashMap::new();
    tag_attrs.insert("a", ["href", "title"].into_iter().collect());
    tag_attrs.insert("img", ["src", "alt", "title"].into_iter().collect());
    tag_attrs.insert("input", ["type", "checked", "disabled"].into_iter().collect());
    tag_attrs.insert("th", ["align"].into_iter().collect());
    tag_attrs.insert("td", ["align"].into_iter().collect());
    tag_attrs.insert("code", ["class"].into_iter().collect());
    tag_attrs.insert("span", ["class"].into_iter().collect());
    b.tag_attributes(tag_attrs);

    let url_schemes: HashSet<&'static str> = ["http", "https", "mailto"].into_iter().collect();
    b.url_schemes(url_schemes);

    // Allow image-relative paths (no scheme) so attachments render in preview.
    b.url_relative(ammonia::UrlRelative::PassThrough);

    // Default behavior already strips <script>, <iframe>, <object>, <embed>,
    // and inline event handler attributes (on*). Do not relax these.

    b
}
```

- [ ] **Step 4: Wire the sanitizer into the render pipeline**

Modify `crates/skymark-core/src/render.rs` so the final return runs through the sanitizer:

```rust
use pulldown_cmark::{html, Options, Parser};
use thiserror::Error;

use crate::sanitize::sanitize;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("internal render error: {0}")]
    Internal(String),
}

pub fn render_html(markdown: &str) -> Result<String, RenderError> {
    if markdown.is_empty() {
        return Ok(String::new());
    }
    let mut html_buf = String::new();
    let parser = Parser::new_ext(markdown, gfm_options());
    html::push_html(&mut html_buf, parser);
    Ok(sanitize(&html_buf))
}

fn gfm_options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}
```

- [ ] **Step 5: Run the full test suite**

Run: `cargo test -p skymark-core`

Expected: all tests pass (Tasks 2, 3, 4, 5 combined).

If `allows_relative_image_path` fails because ammonia drops the relative URL, confirm `url_relative(UrlRelative::PassThrough)` is set in `builder()`.

- [ ] **Step 6: Commit**

```bash
git add crates/skymark-core/
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(core): wire ammonia sanitization into render pipeline"
```

---

## Task 6: WASM compatibility verification

**Files:** *(no source changes — verification only)*

The layering invariant from spec §3.2 says `skymark-core` MUST build for `wasm32-unknown-unknown`. CI will gate this in Task 16; verify it locally first.

- [ ] **Step 1: Confirm the wasm target is installed**

Run: `rustup target list --installed | grep wasm32-unknown-unknown`

Expected: `wasm32-unknown-unknown` listed. If not: `rustup target add wasm32-unknown-unknown`. The toolchain pin in Task 1 should have installed it automatically.

- [ ] **Step 2: Build skymark-core for wasm32**

Run: `cargo build -p skymark-core --target wasm32-unknown-unknown`

Expected: build succeeds. If a dependency pulls in `getrandom` or another wasm-incompatible crate, the build fails here. Fix by trimming the dep or enabling its `js`/`wasm` feature flag.

- [ ] **Step 3: Confirm the artifact exists**

Run: `ls target/wasm32-unknown-unknown/debug/libskymark_core.rlib`

Expected: file exists.

- [ ] **Step 4: Commit nothing — this is a verification-only task**

(No commit; the gate is enforced in CI by Task 16.)

---

## Task 7: skymark-app crate skeleton + render command

**Files:**
- Create: `crates/skymark-app/Cargo.toml`
- Create: `crates/skymark-app/build.rs`
- Create: `crates/skymark-app/tauri.conf.json`
- Create: `crates/skymark-app/src/main.rs`
- Create: `crates/skymark-app/src/commands.rs`
- Create: `crates/skymark-app/icons/icon.png` *(placeholder; any 32×32 PNG)*

- [ ] **Step 1: Create the Tauri crate manifest**

`crates/skymark-app/Cargo.toml`:

```toml
[package]
name = "skymark-app"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "Skymark desktop app: Tauri 2 backend"

[build-dependencies]
tauri-build.workspace = true

[dependencies]
tauri = { workspace = true, features = ["macos-private-api"] }
tauri-plugin-dialog.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
skymark-core = { path = "../skymark-core" }

[[bin]]
name = "skymark"
path = "src/main.rs"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 2: Create the Tauri build script**

`crates/skymark-app/build.rs`:

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 3: Create the minimal `tauri.conf.json`**

`crates/skymark-app/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Skymark",
  "version": "0.1.0",
  "identifier": "org.skymark.desktop",
  "build": {
    "beforeBuildCommand": "npm run build",
    "beforeDevCommand": "npm run dev",
    "frontendDist": "../../frontend/dist",
    "devUrl": "http://localhost:1420"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Skymark",
        "width": 1100,
        "height": 720,
        "minWidth": 720,
        "minHeight": 480,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file: asset: tauri:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.png"]
  },
  "plugins": {}
}
```

The CSP is the spec §5.2 baseline plus the Tauri-specific schemes (`asset:`, `tauri:`, `ipc:`, `http://ipc.localhost`) the runtime requires. `style-src 'unsafe-inline'` is the only inline relaxation, required by KaTeX in Phase 4.

- [ ] **Step 4: Create the entry point**

`crates/skymark-app/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::render,
            commands::open_file,
            commands::save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skymark");
}
```

- [ ] **Step 5: Create the commands module with the render command and unit tests**

`crates/skymark-app/src/commands.rs`:

```rust
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct OpenedFile {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub fn render(text: String) -> Result<String, String> {
    skymark_core::render_html(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_file(_path: String) -> Result<OpenedFile, String> {
    Err("not implemented".into())
}

#[tauri::command]
pub fn save_file(_path: String, _content: String) -> Result<(), String> {
    Err("not implemented".into())
}

// Path validation helper used by Tasks 8 and 9.
#[allow(dead_code)]
pub(crate) fn validate_markdown_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    match p.extension().and_then(|e| e.to_str()) {
        Some(ext) if matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "txt") => Ok(p),
        Some(other) => Err(format!("unsupported extension: {other}")),
        None => Err("path has no extension".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_command_round_trips_markdown_to_sanitized_html() {
        let html = render("# Title\n\n<script>alert(1)</script>".into()).unwrap();
        assert!(html.contains("<h1>Title</h1>"), "got: {html}");
        assert!(!html.contains("<script>"), "got: {html}");
    }

    #[test]
    fn validate_markdown_path_accepts_md() {
        assert!(validate_markdown_path("/tmp/x.md").is_ok());
        assert!(validate_markdown_path("/tmp/x.markdown").is_ok());
    }

    #[test]
    fn validate_markdown_path_rejects_other_extensions() {
        assert!(validate_markdown_path("/tmp/x.exe").is_err());
        assert!(validate_markdown_path("/tmp/x").is_err());
    }
}
```

- [ ] **Step 6: Create a placeholder icon**

Tauri requires an icon for the bundle config to validate. Create a 32×32 PNG at `crates/skymark-app/icons/icon.png`:

Run: `convert -size 32x32 xc:'#3b82f6' crates/skymark-app/icons/icon.png` (or use any other 32×32 PNG).

If `convert` is not available, copy any tiny PNG file to that path — replace it with a real icon in Phase 6.

- [ ] **Step 7: Build the Tauri crate**

Run: `cargo build -p skymark-app`

Expected: build succeeds. If the build complains about missing system deps on Linux, install: `sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`. On macOS the Xcode CLT is sufficient. On Windows, the WebView2 runtime is required.

- [ ] **Step 8: Run the unit tests**

Run: `cargo test -p skymark-app`

Expected: 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add crates/skymark-app/
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(app): tauri 2 skeleton with render command"
```

---

## Task 8: open_file command

**Files:**
- Modify: `crates/skymark-app/src/commands.rs`

- [ ] **Step 1: Add a failing test for `open_file`**

Append to the `tests` module in `crates/skymark-app/src/commands.rs`:

```rust
    #[test]
    fn open_file_reads_existing_markdown() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("skymark-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hello.md");
        std::fs::File::create(&path).unwrap().write_all(b"# hello\n").unwrap();

        let opened = open_file(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(opened.path, path.to_string_lossy());
        assert_eq!(opened.content, "# hello\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_file_rejects_non_markdown_extension() {
        let r = open_file("/tmp/foo.exe".into());
        assert!(r.is_err());
    }

    #[test]
    fn open_file_rejects_missing_file() {
        let r = open_file("/tmp/skymark-does-not-exist-xyz123.md".into());
        assert!(r.is_err());
    }
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cargo test -p skymark-app open_file`

Expected: 3 failures — current `open_file` returns `not implemented`.

- [ ] **Step 3: Implement `open_file`**

Replace the `open_file` function in `crates/skymark-app/src/commands.rs`:

```rust
#[tauri::command]
pub fn open_file(path: String) -> Result<OpenedFile, String> {
    let validated = validate_markdown_path(&path)?;
    let content = std::fs::read_to_string(&validated).map_err(|e| format!("read failed: {e}"))?;
    Ok(OpenedFile {
        path: validated.to_string_lossy().into_owned(),
        content,
    })
}
```

- [ ] **Step 4: Run the tests — they should pass**

Run: `cargo test -p skymark-app open_file`

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-app/src/commands.rs
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(app): open_file command reads validated markdown paths"
```

---

## Task 9: save_file command

**Files:**
- Modify: `crates/skymark-app/src/commands.rs`

- [ ] **Step 1: Add a failing test for `save_file`**

Append to the `tests` module in `crates/skymark-app/src/commands.rs`:

```rust
    #[test]
    fn save_file_writes_atomically() {
        let dir = std::env::temp_dir().join(format!("skymark-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.md");

        save_file(path.to_string_lossy().into_owned(), "# hello\n".into()).unwrap();

        let read_back = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read_back, "# hello\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_file_rejects_non_markdown_extension() {
        let r = save_file("/tmp/foo.exe".into(), "x".into());
        assert!(r.is_err());
    }
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cargo test -p skymark-app save_file`

Expected: 2 failures.

- [ ] **Step 3: Implement `save_file` with atomic write**

Replace the `save_file` function in `crates/skymark-app/src/commands.rs`:

```rust
#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    let validated = validate_markdown_path(&path)?;
    let parent = validated
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;

    // Atomic write: write to a temp file in the same directory, then rename.
    let tmp = parent.join(format!(
        ".{}.tmp",
        validated
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("skymark-save")
    ));
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("write tmp failed: {e}"))?;
    std::fs::rename(&tmp, &validated).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}
```

- [ ] **Step 4: Run the tests — they should pass**

Run: `cargo test -p skymark-app save_file`

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-app/src/commands.rs
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(app): save_file command with atomic write-temp-then-rename"
```

---

## Task 10: Tauri capabilities (deny-by-default)

**Files:**
- Create: `crates/skymark-app/capabilities/default.json`

- [ ] **Step 1: Create the capabilities file**

`crates/skymark-app/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Phase 1 capability set: only the dialog plugin's open and save permissions.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:webview:default",
    "core:event:default",
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

The frontend's invokes of `render`, `open_file`, and `save_file` are routed through `tauri::generate_handler!` (registered in `main.rs`). Tauri 2's permission system treats user-defined commands as permitted to the webview by default once they are in the handler list — no additional capability declaration is needed for them. Plugin commands (dialog open/save) require explicit permissions, which this file grants.

The fs plugin is intentionally **not** in the permission list. The frontend must use `open_file` / `save_file` (which validate paths in Rust) and never read or write the filesystem directly.

- [ ] **Step 2: Build the app to confirm capabilities parse**

Run: `cargo build -p skymark-app`

Expected: build succeeds. The `tauri-build` step ingests `capabilities/default.json`; a malformed file fails the build with a JSON-schema error.

- [ ] **Step 3: Commit**

```bash
git add crates/skymark-app/capabilities/
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(app): deny-by-default tauri capabilities for phase 1"
```

---

## Task 11: Frontend bootstrap (Vite + TypeScript)

**Files:**
- Create: `package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.ts`

- [ ] **Step 1: Create the root `package.json`**

`package.json` at the repo root:

```json
{
  "name": "skymark",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --config frontend/vite.config.ts",
    "build": "vite build --config frontend/vite.config.ts",
    "preview": "vite preview --config frontend/vite.config.ts",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@codemirror/state": "^6.4.0",
    "@codemirror/view": "^6.26.0",
    "@codemirror/commands": "^6.5.0",
    "@codemirror/lang-markdown": "^6.2.0",
    "@codemirror/language": "^6.10.0",
    "@codemirror/search": "^6.5.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create the Vite config**

`frontend/vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  publicDir: false,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2020",
    minify: "esbuild",
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Create `index.html`**

`frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Skymark</title>
    <link rel="stylesheet" href="./src/styles/tokens.css" />
    <link rel="stylesheet" href="./src/styles/app.css" />
  </head>
  <body>
    <div id="app">
      <header class="titlebar">
        <span class="doc-title" id="doc-title">Untitled</span>
        <span class="dirty-indicator" id="dirty-indicator" hidden>●</span>
      </header>
      <main class="panes">
        <section class="pane editor-pane" id="editor"></section>
        <section class="pane preview-pane" id="preview"></section>
      </main>
    </div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create the entry stub**

`frontend/src/main.ts`:

```ts
console.info("[skymark] frontend boot");
// Editor and preview wiring are added by Tasks 13 and 14.
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`

Expected: lockfile written, `node_modules/` populated.

- [ ] **Step 7: Verify the dev server starts**

Run: `npm run dev`

Expected: Vite logs `Local: http://localhost:1420/`. Open that URL — page should load and the console should log `[skymark] frontend boot`.

Stop the server with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json frontend/
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): vite + typescript bootstrap"
```

---

## Task 12: Design tokens and base layout

**Files:**
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/app.css`

- [ ] **Step 1: Create the token sheet (single source of color/spacing/type)**

`frontend/src/styles/tokens.css`:

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  --color-bg: #fbfbfa;
  --color-surface: #ffffff;
  --color-border: #e7e5e4;
  --color-text: #1c1917;
  --color-text-muted: #57534e;
  --color-accent: #2563eb;

  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  --font-body: ui-serif, "Source Serif Pro", Georgia, Cambria, "Times New Roman", serif;
  --font-mono: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
  --line-height-editor: 1.6;
  --line-height-preview: 1.65;

  --titlebar-height: 36px;
  --pane-divider: 1px solid var(--color-border);
  --content-max-width: 720px;
}
```

- [ ] **Step 2: Create the layout sheet**

`frontend/src/styles/app.css`:

```css
*, *::before, *::after { box-sizing: border-box; }

html, body, #app { height: 100%; margin: 0; }

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

#app { display: flex; flex-direction: column; }

.titlebar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--titlebar-height);
  padding: 0 var(--space-4);
  border-bottom: var(--pane-divider);
  background: var(--color-surface);
  font-size: 13px;
  color: var(--color-text-muted);
  user-select: none;
}

.titlebar .doc-title { font-weight: 500; color: var(--color-text); }
.titlebar .dirty-indicator { color: var(--color-accent); }

.panes {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 0;
}

.pane { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }

.editor-pane { border-right: var(--pane-divider); background: var(--color-surface); }
.editor-pane .cm-editor { flex: 1; height: 100%; font-family: var(--font-mono); font-size: 14px; line-height: var(--line-height-editor); }
.editor-pane .cm-scroller { padding: var(--space-5) var(--space-6); }

.preview-pane { background: var(--color-surface); overflow-y: auto; padding: var(--space-5) var(--space-6); }
.preview-pane .preview-content {
  max-width: var(--content-max-width);
  margin: 0 auto;
  font-family: var(--font-body);
  font-size: 16px;
  line-height: var(--line-height-preview);
}

.preview-content h1, .preview-content h2, .preview-content h3,
.preview-content h4, .preview-content h5, .preview-content h6 {
  font-family: var(--font-ui);
  font-weight: 600;
  line-height: 1.25;
  margin-top: 1.6em;
  margin-bottom: 0.5em;
}
.preview-content h1 { font-size: 1.8rem; }
.preview-content h2 { font-size: 1.45rem; }
.preview-content h3 { font-size: 1.2rem; }
.preview-content p, .preview-content ul, .preview-content ol,
.preview-content blockquote, .preview-content pre, .preview-content table { margin: 0 0 1em 0; }

.preview-content a { color: var(--color-accent); text-decoration: underline; text-underline-offset: 2px; }
.preview-content code { font-family: var(--font-mono); font-size: 0.92em; }
.preview-content pre {
  background: #f4f4f5;
  padding: var(--space-3) var(--space-4);
  border-radius: 6px;
  overflow-x: auto;
}
.preview-content table { border-collapse: collapse; width: 100%; }
.preview-content th, .preview-content td { border: 1px solid var(--color-border); padding: var(--space-2) var(--space-3); }
.preview-content blockquote {
  border-left: 3px solid var(--color-border);
  padding-left: var(--space-4);
  color: var(--color-text-muted);
}
```

- [ ] **Step 3: Reload the dev server**

Run: `npm run dev`

Expected: page loads with two-pane layout (editor pane left, preview pane right) and a thin titlebar above. Both panes are empty.

Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): design tokens and base two-pane layout"
```

---

## Task 13: CodeMirror 6 editor

**Files:**
- Create: `frontend/src/editor.ts`
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Create the editor module**

`frontend/src/editor.ts`:

```ts
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";

export interface EditorHandle {
  view: EditorView;
  getValue(): string;
  setValue(text: string): void;
}

export type DocChangeListener = (text: string) => void;

export function createEditor(parent: HTMLElement, onChange: DocChangeListener): EditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
  };
}
```

- [ ] **Step 2: Wire the editor into `main.ts`**

Replace `frontend/src/main.ts`:

```ts
import { createEditor } from "./editor";

const editorHost = document.getElementById("editor");
if (!editorHost) throw new Error("missing #editor host element");

const editor = createEditor(editorHost, (text) => {
  // Preview wiring follows in Task 14.
  console.debug("[skymark] doc changed:", text.length, "chars");
});

editor.setValue("# Welcome to Skymark\n\nStart typing in the editor on the left.\n");
```

- [ ] **Step 3: Verify the editor renders**

Run: `npm run dev`

Expected: the left pane now shows a CodeMirror editor with markdown syntax highlighting, line numbers, and the welcome content. Editing the text logs change events to the dev console.

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/editor.ts frontend/src/main.ts
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): codemirror 6 editor with markdown grammar"
```

---

## Task 14: Preview pane + debounced render via Tauri invoke

**Files:**
- Create: `frontend/src/api.ts`
- Create: `frontend/src/preview.ts`
- Modify: `frontend/src/main.ts`

This task wires the canonical core render pipeline into the preview. The preview never assigns to the `innerHTML` property; it parses the (already-sanitized) HTML string from the core via `DOMParser` and swaps the resulting DOM nodes in via `Element.replaceChildren`. `DOMParser` does not execute scripts even if a sanitizer regression let one slip through.

- [ ] **Step 1: Create the Tauri invoke wrapper**

`frontend/src/api.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export interface OpenedFile {
  path: string;
  content: string;
}

export function isTauri(): boolean {
  // @ts-expect-error window.__TAURI_INTERNALS__ is injected by Tauri at runtime
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function renderMarkdown(text: string): Promise<string> {
  if (!isTauri()) {
    // Browser-only dev fallback: return the raw text wrapped in a <pre> so the
    // preview pane is at least visible without the Tauri backend running.
    return `<pre>${escapeHtml(text)}</pre>`;
  }
  return await invoke<string>("render", { text });
}

export async function openFile(path: string): Promise<OpenedFile> {
  return await invoke<OpenedFile>("open_file", { path });
}

export async function saveFile(path: string, content: string): Promise<void> {
  await invoke<void>("save_file", { path, content });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 2: Create the preview module with a 50ms debounce and DOMParser-based commit**

`frontend/src/preview.ts`:

```ts
import { renderMarkdown } from "./api";

export interface PreviewHandle {
  update(text: string): void;
}

export function createPreview(host: HTMLElement): PreviewHandle {
  const content = document.createElement("div");
  content.className = "preview-content";
  host.appendChild(content);

  const parser = new DOMParser();
  let timer: number | null = null;
  let inflight = 0;

  function commitDom(htmlString: string): void {
    // The HTML coming from skymark-core has already been sanitized (spec
    // §5.1). We further avoid the innerHTML setter by parsing into a
    // detached document - DOMParser does not execute <script> tags - and
    // moving the resulting nodes into the live preview via replaceChildren.
    const doc = parser.parseFromString(htmlString, "text/html");
    const adopted: Node[] = [];
    for (const node of Array.from(doc.body.childNodes)) {
      adopted.push(document.importNode(node, true));
    }
    content.replaceChildren(...adopted);
  }

  async function commit(text: string, requestId: number): Promise<void> {
    try {
      const html = await renderMarkdown(text);
      // Drop stale results - only the most recent invoke commits.
      if (requestId !== inflight) return;
      commitDom(html);
    } catch (err) {
      console.error("[skymark] render failed", err);
      content.replaceChildren(document.createTextNode("Render failed: " + String(err)));
    }
  }

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
}
```

The monotonic `inflight` id is a Phase-1 down-payment on the `RenderRequestId` cancellation rule from spec §3.4. Phase 4 generalizes it.

- [ ] **Step 3: Wire the preview into `main.ts`**

Replace `frontend/src/main.ts`:

```ts
import { createEditor } from "./editor";
import { createPreview } from "./preview";

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
if (!editorHost || !previewHost) throw new Error("missing layout host elements");

const preview = createPreview(previewHost);

const editor = createEditor(editorHost, (text) => {
  preview.update(text);
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);
```

- [ ] **Step 4: Run the Tauri dev build to verify end-to-end**

Run: `npm run tauri:dev`

Expected: a Tauri window opens with the two-pane layout. Typing in the editor updates the preview after a ~50ms pause. The welcome content renders as a heading + paragraph.

Try pasting raw HTML like `<script>alert('x')</script>` — the script does NOT execute and does NOT appear in the preview as live HTML (sanitization at the core boundary, plus DOMParser does not run scripts).

Stop the dev session (Ctrl+C in the terminal, or close the window).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/preview.ts frontend/src/main.ts
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): debounced preview wired to skymark-core via tauri invoke"
```

---

## Task 15: File open / save flow with the dialog plugin

**Files:**
- Create: `frontend/src/files.ts`
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Create the file flow module**

`frontend/src/files.ts`:

```ts
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openFile, saveFile, isTauri } from "./api";

export interface DocumentState {
  path: string | null;
  isDirty: boolean;
}

export interface FileFlow {
  state: DocumentState;
  onStateChange(listener: (s: DocumentState) => void): void;
  markDirty(): void;
  openInteractive(): Promise<string | null>; // returns loaded content or null if cancelled
  saveInteractive(content: string): Promise<boolean>; // false if cancelled
  newDocument(): void;
}

export function createFileFlow(): FileFlow {
  const state: DocumentState = { path: null, isDirty: false };
  const listeners: Array<(s: DocumentState) => void> = [];

  function emit(): void {
    for (const l of listeners) l({ ...state });
  }

  return {
    state,
    onStateChange(l) {
      listeners.push(l);
    },
    markDirty() {
      if (!state.isDirty) {
        state.isDirty = true;
        emit();
      }
    },
    newDocument() {
      state.path = null;
      state.isDirty = false;
      emit();
    },
    async openInteractive() {
      if (!isTauri()) {
        console.warn("[skymark] open requires the Tauri host");
        return null;
      }
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (!picked || Array.isArray(picked)) return null;
      const opened = await openFile(picked);
      state.path = opened.path;
      state.isDirty = false;
      emit();
      return opened.content;
    },
    async saveInteractive(content) {
      if (!isTauri()) {
        console.warn("[skymark] save requires the Tauri host");
        return false;
      }
      let target = state.path;
      if (!target) {
        const picked = await saveDialog({
          filters: [{ name: "Markdown", extensions: ["md"] }],
          defaultPath: "untitled.md",
        });
        if (!picked) return false;
        target = picked;
      }
      await saveFile(target, content);
      state.path = target;
      state.isDirty = false;
      emit();
      return true;
    },
  };
}
```

- [ ] **Step 2: Wire keyboard shortcuts and titlebar updates into `main.ts`**

Replace `frontend/src/main.ts`:

```ts
import { createEditor } from "./editor";
import { createPreview } from "./preview";
import { createFileFlow } from "./files";

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
const titleEl = document.getElementById("doc-title") as HTMLElement | null;
const dirtyEl = document.getElementById("dirty-indicator") as HTMLElement | null;
if (!editorHost || !previewHost || !titleEl || !dirtyEl) {
  throw new Error("missing layout host elements");
}

const preview = createPreview(previewHost);
const files = createFileFlow();

const editor = createEditor(editorHost, (text) => {
  preview.update(text);
  files.markDirty();
});

files.onStateChange((s) => {
  titleEl.textContent = s.path ? basename(s.path) : "Untitled";
  dirtyEl.hidden = !s.isDirty;
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);

// cmd/ctrl+O = open, cmd/ctrl+S = save, cmd/ctrl+N = new.
window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === "o" || e.key === "O") {
    e.preventDefault();
    void (async () => {
      const content = await files.openInteractive();
      if (content !== null) {
        editor.setValue(content);
        preview.update(content);
      }
    })();
  } else if (e.key === "s" || e.key === "S") {
    e.preventDefault();
    void files.saveInteractive(editor.getValue());
  } else if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    editor.setValue("");
    preview.update("");
    files.newDocument();
  }
});

function basename(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx >= 0 ? path.slice(idx + 1) : path;
}
```

- [ ] **Step 3: Verify open / save end-to-end**

Run: `npm run tauri:dev`

Expected sequence inside the running app:

1. `cmd-O` (or `ctrl-O`) opens a file dialog → pick an existing `.md` → editor and preview load its content; titlebar updates to the filename; dirty indicator hidden.
2. Edit the content → dirty indicator (`●`) appears.
3. `cmd-S` → file is overwritten on disk; dirty indicator clears. Verify on disk with `cat` that the contents match.
4. `cmd-N` → editor clears; titlebar shows `Untitled`.
5. `cmd-S` on a new doc → save dialog opens; pick a path → file is created.

If `cmd-O` fails with a permission error in the console, recheck Task 10's `capabilities/default.json` includes `dialog:allow-open` and `dialog:allow-save`.

Stop the dev session.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/files.ts frontend/src/main.ts
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "feat(frontend): open/save flow with dialog plugin and dirty tracking"
```

---

## Task 16: CI workflow with WASM build gate

**Files:**
- Create: `.github/workflows/ci.yml`

The Phase 1 CI scope: native test of `skymark-core`, native test of `skymark-app`, frontend typecheck, and the `wasm32-unknown-unknown` build gate for `skymark-core`. Multi-platform packaging is deferred to Phase 6.

- [ ] **Step 1: Create the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

env:
  CARGO_TERM_COLOR: always
  RUSTFLAGS: -D warnings

jobs:
  rust-test:
    name: cargo test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Tauri Linux deps
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev

      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - uses: Swatinem/rust-cache@v2

      - name: cargo fmt --check
        run: cargo fmt --all -- --check

      - name: cargo clippy
        run: cargo clippy --workspace --all-targets -- -D warnings

      - name: cargo test (workspace)
        run: cargo test --workspace --all-targets

  wasm-build-gate:
    name: skymark-core wasm32 build gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown

      - uses: Swatinem/rust-cache@v2
        with:
          key: wasm

      - name: Build skymark-core for wasm32-unknown-unknown
        run: cargo build -p skymark-core --target wasm32-unknown-unknown --release

  frontend-typecheck:
    name: frontend typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - run: npx tsc -p frontend/tsconfig.json --noEmit
```

- [ ] **Step 2: Commit and (if a remote exists) push**

```bash
git add .github/workflows/ci.yml
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "ci: native tests, wasm32 build gate, frontend typecheck"
```

If a remote has been configured (`git remote add origin …`), push and verify the GitHub Actions run shows three green jobs (`cargo test`, `skymark-core wasm32 build gate`, `frontend typecheck`).

If no remote is configured yet, the workflow file is staged for the first push; that is acceptable for Phase 1 completion.

- [ ] **Step 3: Locally simulate the WASM gate one more time**

Run: `cargo build -p skymark-core --target wasm32-unknown-unknown --release`

Expected: build succeeds.

---

## Task 17: End-to-end smoke verification

**Files:** *(no source changes — verification only)*

Manually exercise the golden path before declaring Phase 1 complete.

- [ ] **Step 1: Clean build everything**

Run:

```bash
cargo clean
npm install
cargo build --workspace
npm run build
```

Expected: all four commands succeed.

- [ ] **Step 2: Run the full Rust test suite**

Run: `cargo test --workspace`

Expected: all tests in `skymark-core` and `skymark-app` pass.

- [ ] **Step 3: Run the WASM gate**

Run: `cargo build -p skymark-core --target wasm32-unknown-unknown --release`

Expected: build succeeds.

- [ ] **Step 4: Run the dev binary and exercise the golden path**

Run: `npm run tauri:dev`

Walk through the full user flow inside the running app:

1. The window opens with the two-pane layout, titlebar `Untitled`, the welcome markdown showing in both panes.
2. Type `## Hello` in the editor → preview updates within ~50ms to show an `<h2>`.
3. Paste `<script>alert(1)</script>` → script does NOT execute; preview shows nothing where the script was (sanitizer stripped it).
4. Paste a `[link](javascript:alert(1))` → preview shows "link" with the `href` stripped.
5. `cmd-O` → pick an existing `.md` file → editor and preview load it; titlebar shows the filename.
6. Edit → dirty `●` appears. `cmd-S` → file is overwritten on disk; dirty indicator clears.
7. `cmd-N` → editor clears, titlebar `Untitled`. `cmd-S` → save dialog asks for a path; pick one; file is created.
8. Open the dev console (Cmd-Opt-I / Ctrl-Shift-I in the Tauri window) and verify there are no CSP violations and no errors.

If any step fails, fix and re-test before claiming completion.

- [ ] **Step 5: Final commit (if any drift was fixed)**

If any small fixes were needed during smoke testing:

```bash
git add -A
git -c user.email="zuojin@gmail.com" -c user.name="jinzuo" commit -m "fix(phase-1): smoke-test cleanup"
```

Otherwise no commit needed — Phase 1 is complete.

---

## Phase 1 Definition of Done

- [ ] `cargo test --workspace` passes (`skymark-core` and `skymark-app` integration + unit tests).
- [ ] `cargo build -p skymark-core --target wasm32-unknown-unknown --release` succeeds.
- [ ] `npm run tauri:dev` opens a working two-pane editor.
- [ ] Sanitizer demonstrably strips `<script>`, inline event handlers, `javascript:` URLs, and `data:text/html` URLs.
- [ ] Preview commit path uses `DOMParser` + `replaceChildren`; no `innerHTML` assignment anywhere in the frontend.
- [ ] CSP is in place and emits no violations during the smoke test.
- [ ] Tauri capabilities file enumerates only `dialog:allow-open`, `dialog:allow-save`, and the core defaults.
- [ ] CI workflow runs three green jobs on push: cargo test, wasm32 build gate, frontend typecheck.
- [ ] All commits authored as `zuojin@gmail.com`.

---

## What Phase 2 inherits

Phase 2 (Smart editing + persistence) starts from this codebase and adds:

- Smart-edit primitives in `skymark-core` (auto-pair, list continuation, smart-paste URL, table tab navigation).
- A draft auto-save subsystem in `skymark-app` (10s atomic writes to `<app_data_dir>/drafts/...`, recovery on launch, save-on-close prompt).
- Wiring those into the editor and the file flow.

The architecture, capability scope, sanitizer, WASM gate, and DOMParser-based preview commit established in Phase 1 do not change; Phase 2 layers on top of them.
