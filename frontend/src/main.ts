import { createEditor } from "./editor";

const editorHost = document.getElementById("editor");
if (!editorHost) throw new Error("missing #editor host element");

const editor = createEditor(editorHost, (text) => {
  // Preview wiring follows in Task 14.
  console.debug("[skymark] doc changed:", text.length, "chars");
});

editor.setValue("# Welcome to Skymark\n\nStart typing in the editor on the left.\n");
