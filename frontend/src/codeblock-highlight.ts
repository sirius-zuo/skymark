import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// Regex: matches ```lang ... ``` fences
// Groups: [0]=full match, [1]=language tag, [2]=code content
const fenceRegex = /```([a-zA-Z0-9_+-]+)?\s*\n([\s\S]*?)\n```/g;

interface CodeBlockInfo {
  codeFrom: number;
  codeTo: number;
  lang: string | null;
  code: string;
}

function findCodeBlocks(content: string): CodeBlockInfo[] {
  const blocks: CodeBlockInfo[] = [];
  let m: RegExpExecArray | null;
  fenceRegex.lastIndex = 0;
  while ((m = fenceRegex.exec(content)) !== null) {
    // Find where the code starts: after the first newline following opening fence
    const firstNewline = m.index + m[0].indexOf("\n");
    const codeFrom = firstNewline + 1;
    const code = m[2];
    const codeTo = codeFrom + code.length;
    blocks.push({ codeFrom, codeTo, lang: m[1] || null, code });
  }
  return blocks;
}

// Decode common HTML entities that highlight.js uses in its output.
// highlight.js encodes: ' → &#x27;, / → &#x2F;, > → &gt;, < → &lt;, & → &amp;, " → &quot;
function decodeHTMLEntities(text: string): string {
  return (
    text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/")
      .replace(/&#39;/g, "'")
      .replace(/&#47;/g, "/")
  );
}

function parseHighlightHTML(
  html: string,
  baseOffset: number
): Array<{ from: number; to: number; classes: string[] }> {
  const results: Array<{ from: number; to: number; classes: string[] }> = [];
  let pos = 0;
  let currentClasses: string[] = [];

  const parts = html.split(/(<\/?span[^>]*>)/g);

  for (const part of parts) {
    if (part.startsWith("<span ")) {
      const classMatch = part.match(/class="([^"]+)"/);
      if (classMatch) {
        currentClasses = classMatch[1].split(" ").filter(Boolean);
      }
    } else if (part.startsWith("</span>")) {
      currentClasses = [];
    } else if (part) {
      // Decode HTML entities so positions match the original document text.
      // highlight.js encodes ' as &#x27;, > as &gt;, etc.
      const decoded = decodeHTMLEntities(part);
      if (decoded && currentClasses.length > 0) {
        results.push({
          from: baseOffset + pos,
          to: baseOffset + pos + decoded.length,
          classes: currentClasses,
        });
      }
      pos += decoded.length;
    }
  }

  return results;
}

function highlightBlock(
  hljs: typeof import("highlight.js").default,
  block: CodeBlockInfo
): Array<{ from: number; to: number; classes: string[] }> {
  const results: Array<{ from: number; to: number; classes: string[] }> = [];
  try {
    const result = block.lang
      ? hljs.highlight(block.code, { language: block.lang, ignoreIllegals: true })
      : hljs.highlightAuto(block.code);

    const html = result.value;
    if (typeof html === "string") {
      results.push(...parseHighlightHTML(html, block.codeFrom));
    }
  } catch {
    // highlight.js can throw on malformed input — return empty
  }
  return results;
}

function buildDecorations(
  view: EditorView,
  hljs: typeof import("highlight.js").default
): DecorationSet {
  const doc = view.state.doc.toString();
  const builder = new RangeSetBuilder<Decoration>();
  const blocks = findCodeBlocks(doc);

  for (const block of blocks) {
    const spans = highlightBlock(hljs, block);
    for (const span of spans) {
      if (span.classes.length > 0) {
        builder.add(span.from, span.to, Decoration.mark({ class: span.classes.join(" ") }));
      }
    }
  }

  return builder.finish();
}

// Lazy-load highlight.js (dynamic import avoids Vite tree-shaking of languages)
let hljsCache: typeof import("highlight.js").default | null = null;
let hljsLoading: Promise<typeof import("highlight.js").default> | null = null;

function getHljs(): Promise<typeof import("highlight.js").default> {
  if (hljsCache) return Promise.resolve(hljsCache);
  if (!hljsLoading) {
    hljsLoading = import("highlight.js").then((m) => {
      hljsCache = m.default;
      return hljsCache;
    });
  }
  return hljsLoading;
}

export const codeblockHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    dirty: boolean;

    constructor(_view: EditorView) {
      // Build with no-hljs fallback (empty decorations) on first render
      this.decorations = Decoration.none;
      this.dirty = false;
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.dirty = true;
        // Queue async rebuild via microtask so it runs before next rAF
        // Then dispatch a no-op update to force CodeMirror to re-render
        queueMicrotask(() => {
          if (!this.dirty) return;
          this.dirty = false;
          // Ensure hljs is loaded, then rebuild
          getHljs().then((hljs) => {
            this.decorations = buildDecorations(update.view, hljs);
            // Dispatch empty update to trigger re-render with new decorations
            update.view.dispatch({});
          }).catch(() => {
            // If hljs fails to load, keep empty decorations
          });
        });
      }
    }
  },
  {
    decorations: (v: { decorations: DecorationSet }) => v.decorations,
  }
);

export { findCodeBlocks, highlightBlock, buildDecorations };
