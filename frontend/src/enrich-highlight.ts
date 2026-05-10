import { getTheme } from "./theme";
import lightCss from "highlight.js/styles/github.css?inline";
import darkCss from "highlight.js/styles/github-dark.css?inline";

let hljsModule: typeof import("highlight.js").default | null = null;
let styleEl: HTMLStyleElement | null = null;
let injectedTheme: string | null = null;

async function loadHljs(): Promise<typeof import("highlight.js").default> {
  if (!hljsModule) {
    hljsModule = (await import("highlight.js")).default;
  }
  return hljsModule;
}

function ensureThemeCss(theme: string): void {
  if (injectedTheme === theme) return;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "hljs-theme";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = theme === "dark" ? darkCss : lightCss;
  injectedTheme = theme;
}

export async function enrichHighlight(container: HTMLElement): Promise<void> {
  const els = Array.from(
    container.querySelectorAll<HTMLElement>('code[class^="language-"]:not(.language-mermaid)')
  );
  if (els.length === 0) return;
  let hljs: typeof import("highlight.js").default;
  try {
    hljs = await loadHljs();
  } catch (err) {
    console.error("[skymark] highlight.js load failed", err);
    return;
  }
  ensureThemeCss(getTheme());
  for (const el of els) {
    hljs.highlightElement(el);
  }
}
