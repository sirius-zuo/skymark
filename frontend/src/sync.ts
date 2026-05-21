import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { PreviewHandle } from "./preview";

/**
 * Returns a CodeMirror Extension that drives preview scroll from editor
 * viewport changes (immediate) and cursor moves (100ms debounce).
 * Pass the returned extension into createEditor's `extra` parameter.
 */
export function createSyncExtension(preview: PreviewHandle): Extension {
  let cursorTimer: number | null = null;

  return EditorView.updateListener.of((update) => {
    if (update.viewportChanged) {
      // viewport.from is the start of CodeMirror's pre-render buffer, which sits
      // above the actual visible area. Use posAtCoords on the top edge of the
      // editor DOM to get the truly first-visible character instead.
      const rect = update.view.scrollDOM.getBoundingClientRect();
      const pos = update.view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 });
      if (pos === null) return;
      const line = update.view.state.doc.lineAt(pos).number;
      preview.scrollToLine(line);
      // Cancel any pending cursor sync; viewport change takes priority.
      if (cursorTimer !== null) {
        window.clearTimeout(cursorTimer);
        cursorTimer = null;
      }
      return;
    }

    if (update.selectionSet && !update.docChanged) {
      // Cursor sync: debounce 100ms to avoid firing on every keystroke.
      if (cursorTimer !== null) window.clearTimeout(cursorTimer);
      cursorTimer = window.setTimeout(() => {
        cursorTimer = null;
        const line = update.view.state.doc.lineAt(
          update.view.state.selection.main.head
        ).number;
        preview.scrollToLine(line);
      }, 100);
    }
  });
}
