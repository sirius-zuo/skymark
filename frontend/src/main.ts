import { createEditor } from "./editor";
import { createSyncExtension } from "./sync";
import { createPreview } from "./preview";
import { createFileFlow } from "./files";
import { createDraftHandle } from "./draft";
import { showToast } from "./toast";
import { isTauri, openFile, saveFile as saveFileApi, printWindow } from "./api";
import { createDirTree } from "./dir-tree";
import { createTabHandle } from "./tabs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openSearchPanel } from "@codemirror/search";
import { initTheme, toggleTheme, onThemeChange } from "./theme";
import { createExportDropdown } from "./export-dropdown";
import { checkForUpdate, onUpdateAvailable } from "./update";
import { createUpdateBanner } from "./update-banner";
import { createToolbar } from "./toolbar";

// ---- DOM elements ----------------------------------------------------------

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
const sidebarEl = document.getElementById("sidebar") as HTMLElement | null;
const titleEl = document.getElementById("doc-title") as HTMLElement | null;
const dirtyEl = document.getElementById("dirty-indicator") as HTMLElement | null;
const panesEl = document.querySelector(".panes") as HTMLElement | null;
const tabBarEl = document.getElementById("tab-bar") as HTMLElement | null;
const reloadBannerEl = document.getElementById("reload-banner") as HTMLElement | null;
const reloadConfirmEl = document.getElementById("reload-confirm") as HTMLElement | null;
const reloadDismissEl = document.getElementById("reload-dismiss") as HTMLElement | null;
const sidebarResizerEl = document.getElementById("sidebar-resizer") as HTMLElement | null;
const paneResizerEl = document.getElementById("pane-resizer") as HTMLElement | null;
const themeToggleEl = document.getElementById("theme-toggle") as HTMLButtonElement | null;
const exportDropdownRootEl = document.getElementById("export-dropdown-root") as HTMLElement | null;
const updateBannerRootEl = document.getElementById("update-banner-root") as HTMLElement | null;
const updateCheckBtnEl = document.getElementById("update-check-btn") as HTMLButtonElement | null;

if (!editorHost || !previewHost || !sidebarEl || !titleEl ||
    !dirtyEl || !panesEl || !tabBarEl || !reloadBannerEl ||
    !reloadConfirmEl || !reloadDismissEl || !sidebarResizerEl || !paneResizerEl ||
    !themeToggleEl || !exportDropdownRootEl || !updateBannerRootEl || !updateCheckBtnEl) {
  throw new Error("missing layout host elements");
}

const sidebar = sidebarEl;
const title = titleEl;
const dirty = dirtyEl;
const panes = panesEl;
const tabBar = tabBarEl;
const reloadBanner = reloadBannerEl;
const reloadConfirm = reloadConfirmEl;
const reloadDismiss = reloadDismissEl;
const sidebarResizer = sidebarResizerEl;
const paneResizer = paneResizerEl;
const themeToggle = themeToggleEl;
const exportDropdownRoot = exportDropdownRootEl;
const updateBannerRoot = updateBannerRootEl;
const updateCheckBtn = updateCheckBtnEl;

// ---- Setup -----------------------------------------------------------------

initTheme();
themeToggle.addEventListener("click", toggleTheme);

const preview = createPreview(previewHost);
const syncExt = createSyncExtension(preview);
const files = createFileFlow();
const drafts = createDraftHandle();
const tabs = createTabHandle((idx) => { void handleCloseTab(idx); });
const dirTree = createDirTree(sidebar, (absPath) => { void openFileByPath(absPath); });

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

const exportDropdown = createExportDropdown(
  preview.getContentEl(),
  () => title.textContent ?? "Untitled",
);
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
  tabs.updateActive({ absPath: _path, isDirty: false });
  rebindTabBar();
  if (tabs.active?.absPath) {
    dirTree.setActive(tabs.active.absPath);
  }
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);
files.clearDirty();

// ---- Pane split helpers ----------------------------------------------------

