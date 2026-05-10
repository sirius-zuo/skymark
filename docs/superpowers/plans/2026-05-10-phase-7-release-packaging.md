# Phase 7: Release Packaging & Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up a multi-platform GitHub Actions release pipeline and an in-app auto-update UI so that pushing a `v*` tag produces native installers for macOS/Linux/Windows and running users get an update banner.

**Architecture:** `tauri-apps/tauri-action@v0` handles the CI release matrix (3 platforms) and `latest.json` manifest merging automatically. On the Rust side, `tauri-plugin-updater` and `tauri-plugin-process` are registered; on the frontend, `update.ts` wraps the plugin calls and `update-banner.ts` renders a dismissible banner. The startup check fires 3 seconds after launch; a "Check for Updates" button in the titlebar covers the on-demand path.

**Tech Stack:** Tauri 2, `tauri-plugin-updater@2`, `tauri-plugin-process@2`, `@tauri-apps/plugin-updater@^2`, `@tauri-apps/plugin-process@^2`, GitHub Actions `tauri-apps/tauri-action@v0`, TypeScript, Vite

---

## Prerequisites (one-time manual steps — do these BEFORE starting Task 1)

These steps generate secrets that must exist before the code changes work. They are not automated.

**Step A — Generate the updater keypair:**
```bash
npm run tauri -- signer generate -w ~/.tauri/skymark.key
```
The command prints the **public key** to stdout (a long base64 string). **Copy it now** — you need it in Task 4.

It also writes `~/.tauri/skymark.key` (private key file). Run:
```bash
base64 < ~/.tauri/skymark.key
```
Copy the output — this is the value for the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret.

**Step B — Add GitHub repository secrets:**
Go to `https://github.com/jinzuo/skymark/settings/secrets/actions` and add:
- `TAURI_SIGNING_PRIVATE_KEY` — the base64 of `~/.tauri/skymark.key` from Step A
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you used during keygen (empty string if you pressed Enter)

These secrets are consumed by `.github/workflows/release.yml` in Task 13.

---

## Task 1: Generate and commit the full icon set

**Files:**
- Modify: `crates/skymark-app/icons/` (currently contains only `icon.png`; this task generates the full set)
- Modify: `crates/skymark-app/tauri.conf.json` (update `bundle.icon` to reference generated icon files)

- [ ] **Step 1: Verify source icon exists**

Run:
```bash
ls -la crates/skymark-app/icons/icon.png
```
Expected: file exists. If missing, the icon needs to be created first (1024×1024 PNG).

- [ ] **Step 2: Generate the full icon set**

Run from the workspace root:
```bash
npm run tauri -- icon crates/skymark-app/icons/icon.png
```
Expected output: lines like `"Generated icons/..."` and no errors. This creates `icon.icns`, `icon.ico`, and multiple `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png` files inside `crates/skymark-app/icons/`.

- [ ] **Step 3: Verify generated files**

```bash
ls crates/skymark-app/icons/
```
Expected: you see at minimum `icon.icns`, `icon.ico`, and several `.png` files alongside the original `icon.png`.

- [ ] **Step 4: Update bundle.icon in tauri.conf.json**

Current `bundle.icon` in `crates/skymark-app/tauri.conf.json` (line 31):
```json
"icon": ["icons/icon.png"]
```
Replace with:
```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

- [ ] **Step 5: Verify the app still builds**

```bash
npm run build
```
Expected: Vite build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add crates/skymark-app/icons/ crates/skymark-app/tauri.conf.json
git commit -m "chore: generate full tauri icon set"
```

---

## Task 2: Add Rust dependencies

**Files:**
- Modify: `Cargo.toml` (workspace `[workspace.dependencies]`)
- Modify: `crates/skymark-app/Cargo.toml` (`[dependencies]`)

- [ ] **Step 1: Add to workspace dependencies**

