# Lazy-Loaded Directory Vault

## Problem

The vault currently scans recursively (up to 20 levels deep), returning a flat list of files. This causes two problems:

1. Users cannot see the folder structure — the tree view only groups by top-level directories.
2. Opening large directories is slow and returns too many files at once.

## Goals

- Show the vault as a navigable directory tree, not a flat file list.
- Scan only 2 levels deep by default.
- Lazy-load deeper directories when the user clicks a folder.
- Let users adjust the scan depth via a settings control in the titlebar.

## Non-Goals

- Full recursive pre-scan of the entire vault.
- Per-folder depth settings (one global setting).
- Search or filter within the tree.

## Architecture

### Backend

#### New type: `VaultNode`

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
enum VaultNode {
    Dir {
        abs_path: String,
        name: String,
        children: Vec<VaultNode>,
    },
    File {
        abs_path: String,
        name: String,
    },
}
```

Single enum with a JSON tag discriminator. Dir nodes carry recursive children; File nodes are leaf entries.

#### `scan_vault` — tree root

New signature:

```rust
#[tauri::command]
pub fn scan_vault(path: String) -> Result<Vec<VaultNode>, String>
```

- Validates the path is absolute and exists as a directory.
- Calls `scan_dir_to_tree(&path, 5000, 2)`.
- Returns the top-level tree nodes.

#### `scan_subdir` — lazy load

New Tauri command:

```rust
#[tauri::command]
pub fn scan_subdir(path: String, max_depth: usize) -> Result<Vec<VaultNode>, String>
```

- Validates the path is absolute and exists as a directory.
- Calls `scan_dir_to_tree(&path, 5000, max_depth)`.
- Returns tree nodes rooted at the given directory.

#### `scan_dir_to_tree` — shared logic

New helper in `vault.rs`:

```rust
fn scan_dir_to_tree(
    root: &Path,
    dir: &Path,
    max_files: usize,
    max_depth: usize,
    depth: usize,
) -> Result<Vec<VaultNode>, String>
```

- If `depth > max_depth`, returns `Ok([])` (prune).
- Lists directory entries via `Storage::list`.
- Skips hidden entries (names starting with `.`).
- For directories: recurses (depth + 1), collects children, wraps in `VaultNode::Dir`.
- For files: checks `.md/.markdown/.txt` extension, adds `VaultNode::File`.
- Counts files and returns error if `max_files` exceeded.
- Files and directories are sorted case-insensitively by name.

#### `scan_dir` — kept for tests

The existing `scan_dir` helper (which returns `Vec<VaultFile>`) is kept for the test suite. The tests for `scan_vault` are migrated to use `scan_dir_to_tree`.

### Frontend

#### `vault.ts` — tree handle

```typescript
export interface VaultNode {
    type: "dir" | "file";
    abs_path: string;
    name: string;
    children?: VaultNode[];
}

export interface VaultHandle {
    readonly root: string | null;
    readonly tree: VaultNode[];
    open(): Promise<boolean>;
    openFromPath(path: string): Promise<boolean>;
}
```

`files: VaultFile[]` replaced by `tree: VaultNode[]`. `open()` and `openFromPath()` call `scan_vault` and store the result.

#### `tree.ts` — recursive renderer

```typescript
export interface TreeHandle {
    render(nodes: VaultNode[], activeAbsPath: string | null): void;
    setActive(absPath: string): void;
    onLazyLoad(callback: (absPath: string) => void): void;
}
```

- Recursive render: `Dir` nodes get a toggle (`▶`/`▼`) and child list; `File` nodes get a click handler.
- Collapsed state tracked per `abs_path` (Set of strings).
- Directories at depth 2 trigger the lazy-load callback.
- `onLazyLoad` registers a callback that `main.ts` wires to the `scan_subdir` Tauri call.
- After a lazy-load completes, the parent directory's children are replaced with the new nodes and the tree re-renders.

#### `main.ts` — wiring

- `createVaultHandle()` → tree handle receives `VaultNode[]`.
- `tree.onLazyLoad` → invokes `invoke("scan_subdir", { path, maxDepth })`, then calls `tree.render()` with the updated tree.
- Settings depth read from `localStorage` at init (`skymark:maxDepth`, default `"2"`).
- On depth change: re-scan vault from root and re-render tree.

#### Settings UI

**HTML** — new button in `index.html`:

```html
<button id="settings-btn" class="settings-btn" aria-label="Settings">⚙</button>
<div id="settings-dropdown" class="settings-dropdown" hidden>
    <label>
        Scan depth
        <input type="number" id="settings-depth" min="1" max="10" value="2" />
    </label>
</div>
```

**Event wiring** (in `main.ts`):
- Click on `#settings-btn` toggles dropdown visibility.
- Click outside dropdown closes it.
- Number input change: updates `localStorage`, re-scans vault, re-renders tree.

#### CSS additions

```css
.settings-btn {
    @extend .theme-toggle-btn; /* same size, hover effect */
}

.settings-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    font-size: 14px;
}

.settings-dropdown input[type="number"] {
    width: 50px;
    margin-left: 8px;
}
```

### Data Flow

```
User opens vault
  → scan_vault() → VaultNode[] (2 levels)
  → tree.render() → recursive DOM tree

User clicks level-2 folder
  → tree.onLazyLoad(path)
  → scan_subdir(path, maxDepth) → VaultNode[]
  → parent dir children updated
  → tree.render() → re-renders that subtree

User changes scan depth
  → localStorage update
  → scan_vault() → new VaultNode[]
  → tree.render() → full re-render
```

### Error Handling

- `scan_vault` and `scan_subdir` share the same error messages: vault too large, path not found, permission denied.
- Lazy-load errors show a toast notification; the directory remains expandable for retry.
- Invalid depth values (outside 1–10) are clamped, not rejected.

### Testing

- `scan_dir_to_tree` tests: basic tree, hidden entries skipped, depth limit, file limit, extension filtering, sorted output, nested directory children.
- Tree render tests (frontend): correct DOM structure for Dir and File nodes, collapse/expand toggles, lazy-load callback fires for level-2 dirs.
- Settings UI tests: dropdown toggle, depth persistence in localStorage, re-scan on change.
