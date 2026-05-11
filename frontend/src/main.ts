import { createEditor } from "./editor";
import { createSyncExtension } from "./sync";
import { createPreview } from "./preview";
import { createFileFlow } from "./files";
import { createDraftHandle } from "./draft";
import { showToast } from "./toast";
import { isTauri, openFile } from "./api";
import { createVaultHandle, VaultNode, VaultFile } from "./vault";
import { createTree } from "./tree";
import { createPalette } from "./palette";
import { createTabHandle } from "./tabs";
import { createHeadingIndex, HeadingEntry } from "./headings";
import { createLinkChecker } from "./links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openSearchPanel } from "@codemirror/search";
import { initTheme, toggleTheme, onThemeChange } from "./theme";
import { createExportDropdown } from "./export-dropdown";
import { checkForUpdate, onUpdateAvailable } from "./update";
import { createUpdateBanner } from "./update-banner";
import { createToolbar } from "./toolbar";

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
const sidebarEl = document.getElementById("sidebar") as HTMLElement | null;
const paletteOverlayEl = document.getElementById("palette-overlay") as HTMLElement | null;
const titleEl = document.getElementById("doc-title") as HTMLElement | null;
const vaultPrefixEl = document.getElementById("vault-prefix") as HTMLElement | null;
const dirtyEl = document.getElementById("dirty-indicator") as HTMLElement | null;
const panesEl = document.querySelector(".panes") as HTMLElement | null;
const tabBarEl = document.getElementById("tab-bar") as HTMLElement | null;
const reloadBannerEl = document.getElementById("reload-banner") as HTMLElement | null;
const reloadConfirmEl = document.getElementById("reload-confirm") as HTMLElement | null;
const reloadDismissEl = document.getElementById("reload-dismiss") as HTMLElement | null;
const sidebarResizerEl = document.getElementById("sidebar-resizer") as HTMLElement | null;
const themeToggleEl = document.getElementById("theme-toggle") as HTMLButtonElement | null;
const settingsBtnEl = document.getElementById("settings-btn") as HTMLButtonElement | null;
const settingsDropdownEl = document.getElementById("settings-dropdown") as HTMLElement | null;
const settingsDepthEl = document.getElementById("settings-depth") as HTMLInputElement | null;
const exportDropdownRootEl = document.getElementById("export-dropdown-root") as HTMLElement | null;
const updateBannerRootEl = document.getElementById("update-banner-root") as HTMLElement | null;
const updateCheckBtnEl = document.getElementById("update-check-btn") as HTMLButtonElement | null;

if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl ||
    !vaultPrefixEl || !dirtyEl || !panesEl || !tabBarEl || !reloadBannerEl ||
    !reloadConfirmEl || !reloadDismissEl || !sidebarResizerEl || !themeToggleEl ||
    !settingsBtnEl || !settingsDropdownEl || !settingsDepthEl ||
    !exportDropdownRootEl || !updateBannerRootEl || !updateCheckBtnEl) {
  throw new Error("missing layout host elements");
}

const sidebar = sidebarEl;
const paletteOverlay = paletteOverlayEl;
const title = titleEl;
const vaultPrefix = vaultPrefixEl;
const dirty = dirtyEl;
const panes = panesEl;
const tabBar = tabBarEl;
const reloadBanner = reloadBannerEl;
const reloadConfirm = reloadConfirmEl;
const reloadDismiss = reloadDismissEl;
const sidebarResizer = sidebarResizerEl;
const themeToggle = themeToggleEl;
const settingsBtn = settingsBtnEl;
const settingsDropdown = settingsDropdownEl;
const settingsDepth = settingsDepthEl;
const exportDropdownRoot = exportDropdownRootEl;
const updateBannerRoot = updateBannerRootEl;
const updateCheckBtn = updateCheckBtnEl;

initTheme();
themeToggle.addEventListener("click", toggleTheme);

// Settings UI handlers
let settingsOpen = false;

function closeSettings(): void {
  settingsDropdown.hidden = true;
  settingsOpen = false;
}

settingsBtn.addEventListener("click", () => {
  settingsOpen = !settingsOpen;
  settingsDropdown.hidden = !settingsOpen;
  if (settingsOpen) {
    // Read current depth from localStorage
    const saved = localStorage.getItem("skymark:maxDepth");
    if (saved) {
      settingsDepth.value = saved;
    }
  }
});

