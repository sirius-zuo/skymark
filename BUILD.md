# Building Skymark

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust (via rustup) | stable ≥ 1.78 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 20 LTS | https://nodejs.org or `brew install node` |
| npm | bundled with Node | — |

**macOS only:** Xcode Command Line Tools are required for the native build.
```
xcode-select --install
```

**Linux only:** Install WebKit2 and GTK dependencies.
```
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows only:** The [WebView2 runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) must be installed (it ships with Windows 11 and recent Windows 10 builds).

### macOS: rustup vs Homebrew Rust

If you have both Homebrew Rust and rustup installed, the wasm32 build target requires the **rustup-managed** toolchain. Prefix your PATH before running any wasm32 commands:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

Or run Cargo via its absolute path: `~/.cargo/bin/cargo`.

---

## Development build

Install frontend dependencies once:
```bash
npm install
```

Start the dev server (hot-reloads on file changes):
```bash
npm run tauri:dev
```

This launches the Vite dev server on `http://localhost:1420` and opens the Tauri window. The Rust backend rebuilds automatically when you change `crates/`.

---

## Release build

```bash
npm run tauri:build
```

Produces a native installer in `crates/skymark-app/target/release/bundle/`. Format depends on the platform:

| Platform | Output |
|----------|--------|
| macOS | `.dmg` + `.app` |
| Linux | `.deb` + `.AppImage` |
| Windows | `.msi` + `.exe` (NSIS) |

---

## Running tests

**Rust tests (all crates):**
```bash
cargo test --workspace
```

**WASM build gate** (verifies `skymark-core` compiles for the browser target):
```bash
cargo build -p skymark-core --target wasm32-unknown-unknown --release
```
The wasm32 target must be installed: `rustup target add wasm32-unknown-unknown`.

**Frontend typecheck:**
```bash
npx tsc -p frontend/tsconfig.json --noEmit
```

---

## Project layout

```
skymark/
├── Cargo.toml                  workspace root
├── package.json                npm scripts + frontend deps
├── frontend/                   Vite + TypeScript UI
│   ├── index.html
│   └── src/
│       ├── main.ts             app entry point
│       ├── editor.ts           CodeMirror 6 setup
│       ├── preview.ts          debounced HTML preview
│       ├── api.ts              Tauri invoke wrappers
│       ├── files.ts            open/save dialog flow
│       └── styles/             CSS tokens + layout
└── crates/
    ├── skymark-core/           pure Rust library (markdown → sanitized HTML)
    │   └── src/
    │       ├── render.rs       pulldown-cmark pipeline
    │       └── sanitize.rs     ammonia allowlist config
    └── skymark-app/            Tauri 2 backend
        └── src/
            ├── main.rs         Tauri entry point
            └── commands.rs     render / open_file / save_file
```

---

## CI

Three jobs run on every push to `main` and on pull requests (`.github/workflows/ci.yml`):

1. **cargo test** — `cargo fmt`, `cargo clippy`, `cargo test --workspace` on Ubuntu
2. **wasm32 build gate** — `cargo build -p skymark-core --target wasm32-unknown-unknown`
3. **frontend typecheck** — `npm ci` + `tsc --noEmit`
