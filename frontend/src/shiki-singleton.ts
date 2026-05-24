// Shared Shiki highlighter instance used by both the editor plugin and preview enricher.

type Highlighter = Awaited<ReturnType<typeof import("shiki").createHighlighter>>;
export type { Highlighter };

const loadedLangs = new Set<string>(["text"]);
let shikiCache: Highlighter | null = null;
let shikiLoading: Promise<Highlighter> | null = null;

export function getShiki(): Promise<Highlighter> {
  if (shikiCache) return Promise.resolve(shikiCache);
  if (!shikiLoading) {
    shikiLoading = import("shiki")
      .then((m) => m.createHighlighter({ themes: ["one-dark-pro", "github-light"], langs: [] }))
      .then((h) => { shikiCache = h; return h; });
  }
  return shikiLoading;
}

/** Load a language if not already loaded. Returns the name to use ("text" as fallback). */
export async function ensureLang(shiki: Highlighter, lang: string): Promise<string> {
  if (loadedLangs.has(lang)) return lang;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await shiki.loadLanguage(lang as any);
    loadedLangs.add(lang);
    return lang;
  } catch {
    return "text";
  }
}

export function tokenToStyle(color: string | undefined, fontStyle: number): string {
  const parts: string[] = [];
  if (color) parts.push(`color:${color}`);
  if (fontStyle & 1) parts.push("font-style:italic");
  if (fontStyle & 2) parts.push("font-weight:bold");
  return parts.join(";");
}

export function shikiTheme(mode: "light" | "dark"): string {
  return mode === "dark" ? "one-dark-pro" : "github-light";
}