In `Cargo.toml`, the `[workspace.dependencies]` section currently ends with:
```toml
notify-debouncer-mini = "0.4"
```
Append two lines after it:
```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

Full `[workspace.dependencies]` section after edit:
```toml
[workspace.dependencies]
pulldown-cmark = { version = "0.13", default-features = false, features = ["html"] }
ammonia = "4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
tauri = { version = "2", features = [] }
tauri-build = { version = "2", features = [] }
tauri-plugin-dialog = "2"
notify-debouncer-mini = "0.4"
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Add to app crate dependencies**

In `crates/skymark-app/Cargo.toml`, the `[dependencies]` section currently ends with:
```toml
notify-debouncer-mini.workspace = true
```
Append two lines:
```toml
tauri-plugin-updater.workspace = true
tauri-plugin-process.workspace = true
```

Full `[dependencies]` section after edit:
```toml
[dependencies]
tauri = { workspace = true, features = [] }
tauri-plugin-dialog.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
skymark-core = { path = "../skymark-core" }
notify-debouncer-mini.workspace = true
tauri-plugin-updater.workspace = true
tauri-plugin-process.workspace = true
```

- [ ] **Step 3: Verify cargo can resolve the new crates**

```bash
cargo fetch
```
Expected: downloads `tauri-plugin-updater` and `tauri-plugin-process` with no errors.

- [ ] **Step 4: Commit**

```bash
git add Cargo.toml crates/skymark-app/Cargo.toml Cargo.lock
git commit -m "chore: add tauri-plugin-updater and tauri-plugin-process deps"
```

---

## Task 3: Add npm packages

**Files:**
- Modify: `package.json` (`dependencies`)

- [ ] **Step 1: Add the two packages**

In `package.json`, the `dependencies` object currently ends with:
```json
"mermaid": "^11.14.0"
```
Add two more entries (keeping alphabetical order is optional; just keep valid JSON):
```json
"@tauri-apps/plugin-process": "^2.0.0",
"@tauri-apps/plugin-updater": "^2.0.0",
```

Full `dependencies` object after edit:
```json
"dependencies": {
  "@codemirror/autocomplete": "^6.18.0",
  "@codemirror/commands": "^6.5.0",
  "@codemirror/lang-markdown": "^6.2.0",
  "@codemirror/language": "^6.10.0",
  "@codemirror/search": "^6.5.0",
  "@codemirror/state": "^6.4.0",
  "@codemirror/view": "^6.26.0",
  "@tauri-apps/api": "^2.0.0",
  "@tauri-apps/plugin-dialog": "^2.0.0",
  "@tauri-apps/plugin-process": "^2.0.0",
  "@tauri-apps/plugin-updater": "^2.0.0",
  "highlight.js": "^11.11.1",
  "katex": "^0.16.45",
  "mermaid": "^11.14.0"
}
```

- [ ] **Step 2: Install packages**

```bash
npm install
```
Expected: `package-lock.json` updated; no errors. The two new packages appear under `node_modules/@tauri-apps/`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @tauri-apps/plugin-updater and plugin-process npm packages"
```

---

## Task 4: Configure tauri.conf.json updater plugin

**Files:**
- Modify: `crates/skymark-app/tauri.conf.json`

**Prerequisite:** You must have the public key from the Prerequisites section (Step A). It looks like a long base64 string beginning with `dW50...` or similar.

- [ ] **Step 1: Replace the empty plugins object**

Current `crates/skymark-app/tauri.conf.json` line 34:
```json
"plugins": {}
```
Replace with (substitute `<YOUR-PUBLIC-KEY-HERE>` with the actual key from Prerequisites Step A):
```json
"plugins": {
  "updater": {
    "pubkey": "<YOUR-PUBLIC-KEY-HERE>",
    "endpoints": [
      "https://github.com/jinzuo/skymark/releases/latest/download/latest.json"
    ]
  }
}
```

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('crates/skymark-app/tauri.conf.json','utf8')); console.log('valid')"
```
Expected: prints `valid`.

- [ ] **Step 3: Commit**

```bash
git add crates/skymark-app/tauri.conf.json
git commit -m "chore: configure tauri updater plugin with pubkey and endpoint"
```

