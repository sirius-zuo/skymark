import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveLinkPath, wirePreviewLinks } from "./preview-links";

describe("resolveLinkPath", () => {
  it("joins a bare filename onto the base directory", () => {
    expect(resolveLinkPath("/docs", "notes.md")).toBe("/docs/notes.md");
  });

  it("resolves ./ prefixes", () => {
    expect(resolveLinkPath("/docs", "./sub/notes.md")).toBe("/docs/sub/notes.md");
  });

  it("resolves ../ segments", () => {
    expect(resolveLinkPath("/docs/guide", "../notes.md")).toBe("/docs/notes.md");
    expect(resolveLinkPath("/a/b/c", "../../x.md")).toBe("/a/x.md");
  });

  it("strips query and fragment", () => {
    expect(resolveLinkPath("/docs", "notes.md#section")).toBe("/docs/notes.md");
    expect(resolveLinkPath("/docs", "notes.md?x=1")).toBe("/docs/notes.md");
  });

  it("keeps absolute paths as-is", () => {
    expect(resolveLinkPath("/docs", "/other/notes.md")).toBe("/other/notes.md");
  });
});

describe("wirePreviewLinks", () => {
  let content: HTMLElement;
  let openFile: ReturnType<typeof vi.fn<(absPath: string) => void>>;
  let openExternal: ReturnType<typeof vi.fn<(url: string) => void>>;
  let baseDir: string | null;

  function clickLink(href: string): MouseEvent {
    const a = document.createElement("a");
    a.setAttribute("href", href);
    a.textContent = "link";
    const p = document.createElement("p");
    p.appendChild(a);
    content.appendChild(p);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    return ev;
  }

  beforeEach(() => {
    content = document.createElement("div");
    document.body.appendChild(content);
    openFile = vi.fn<(absPath: string) => void>();
    openExternal = vi.fn<(url: string) => void>();
    baseDir = "/docs";
    wirePreviewLinks(content, {
      getBaseDir: () => baseDir,
      openFile,
      openExternal,
    });
  });

  it("opens a relative .md link in the app, resolved against the base dir", () => {
    const ev = clickLink("./sub/notes.md");
    expect(ev.defaultPrevented).toBe(true);
    expect(openFile).toHaveBeenCalledWith("/docs/sub/notes.md");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens http(s) links externally", () => {
    const ev = clickLink("https://example.com/page");
    expect(ev.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/page");
    expect(openFile).not.toHaveBeenCalled();
  });

  it("leaves in-page #anchor links alone", () => {
    const ev = clickLink("#section");
    expect(ev.defaultPrevented).toBe(false);
    expect(openFile).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("does not open a relative link when there is no base dir (unsaved doc)", () => {
    baseDir = null;
    const ev = clickLink("notes.md");
    expect(ev.defaultPrevented).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
  });

  it("does not open relative links to non-markdown files", () => {
    const ev = clickLink("./archive.zip");
    expect(ev.defaultPrevented).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
  });

  it("ignores clicks on non-link content", () => {
    const p = document.createElement("p");
    p.textContent = "plain text";
    content.appendChild(p);
    p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(openFile).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
