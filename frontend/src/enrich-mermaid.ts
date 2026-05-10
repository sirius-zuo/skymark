import { getTheme } from "./theme";

let mermaidMod: typeof import("mermaid").default | null = null;
let mermaidInitTheme: string | null = null;
let counter = 0;

async function loadMermaid(theme: string): Promise<typeof import("mermaid").default> {
  const mod = (await import("mermaid")).default;
  if (mermaidMod === null || mermaidInitTheme !== theme) {
    mod.initialize({ startOnLoad: false, theme: theme === "dark" ? "dark" : "default" });
    mermaidInitTheme = theme;
  }
  mermaidMod = mod;
  return mod;
}

export async function enrichMermaid(container: HTMLElement): Promise<void> {
  const pres = Array.from(
    container.querySelectorAll<HTMLElement>("pre:has(code.language-mermaid)")
  );
  if (pres.length === 0) return;
  const theme = getTheme();
  let mermaid: typeof import("mermaid").default;
  try {
    mermaid = await loadMermaid(theme);
  } catch (err) {
    console.error("[skymark] mermaid load failed", err);
    return;
  }
  for (let i = 0; i < pres.length; i++) {
    const pre = pres[i];
    const code = pre.querySelector("code.language-mermaid");
    if (!code) continue;
    const source = code.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mermaid-${++counter}`, source);
      const wrapper = document.createElement("div");
      wrapper.className = "mermaid-diagram";
      // Safe: mermaid.render() returns trusted SVG generated server-side from diagram source
      wrapper.innerHTML = svg;
      pre.replaceWith(wrapper);
    } catch (err) {
      pre.classList.add("mermaid-error");
      const msg = document.createElement("p");
      msg.textContent = `Mermaid error: ${String(err)}`;
      pre.prepend(msg);
    }
  }
}
