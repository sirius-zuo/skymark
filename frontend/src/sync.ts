import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { PreviewHandle } from "./preview";

export function createSyncExtension(preview: PreviewHandle): Extension {
  return ViewPlugin.fromClass(
    class {
      private cursorTimer: number | null = null;
      private rafPending = false;
      // Suppress forward geometry reads briefly after a full-document change
      // (tab switch / setValue): the preview still holds the previous document's
      // data-line anchors until preview.update() re-renders, and reading editor
      // geometry right after a whole-document replace can race CM6's remeasure.
      private docChangedUntil = 0;
      private readonly onScroll = () => this.scheduleScrollSync();

      constructor(private readonly view: EditorView) {
        // The editor's actual scroll events fire on every pixel of movement,
        // unlike CM6's viewportChanged (which only flips when the rendered DOM
        // buffer is recycled, in coarse chunks). Listening here is what makes
        // the preview follow continuously and stay level-aligned — mirroring the
        // DOM scroll listener the preview side uses for the reverse direction.
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      }

      destroy(): void {
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.docChangedUntil = Date.now() + 150;
          if (this.cursorTimer !== null) {
            window.clearTimeout(this.cursorTimer);
            this.cursorTimer = null;
          }
          return;
        }

        if (update.selectionSet) {
          if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer);
          this.cursorTimer = window.setTimeout(() => {
            this.cursorTimer = null;
            this.syncCursor();
          }, 100);
        }
      }

      private scheduleScrollSync(): void {
        if (this.rafPending) return;
        this.rafPending = true;
        requestAnimationFrame(() => {
          this.rafPending = false;
          if (Date.now() < this.docChangedUntil) return;
          this.syncViewportTop();
        });
      }

      // Align the preview to the editor's viewport top: find the two data-line
      // anchors bracketing the top of the visible area and scroll the preview to
      // the same proportional position. Keeps content level between the panes.
      private syncViewportTop(): void {
        const view = this.view;
        const dataLines = preview.getDataLineNumbers();
        if (dataLines.length === 0) return;

        const rect = view.scrollDOM.getBoundingClientRect();

        // The anchor's y-position relative to the top of the editor's visible
        // area. Negative = above viewport top, 0 = at top, positive = below.
        // coordsAtPos is accurate but null outside the CM render buffer;
        // lineBlockAt covers that case with a small approximation.
        const anchorViewY = (dl: number): number => {
          const n = Math.min(dl, view.state.doc.lines);
          const pos = view.state.doc.line(n).from;
          const coords = view.coordsAtPos(pos);
          if (coords !== null) return coords.top - rect.top;
          return view.lineBlockAt(pos).top - view.scrollDOM.scrollTop;
        };

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
          const scrollEl = view.scrollDOM;
          const remaining = scrollEl.scrollHeight - scrollEl.scrollTop;
          const fraction = Math.max(0, Math.min(1, -viewYA / (remaining - viewYA)));
          preview.scrollPastAnchor(lineA, fraction);
        } else {
          // Viewport is before the first anchor or degenerate — snap to lineA.
          preview.scrollBetween(lineA, lineB ?? lineA, 0);
        }
      }

      // Cursor sync: place the cursor's source line at the same vertical fraction
      // of the preview that it occupies in the editor's visible area, so moving
      // the cursor keeps content level rather than yanking the line to the top.
      private syncCursor(): void {
        const view = this.view;
        if (Date.now() < this.docChangedUntil) return;
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head).number;
        const rect = view.scrollDOM.getBoundingClientRect();
        const coords = view.coordsAtPos(head);
        let fraction = 0;
        if (coords !== null && rect.height > 0) {
          fraction = Math.max(0, Math.min(1, (coords.top - rect.top) / rect.height));
        }
        preview.scrollToLine(line, fraction);
      }
    },
  );
}
