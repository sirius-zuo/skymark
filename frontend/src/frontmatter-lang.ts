import type { Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { parseMixed, type Input, type NestedParse, type SyntaxNodeRef } from "@lezer/common";

export interface Span {
  from: number;
  to: number;
}

/**
 * Detects a leading YAML frontmatter block per GitHub's rule: the
 * document's first line is exactly `---`, and some later line is exactly
 * `---` or `...`. Returns the byte range from the start of the document
 * through the end of the closing fence line (both fence lines included),
 * or null if no such block exists.
 *
 * Mirrors the detection rule in `frontmatter_span`
 * (crates/skymark-core/src/render.rs) — kept as an independent
 * implementation since the two run in different languages.
 */
export function detectFrontmatterSpan(text: string): Span | null {
  const lines = text.split("\n");
  const first = lines[0]?.replace(/\r$/, "") ?? "";
  if (first !== "---") return null;

  let offset = (lines[0]?.length ?? 0) + 1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/\r$/, "");
    if (trimmed === "---" || trimmed === "...") {
      return { from: 0, to: offset + line.length };
    }
    offset += line.length + 1;
  }
  return null;
}

const frontmatterOverlay = {
  wrap: parseMixed((node: SyntaxNodeRef, input: Input): NestedParse | null => {
    if (node.type.name !== "Document" || node.from !== 0) return null;
    const span = detectFrontmatterSpan(input.read(0, input.length));
    if (!span) return null;
    return { parser: yamlLanguage.parser, overlay: [span] };
  }),
};

/** Markdown language support with YAML frontmatter highlighted as an overlay. */
export function markdownWithFrontmatter(): Extension {
  return markdown({ extensions: frontmatterOverlay });
}
