import { createEditor } from "./editor";
import { createPreview } from "./preview";
import { createFileFlow } from "./files";
import { createDraftHandle } from "./draft";
import { showToast } from "./toast";
import { isTauri } from "./api";
import { createVaultHandle, VaultFile } from "./vault";
import { createTree } from "./tree";
import { createPalette } from "./palette";

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
const sidebarEl = document.getElementById("sidebar") as HTMLElement | null;
const paletteOverlayEl = document.getElementById("palette-overlay") as HTMLElement | null;
const titleEl = document.getElementById("doc-title") as HTMLElement | null;
const vaultPrefixEl = document.getElementById("vault-prefix") as HTMLElement | null;
const dirtyEl = document.getElementById("dirty-indicator") as HTMLElement | null;
const panesEl = document.querySelector(".panes") as HTMLElement | null;

if (!editorHost || !previewHost || !sidebarEl || !paletteOverlayEl || !titleEl || !vaultPrefixEl || !dirtyEl || !panesEl) {
  throw new Error("missing layout host elements");
}

const sidebar = sidebarEl as HTMLElement;
const paletteOverlay = paletteOverlayEl as HTMLElement;
const title = titleEl as HTMLElement;
const vaultPrefix = vaultPrefixEl as HTMLElement;
const dirty = dirtyEl as HTMLElement;
const panes = panesEl as HTMLElement;

const preview = createPreview(previewHost);
const files = createFileFlow();
const drafts = createDraftHandle();
const vault = createVaultHandle();
const tree = createTree(sidebar, (file) => { void openVaultFile(file); });
const palette = createPalette(paletteOverlay);

const editor = createEditor(editorHost, (text) => {
  preview.update(text);
  files.markDirty();
  drafts.onDocChange(files.state.path, () => editor.getValue());
});

files.onStateChange((s) => {
  updateTitlebar(s.path);
  dirty.hidden = !s.isDirty;
});

files.onAfterSave((path) => {
  drafts.onExplicitSave(path);
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);

// ── Keyboard shortcuts ──────────────────────────────────────────────────

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
        if (content !== null) {
          editor.setValue(content);
          preview.update(content);
        }
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
  } else if ((e.key === "p" || e.key === "P") && vault.root) {
    e.preventDefault();
    palette.show(vault.files, (file) => { void openVaultFile(file); });
  } else if (e.key === "\\" || e.key === "|") {
    if (vault.root) {
      e.preventDefault();
      toggleSidebar();
    }
  }
});

// ── Vault helpers ───────────────────────────────────────────────────────

async function openVault(): Promise<void> {
  const ok = await vault.open();
  if (!ok) return;

  sidebar.hidden = false;
  panes.classList.add("vault-mode");
  tree.render(vault.files, null);

  // Auto-open: prefer index.md or README.md, else first file.
  const autoFile =
    vault.files.find(f => /^(index|readme)\.md$/i.test(f.name)) ??
    vault.files[0];

  if (!autoFile) {
    showToast("No Markdown files found in this folder");
    return;
  }

  await openVaultFile(autoFile);
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

  const content = await files.loadFile(file.abs_path);
  editor.setValue(content);
  preview.update(content);
  tree.setActive(file.abs_path);
  updateTitlebar(file.abs_path);
}

function toggleSidebar(): void {
  sidebar.hidden = !sidebar.hidden;
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

// ── Draft recovery on launch ────────────────────────────────────────────

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

// ── Save-on-close ───────────────────────────────────────────────────────

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

// ── Utilities ──────────────────────────────────────────────────────────

function basename(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx >= 0 ? path.slice(idx + 1) : path;
}
