import katexCss from "katex/dist/katex.min.css?inline";

let katexModule: typeof import("katex").default | null = null;

async function loadKatex(): Promise<typeof import("katex").default> {
  if (katexModule) return katexModule;
  const mod = await import("katex");
  katexModule = mod.default;
  const style = document.createElement("style");
  style.textContent = katexCss;
  document.head.appendChild(style);
  return katexModule;
}

export async function enrichMath(container: HTMLElement): Promise<void> {
  const els = Array.from(
    container.querySelectorAll<HTMLElement>(".math-inline, .math-display")
  );
  if (els.length === 0) return;
  let katex: typeof import("katex").default;
  try {
    katex = await loadKatex();
  } catch (err) {
    console.error("[skymark] katex load failed", err);
    return;
  }
  for (const el of els) {
    const latex = el.textContent ?? "";
    try {
      // Safe: katex.renderToString produces trusted markup
      el.innerHTML = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: el.classList.contains("math-display"),
      });
    } catch {
      // leave raw LaTeX text visible on unexpected error
    }
  }
}
