# Phase 7: Release Packaging & Auto-Update — Design Spec

**Date:** 2026-05-10
**Scope:** Multi-platform CI release pipeline (macOS universal, Linux, Windows) via GitHub Actions + GitHub Releases, and in-app auto-update via `tauri-plugin-updater`.

---

## Goals

- Push a `v*` git tag → GitHub Actions builds native installers for all three platforms, publishes a GitHub Release with artifacts and a signed update manifest.
- Running app checks for updates on launch (3-second delay) and on demand via a "Check for Updates" button; shows a banner when an update is available; user clicks "Install & Restart" to apply.
- No OS-level code signing (unsigned distribution — users bypass Gatekeeper/SmartScreen manually); Tauri's own keypair provides update bundle integrity.

---

## Out of Scope

- Apple notarization / Windows EV signing
- Mac App Store / Windows Store / Flathub distribution
- Delta/differential updates
- Staged rollouts or canary channels
- Automatic version bumping tooling (version bump is a manual 3-file edit + tag)

---

## Architecture

Three sequential pieces:

1. **Icon set** — generate the full Tauri icon set from the existing `icon.png` using `npm run tauri -- icon`. Committed to the repo. One-time task, done before the first tagged release.
2. **Release CI** — `.github/workflows/release.yml` triggered on `v*` tags. Uses `tauri-apps/tauri-action@v0` on a 3-platform matrix (macOS universal, Ubuntu, Windows). Handles release creation, artifact upload, and `latest.json` manifest generation automatically.
3. **Auto-update** — `tauri-plugin-updater` on the Rust side; `@tauri-apps/plugin-updater` npm package on the frontend; `update.ts` logic module; `update-banner.ts` UI component; "Check for Updates" button in the titlebar.

---

## Components

### `.github/workflows/release.yml`

Triggered on `push: tags: ['v*']`. Single job with a 3-platform matrix:

```yaml
name: Release
on:
  push:
    tags: ['v*']
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

`tauri-action` handles: creating the GitHub Release draft, running `tauri build`, uploading platform artifacts, and merging the per-platform `latest.json` shards into one combined manifest. The release stays draft until all three matrix jobs complete and upload; mark it as published manually (or add a finalize job).

### Icon set

Run once from the workspace root before the first tagged release:

```bash
npm run tauri -- icon crates/skymark-app/icons/icon.png
```

Generates the full icon set in `crates/skymark-app/icons/`: `icon.icns` (macOS), `icon.ico` (Windows), and multiple PNG sizes. Commit the result.

### Updater keypair (one-time setup)

```bash
npm run tauri -- signer generate -w ~/.tauri/skymark.key
```

- Prints the public key to stdout — copy it into `tauri.conf.json` `plugins.updater.pubkey`
- Store `TAURI_SIGNING_PRIVATE_KEY` (base64 of the private key file) as a GitHub Actions secret
- Store `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (password used during generation, may be empty) as a secret

### `crates/skymark-app/tauri.conf.json`

Add to the `plugins` object:

```json
"plugins": {
  "updater": {
    "pubkey": "<paste-public-key-here>",
    "endpoints": [
      "https://github.com/jinzuo/skymark/releases/latest/download/latest.json"
    ]
  }
}
```

### `Cargo.toml` (workspace `[workspace.dependencies]`)

Add:
```toml
tauri-plugin-updater = "2"
```

### `crates/skymark-app/Cargo.toml`

Add to `[dependencies]`:
```toml
tauri-plugin-updater.workspace = true
```

### `crates/skymark-app/capabilities/default.json`

Add `"updater:default"` to the permissions array:
```json
"permissions": [
  "core:default",
  "core:window:default",
  "core:webview:default",
  "core:event:default",
  "dialog:allow-open",
  "dialog:allow-save",
  "updater:default"
]
```

### `crates/skymark-app/src/main.rs`

Add the updater plugin to the builder chain (after `tauri_plugin_dialog::init()`):

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

### `package.json`

Add to `dependencies`:
```json
"@tauri-apps/plugin-updater": "^2.0.0"
```

### `frontend/src/update.ts`

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

Note: `@tauri-apps/plugin-process` provides `relaunch()`. Add `"@tauri-apps/plugin-process": "^2.0.0"` to `package.json` and add `tauri-plugin-process` to Cargo deps + capabilities + main.rs.

### `frontend/src/update-banner.ts`

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

### `frontend/index.html`

Add `<div id="update-banner-root"></div>` between the `<header>` and `<div id="tab-bar">`:

```html
      </header>
      <div id="update-banner-root"></div>
      <div id="tab-bar" hidden></div>
```

Add `<button id="update-check-btn">` to the titlebar, after `#export-dropdown-root`:

```html
        <div id="export-dropdown-root"></div>
        <button id="update-check-btn" class="update-check-btn" aria-label="Check for updates" hidden>↑</button>
      </header>
```

The button starts `hidden`; it becomes visible (with a badge dot) when an update is found.

### `frontend/src/styles/app.css`

```css
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

### `frontend/src/main.ts`

- Query `#update-banner-root` and `#update-check-btn`; add both to null-guard
- After app init, create the update banner: `const updateBanner = createUpdateBanner(updateBannerRoot)`
- Register callback: `onUpdateAvailable(({ version }) => { updateBanner.show(version); updateCheckBtn.hidden = false; updateCheckBtn.classList.add("has-update"); })`
- Launch check (3-second delay after startup): `window.setTimeout(() => { void checkForUpdate(); }, 3000)`
- "Check for Updates" button handler: on click, call `checkForUpdate()`; if returns `null`, show toast `"You're up to date"`.

---

## Data Flow

**Release:**
1. Developer bumps `version` in `Cargo.toml` (workspace), `tauri.conf.json`, `package.json` to e.g. `0.2.0`
2. Commits: `git commit -m "chore: bump version to 0.2.0"`
3. Tags: `git tag v0.2.0 && git push origin v0.2.0`
4. GitHub Actions triggers; three parallel runners each build the native installer, sign the update bundle, upload artifacts + `latest.json` shard to the draft GitHub Release
5. Developer manually publishes the draft release

**Auto-update (on launch):**
1. 3 seconds after startup: `checkForUpdate()` fetches `latest.json` from GitHub Releases endpoint
2. If `update.version > current`: `onUpdateAvailable` callbacks fire → banner shows, `#update-check-btn` gets badge
3. User clicks "Install & Restart" → `downloadAndInstall()` runs (progress visible via disabled button state) → `relaunch()` restarts the app with the new binary

**Manual check:**
1. User clicks `#update-check-btn`
2. `checkForUpdate()` called again
3. If no update: `showToast("You're up to date")`
4. If update found: same banner flow as above

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Update check network failure | Silent fail on launch; button click shows toast "You're up to date" (same as no-update path — no distinction exposed to user) |
| Download failure mid-way | Toast "Update failed: {error}"; Install button re-enabled |
| Signature verification failure | Tauri rejects bundle; toast "Update failed: signature invalid" |
| Missing `latest.json` on GitHub (partial release) | Treated as no update (404 = up to date) |
| CI matrix job fails on one platform | That platform's artifacts absent from release; others still publish |

---

## Testing

- **CI smoke test:** on every PR, the existing `ci.yml` test jobs still run; release workflow only triggers on `v*` tags
- **Updater keypair round-trip:** verified automatically by `tauri-action` — if `TAURI_SIGNING_PRIVATE_KEY` is wrong, the build fails
- **Manual release test:** push `v0.2.0` tag; verify GitHub Release appears with 6 artifacts (2 per platform: installer + AppImage/MSI variants) plus `latest.json`
- **Manual update test:** install from `v0.1.0` release build; push `v0.2.0` tag; wait for release; launch app; verify banner appears after 3s; click Install & Restart; verify new version
- **"Check for Updates" toast:** on latest version, click button; verify "You're up to date" toast

---

## File Map

| Action | Path |
|--------|------|
| Create | `.github/workflows/release.yml` |
| Regenerate | `crates/skymark-app/icons/` (full icon set) |
| Modify | `crates/skymark-app/tauri.conf.json` |
| Modify | `Cargo.toml` (add `tauri-plugin-updater`, `tauri-plugin-process`) |
| Modify | `crates/skymark-app/Cargo.toml` |
| Modify | `crates/skymark-app/capabilities/default.json` |
| Modify | `crates/skymark-app/src/main.rs` |
| Modify | `package.json` |
| Create | `frontend/src/update.ts` |
| Create | `frontend/src/update-banner.ts` |
| Modify | `frontend/src/styles/app.css` |
| Modify | `frontend/index.html` |
| Modify | `frontend/src/main.ts` |

---

## Prerequisites Before First Release

1. Generate and commit the full icon set (one-time)
2. Generate the updater keypair (one-time): `npm run tauri -- signer generate -w ~/.tauri/skymark.key`
3. Add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to GitHub repository secrets
4. Paste the public key into `tauri.conf.json`