---

## Task 5: Update capabilities and register Rust plugins

**Files:**
- Modify: `crates/skymark-app/capabilities/default.json`
- Modify: `crates/skymark-app/src/main.rs`

- [ ] **Step 1: Add updater and process permissions to capabilities**

Current `crates/skymark-app/capabilities/default.json` `permissions` array:
```json
"permissions": [
  "core:default",
  "core:window:default",
  "core:webview:default",
  "core:event:default",
  "dialog:allow-open",
  "dialog:allow-save"
]
```
Replace with:
```json
"permissions": [
  "core:default",
  "core:window:default",
  "core:webview:default",
  "core:event:default",
  "dialog:allow-open",
  "dialog:allow-save",
  "updater:default",
  "process:default"
]
```

- [ ] **Step 2: Register plugins in main.rs**

Current `crates/skymark-app/src/main.rs` builder chain (lines 11–12):
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
```
Add two more `.plugin()` calls immediately after the dialog plugin:
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo check -p skymark-app
```
Expected: no errors. (This confirms the plugin crates are found and the API calls are correct.)

- [ ] **Step 4: Run existing tests**

```bash
cargo test -p skymark-app
```
Expected: all tests pass (the existing `export_file` tests in `commands.rs`).

- [ ] **Step 5: Commit**

```bash
git add crates/skymark-app/capabilities/default.json crates/skymark-app/src/main.rs
git commit -m "feat: register tauri-plugin-updater and tauri-plugin-process"
```

---

## Task 6: Create frontend/src/update.ts

**Files:**
- Create: `frontend/src/update.ts`

This module wraps `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process`. It exposes three functions: `onUpdateAvailable` (register a callback), `checkForUpdate` (fetch latest.json and fire callbacks if newer), and `installUpdate` (download, install, relaunch).

- [ ] **Step 1: Create the file**

Create `frontend/src/update.ts` with this exact content:

```ts
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

type UpdateCallback = (info: UpdateInfo) => void;
const callbacks: UpdateCallback[] = [];
let pending: Update | null = null;

export function onUpdateAvailable(cb: UpdateCallback): void {
  callbacks.push(cb);
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update) return null;
    pending = update;
    const info: UpdateInfo = { version: update.version, body: update.body ?? null };
    callbacks.forEach((cb) => cb(info));
    return info;
  } catch {
    return null;
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending) throw new Error("no update pending");
  await pending.downloadAndInstall();
  await relaunch();
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npm run build
```
Expected: Vite build completes with no TypeScript errors. (The new module is not yet imported anywhere, so it will be tree-shaken out — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/update.ts
git commit -m "feat: add update.ts — checkForUpdate, installUpdate, onUpdateAvailable"
```

---

## Task 7: Create frontend/src/update-banner.ts

**Files:**
- Create: `frontend/src/update-banner.ts`

A pure DOM module that creates a dismissible banner with "Install & Restart" button. Depends on `installUpdate` from `update.ts` and `showToast` from `toast.ts`.

- [ ] **Step 1: Create the file**

Create `frontend/src/update-banner.ts` with this exact content:

```ts
import { installUpdate } from "./update";
import { showToast } from "./toast";

export interface UpdateBannerHandle {
  show(version: string): void;
  hide(): void;
}

export function createUpdateBanner(host: HTMLElement): UpdateBannerHandle {
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.hidden = true;

  const msg = document.createElement("span");
  msg.className = "update-banner-msg";

  const installBtn = document.createElement("button");
  installBtn.className = "update-install-btn";
  installBtn.textContent = "Install & Restart";
  installBtn.addEventListener("click", () => {
    installBtn.disabled = true;
    installBtn.textContent = "Installing…";
    void installUpdate().catch((err) => {
      showToast(`Update failed: ${String(err)}`);
      installBtn.disabled = false;
      installBtn.textContent = "Install & Restart";
    });
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "update-dismiss-btn";
  dismissBtn.setAttribute("aria-label", "Dismiss");
  dismissBtn.textContent = "✕";
  dismissBtn.addEventListener("click", () => { banner.hidden = true; });

  banner.appendChild(msg);
  banner.appendChild(installBtn);
  banner.appendChild(dismissBtn);
  host.appendChild(banner);

  return {
    show(version: string): void {
      msg.textContent = `Skymark ${version} is available.`;
      banner.hidden = false;
    },
    hide(): void { banner.hidden = true; },
  };
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/update-banner.ts
git commit -m "feat: add update-banner.ts — dismissible update notification UI"
```

---

## Task 8: Add update CSS to app.css

**Files:**
- Modify: `frontend/src/styles/app.css` (append at end, after the `.tree-badge-broken` block which ends at line 374)

- [ ] **Step 1: Append CSS**

Add to the end of `frontend/src/styles/app.css`:

```css

/* ---- Update banner --------------------------------------------------------- */

.update-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  background: var(--color-accent);
  color: #fff;
  font-size: 0.85em;
}
.update-banner-msg { flex: 1; }
.update-install-btn {
  background: #fff;
  color: var(--color-accent);
  border: none;
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
  font-size: inherit;
}
.update-install-btn:disabled { opacity: 0.6; cursor: default; }
.update-dismiss-btn {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}
.update-check-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 0 var(--space-1);
  color: var(--color-text-muted);
  position: relative;
}
.update-check-btn:hover { color: var(--color-text); }
.update-check-btn.has-update::after {
  content: '';
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles/app.css
git commit -m "feat: add update banner and update-check-btn CSS"
```

---

## Task 9: Update index.html

**Files:**
- Modify: `frontend/index.html`

Two changes: add `#update-banner-root` between `</header>` and `<div id="tab-bar">`, and add `#update-check-btn` inside the titlebar after `#export-dropdown-root`.

- [ ] **Step 1: Add the update-banner-root div**

Current `frontend/index.html` lines 19–20:
```html
      </header>
      <div id="tab-bar" hidden></div>
```
Replace with:
```html
      </header>
      <div id="update-banner-root"></div>
      <div id="tab-bar" hidden></div>
```

- [ ] **Step 2: Add the update-check-btn button**

Current `frontend/index.html` lines 17–19 (inside titlebar):
```html
        <button id="theme-toggle" class="theme-toggle-btn" aria-label="Toggle theme">&#x1F319;</button>
        <div id="export-dropdown-root"></div>
      </header>
```
Replace with:
```html
        <button id="theme-toggle" class="theme-toggle-btn" aria-label="Toggle theme">&#x1F319;</button>
        <div id="export-dropdown-root"></div>
        <button id="update-check-btn" class="update-check-btn" aria-label="Check for updates" hidden>&#x2191;</button>
      </header>
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html
git commit -m "feat: add update-banner-root and update-check-btn to HTML"
```

---

## Task 10: Wire main.ts

**Files:**
- Modify: `frontend/src/main.ts`

Four changes:
1. Add imports for `update.ts` and `update-banner.ts`
2. Query `#update-banner-root` and `#update-check-btn`, add to null guard
3. Create banner and register callback after `exportDropdown` setup
4. Launch startup check (3-second delay) and wire button handler

- [ ] **Step 1: Add imports**

Current `frontend/src/main.ts` line 15 (last import line):
```ts
import { createExportDropdown } from "./export-dropdown";
```
Add two imports after it:
```ts
import { createExportDropdown } from "./export-dropdown";
import { checkForUpdate, onUpdateAvailable } from "./update";
import { createUpdateBanner } from "./update-banner";
```

- [ ] **Step 2: Query the two new elements**

Current `frontend/src/main.ts` line 31 (last element query):
```ts
const exportDropdownRootEl = document.getElementById("export-dropdown-root") as HTMLElement | null;
```
Add two more queries after it:
```ts
const exportDropdownRootEl = document.getElementById("export-dropdown-root") as HTMLElement | null;
const updateBannerRootEl = document.getElementById("update-banner-root") as HTMLElement | null;
const updateCheckBtnEl = document.getElementById("update-check-btn") as HTMLButtonElement | null;
```

- [ ] **Step 3: Add to the null guard**

Current null guard (lines 33–38):
```ts
if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl ||
    !vaultPrefixEl || !dirtyEl || !panesEl || !tabBarEl || !reloadBannerEl ||
    !reloadConfirmEl || !reloadDismissEl || !sidebarResizerEl || !themeToggleEl ||
    !exportDropdownRootEl) {
  throw new Error("missing layout host elements");
}
```
Replace with:
```ts
if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl ||
    !vaultPrefixEl || !dirtyEl || !panesEl || !tabBarEl || !reloadBannerEl ||
    !reloadConfirmEl || !reloadDismissEl || !sidebarResizerEl || !themeToggleEl ||
    !exportDropdownRootEl || !updateBannerRootEl || !updateCheckBtnEl) {
  throw new Error("missing layout host elements");
}
```

- [ ] **Step 4: Alias the new elements**

Current aliases block ends at (line 52):
```ts
const exportDropdownRoot = exportDropdownRootEl;
```
Add two more aliases after it:
```ts
const exportDropdownRoot = exportDropdownRootEl;
const updateBannerRoot = updateBannerRootEl;
const updateCheckBtn = updateCheckBtnEl;
```

- [ ] **Step 5: Create banner, register callback, startup check, and button handler**

Current `frontend/src/main.ts` lines 79–80:
```ts
const exportDropdown = createExportDropdown(preview.getContentEl(), () => title.textContent ?? "Untitled");
exportDropdownRoot.appendChild(exportDropdown.el);
```
Add immediately after these two lines:
```ts
const updateBanner = createUpdateBanner(updateBannerRoot);
onUpdateAvailable(({ version }) => {
  updateBanner.show(version);
  updateCheckBtn.hidden = false;
  updateCheckBtn.classList.add("has-update");
});
window.setTimeout(() => { void checkForUpdate(); }, 3000);
updateCheckBtn.addEventListener("click", () => {
  void checkForUpdate().then((info) => {
    if (!info) showToast("You're up to date");
  });
});
```

- [ ] **Step 6: Verify TypeScript compilation**

```bash
npm run build
```
Expected: no TypeScript errors, Vite build succeeds.

- [ ] **Step 7: Verify in dev mode**

```bash
npm run tauri:dev
```
Expected: app launches normally. Open DevTools console — no errors. The `#update-check-btn` (↑) is hidden in the titlebar. After 3 seconds, `checkForUpdate()` fires silently (returns null in dev — no server running). Clicking the ↑ button (if you make it temporarily visible via DevTools) shows the toast "You're up to date".

To visually test the banner: In browser DevTools console, run:
```js
// manually trigger banner for visual verification
document.getElementById("update-banner-root").querySelector(".update-banner").hidden = false;
document.getElementById("update-banner-root").querySelector(".update-banner-msg").textContent = "Skymark 0.2.0 is available.";
```
Expected: accent-colored banner appears below the titlebar with "Skymark 0.2.0 is available.", "Install & Restart" button, and "✕" dismiss button.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat: wire update banner, startup check, and manual check button in main.ts"
```

---

## Task 11: Create .github/workflows/release.yml

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Verify the .github/workflows directory exists**

```bash
ls .github/workflows/
```
Expected: shows `ci.yml`. The directory already exists.

- [ ] **Step 2: Create the release workflow**

Create `.github/workflows/release.yml` with this exact content:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: --target universal-apple-darwin
          - platform: ubuntu-22.04
            args: ''
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      - name: Install Linux system dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev

      - run: npm ci

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: Skymark ${{ github.ref_name }}
          releaseBody: See the assets below to download and install this version.
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

- [ ] **Step 3: Verify YAML is syntactically valid**

```bash
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
try {
  yaml.load(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
  console.log('valid');
} catch(e) {
  console.error(e.message);
  process.exit(1);
}
" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('valid')"
```
Expected: prints `valid`. (Uses `js-yaml` if available, falls back to Python.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add multi-platform release workflow with tauri-action"
```

---

## Task 12: Version bump and manual release test

**Files:**
- Modify: `Cargo.toml` (`[workspace.package] version`)
- Modify: `crates/skymark-app/tauri.conf.json` (`"version"`)
- Modify: `package.json` (`"version"`)

This task verifies the end-to-end release pipeline. Do this only after Tasks 1–11 are complete and merged to main.

- [ ] **Step 1: Bump version in all three places**

`Cargo.toml` line 6 — change `0.1.0` to `0.2.0`:
```toml
version = "0.2.0"
```

`crates/skymark-app/tauri.conf.json` line 3 — change `0.1.0` to `0.2.0`:
```json
"version": "0.2.0",
```

`package.json` line 3 — change `0.1.0` to `0.2.0`:
```json
"version": "0.2.0",
```

- [ ] **Step 2: Verify all three match**

```bash
grep '"version"' package.json crates/skymark-app/tauri.conf.json && grep '^version' Cargo.toml
```
Expected: all three show `0.2.0`.

- [ ] **Step 3: Commit the version bump**

```bash
git add Cargo.toml crates/skymark-app/tauri.conf.json package.json
git commit -m "chore: bump version to 0.2.0"
```

- [ ] **Step 4: Tag and push**

```bash
git tag v0.2.0
git push origin main
git push origin v0.2.0
```
Expected: the push of `v0.2.0` triggers the release workflow on GitHub Actions.

- [ ] **Step 5: Verify the GitHub Actions run**

Go to `https://github.com/jinzuo/skymark/actions` and watch the Release workflow. All three platform jobs should build successfully (~10–15 min for macOS universal). When complete, a draft release appears at `https://github.com/jinzuo/skymark/releases` with:
- `Skymark_0.2.0_aarch64-apple-darwin.dmg` (or `.app.tar.gz`)
- `Skymark_0.2.0_x86_64_en-US.msi` (Windows)
- `skymark_0.2.0_amd64.AppImage` (Linux)
- `latest.json` — the combined update manifest

If any job fails, check the Actions log for the error.

- [ ] **Step 6: Publish the draft release**

On the GitHub Releases page, open the draft and click "Publish release". This makes `latest.json` publicly accessible at the configured endpoint.

- [ ] **Step 7: End-to-end update test (optional but recommended)**

If you have a `v0.1.0` build installed:
1. Install from `v0.1.0` release artifacts
2. Publish `v0.2.0` release (Step 6)
3. Launch the `v0.1.0` app
4. After 3 seconds, the update banner should appear: "Skymark 0.2.0 is available."
5. Click "Install & Restart" — app downloads and restarts at 0.2.0
6. With latest version running, click ↑ button — toast shows "You're up to date"

---

## Self-Review Checklist

- [x] **Spec coverage:** All spec sections have corresponding tasks — icon set (T1), CI (T11), updater keypair (Prerequisites), tauri.conf.json (T4), Cargo (T2), npm (T3), capabilities (T5), main.rs (T5), update.ts (T6), update-banner.ts (T7), CSS (T8), index.html (T9), main.ts (T10), version bump procedure (T12).
- [x] **No placeholders:** All code blocks are complete. `<YOUR-PUBLIC-KEY-HERE>` in Task 4 is intentional — it cannot be automated.
- [x] **Type consistency:** `UpdateInfo`, `UpdateBannerHandle`, `UpdateCallback` defined in T6 and consumed in T7/T10 consistently. `checkForUpdate()` returns `Promise<UpdateInfo | null>` in T6 and T10 both use `.then((info) => { if (!info) ... })`.
- [x] **Ordering:** Prerequisites → icon (T1) → Cargo (T2) → npm (T3) → tauri.conf.json (T4) → capabilities+main.rs (T5) → frontend modules (T6–T10) → CI (T11) → release test (T12). Each task can be independently committed.
