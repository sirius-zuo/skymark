import { createEditor } from "./editor";
import { createPreview } from "./preview";
import { createFileFlow } from "./files";
import { createDraftHandle } from "./draft";
import { showToast } from "./toast";
import { isTauri, openFile } from "./api";
import { createVaultHandle, VaultFile } from "./vault";
import { createTree } from "./tree";
import { createPalette } from "./palette";
import { createTabHandle } from "./tabs";
import { createHeadingIndex, HeadingEntry } from "./headings";
import { createLinkChecker } from "./links";
import { invoke } from "@tauri-apps/api/core";

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

if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl ||
    !vaultPrefixEl || !dirtyEl || !panesEl || !tabBarEl || !reloadBannerEl ||
    !reloadConfirmEl || !reloadDismissEl || !sidebarResizerEl) {
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

const preview = createPreview(previewHost);
const files = createFileFlow();
const drafts = createDraftHandle();
const vault = createVaultHandle();
const headings = createHeadingIndex();
const links = createLinkChecker();
const tabs = createTabHandle((idx) => { void handleCloseTab(idx); });
const tree = createTree(sidebar, (file) => { void openVaultFile(file); }, () => links.getBrokenFiles());
const palette = createPalette(paletteOverlay);

const editor = createEditor(editorHost, (text) => {
  preview.update(text);
  files.markDirty();
  drafts.onDocChange(files.state.path, () => editor.getValue());
  if (tabs.active) {
    tabs.updateActive({ content: text, isDirty: true });
    rebindTabBar();
  }
});

files.onStateChange((s) => {
  updateTitlebar(s.path);
  dirty.hidden = !s.isDirty;
});

files.onAfterSave((_path) => {
  drafts.onExplicitSave(_path);
  tabs.updateActive({ isDirty: false });
  rebindTabBar();
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);

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
      void (async () => {
        const content = await files.openInteractive();
        if (content !== null) { editor.setValue(content); preview.update(content); }
      })();
    }
  } else if (e.key === "s" || e.key === "S") {
    e.preventDefault();
    void files.saveInteractive(editor.getValue());
  } else if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    editor.setValue("");
    preview.update("");
    files.newDocument();
  } else if (e.key === "w" || e.key === "W") {
    if (tabs.active) { e.preventDefault(); void handleCloseTab(tabs.activeIdx); }
  } else if ((e.key === "p" || e.key === "P") && vault.root) {
    e.preventDefault();
    palette.show(
      vault.files,
      (file) => { void openVaultFile(file); },
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
  tabs.forceCloseTab(idx);
  const active = tabs.active;
  if (active) {
    editor.setValue(active.content);
    files.clearDirty();
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
  rebindTabBar();
  void watchCurrentTabs();
}

// ---- Vault helpers ---------------------------------------------------------

async function openVault(): Promise<void> {
  const ok = await vault.open();
  if (!ok) return;

  const prevPaths = tabs.entries.map(e => e.absPath);
  tabs.clearAll();
  for (const p of prevPaths) headings.remove(p);
  links.clear();

  sidebar.hidden = false;
  sidebarResizer.hidden = false;
  tabBar.hidden = false;
  panes.classList.add("vault-mode");

  const savedWidth = localStorage.getItem('skymark:sidebar-width');
  if (savedWidth) panes.style.gridTemplateColumns = `${savedWidth}px 4px 1fr 1fr`;

  tree.render(vault.files, null);

  const autoFile =
    vault.files.find(f => /^(index|readme)\.md$/i.test(f.name)) ??
    vault.files[0];

  if (!autoFile) {
    showToast("No Markdown files found in this folder");
    return;
  }

  await openVaultFile(autoFile);
  void watchCurrentTabs();
}

async function openVaultFile(file: VaultFile): Promise<void> {
  if (files.state.isDirty) {
    const currentName = files.state.path ? basename(files.state.path) : "Untitled";
    const save = confirm(`Save changes to "${currentName}"?`);
    if (save) {
      const saved = await files.saveInteractive(editor.getValue());
      if (!saved) return;
    }
  }

  const existing = tabs.entries.findIndex(e => e.absPath === file.abs_path);
  if (existing !== -1) { switchTab(existing); return; }

  if (tabs.active) {
    tabs.updateActive({
      content: editor.getValue(),
      cursorPos: editor.view.state.selection.main.anchor,
      scrollTop: editor.view.scrollDOM.scrollTop,
    });
  }

  const content = await files.loadFile(file.abs_path);
  tabs.addTab(file.abs_path, content);
  editor.setValue(content);
  files.clearDirty();
  preview.update(content);
  tree.setActive(file.abs_path);
  updateTitlebar(file.abs_path);
  reloadBanner.hidden = true;

  headings.index(file.abs_path, file.rel_path, file.name, content);
  links.update(file.abs_path, content, vault.files);
  tabs.persist();
  rebindTabBar();
  void watchCurrentTabs();
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
    links.update(h.absPath, content, vault.files);
    tabs.persist();
    rebindTabBar();
    void watchCurrentTabs();
  }
  editor.scrollToLine(h.line);
}

async function watchCurrentTabs(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("watch_paths", { paths: tabs.entries.map(e => e.absPath) });
  } catch {
    showToast("File watching unavailable");
  }
}

// ---- Watcher events --------------------------------------------------------

if (isTauri()) {
  void (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("file-changed", (event) => {
      const changedPath = event.payload;
      const tabIdx = tabs.entries.findIndex(e => e.absPath === changedPath);
      if (tabIdx === -1) return;
      if (tabIdx === tabs.activeIdx) {
        reloadBanner.hidden = false;
      } else {
        tabs.markExternallyModified(tabIdx);
        rebindTabBar();
      }
    });
  })();
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

// ---- Startup tab restoration -----------------------------------------------

void (async () => {
  if (!vault.root) return;
  const saved = tabs.restore();
  for (const { absPath } of saved) {
    try {
      const opened = await openFile(absPath);
      const relPath = opened.path.slice(vault.root!.length + 1);
      const fileName = basename(opened.path);
      tabs.addTab(opened.path, opened.content);
      headings.index(opened.path, relPath, fileName, opened.content);
      links.update(opened.path, opened.content, vault.files);
    } catch {
      // file no longer exists
    }
  }
  if (tabs.active) {
    editor.setValue(tabs.active.content);
    files.clearDirty();
    preview.update(tabs.active.content);
    tree.setActive(tabs.active.absPath);
    updateTitlebar(tabs.active.absPath);
    rebindTabBar();
    void watchCurrentTabs();
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
