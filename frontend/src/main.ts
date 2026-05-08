import { createEditor } from "./editor";
import { createPreview } from "./preview";

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
if (!editorHost || !previewHost) throw new Error("missing layout host elements");

const preview = createPreview(previewHost);

const editor = createEditor(editorHost, (text) => {
  preview.update(text);
});

const initial = "# Welcome to Skymark\n\nStart typing in the editor on the left.\n";
editor.setValue(initial);
preview.update(initial);