function getPaneSplit(): number {
  const saved = localStorage.getItem("skymark:pane-split");
  const f = saved ? parseFloat(saved) : 0.5;
  return Math.min(0.8, Math.max(0.2, isNaN(f) ? 0.5 : f));
}

function applySplitColumns(): void {
  const split = getPaneSplit();
  if (sidebar.hidden) {
    panes.style.gridTemplateColumns = `${split}fr 4px ${1 - split}fr`;
  } else {
    const savedW = localStorage.getItem("skymark:sidebar-width") ?? "220";
    panes.style.gridTemplateColumns = `${savedW}px 4px ${split}fr 4px ${1 - split}fr`;
  }
}

// ---- Sidebar / tab visibility ----------------------------------------------

function showSidebarAndTabs(): void {
  tabBar.hidden = false;
  if (sidebar.hidden) {
    sidebar.hidden = false;
    sidebarResizer.hidden = false;
    applySplitColumns();
  }
}

// ---- File action helpers ---------------------------------------------------

async function openFileInteractive(): Promise<void> {
  const content = await files.openInteractive();
  if (content === null) return;
  const newPath = files.state.path!;

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
  tabs.persist();
  rebindTabBar();
  showSidebarAndTabs();
  void dirTree.setRoot(dirOf(newPath), newPath);
  if (isTauri()) void invoke("add_watch", { path: newPath });
}

async function openFileByPath(absPath: string): Promise<void> {
  const existing = tabs.entries.findIndex(e => e.absPath === absPath);
  if (existing !== -1) { switchTab(existing); return; }

  if (tabs.active) {
    tabs.updateActive({
      content: editor.getValue(),
      cursorPos: editor.view.state.selection.main.anchor,
      scrollTop: editor.view.scrollDOM.scrollTop,
    });
  }
  const content = await files.loadFile(absPath);
  tabs.addTab(absPath, content);
  editor.setValue(content);
  files.clearDirty();
  tabs.updateActive({ isDirty: false });
  preview.update(content);
  updateTitlebar(absPath);
  reloadBanner.hidden = true;
  tabs.persist();
  rebindTabBar();
  dirTree.setActive(absPath);
  if (isTauri()) void invoke("add_watch", { path: absPath });
}

function startNewDocument(): void {
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
  showSidebarAndTabs();
}

// ---- Keyboard shortcuts ----------------------------------------------------

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  if (e.key === "o" || e.key === "O") {
    e.preventDefault();
    void openFileInteractive();
  } else if (e.key === "s" || e.key === "S") {
    e.preventDefault();
    void files.saveInteractive(editor.getValue());
  } else if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    startNewDocument();
  } else if (e.key === "w" || e.key === "W") {
    if (tabs.active) { e.preventDefault(); void handleCloseTab(tabs.activeIdx); }
  } else if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    showPrintModal();
  } else if (e.key === "\\" || e.key === "|") {
    if (!sidebar.hidden) { e.preventDefault(); toggleSidebar(); }
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
  const wasDirty = entry.isDirty;
  editor.setValue(entry.content);
  files.clearDirty();
  tabs.updateActive({ isDirty: wasDirty });
  editor.view.dispatch({ selection: { anchor: entry.cursorPos }, scrollIntoView: true });
  editor.view.scrollDOM.scrollTop = entry.scrollTop;
  preview.update(entry.content);
  updateTitlebar(entry.absPath || null);
  reloadBanner.hidden = !entry.externallyModified;
  rebindTabBar();
  if (entry.absPath) {
    void dirTree.setRoot(dirOf(entry.absPath), entry.absPath);
  }
}

