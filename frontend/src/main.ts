import { createEditor } from "./editor";
import { createPreview } from "./preview";
import { createFileFlow } from "./files";
import { createDraftHandle } from "./draft";
import { showToast } from "./toast";
import { isTauri } from "./api";

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
const titleEl = document.getElementById("doc-title") as HTMLElement | null;
const dirtyEl = document.getElementById("dirty-indicator") as HTMLElement | null;
if (!editorHost || !previewHost || !titleEl || !dirtyEl) {
  throw new Error("missing layout host elements");
}

const preview = createPreview(previewHost);
const files = createFileFlow();
const drafts = createDraftHandle();

const editor = createEditor(editorHost, (text) => {
  preview.update(text);
  files.markDirty();
  drafts.onDocChange(files.state.path, () => editor.getValue());
});

files.onStateChange((s) => {
  titleEl.textContent = s.path ? basename(s.path) : "Untitled";
  dirtyEl.hidden = !s.isDirty;
});

files.onAfterSave((path) => {
  drafts.onExplicitSave(path);
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);

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

// Draft recovery on launch.
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
})();

// Save-on-close: intercept window close when dirty.
if (isTauri()) {
  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event: { preventDefault(): void }) => {
      if (!files.state.isDirty) return;
      event.preventDefault();
      const saved = await files.saveInteractive(editor.getValue());
      if (!saved) {
        const discard = confirm("Discard unsaved changes and close?");
        if (!discard) return;
      }
      await win.destroy();
    });
  })();
}

function basename(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx >= 0 ? path.slice(idx + 1) : path;
}
