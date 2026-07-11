/**
 * Click handling for links inside the preview pane.
 *
 * The webview's default navigation is blocked in Tauri, so anchors in the
 * rendered markdown are inert unless we translate them into app actions:
 * relative markdown links open in the app, http(s) links open externally,
 * and in-page #anchor links keep the default behavior.
 */

const MD_EXTENSIONS = /\.(md|markdown|mdown)$/i;

/**
 * Resolve a relative link target against the directory of the current file.
 * Strips any query/fragment and normalizes ./ and ../ segments.
 */
export function resolveLinkPath(baseDir: string, href: string): string {
  const path = href.replace(/[?#].*$/, "");
  const joined = path.startsWith("/") ? path : `${baseDir}/${path}`;
  const out: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return "/" + out.join("/");
}

export interface PreviewLinkActions {
  /** Directory of the active document, or null for an unsaved document. */
  getBaseDir(): string | null;
  /** Open a markdown file inside the app (same flow as a sidebar click). */
  openFile(absPath: string, fragment?: string): void;
  /** Open an external URL in the system browser. */
  openExternal(url: string): void;
}

export function wirePreviewLinks(content: HTMLElement, actions: PreviewLinkActions): void {
  content.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest("a[href]");
    if (!anchor || !content.contains(anchor)) return;
    const href = anchor.getAttribute("href") ?? "";

    // In-page anchors (#heading) keep the webview's default behavior.
    if (href.startsWith("#")) return;

    // Everything else would trigger a page navigation the app blocks — take over.
    e.preventDefault();

    if (/^https?:/i.test(href)) {
      actions.openExternal(href);
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // other schemes (mailto:, file:, …)

    const pathPart = href.replace(/[?#].*$/, "");
    if (!MD_EXTENSIONS.test(pathPart)) return;
    const hashIdx = href.indexOf("#");
    let fragment: string | undefined;
    if (hashIdx !== -1 && hashIdx < href.length - 1) {
      const raw = href.slice(hashIdx + 1);
      try {
        fragment = decodeURIComponent(raw);
      } catch {
        fragment = raw;
      }
    }
    const baseDir = actions.getBaseDir();
    if (pathPart.startsWith("/")) {
      actions.openFile(resolveLinkPath("/", pathPart), fragment);
    } else if (baseDir) {
      actions.openFile(resolveLinkPath(baseDir, pathPart), fragment);
    }
  });
}
