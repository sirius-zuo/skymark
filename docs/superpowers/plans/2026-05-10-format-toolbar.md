# Format Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed formatting toolbar strip above the CodeMirror editor with 16 buttons in 5 groups (inline, headings, lists, block, insert).

**Architecture:** A new `toolbar.ts` module builds the toolbar DOM and wires click handlers using `mousedown + preventDefault` to preserve editor focus. Three formatting functions are added to (or promoted in) `editor.ts` — `wrapSelection` (export-promoted), `toggleLinePrefix` (new), and `insertTemplate` (new) — each dispatching CodeMirror transactions. `main.ts` calls `createToolbar` once after the editor is initialised.

**Tech Stack:** TypeScript, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), Vite, Vitest + jsdom (unit tests).

---

## File map

| Action   | Path                                   | Purpose                                      |
|----------|----------------------------------------|----------------------------------------------|
| Modify   | `frontend/src/editor.ts`               | Export `wrapSelection`; add `toggleLinePrefix`, `insertTemplate` |
| Create   | `frontend/src/toolbar.ts`              | `createToolbar(el, view)` — DOM + event wiring |
| Modify   | `frontend/index.html`                  | Add `<div id="format-toolbar">` inside `.editor-pane` |
| Modify   | `frontend/src/styles/app.css`          | Toolbar strip styles (`.tb-btn`, `.tb-sep`)  |
| Modify   | `frontend/src/main.ts`                 | Import and call `createToolbar` with null guard |
| Create   | `frontend/src/editor.test.ts`          | Unit tests for `toggleLinePrefix` and `insertTemplate` |
| Create   | `vitest.config.ts`                     | Vitest config with jsdom environment         |
| Create   | `frontend/src/test-setup.ts`           | Mock `ResizeObserver` for CodeMirror in jsdom |
| Modify   | `package.json`                         | Add `vitest` + `jsdom` devDeps, `test` script |

---

## Task 1: Set up Vitest and write failing tests

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `frontend/src/test-setup.ts`
- Create: `frontend/src/editor.test.ts`

- [ ] **Step 1: Install Vitest and jsdom**

```bash
npm install --save-dev vitest jsdom
```

Expected: both packages added to `node_modules/`, `package.json` devDependencies updated.

- [ ] **Step 2: Add test script to package.json**

In `package.json`, add `"test"` to the `scripts` block:

```json
{
  "scripts": {
    "dev": "vite --config frontend/vite.config.ts",
    "build": "vite build --config frontend/vite.config.ts",
    "preview": "vite preview --config frontend/vite.config.ts",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Create vitest.config.ts at the project root**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["frontend/src/**/*.test.ts"],
    setupFiles: ["frontend/src/test-setup.ts"],
  },
});
```

- [ ] **Step 4: Create the test setup file**

```typescript
// frontend/src/test-setup.ts
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
```

- [ ] **Step 5: Write the failing tests**

