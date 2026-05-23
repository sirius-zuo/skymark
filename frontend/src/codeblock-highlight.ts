import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import hljs from "highlight.js";

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
      // Text content
      if (part && currentClasses.length > 0) {
        results.push({
          from: baseOffset + pos,
          to: baseOffset + pos + part.length,
          classes: currentClasses,
        });
      }
      pos += part.length;
    }
  }

  return results;
}

function highlightBlock(block: CodeBlockInfo): Array<{ from: number; to: number; classes: string[] }> {
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

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc.toString();
  const builder = new RangeSetBuilder<Decoration>();
  const blocks = findCodeBlocks(doc);

  for (const block of blocks) {
    const spans = highlightBlock(block);
    for (const span of spans) {
      if (span.classes.length > 0) {
        builder.add(span.from, span.to, Decoration.mark({ class: span.classes.join(" ") }));
      }
    }
  }

  return builder.finish();
}

export const codeblockHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v: { decorations: DecorationSet }) => v.decorations,
  }
);

export { findCodeBlocks, highlightBlock };