// Close settings when clicking outside
document.addEventListener("click", (e) => {
  if (settingsOpen && !settingsDropdown.contains(e.target as Node) && !settingsBtn.contains(e.target as Node)) {
    closeSettings();
  }
});

// Depth change handler
settingsDepth.addEventListener("change", () => {
  let val = parseInt(settingsDepth.value, 10);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 10) val = 10;
  settingsDepth.value = String(val);
  localStorage.setItem("skymark:maxDepth", String(val));
  // Re-scan vault if open
  if (vault.root) {
    void (async () => {
      const result = await invoke<VaultNode[]>("scan_vault", { path: vault.root });
      vault.tree = result;
      tree.render(vault.tree, currentActive);
    })();
  }
  closeSettings();
});

const preview = createPreview(previewHost);
const syncExt = createSyncExtension(preview);
const files = createFileFlow();
const drafts = createDraftHandle();
const vault = createVaultHandle();
const headings = createHeadingIndex();
const links = createLinkChecker();
const tabs = createTabHandle((idx) => { void handleCloseTab(idx); });
let currentActive: string | null = null;

const tree = createTree(sidebar, (node) => { void openVaultFile(node); }, () => links.getBrokenFiles());

// Lazy-load callback: when user double-clicks a depth-2 directory
tree.onLazyLoad(async (absPath: string) => {
  const maxDepth = parseInt(settingsDepth?.value ?? "2", 10) || 2;
  try {
    const nodes = await invoke<VaultNode[]>("scan_subdir", { path: absPath, maxDepth });
    // Find the parent directory and update its children
    function updateChildren(parents: VaultNode[]): boolean {
      for (const parent of parents) {
        if (parent.type === "dir" && parent.abs_path === absPath) {
          if (parent.children) {
            parent.children.length = 0;
            for (const child of nodes) {
              parent.children.push(child);
            }
          } else {
            parent.children = nodes;
          }
          return true;
        }
        if (parent.type === "dir" && parent.children && updateChildren(parent.children)) {
          return true;
        }
      }
      return false;
    }
    updateChildren(vault.tree);
    tree.render(vault.tree, currentActive);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(`Failed to load directory: ${msg}`);
  }
});

const palette = createPalette(paletteOverlay);

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

onThemeChange(() => { preview.update(editor.getValue()); });

const toolbarEl = document.getElementById("format-toolbar");
if (toolbarEl) {
  createToolbar(toolbarEl, editor.view);
} else {
  console.error("format-toolbar element not found");
}

const exportDropdown = createExportDropdown(preview.getContentEl(), () => title.textContent ?? "Untitled");
exportDropdownRoot.appendChild(exportDropdown.el);
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

files.onStateChange((s) => {
  updateTitlebar(s.path);
  dirty.hidden = !s.isDirty;
});

