import { renderMarkdown } from "./api";

export interface PreviewHandle {
  update(text: string): void;
}

export function createPreview(host: HTMLElement): PreviewHandle {
  const content = document.createElement("div");
  content.className = "preview-content";
  host.appendChild(content);

  const parser = new DOMParser();
  let timer: number | null = null;
  let inflight = 0;

  function commitDom(htmlString: string): void {
    // The HTML from skymark-core is already sanitized (spec §5.1).
    // We parse into a detached document — DOMParser does not execute <script>
    // tags — then move nodes into the live preview via replaceChildren.
    const doc = parser.parseFromString(htmlString, "text/html");
    const adopted: Node[] = [];
    for (const node of Array.from(doc.body.childNodes)) {
      adopted.push(document.importNode(node, true));
    }
    content.replaceChildren(...adopted);
  }

  async function commit(text: string, requestId: number): Promise<void> {
    try {
      const html = await renderMarkdown(text);
      // Drop stale results — only the most recent invoke commits.
      if (requestId !== inflight) return;
      commitDom(html);
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
  };
}
