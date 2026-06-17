import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { PreviewHandle } from "./preview";

export function createSyncExtension(preview: PreviewHandle): Extension {
  let cursorTimer: number | null = null;

  return EditorView.updateListener.of((update) => {
    // Skip when the document itself changed (e.g. setValue() swapping in a
    // different tab's content wholesale): the viewport always "changes" too
    // in that case, but reading geometry here (coordsAtPos/lineBlockAt) right
    // after a full-document replace can race CM6's own remeasure and throw
    // (mapping a stale cached position through the new changeset). Preview
    // sync for a tab switch happens separately via preview.update(content).
    if (update.viewportChanged && !update.docChanged) {
      const view = update.view;
      const dataLines = preview.getDataLineNumbers();
      if (dataLines.length === 0) return;

      const rect = view.scrollDOM.getBoundingClientRect();

      // Returns the anchor's y-position relative to the top of the editor's
      // visible area. Negative = above viewport top, 0 = at top, positive = below.
      // coordsAtPos is accurate but returns null for positions outside the CM
      // render buffer. lineBlockAt covers that case with a small approximation.
      function anchorViewY(dl: number): number {
        const n = Math.min(dl, view.state.doc.lines);
        const pos = view.state.doc.line(n).from;
        const coords = view.coordsAtPos(pos);
        if (coords !== null) return coords.top - rect.top;
        return view.lineBlockAt(pos).top - view.scrollDOM.scrollTop;
      }

      // Find the two anchors that bracket the top of the visible area.
      let lineA = dataLines[0];
      let viewYA = anchorViewY(dataLines[0]);
      let lineB: number | null = null;
      let viewYB = 0;

      for (let i = 1; i < dataLines.length; i++) {
        const vy = anchorViewY(dataLines[i]);
        if (vy <= 0) {
          lineA = dataLines[i];
          viewYA = vy;
        } else {
          lineB = dataLines[i];
          viewYB = vy;
          break;
        }
      }

      if (lineB !== null && viewYB > viewYA) {
        // Normal case: viewport top sits between anchors A and B.
        const fraction = Math.max(0, Math.min(1, -viewYA / (viewYB - viewYA)));
        preview.scrollBetween(lineA, lineB, fraction);
      } else if (lineB === null && viewYA <= 0) {
        // Past the last anchor: interpolate to the end of the preview.
        // fraction = how far past lineA the viewport top is, out of all
        // remaining editor content below lineA.
        const scrollEl = view.scrollDOM;
        const remaining = scrollEl.scrollHeight - scrollEl.scrollTop;
        const fraction = Math.max(0, Math.min(1, -viewYA / (remaining - viewYA)));
        preview.scrollPastAnchor(lineA, fraction);
      } else {
        // Viewport is before the first anchor or degenerate — snap to lineA.
        preview.scrollBetween(lineA, lineB ?? lineA, 0);
      }

      if (cursorTimer !== null) { window.clearTimeout(cursorTimer); cursorTimer = null; }
      return;
    }

    if (update.selectionSet && !update.docChanged) {
      if (cursorTimer !== null) window.clearTimeout(cursorTimer);
      cursorTimer = window.setTimeout(() => {
        cursorTimer = null;
        const line = update.view.state.doc.lineAt(
          update.view.state.selection.main.head,
        ).number;
        preview.scrollToLine(line);
      }, 100);
    }
  });
}