files.onAfterSave((_path) => {
  drafts.onExplicitSave(_path);
  tabs.updateActive({ isDirty: false });
  rebindTabBar();
  if (tabs.active && vault.root) {
    links.update(tabs.active.absPath, editor.getValue(), vault.tree as unknown as VaultFile[]);
    tree.setActive(tabs.active.absPath);
  }
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);
files.clearDirty();

// ---- File action helpers ----------------------------------------------------

async function openFileInteractive(): Promise<void> {
  const content = await files.openInteractive();
  if (content === null) return;
  const newPath = files.state.path!;

  // Determine if the file lives outside the current vault (or no vault is open).
  const sep = newPath.includes("/") ? "/" : "\\";
  const parentDir = newPath.slice(0, newPath.lastIndexOf(sep)) || newPath;
  const inVault = vault.root != null &&
    (newPath.startsWith(vault.root + "/") || newPath.startsWith(vault.root + "\\"));

  if (!inVault) {
    // Open the file's parent directory as the new vault.
    if (isTauri()) void invoke("clear_all");
    const prevPaths = tabs.entries.map(e => e.absPath);
    tabs.clearAll();
    for (const p of prevPaths) headings.remove(p);
    links.clear();

    const ok = await vault.openFromPath(parentDir);
    if (ok) {
      sidebar.hidden = false;
      sidebarResizer.hidden = false;
      tabBar.hidden = false;
      panes.classList.add("vault-mode");
      localStorage.setItem('skymark:vault-root', parentDir);
      const savedWidth = localStorage.getItem('skymark:sidebar-width');
      if (savedWidth) panes.style.gridTemplateColumns = `${savedWidth}px 4px 1fr 1fr`;
      tree.render(vault.tree, null);
    }
  }

  if (vault.root) {
    // Switch to the tab if already open, otherwise add a new one.
    const existing = tabs.entries.findIndex(e => e.absPath === newPath);
    if (existing !== -1) { switchTab(existing); return; }

    if (tabs.active) {
      tabs.updateActive({
        content: editor.getValue(),
        cursorPos: editor.view.state.selection.main.anchor,
        scrollTop: editor.view.scrollDOM.scrollTop,
      });
    }
    tabs.addTab(newPath, content);
    editor.setValue(content);
    files.clearDirty();
    tabs.updateActive({ isDirty: false });
    preview.update(content);
    updateTitlebar(newPath);
    reloadBanner.hidden = true;
    const vf = vault.tree.find(n => n.type === "file" && n.abs_path === newPath) as VaultNode | undefined;
    if (vf && vf.type === "file") {
      const relPath = vf.abs_path.slice(vault.root!.length + 1);
      headings.index(vf.abs_path, relPath, vf.name, content);
      links.update(vf.abs_path, content, vault.tree as unknown as VaultFile[]);
    }
    tabs.persist();
    rebindTabBar();
    tree.setActive(newPath);
    // Add this file to the watcher
    if (isTauri()) {
      void invoke("add_watch", { path: newPath });
    }
  } else {
    editor.setValue(content);
    preview.update(content);
    files.clearDirty();
  }
}

function startNewDocument(): void {
  if (vault.root) {
    // In vault mode: open a new untitled tab (or switch to existing one).
    const existingNew = tabs.entries.findIndex(e => e.absPath === "");
    if (existingNew !== -1) { switchTab(existingNew); return; }

    if (tabs.active) {
      tabs.updateActive({
        content: editor.getValue(),
        cursorPos: editor.view.state.selection.main.anchor,
        scrollTop: editor.view.scrollDOM.scrollTop,
      });
    }
    tabs.addTab("", "");
    editor.setValue("");
    files.newDocument();
    files.clearDirty();
    tabs.updateActive({ isDirty: false });
    preview.update("");
    updateTitlebar(null);
    reloadBanner.hidden = true;
    rebindTabBar();
  } else {
    editor.setValue("");
    preview.update("");
    files.newDocument();
  }
}

// ---- Keyboard shortcuts ----------------------------------------------------

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  if (e.key === "o" || e.key === "O") {
    if (e.shiftKey) {
      e.preventDefault();
      void openVault();
    } else {
      e.preventDefault();
      void openFileInteractive();
    }
  } else if (e.key === "s" || e.key === "S") {
    e.preventDefault();
    void files.saveInteractive(editor.getValue());
  } else if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    startNewDocument();
  } else if (e.key === "w" || e.key === "W") {
    if (tabs.active) { e.preventDefault(); void handleCloseTab(tabs.activeIdx); }
  } else if ((e.key === "p" || e.key === "P") && vault.root) {
    e.preventDefault();
    palette.show(
      vault.tree as unknown as VaultFile[],
      (file: VaultFile) => { void openVaultFile(file as unknown as VaultNode); },
      headings.getAll(),
      (h) => { void openHeading(h); },
    );
  } else if (e.key === "\\" || e.key === "|") {
    if (vault.root) { e.preventDefault(); toggleSidebar(); }
  }
});

// ---- Tab helpers -----------------------------------------------------------

function rebindTabBar(): void {
  tabs.renderBar(tabBar);
  tabBar.querySelectorAll<HTMLElement>(".tab-item").forEach((btn, i) => {
    btn.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("tab-close")) return;
      switchTab(i);
    });
  });
}

