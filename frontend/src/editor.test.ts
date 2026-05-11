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
