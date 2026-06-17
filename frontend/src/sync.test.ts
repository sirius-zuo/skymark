import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createSyncExtension } from "./sync";
import type { PreviewHandle } from "./preview";

function makePreview(): PreviewHandle {
  return {
    update: vi.fn(),
    getContentEl: () => document.createElement("div"),
    getDataLineNumbers: vi.fn(() => [1, 5, 10]),
    scrollBetween: vi.fn(),
    scrollPastAnchor: vi.fn(),
    scrollToLine: vi.fn(),
    onScroll: vi.fn(),
  };
}

// Regression: a full-document replace (e.g. switchTab()'s editor.setValue()
// when switching tabs) also flips update.viewportChanged, since the visible
// content is now an entirely different document. The scroll-sync listener
// used to run its geometry-reading logic (coordsAtPos/lineBlockAt) in that
// case too, racing CM6's own remeasure and throwing "Position N is out of
// range for changeset of length M" on rapid tab switches. Preview content
// for a tab switch is already handled separately via preview.update(), so
// this listener should skip entirely when the document changed.
describe("createSyncExtension", () => {
  it("does not touch preview/editor geometry when the document changed", () => {
    const preview = makePreview();
    const view = new EditorView({
      state: EditorState.create({ doc: "a\nb\nc", extensions: [createSyncExtension(preview)] }),
    });

    // Simulate switchTab()'s editor.setValue(): replace the whole document.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "x\ny" } });

    expect(preview.getDataLineNumbers).not.toHaveBeenCalled();
  });
});