function switchTab(idx: number): void {
  if (tabs.active) {
    tabs.updateActive({
      content: editor.getValue(),
      cursorPos: editor.view.state.selection.main.anchor,
      scrollTop: editor.view.scrollDOM.scrollTop,
    });
  }
  tabs.activateTab(idx);
  const entry = tabs.active;
  if (!entry) return;
  editor.setValue(entry.content);
  files.clearDirty();
  tabs.updateActive({ isDirty: false });
  editor.view.dispatch({ selection: { anchor: entry.cursorPos }, scrollIntoView: true });
  editor.view.scrollDOM.scrollTop = entry.scrollTop;
  preview.update(entry.content);
  tree.setActive(entry.absPath);
  updateTitlebar(entry.absPath);
  reloadBanner.hidden = !entry.externallyModified;
  rebindTabBar();
}

async function handleCloseTab(idx: number): Promise<void> {
  const entry = tabs.entries[idx];
  if (!entry) return;
  if (entry.isDirty) {
    const discard = confirm(`Discard unsaved changes to "${basename(entry.absPath)}"?`);
    if (!discard) return;
  }
  // Remove this tab from watching before closing
  if (isTauri() && entry.absPath) {
    void invoke("remove_watch", { path: entry.absPath });
  }
  tabs.forceCloseTab(idx);
  headings.remove(entry.absPath);
  links.remove(entry.absPath);
  const active = tabs.active;
  if (active) {
    editor.setValue(active.content);
    files.clearDirty();
    tabs.updateActive({ isDirty: false });
    preview.update(active.content);
    tree.setActive(active.absPath);
    updateTitlebar(active.absPath);
    reloadBanner.hidden = !active.externallyModified;
  } else {
    editor.setValue("");
    preview.update("");
    files.newDocument();
    reloadBanner.hidden = true;
  }
  if (vault.root && active) tree.setActive(active.absPath);
  rebindTabBar();
}

// ---- Vault helpers ---------------------------------------------------------

async function openVault(): Promise<void> {
  const ok = await vault.open();
  if (!ok) return;

  if (isTauri()) void invoke("clear_all");

  const prevPaths = tabs.entries.map(e => e.absPath);
  tabs.clearAll();
  for (const p of prevPaths) headings.remove(p);
  links.clear();

  sidebar.hidden = false;
  sidebarResizer.hidden = false;
  tabBar.hidden = false;
  panes.classList.add("vault-mode");
  localStorage.setItem('skymark:vault-root', vault.root!);

  const savedWidth = localStorage.getItem('skymark:sidebar-width');
  if (savedWidth) panes.style.gridTemplateColumns = `${savedWidth}px 4px 1fr 1fr`;

  tree.render(vault.tree, null);

  const autoFile =
    vault.tree.find(f => /^(index|readme)\.md$/i.test(f.name)) ??
    vault.tree[0];

  if (!autoFile) {
    showToast("No Markdown files found in this folder");
    return;
  }

  await openVaultFile(autoFile);
  void watchCurrentTabs();
}

async function openVaultFile(node: VaultNode): Promise<void> {
  if (node.type !== "file") return;
  if (files.state.isDirty) {
    const currentName = files.state.path ? basename(files.state.path) : "Untitled";
    const save = confirm(`Save changes to "${currentName}"?`);
    if (save) {
      const saved = await files.saveInteractive(editor.getValue());
      if (!saved) return;
    }
  }

  const existing = tabs.entries.findIndex(e => e.absPath === node.abs_path);
  if (existing !== -1) { switchTab(existing); return; }

  if (tabs.active) {
    tabs.updateActive({
      content: editor.getValue(),
      cursorPos: editor.view.state.selection.main.anchor,
      scrollTop: editor.view.scrollDOM.scrollTop,
    });
  }

  const content = await files.loadFile(node.abs_path);
  tabs.addTab(node.abs_path, content);
  editor.setValue(content);
  files.clearDirty();
  tabs.updateActive({ isDirty: false });
  preview.update(content);
  tree.setActive(node.abs_path);
  updateTitlebar(node.abs_path);
  reloadBanner.hidden = true;

  currentActive = node.abs_path;

  headings.index(node.abs_path, node.abs_path.slice(vault.root!.length + 1), node.name, content);
  links.update(node.abs_path, content, vault.tree as unknown as VaultFile[]);
  tabs.persist();
  rebindTabBar();
  // Add this file to the watcher
  if (isTauri()) {
    void invoke("add_watch", { path: node.abs_path });
  }
}

