import { renderMarkdown } from "./api";
import { enrichHighlight } from "./enrich-highlight";
import { enrichMath } from "./enrich-math";
import { enrichMermaid } from "./enrich-mermaid";

export interface PreviewHandle {
  update(text: string): void;
  getContentEl(): HTMLElement;
  scrollToLine(line: number): void;
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

  async function commitDom(htmlString: string): Promise<void> {
    // The HTML from skymark-core is already sanitized (spec §5.1).
    // We parse into a detached document — DOMParser does not execute <script>
    // tags — then move nodes into the live preview via replaceChildren.
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
      // Drop stale results — only the most recent invoke commits.
      if (requestId !== inflight) return;
      await commitDom(html);
    } catch (err) {
      console.error("[skymark] render failed", err);
      content.replaceChildren(document.createTextNode("Render failed: " + String(err)));
    }
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
    scrollToLine(line: number): void {
      const markers = Array.from(
        content.querySelectorAll<HTMLElement>("[data-line]")
      );
      if (markers.length === 0) return;

      // Find the last marker whose data-line value is <= the requested line.
      // Markers are in DOM order which matches ascending data-line order.
      let target: HTMLElement | null = null;
      for (const el of markers) {
        const n = parseInt(el.getAttribute("data-line") ?? "0", 10);
        if (n <= line) target = el;
        else break;
      }

      if (target) {
        target.scrollIntoView({ block: "nearest", behavior: "instant" });
      } else {
        // All block markers are after the cursor line — scroll preview to top.
        scroller.scrollTop = 0;
      }
    },
  };
}
