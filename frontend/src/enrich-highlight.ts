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
    container.querySelectorAll<HTMLElement>('code[class^="language-"]')
  );
  if (els.length === 0) return;
  const hljs = await loadHljs();
  ensureThemeCss(getTheme());
  for (const el of els) {
    hljs.highlightElement(el);
  }
}
