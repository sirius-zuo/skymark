import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPreview } from "./preview";

function rectAt(top: number): DOMRect {
  return { x: 0, y: top, width: 100, height: 20, top, left: 0, bottom: top + 20, right: 100, toJSON: () => ({}) } as DOMRect;
}

describe("preview scrollToAnchor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const preview = createPreview(host);
    const scroller = host.querySelector<HTMLElement>(".preview-scroll")!;
    scroller.getBoundingClientRect = () => rectAt(0);
    return { preview, scroller, content: preview.getContentEl() };
  }

  function addHeading(content: HTMLElement, id: string, top: number): void {
    const h = document.createElement("h2");
    h.id = id;
    h.getBoundingClientRect = () => rectAt(top);
    content.appendChild(h);
  }

  it("scrolls the heading with the given id to the top of the pane", () => {
    const { preview, scroller, content } = setup();
    addHeading(content, "some-section", 500);
    preview.scrollToAnchor("some-section");
    vi.runOnlyPendingTimers();
    expect(scroller.scrollTop).toBe(500);
  });

  it("waits for the heading to appear after an async render", () => {
    const { preview, scroller, content } = setup();
    preview.scrollToAnchor("late-section");
    vi.advanceTimersByTime(150);
    expect(scroller.scrollTop).toBe(0);
    addHeading(content, "late-section", 300);
    vi.advanceTimersByTime(150);
    expect(scroller.scrollTop).toBe(300);
  });

  it("gives up after the deadline without scrolling", () => {
    const { preview, scroller, content } = setup();
    preview.scrollToAnchor("never");
    vi.advanceTimersByTime(3000);
    addHeading(content, "never", 400);
    vi.advanceTimersByTime(1000);
    expect(scroller.scrollTop).toBe(0);
  });
});

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
