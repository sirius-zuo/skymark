// frontend/src/editor.test.ts
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, it, expect, vi } from "vitest";
import { toggleLinePrefix, insertTemplate, createEditor } from "./editor";

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

  it("replaces H2 prefix with H1 (longer prefix replaced with shorter)", () => {
    const view = makeView("## hello");
    toggleLinePrefix(view, "# ", ["# ", "## ", "### "]);
    expect(view.state.doc.toString()).toBe("# hello");
  });

  it("replaces H3 prefix with H1", () => {
    const view = makeView("### hello");
    toggleLinePrefix(view, "# ", ["# ", "## ", "### "]);
    expect(view.state.doc.toString()).toBe("# hello");
  });

  it("does not mistake task list for bullet (longer group prefix wins)", () => {
    const view = makeView("- [ ] task");
    toggleLinePrefix(view, "- ", ["- ", "1. ", "- [ ] "]);
    expect(view.state.doc.toString()).toBe("- task");
  });

  it("replaces bullet with task list", () => {
    const view = makeView("- item");
    toggleLinePrefix(view, "- [ ] ", ["- ", "1. ", "- [ ] "]);
    expect(view.state.doc.toString()).toBe("- [ ] item");
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

// Regression: switchTab() in main.ts dispatches a raw selection anchor read
// from a tab's stored cursorPos. If that stored value is stale relative to
// the tab's content (e.g. set before an external reload/draft recovery
// shrank the document), dispatching it unclamped throws synchronously and
// aborts switchTab before it updates the preview/tab-bar/dirTree.
describe("stale cursorPos handling (switchTab safety net)", () => {
  it("dispatching an out-of-range anchor throws", () => {
    const view = makeView("0123456789", 0);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "ab" } });
    expect(() => {
      view.dispatch({ selection: { anchor: 9 }, scrollIntoView: true });
    }).toThrow();
  });

  it("clamping the anchor to the document length avoids the throw", () => {
    const view = makeView("0123456789", 0);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "ab" } });
    const staleCursorPos = 9;
    const safeCursorPos = Math.min(staleCursorPos, view.state.doc.length);
    expect(() => {
      view.dispatch({ selection: { anchor: safeCursorPos }, scrollIntoView: true });
    }).not.toThrow();
    expect(view.state.selection.main.anchor).toBe(view.state.doc.length);
  });
});


describe("createEditor onSelectionChange", () => {
  it("calls onSelectionChange with the main selection range when selection changes without a doc edit", () => {
    const parent = document.createElement("div");
    const onChange = vi.fn();
    const onSelectionChange = vi.fn();
    const editor = createEditor(parent, onChange, onSelectionChange);

    editor.setValue("hello world");
    onSelectionChange.mockClear();
    editor.view.dispatch({ selection: { anchor: 1, head: 4 } });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const call = onSelectionChange.mock.calls[0];
    expect(call[0].from).toBe(1);
    expect(call[0].to).toBe(4);
  });

  it("does not call onChange for a selection-only dispatch", () => {
    const parent = document.createElement("div");
    const onChange = vi.fn();
    const editor = createEditor(parent, onChange, () => {});

    editor.setValue("hello world");
    onChange.mockClear();
    editor.view.dispatch({ selection: { anchor: 1, head: 4 } });

    expect(onChange).not.toHaveBeenCalled();
  });
});
