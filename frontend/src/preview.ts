import { renderMarkdown } from "./api";
import { enrichHighlight } from "./enrich-highlight";
import { enrichMath } from "./enrich-math";
import { enrichMermaid } from "./enrich-mermaid";

export interface PreviewHandle {
  update(text: string): void;
  getContentEl(): HTMLElement;
  /** Returns source line numbers of every data-line block marker, in order. */
  getDataLineNumbers(): number[];
  /**
   * Scroll sync from editor: scroll so that `fraction` of the way between the
   * preview elements for `lineA` and `lineB` is at the top of the pane.
   */
  scrollBetween(lineA: number, lineB: number, fraction: number): void;
  /**
   * Scroll sync past the last anchor: scroll `fraction` of the remaining
   * preview content below `lineA` into view (fraction=1 → preview bottom).
   */
  scrollPastAnchor(lineA: number, fraction: number): void;
  /**
   * Cursor sync: scroll the block containing source line `line` to
   * `viewportFraction` down the visible area (0 = top, default).
   */
  scrollToLine(line: number, viewportFraction?: number): void;
  /** Fires with the topmost visible source line when the user scrolls the preview. */
  onScroll(listener: (line: number) => void): void;
}

export function createPreview(host: HTMLElement): PreviewHandle {
  const scroller = document.createElement("div");
  scroller.className = "preview-scroll";
  host.appendChild(scroller);

  const content = document.createElement("div");
  content.className = "preview-content";
  scroller.appendChild(content);

  const parser = new DOMParser();
  let timer: number | null = null;
  let inflight = 0;

  // True while we are changing scroller.scrollTop programmatically — suppresses
  // the scroll event so it doesn't echo back to the editor.
  let syncingFromEditor = false;
  // Deadline until which scrollBetween/scrollToLine are suppressed because the
  // user is actively scrolling the preview pane.
  let previewDrivingUntil = 0;

  const scrollListeners: Array<(line: number) => void> = [];

  function doScroll(newScrollTop: number): void {
    syncingFromEditor = true;
    scroller.scrollTop = Math.max(0, newScrollTop);
    requestAnimationFrame(() => { syncingFromEditor = false; });
  }

  scroller.addEventListener("scroll", () => {
    if (syncingFromEditor) return;
    previewDrivingUntil = Date.now() + 100;
    const scrollerRect = scroller.getBoundingClientRect();
    const markers = Array.from(content.querySelectorAll<HTMLElement>("[data-line]"));
    let line = 1;
    for (const el of markers) {
      if (el.getBoundingClientRect().top - scrollerRect.top <= 2) {
        line = parseInt(el.getAttribute("data-line") ?? "1", 10);
      } else {
        break;
      }
    }
    for (const l of scrollListeners) l(line);
  }, { passive: true });

  async function commitDom(htmlString: string): Promise<void> {
    const doc = parser.parseFromString(htmlString, "text/html");
    const adopted: Node[] = [];
    for (const node of Array.from(doc.body.childNodes)) {
      adopted.push(document.importNode(node, true));
    }
    content.replaceChildren(...adopted);
    await enrichHighlight(content);
    await enrichMath(content);
    await enrichMermaid(content);
  }

  async function commit(text: string, requestId: number): Promise<void> {
    try {
      const html = await renderMarkdown(text);
      if (requestId !== inflight) return;
      await commitDom(html);
    } catch (err) {
      console.error("[skymark] render failed", err);
      content.replaceChildren(document.createTextNode("Render failed: " + String(err)));
    }
  }

  function markerOffset(el: HTMLElement): number {
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }

  return {
    update(text: string): void {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        inflight += 1;
        const id = inflight;
        void commit(text, id);
      }, 50);
    },

    getContentEl(): HTMLElement {
      return content;
    },

    getDataLineNumbers(): number[] {
      return Array.from(content.querySelectorAll<HTMLElement>("[data-line]"))
        .map(el => parseInt(el.getAttribute("data-line") ?? "0", 10))
        .filter(n => n > 0);
    },

    scrollBetween(lineA: number, lineB: number, fraction: number): void {
      if (Date.now() < previewDrivingUntil) return;
      const elA = content.querySelector<HTMLElement>(`[data-line="${lineA}"]`);
      if (!elA) return;
      const aOff = markerOffset(elA);
      const elB = content.querySelector<HTMLElement>(`[data-line="${lineB}"]`);
      if (!elB) { doScroll(scroller.scrollTop + aOff); return; }
      const bOff = markerOffset(elB);
      doScroll(scroller.scrollTop + aOff + fraction * (bOff - aOff));
    },

    scrollPastAnchor(lineA: number, fraction: number): void {
      if (Date.now() < previewDrivingUntil) return;
      const elA = content.querySelector<HTMLElement>(`[data-line="${lineA}"]`);
      if (!elA) return;
      const elADocY = scroller.scrollTop + markerOffset(elA);
      const totalRemaining = scroller.scrollHeight - elADocY;
      doScroll(elADocY + fraction * totalRemaining);
    },

    scrollToLine(line: number, viewportFraction = 0): void {
      if (Date.now() < previewDrivingUntil) return;
      const markers = Array.from(content.querySelectorAll<HTMLElement>("[data-line]"));
      if (markers.length === 0) return;
      let markerA: HTMLElement | null = null;
      let lineA = 0;
      let markerB: HTMLElement | null = null;
      let lineB = 0;
      for (const el of markers) {
        const n = parseInt(el.getAttribute("data-line") ?? "0", 10);
        if (n <= line) { markerA = el; lineA = n; }
        else { markerB = el; lineB = n; break; }
      }
      if (!markerA) { doScroll(0); return; }
      const aOff = markerOffset(markerA);
      // Document-Y of the source line (interpolated between the bracketing markers).
      let lineDocY = scroller.scrollTop + aOff;
      if (markerB && lineB > lineA) {
        const bOff = markerOffset(markerB);
        const fraction = (line - lineA) / (lineB - lineA);
        lineDocY = scroller.scrollTop + aOff + fraction * (bOff - aOff);
      }
      // Offset so the line lands viewportFraction down the visible area, not the top.
      doScroll(lineDocY - viewportFraction * scroller.clientHeight);
    },

    onScroll(listener: (line: number) => void): void {
      scrollListeners.push(listener);
    },
  };
}
