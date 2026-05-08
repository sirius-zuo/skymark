/** Mirrors skymark-core::smart_edit. Keep in sync when the WASM path is added. */

export type ContinueAction =
  | { type: "continue"; prefix: string }
  | { type: "cancel"; removeChars: number };

/**
 * Given the text of the current editor line, returns how Enter should behave.
 * Returns null when the line is not a list item or blockquote.
 */
export function continueList(line: string): ContinueAction | null {
  const indentMatch = line.match(/^([ \t]*)/);
  const indent = indentMatch ? indentMatch[1] : "";
  const rest = line.slice(indent.length);

  // Unordered bullets: -, *, +
  for (const bullet of ["-", "*", "+"]) {
    if (rest.startsWith(bullet + " ")) {
      const after = rest.slice(bullet.length + 1);
      const content = after.trimEnd();
      if (content === "") {
        return { type: "cancel", removeChars: indent.length + bullet.length + 1 };
      }
      const isTask =
        after.startsWith("[ ] ") ||
        after.startsWith("[x] ") ||
        after.startsWith("[X] ");
      const prefix = isTask ? `${indent}${bullet} [ ] ` : `${indent}${bullet} `;
      return { type: "continue", prefix };
    }
  }

  // Ordered list: one-or-more digits followed by ". "
  const olMatch = rest.match(/^(\d+)\. (.*)/);
  if (olMatch) {
    const n = parseInt(olMatch[1], 10);
    const content = olMatch[2].trimEnd();
    if (content === "") {
      return { type: "cancel", removeChars: indent.length + olMatch[1].length + 2 };
    }
    return { type: "continue", prefix: `${indent}${n + 1}. ` };
  }

  // Blockquote: "> "
  if (rest.startsWith("> ")) {
    const content = rest.slice(2).trimEnd();
    if (content === "") {
      return { type: "cancel", removeChars: indent.length + 2 };
    }
    return { type: "continue", prefix: `${indent}> ` };
  }

  return null;
}

/** Returns true if `s` begins with a URL scheme (http, https, ftp, mailto). */
export function isUrl(s: string): boolean {
  return /^(https?|ftp):\/\//.test(s) || s.startsWith("mailto:");
}