async function openHeading(h: HeadingEntry): Promise<void> {
  const existing = tabs.entries.findIndex(e => e.absPath === h.absPath);
  if (existing !== -1) {
    switchTab(existing);
  } else {
    const content = await files.loadFile(h.absPath);
    tabs.addTab(h.absPath, content);
    editor.setValue(content);
    files.clearDirty();
    preview.update(content);
    tree.setActive(h.absPath);
    updateTitlebar(h.absPath);
    reloadBanner.hidden = true;
    headings.index(h.absPath, h.relPath, h.fileName, content);
    links.update(h.absPath, content, vault.tree as unknown as VaultFile[]);
    tabs.persist();
    rebindTabBar();
    // Add this file to the watcher
    if (isTauri()) {
      void invoke("add_watch", { path: h.absPath });
    }
  }
  editor.scrollToLine(h.line);
}

async function watchCurrentTabs(): Promise<void> {
  if (!isTauri()) return;
  try {
    // Use incremental watcher: clear all, then add each tab
    await invoke("clear_all");
    for (const entry of tabs.entries) {
      if (entry.absPath) {
        await invoke("add_watch", { path: entry.absPath });
      }
    }
  } catch {
    showToast("File watching unavailable");
  }
}

// ---- Watcher events --------------------------------------------------------

if (isTauri()) {
  void listen<string>("file-changed", (event) => {
    const changedPath = event.payload.replace(/\\/g, "/");
    const tabIdx = tabs.entries.findIndex(e => e.absPath.replace(/\\/g, "/") === changedPath);
    if (tabIdx === -1) return;
    if (tabIdx === tabs.activeIdx) {
      reloadBanner.hidden = false;
    } else {
      tabs.markExternallyModified(tabIdx);
      rebindTabBar();
    }
  });
}

// ---- Menu events -----------------------------------------------------------

if (isTauri()) {
  void listen<string>("skymark://menu", ({ payload }) => {
    switch (payload) {
      case "new-file":
        startNewDocument();
        break;
      case "open-file":
        void openFileInteractive();
        break;
      case "open-folder":
        void openVault();
        break;
      case "save-file":
        void files.saveInteractive(editor.getValue());
        break;
      case "find":
        openSearchPanel(editor.view);
        break;
    }
  });
}

reloadConfirm.addEventListener("click", () => {
  const active = tabs.active;
  if (!active) return;
  void (async () => {
    const content = await files.loadFile(active.absPath);
    tabs.updateActive({ content, externallyModified: false });
    editor.setValue(content);
    files.clearDirty();
    preview.update(content);
    reloadBanner.hidden = true;
    rebindTabBar();
    if (vault.root) {
      const relPath = active.absPath.slice(vault.root.length + 1);
      const fileName = basename(active.absPath);
      headings.index(active.absPath, relPath, fileName, content);
      links.update(active.absPath, content, vault.tree as unknown as VaultFile[]);
      tree.setActive(active.absPath);
    }
  })();
});

reloadDismiss.addEventListener("click", () => {
  tabs.updateActive({ externallyModified: false });
  reloadBanner.hidden = true;
  rebindTabBar();
});

// ---- Sidebar resize --------------------------------------------------------

sidebarResizer.addEventListener("pointerdown", (e) => {
  const startX = e.clientX;
  const startWidth = sidebar.offsetWidth;
  sidebarResizer.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => {
    const w = Math.min(480, Math.max(160, startWidth + ev.clientX - startX));
    panes.style.gridTemplateColumns = `${w}px 4px 1fr 1fr`;
    localStorage.setItem('skymark:sidebar-width', String(w));
  };
  const cleanup = () => {
    sidebarResizer.removeEventListener("pointermove", onMove);
    sidebarResizer.removeEventListener("pointerup", cleanup);
    sidebarResizer.removeEventListener("pointercancel", cleanup);
  };
  sidebarResizer.addEventListener("pointermove", onMove);
  sidebarResizer.addEventListener("pointerup", cleanup);
  sidebarResizer.addEventListener("pointercancel", cleanup);
});

function toggleSidebar(): void {
  sidebar.hidden = !sidebar.hidden;
  sidebarResizer.hidden = sidebar.hidden;
}

function updateTitlebar(filePath: string | null): void {
  title.textContent = filePath ? basename(filePath) : "Untitled";
  if (vault.root) {
    vaultPrefix.textContent = basename(vault.root) + " /";
    vaultPrefix.hidden = false;
  } else {
    vaultPrefix.hidden = true;
  }
}