function promptDirtyClose(filename: string): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "print-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "print-modal";
    const titleDiv = document.createElement("div");
    titleDiv.className = "print-modal__title";
    titleDiv.textContent = "Unsaved Changes";
    const msgDiv = document.createElement("div");
    msgDiv.className = "print-modal__mode";
    msgDiv.textContent = `"${filename}" has unsaved changes.`;
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "print-modal__actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "print-modal__cancel";
    cancelBtn.textContent = "Cancel";
    const discardBtn = document.createElement("button");
    discardBtn.className = "print-modal__switch";
    discardBtn.textContent = "Don't Save";
    const saveBtn = document.createElement("button");
    saveBtn.className = "print-modal__print";
    saveBtn.textContent = "Save";
    actionsDiv.append(cancelBtn, discardBtn, saveBtn);
    modal.append(titleDiv, msgDiv, actionsDiv);
    overlay.append(modal);
    document.body.append(overlay);
    const done = (choice: "save" | "discard" | "cancel") => { overlay.remove(); resolve(choice); };
    cancelBtn.addEventListener("click", () => done("cancel"));
    discardBtn.addEventListener("click", () => done("discard"));
    saveBtn.addEventListener("click", () => done("save"));
  });
}

async function handleCloseTab(idx: number): Promise<void> {
  const entry = tabs.entries[idx];
  if (!entry) return;
  if (entry.isDirty) {
    const choice = await promptDirtyClose(basename(entry.absPath || "Untitled"));
    if (choice === "cancel") return;
    if (choice === "save") {
      if (idx === tabs.activeIdx) {
        const saved = await files.saveInteractive(editor.getValue());
        if (!saved) return;
        // onAfterSave callback already clears isDirty on the active tab
      } else if (entry.absPath) {
        try {
          await saveFileApi(entry.absPath, entry.content);
          drafts.onExplicitSave(entry.absPath);
          entry.isDirty = false;
          rebindTabBar();
        } catch {
          showToast("Save failed");
          return;
        }
      }
      // Untitled non-active: no save path available, fall through to close
    }
  }
  if (isTauri() && entry.absPath) {
    void invoke("remove_watch", { path: entry.absPath });
  }
  tabs.forceCloseTab(idx);
  const active = tabs.active;
  if (active) {
    const wasDirty = active.isDirty;
    editor.setValue(active.content);
    files.clearDirty();
    tabs.updateActive({ isDirty: wasDirty });
    preview.update(active.content);
    updateTitlebar(active.absPath || null);
    reloadBanner.hidden = !active.externallyModified;
    if (active.absPath) {
      void dirTree.setRoot(dirOf(active.absPath), active.absPath);
    }
  } else {
    editor.setValue("");
    preview.update("");
    files.newDocument();
    reloadBanner.hidden = true;
    tabBar.hidden = true;
    sidebar.hidden = true;
    sidebarResizer.hidden = true;
    applySplitColumns();
  }
  rebindTabBar();
}

// ---- Watcher events --------------------------------------------------------

if (isTauri()) {
  void listen<string>("file-changed", (event) => {
    const changedPath = event.payload.replace(/\\/g, "/");
    const tabIdx = tabs.entries.findIndex(
      e => e.absPath.replace(/\\/g, "/") === changedPath,
    );
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
      case "new-file":   startNewDocument(); break;
      case "open-file":  void openFileInteractive(); break;
      case "save-file":  void files.saveInteractive(editor.getValue()); break;
      case "find":       openSearchPanel(editor.view); break;
      case "print-file": showPrintModal(); break;
    }
  });
}

// ---- Reload banner ---------------------------------------------------------

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
    dirTree.setActive(active.absPath);
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
    const split = getPaneSplit();
    panes.style.gridTemplateColumns = `${w}px 4px ${split}fr 4px ${1 - split}fr`;
    localStorage.setItem("skymark:sidebar-width", String(w));
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

// ---- Pane resize -----------------------------------------------------------

paneResizer.addEventListener("pointerdown", (e) => {
  paneResizer.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => {
    const panesRect = panes.getBoundingClientRect();
    const sidebarTaken = sidebar.hidden ? 0 : sidebar.offsetWidth + 4;
    const available = panesRect.width - sidebarTaken - 4;
    const editorW = ev.clientX - panesRect.left - sidebarTaken;
    const split = Math.min(0.8, Math.max(0.2, editorW / available));
    if (sidebar.hidden) {
      panes.style.gridTemplateColumns = `${split}fr 4px ${1 - split}fr`;
    } else {
      panes.style.gridTemplateColumns = `${sidebar.offsetWidth}px 4px ${split}fr 4px ${1 - split}fr`;
    }
    localStorage.setItem("skymark:pane-split", String(split));
  };
  const cleanup = () => {
    paneResizer.removeEventListener("pointermove", onMove);
    paneResizer.removeEventListener("pointerup", cleanup);
    paneResizer.removeEventListener("pointercancel", cleanup);
  };
  paneResizer.addEventListener("pointermove", onMove);
  paneResizer.addEventListener("pointerup", cleanup);
  paneResizer.addEventListener("pointercancel", cleanup);
});

