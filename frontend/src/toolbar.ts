// frontend/src/toolbar.ts
import { EditorView } from "@codemirror/view";
import { wrapSelection, toggleLinePrefix, insertTemplate } from "./editor";

const HEADING_GROUP = ["# ", "## ", "### "];
const LIST_GROUP = ["- ", "1. ", "- [ ] "];

function btn(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tb-btn";
  b.textContent = label;
  b.title = title;
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

function sep(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "tb-sep";
  return d;
}

export function createToolbar(el: HTMLElement, view: EditorView): void {
  // Group 1: Inline
  el.appendChild(btn("B", "Bold ⌘B", () => wrapSelection(view, "**", "**")));
  el.appendChild(btn("I", "Italic ⌘I", () => wrapSelection(view, "_", "_")));
  el.appendChild(btn("S", "Strikethrough", () => wrapSelection(view, "~~", "~~")));
  el.appendChild(btn("` `", "Inline code", () => wrapSelection(view, "`", "`")));
  el.appendChild(sep());

  // Group 2: Headings
  el.appendChild(btn("H1", "Heading 1", () => toggleLinePrefix(view, "# ", HEADING_GROUP)));
  el.appendChild(btn("H2", "Heading 2", () => toggleLinePrefix(view, "## ", HEADING_GROUP)));
  el.appendChild(btn("H3", "Heading 3", () => toggleLinePrefix(view, "### ", HEADING_GROUP)));
  el.appendChild(sep());

  // Group 3: Lists
  el.appendChild(btn("•", "Bullet list", () => toggleLinePrefix(view, "- ", LIST_GROUP)));
  el.appendChild(btn("1.", "Numbered list", () => toggleLinePrefix(view, "1. ", LIST_GROUP)));
  el.appendChild(btn("☑", "Task list", () => toggleLinePrefix(view, "- [ ] ", LIST_GROUP)));
  el.appendChild(sep());

  // Group 4: Block
  el.appendChild(btn("🔗", "Link ⌘K", () => wrapSelection(view, "[", "](url)")));
  el.appendChild(btn("❝", "Blockquote", () => toggleLinePrefix(view, "> ")));
  el.appendChild(sep());

  // Group 5: Insert
  el.appendChild(btn("🖼", "Image", () => insertTemplate(view, "![alt](url)", 2)));
  el.appendChild(btn("∑", "Inline math", () => insertTemplate(view, "$expr$", 1)));
  el.appendChild(btn("$$", "Display math", () => insertTemplate(view, "$$\nexpr\n$$", 3)));
  el.appendChild(btn("```", "Code block", () => insertTemplate(view, "```\n\n```", 4)));
  el.appendChild(btn("⬡", "Mermaid diagram", () => insertTemplate(view, "```mermaid\ngraph TD;\n\n```", 21)));
}
