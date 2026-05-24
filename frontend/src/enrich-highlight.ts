import { getTheme } from "./theme";
import { getShiki, ensureLang, tokenToStyle, shikiTheme } from "./shiki-singleton";

export async function enrichHighlight(
  container: HTMLElement,
  themeOverride?: "light" | "dark"
): Promise<void> {
  const els = Array.from(
    container.querySelectorAll<HTMLElement>('code[class*="language-"]:not(.language-mermaid)')
  );
  if (els.length === 0) return;

  const shiki = await getShiki();
  const theme = shikiTheme(themeOverride ?? getTheme());

  for (const el of els) {
    const langClass = Array.from(el.classList).find((c) => c.startsWith("language-"));
    const rawLang = langClass ? langClass.slice("language-".length) : "text";
    // textContent automatically unescapes HTML entities from the rendered markdown
    const code = (el.textContent ?? "").replace(/\n$/, "");
    const lang = await ensureLang(shiki, rawLang);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { tokens } = shiki.codeToTokens(code, { lang: lang as any, theme });
      const nodes: Node[] = [];
      tokens.forEach((line, lineIdx) => {
        for (const token of line) {
          const style = tokenToStyle(token.color, token.fontStyle ?? 0);
          if (style) {
            const span = document.createElement("span");
            span.setAttribute("style", style);
            span.textContent = token.content;
            nodes.push(span);
          } else {
            nodes.push(document.createTextNode(token.content));
          }
        }
        if (lineIdx < tokens.length - 1) {
          nodes.push(document.createTextNode("\n"));
        }
      });
      el.replaceChildren(...nodes);
    } catch {
      // leave element as-is on error
    }
  }
}