function toggleSidebar(): void {
  sidebar.hidden = !sidebar.hidden;
  sidebarResizer.hidden = sidebar.hidden;
  applySplitColumns();
}

// ---- Print -----------------------------------------------------------------

function showPrintModal(): void {
  let mode: "preview" | "source" = "preview";

  const overlay = document.createElement("div");
  overlay.className = "print-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "print-modal";

  const titleDiv = document.createElement("div");
  titleDiv.className = "print-modal__title";
  titleDiv.textContent = "Print";

  const modeDiv = document.createElement("div");
  modeDiv.className = "print-modal__mode";
  modeDiv.textContent = "Mode: ";
  const modeLabel = document.createElement("strong");
  modeLabel.className = "print-modal__mode-label";
  modeLabel.textContent = "Rendered Preview";
  modeDiv.appendChild(modeLabel);

  const hintDiv = document.createElement("div");
  hintDiv.className = "print-modal__hint";
  hintDiv.textContent = "Click Switch to print Markdown source";

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "print-modal__actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "print-modal__cancel";
  cancelBtn.textContent = "Cancel";

  const switchBtn = document.createElement("button");
  switchBtn.className = "print-modal__switch";
  switchBtn.textContent = "Switch";

  const printBtn = document.createElement("button");
  printBtn.className = "print-modal__print";
  printBtn.textContent = "Print";

  actionsDiv.appendChild(cancelBtn);
  actionsDiv.appendChild(switchBtn);
  actionsDiv.appendChild(printBtn);
  modal.appendChild(titleDiv);
  modal.appendChild(modeDiv);
  modal.appendChild(hintDiv);
  modal.appendChild(actionsDiv);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  switchBtn.addEventListener("click", () => {
    if (mode === "preview") {
      mode = "source";
      modeLabel.textContent = "Markdown Source";
      hintDiv.textContent = "Click Switch to print rendered preview";
    } else {
      mode = "preview";
      modeLabel.textContent = "Rendered Preview";
      hintDiv.textContent = "Click Switch to print Markdown source";
    }
  });

  printBtn.addEventListener("click", () => {
    overlay.remove();
    void doPrint(mode);
  });

  cancelBtn.addEventListener("click", () => {
    overlay.remove();
  });
}

