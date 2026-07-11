import { describe, it, expect, beforeEach } from "vitest";
import { createPreview } from "./preview";

describe("preview select-all", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  it("makes the scroller focusable so clicks in the preview move focus into it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    createPreview(host);
    const scroller = host.querySelector<HTMLElement>(".preview-scroll")!;
    expect(scroller.getAttribute("tabindex")).toBe("-1");
  });

  it("scopes mod+A to the preview content instead of the whole document", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const outside = document.createElement("p");
    outside.textContent = "outside the preview";
    document.body.appendChild(outside);

    const preview = createPreview(host);
    const content = preview.getContentEl();
    const para = document.createElement("p");
    para.textContent = "hello preview";
    content.appendChild(para);

    const scroller = host.querySelector<HTMLElement>(".preview-scroll")!;
    const ev = new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    scroller.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    const sel = window.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    const range = sel.getRangeAt(0);
    expect(range.toString()).toContain("hello preview");
    expect(range.toString()).not.toContain("outside the preview");
  });
});