// ---- Draft recovery on launch ----------------------------------------------

void (async () => {
  const recoverable = await drafts.checkRecovery();
  if (recoverable.length === 0) return;

  const draft = recoverable[0];
  const label = draft.original_path ? basename(draft.original_path) : "Untitled";

  if (draft.needs_resolution) {
    const keepDraft = confirm(
      `"${label}" was modified externally since your last edit.\n\n` +
      "OK = restore your unsaved draft\n" +
      "Cancel = use the version on disk"
    );
    if (keepDraft) {
      const content = await drafts.recoverDraft(draft.draft_key);
      editor.setValue(content);
      preview.update(content);
      showToast(`Restored draft of "${label}"`);
    } else {
      await drafts.dismissDraft(draft.draft_key);
    }
  } else {
    const content = await drafts.recoverDraft(draft.draft_key);
    editor.setValue(content);
    preview.update(content);
    showToast(`Recovered unsaved changes to "${label}"`);
  }
})().catch((err) => console.error("[skymark] draft recovery failed:", err));

// ---- Startup vault + tab restoration ----------------------------------------

void (async () => {
  const savedRoot = localStorage.getItem('skymark:vault-root');
  if (!savedRoot || !isTauri()) return;
  const ok = await vault.openFromPath(savedRoot);
  if (!ok) { localStorage.removeItem('skymark:vault-root'); return; }

  sidebar.hidden = false;
  sidebarResizer.hidden = false;
  tabBar.hidden = false;
  panes.classList.add("vault-mode");
  const savedWidth = localStorage.getItem('skymark:sidebar-width');
  if (savedWidth) panes.style.gridTemplateColumns = `${savedWidth}px 4px 1fr 1fr`;
  tree.render(vault.tree, null);

  const saved = tabs.restore();
  for (const { absPath } of saved.entries) {
    try {
      const opened = await openFile(absPath);
      const relPath = opened.path.slice(savedRoot.length + 1);
      const fileName = basename(opened.path);
      tabs.addTab(opened.path, opened.content);
      headings.index(opened.path, relPath, fileName, opened.content);
      links.update(opened.path, opened.content, vault.tree as unknown as VaultFile[]);
    } catch {
      // file no longer exists
    }
  }
  if (saved.activeIdx >= 0 && saved.activeIdx < tabs.entries.length) {
    tabs.activateTab(saved.activeIdx);
  }
  if (tabs.active) {
    editor.setValue(tabs.active.content);
    files.clearDirty();
    tabs.updateActive({ isDirty: false });
    preview.update(tabs.active.content);
    tree.setActive(tabs.active.absPath);
    updateTitlebar(tabs.active.absPath);
    rebindTabBar();
    // Add all restored tabs to the watcher
    if (isTauri()) {
      for (const entry of tabs.entries) {
        if (entry.absPath) {
          void invoke("add_watch", { path: entry.absPath });
        }
      }
    }
  } else {
    function findFirstFile(nodes: VaultNode[]): VaultNode | null {
      for (const n of nodes) {
        if (n.type === "file") {
          if (/^(index|readme)\.md$/i.test(n.name)) return n;
        } else if (n.type === "dir" && n.children) {
          const found = findFirstFile(n.children);
          if (found) return found;
        }
      }
      return null;
    }
    const autoFile = findFirstFile(vault.tree);
    if (autoFile) {
      await openVaultFile(autoFile);
      // openVaultFile already calls add_watch, so no need to call watchCurrentTabs
    }
  }
})();

// ---- Save-on-close ---------------------------------------------------------

if (isTauri()) {
  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    let closing = false;
    await win.onCloseRequested(async (event: { preventDefault(): void }) => {
      if (!files.state.isDirty) return;
      if (closing) { event.preventDefault(); return; }
      closing = true;
      event.preventDefault();
      const saved = await files.saveInteractive(editor.getValue());
      if (!saved) {
        const discard = confirm("Discard unsaved changes and close?");
        if (!discard) { closing = false; return; }
      }
      await win.destroy();
    });
  })();
}

// ---- Utilities -------------------------------------------------------------

function basename(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx >= 0 ? path.slice(idx + 1) : path;
}
