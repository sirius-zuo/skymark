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
