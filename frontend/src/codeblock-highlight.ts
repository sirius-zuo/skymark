import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { getTheme, onThemeChange } from "./theme";
import { getShiki, ensureLang, tokenToStyle, type Highlighter } from "./shiki-singleton";

// Regex: matches ```lang ... ``` fences
const fenceRegex = /```([a-zA-Z0-9_+-]+)?\s*\n([\s\S]*?)\n```/g;

interface CodeBlockInfo {
  codeFrom: number;
  codeTo: number;
  lang: string | null;
  code: string;
}

function findCodeBlocks(content: string): CodeBlockInfo[] {
  const blocks: CodeBlockInfo[] = [];
  for (const m of content.matchAll(fenceRegex)) {
    const firstNewline = m.index! + m[0].indexOf("\n");
    const codeFrom = firstNewline + 1;
    const code = m[2];
    blocks.push({ codeFrom, codeTo: codeFrom + code.length, lang: m[1] || null, code });
  }
  return blocks;
}

async function buildDecorations(view: EditorView, shiki: Highlighter): Promise<DecorationSet> {
  const doc = view.state.doc.toString();
  const theme = getTheme() === "dark" ? "one-dark-pro" : "github-light";
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of findCodeBlocks(doc)) {
    const lang = await ensureLang(shiki, block.lang ?? "text");
    try {
      // token.offset is absolute from start of block.code (not per-line)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { tokens } = shiki.codeToTokens(block.code, { lang: lang as any, theme });
      for (const line of tokens) {
        for (const token of line) {
          const style = tokenToStyle(token.color, token.fontStyle ?? 0);
          if (style) {
            const from = block.codeFrom + token.offset;
            builder.add(from, from + token.content.length, Decoration.mark({ attributes: { style } }));
          }
        }
      }
    } catch {
      // skip block on error — unsupported lang or malformed code
    }
  }

  return builder.finish();
}

export const codeblockHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private view: EditorView;
    private pending = false;

    constructor(view: EditorView) {
      this.view = view;
      this.decorations = Decoration.none;
      this.schedule();
      onThemeChange(() => this.schedule());
    }

    update(update: ViewUpdate): void {
      this.view = update.view;
      if (update.docChanged) this.schedule();
    }

    private schedule(): void {
      if (this.pending) return;
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        const view = this.view;
        getShiki()
          .then((shiki) => buildDecorations(view, shiki))
          .then((deco) => {
            this.decorations = deco;
            view.dispatch({});
          })
          .catch(() => {});
      });
    }
  },
  { decorations: (v) => v.decorations }
);

export { findCodeBlocks };