```typescript
// frontend/src/editor.test.ts
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, it, expect } from "vitest";
import { toggleLinePrefix, insertTemplate } from "./editor";

function makeView(doc: string, anchor = doc.length, head = anchor): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor, head } }),
  });
}

describe("toggleLinePrefix", () => {
  it("adds prefix to a plain line", () => {
    const view = makeView("hello");
    toggleLinePrefix(view, "- ");
    expect(view.state.doc.toString()).toBe("- hello");
  });

  it("removes prefix when line already has it (toggle off)", () => {
    const view = makeView("- hello");
    toggleLinePrefix(view, "- ");
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("adds prefix to all selected lines", () => {
    const doc = "line one\nline two\nline three";
    const view = makeView(doc, 0, doc.length);
    toggleLinePrefix(view, "- ");
    expect(view.state.doc.toString()).toBe("- line one\n- line two\n- line three");
  });

  it("removes prefix from all lines when all have it", () => {
    const doc = "- line one\n- line two";
    const view = makeView(doc, 0, doc.length);
    toggleLinePrefix(view, "- ");
    expect(view.state.doc.toString()).toBe("line one\nline two");
  });

  it("replaces a group prefix with the new one", () => {
    const view = makeView("- item");
    toggleLinePrefix(view, "1. ", ["- ", "1. ", "- [ ] "]);
    expect(view.state.doc.toString()).toBe("1. item");
  });

  it("removes prefix when its own prefix is clicked again (group)", () => {
    const view = makeView("1. item");
    toggleLinePrefix(view, "1. ", ["- ", "1. ", "- [ ] "]);
    expect(view.state.doc.toString()).toBe("item");
  });

  it("adds prefix even when some lines already have it (partial match toggles on)", () => {
    const doc = "- first\nsecond";
    const view = makeView(doc, 0, doc.length);
    toggleLinePrefix(view, "- ");
    expect(view.state.doc.toString()).toBe("- first\n- second");
  });
});

describe("insertTemplate", () => {
  it("inserts template at cursor", () => {
    const view = makeView("hello", 5);
    insertTemplate(view, " world");
    expect(view.state.doc.toString()).toBe("hello world");
  });

  it("replaces selection with template", () => {
    const doc = "hello world";
    const view = makeView(doc, 6, 11); // selects "world"
    insertTemplate(view, "earth");
    expect(view.state.doc.toString()).toBe("hello earth");
  });

  it("places cursor at end of inserted text when no cursorOffset", () => {
    const view = makeView("", 0);
    insertTemplate(view, "hello");
    expect(view.state.selection.main.head).toBe(5);
  });

  it("places cursor at cursorOffset from insertion start", () => {
    const view = makeView("", 0);
    insertTemplate(view, "![alt](url)", 2); // cursor after "!["
    expect(view.state.doc.toString()).toBe("![alt](url)");
    expect(view.state.selection.main.head).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — `toggleLinePrefix` and `insertTemplate` are not exported from `./editor`.

---

## Task 2: Implement editor formatting functions

**Files:**
- Modify: `frontend/src/editor.ts:46,64-186`

- [ ] **Step 1: Export wrapSelection (line 46)**

Change line 46 from:
```typescript
function wrapSelection(view: EditorView, prefix: string, suffix: string): boolean {
```
to:
```typescript
export function wrapSelection(view: EditorView, prefix: string, suffix: string): boolean {
```

The `boolean` return type is kept because `formattingKeymap` uses this function as a CodeMirror command handler (which must return `boolean`). External callers ignore the return value.

- [ ] **Step 2: Add toggleLinePrefix after wrapSelection (after line 63)**

Insert after the closing `}` of `wrapSelection` (after line 63):

```typescript
export function toggleLinePrefix(view: EditorView, prefix: string, group?: string[]): void {
  const { state } = view;
  const sel = state.selection.main;
  const fromLine = state.doc.lineAt(sel.from);
  const toLine = state.doc.lineAt(sel.to);

  const lines: Array<{ from: number; text: string }> = [];
  for (let n = fromLine.number; n <= toLine.number; n++) {
    const l = state.doc.line(n);
    lines.push({ from: l.from, text: l.text });
  }

  const allHavePrefix = lines.every((l) => l.text.startsWith(prefix));
  const changes: Array<{ from: number; to: number; insert: string }> = [];

  for (const l of lines) {
    if (allHavePrefix) {
      changes.push({ from: l.from, to: l.from + prefix.length, insert: "" });
      continue;
    }
    if (l.text.startsWith(prefix)) continue; // already has this prefix, skip
    let removeLen = 0;
    if (group) {
      for (const g of group) {
        if (l.text.startsWith(g)) { removeLen = g.length; break; }
      }
    }
    changes.push({ from: l.from, to: l.from + removeLen, insert: prefix });
  }

  if (changes.length > 0) {
    view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
  }
}
```

- [ ] **Step 3: Add insertTemplate after toggleLinePrefix**

Insert immediately after the closing `}` of `toggleLinePrefix`:

```typescript
export function insertTemplate(view: EditorView, template: string, cursorOffset?: number): void {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const anchor = range.from + (cursorOffset ?? template.length);
    return {
      changes: { from: range.from, to: range.to, insert: template },
      range: EditorSelection.cursor(anchor),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/editor.ts frontend/src/editor.test.ts frontend/src/test-setup.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: export wrapSelection; add toggleLinePrefix and insertTemplate to editor"
```

---

## Task 3: Add toolbar div and CSS

**Files:**
- Modify: `frontend/index.html:26-32`
- Modify: `frontend/src/styles/app.css` (append)

- [ ] **Step 1: Add the toolbar div to index.html**

In `frontend/index.html`, add `<div id="format-toolbar"></div>` after the closing `</div>` of `#reload-banner` (after line 31):

```html
        <section class="pane editor-pane" id="editor">
          <div id="reload-banner" hidden>
            <span id="reload-banner-msg">This file was changed on disk.</span>
            <button id="reload-confirm">Reload</button>
            <button id="reload-dismiss">Keep Mine</button>
          </div>
          <div id="format-toolbar"></div>
        </section>
```

- [ ] **Step 2: Add toolbar CSS to app.css**

Append to the end of `frontend/src/styles/app.css`:

```css
/* ---- Format toolbar ----------------------------------------------- */

#format-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.tb-btn {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 3px 7px;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  line-height: 1;
}

.tb-btn:hover {
  background: var(--color-bg);
  border-color: var(--color-border);
}

.tb-sep {
  width: 1px;
  height: 16px;
  background: var(--color-border);
  margin: 0 4px;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html frontend/src/styles/app.css
git commit -m "feat: add format-toolbar div and CSS styles"
```

---

## Task 4: Create toolbar.ts

**Files:**
- Create: `frontend/src/toolbar.ts`

- [ ] **Step 1: Create toolbar.ts**

```typescript
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
```

The cursor offsets for Insert templates are:
- `![alt](url)` → offset 2 places cursor at start of `alt`
- `$expr$` → offset 1 places cursor at start of `expr`
- `$$\nexpr\n$$` → offset 3 places cursor at start of `expr` (after `$$\n`)
- ```` ```\n\n``` ```` → offset 4 places cursor on the blank line (after ```` ```\n ````)
- ```` ```mermaid\ngraph TD;\n\n``` ```` → offset 21 places cursor on the blank line (after `graph TD;\n`)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/toolbar.ts
git commit -m "feat: add toolbar.ts with createToolbar"
```

---

## Task 5: Wire toolbar in main.ts and smoke test

**Files:**
- Modify: `frontend/src/main.ts:1,91`

- [ ] **Step 1: Add the import for createToolbar**

In `frontend/src/main.ts`, add to the import block after line 20 (after the last existing import):

```typescript
import { createToolbar } from "./toolbar";
```

- [ ] **Step 2: Wire createToolbar after the editor is initialised**

In `frontend/src/main.ts`, after line 91 (`onThemeChange(() => { preview.update(editor.getValue()); });`), add:

```typescript
const toolbarEl = document.getElementById("format-toolbar");
if (toolbarEl) {
  createToolbar(toolbarEl, editor.view);
} else {
  console.error("format-toolbar element not found");
}
```

- [ ] **Step 3: Run the dev server and verify**

```bash
npm run tauri:dev
```

Verify in the app:
1. The toolbar strip appears above the editor, below any reload banner.
2. All 16 buttons are visible in 5 groups with dividers.
3. Click **B** with a word selected → wraps in `**...**`.
4. Click **I** with a word selected → wraps in `_..._`.
5. Click **S** with a word selected → wraps in `~~...~~`.
6. Click **` `** with a word selected → wraps in `` `...` ``.
7. Click **H1** on a plain line → prefixes with `# `. Click again → removes it.
8. Click **H2** on a `# `-prefixed line → replaces with `## `.
9. Click **•** on multiple selected lines → each gets `- ` prefix.
10. Click **1.** on a `- `-prefixed line → replaces with `1. `.
11. Click **🔗** with text selected → wraps as `[text](url)`.
12. Click **❝** on a line → prefixes with `> `.
13. Click **⬡** → inserts mermaid block at cursor.
14. After each click, the editor cursor remains active (no focus loss).
15. Buttons render correctly in both light and dark themes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat: wire format toolbar into editor pane"
```