async function doPrint(mode: "preview" | "source"): Promise<void> {
  let sourceEl: HTMLElement | null = null;
  if (mode === "source") {
    console.log("[print] switching to source mode");
    document.body.classList.add("print-source");
    sourceEl = document.createElement("pre");
    sourceEl.id = "skymark-print-source";
    sourceEl.textContent = editor.getValue();
    document.body.appendChild(sourceEl);
    console.log("[print] source element appended, body classes:", document.body.className);
    // Wait for browser to reflow before opening print dialog
    await new Promise((r) => setTimeout(r, 300));
  }
  await printWindow();
  // Clean up after print dialog closes
  const cleanup = () => {
    console.log("[print] cleaning up");
    document.body.classList.remove("print-source");
    sourceEl?.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // Fallback: cleanup after 10s if afterprint doesn't fire
  setTimeout(cleanup, 10000);
}

// ---- Titlebar --------------------------------------------------------------

function updateTitlebar(filePath: string | null): void {
  title.textContent = filePath ? basename(filePath) : "Untitled";
}

// ---- Startup: restore tabs then recover drafts ----------------------------

void (async () => {
  // Phase 1: Restore tabs from previous session
  if (isTauri()) {
    const saved = tabs.restore();
    if (saved.entries.length > 0) {
      for (const { absPath } of saved.entries) {
        if (!absPath) continue;
        try {
          const opened = await openFile(absPath);
          tabs.addTab(opened.path, opened.content);
        } catch {
          // file no longer exists
        }
      }
      if (saved.activeIdx >= 0 && saved.activeIdx < tabs.entries.length) {
        tabs.activateTab(saved.activeIdx);
      }
      if (tabs.active) {
        files.setPath(tabs.active.absPath || null);
        editor.setValue(tabs.active.content);
        files.clearDirty();
        tabs.updateActive({ isDirty: false });
        preview.update(tabs.active.content);
        updateTitlebar(tabs.active.absPath || null);
        rebindTabBar();
        showSidebarAndTabs();
        if (tabs.active.absPath) {
          void dirTree.setRoot(dirOf(tabs.active.absPath), tabs.active.absPath);
        }
        for (const entry of tabs.entries) {
          if (entry.absPath) void invoke("add_watch", { path: entry.absPath });
        }
      }
    }
  }

  // Phase 2: Recover drafts (only if they match current tab)
  const recoverable = await drafts.checkRecovery();
  if (recoverable.length === 0) return;

  if (tabs.entries.length === 0) {
    for (const d of recoverable) await drafts.dismissDraft(d.draft_key);
    return;
  }

  const activePath = tabs.active?.absPath ?? null;
  const matchingDraft = recoverable.find(d => d.original_path === activePath);
  if (!matchingDraft) {
    for (const d of recoverable) await drafts.dismissDraft(d.draft_key);
    return;
  }

  const draft = matchingDraft;
  const label = draft.original_path ? basename(draft.original_path) : "Untitled";

  if (draft.needs_resolution) {
    const keepDraft = confirm(
      `"${label}" was modified externally since your last edit.\n\n` +
      "OK = restore your unsaved draft\n" +
      "Cancel = use the version on disk",
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
    if (content === (tabs.active?.content ?? "")) {
      await drafts.dismissDraft(draft.draft_key);
    } else {
      editor.setValue(content);
      preview.update(content);
      showToast(`Recovered unsaved changes to "${label}"`);
    }
  }
  for (const d of recoverable) {
    if (d.draft_key !== draft.draft_key) await drafts.dismissDraft(d.draft_key);
  }
})().catch((err) => console.error("[skymark] startup recovery failed:", err));

// ---- Save-on-close ---------------------------------------------------------

if (isTauri()) {
  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    let closing = false;
    await win.onCloseRequested(async (event: { preventDefault(): void }) => {
      const dirtyTabs = tabs.entries.filter(e => e.isDirty);
      if (dirtyTabs.length === 0 && !files.state.isDirty) return;
      if (closing) { event.preventDefault(); return; }
      closing = true;
      event.preventDefault();

      for (const entry of dirtyTabs) {
        const choice = await promptDirtyClose(basename(entry.absPath || "Untitled"));
        if (choice === "cancel") { closing = false; return; }
        if (choice === "save") {
          if (entry === tabs.active) {
            const saved = await files.saveInteractive(editor.getValue());
            if (!saved) { closing = false; return; }
          } else if (entry.absPath) {
            try {
              await saveFileApi(entry.absPath, entry.content);
              drafts.onExplicitSave(entry.absPath);
              entry.isDirty = false;
            } catch {
              showToast(`Could not save "${basename(entry.absPath)}"`);
              closing = false;
              return;
            }
          } else {
            // Untitled non-active tab — switch to it so saveInteractive can show a Save As dialog
            const entryIdx = tabs.entries.indexOf(entry);
            switchTab(entryIdx);
            files.setPath(null);
            const saved = await files.saveInteractive(editor.getValue());
            if (!saved) { closing = false; return; }
          }
        }
      }

      tabs.persist();
      await win.destroy();
    });
  })();
}

// ---- Utilities -------------------------------------------------------------

function dirOf(path: string): string {
  const sep = path.includes("/") ? "/" : "\\";
  const idx = path.lastIndexOf(sep);
  return idx > 0 ? path.slice(0, idx) : path;
}

function basename(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx >= 0 ? path.slice(idx + 1) : path;
}
