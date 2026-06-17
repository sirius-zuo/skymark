import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { findCodeBlocks, codeblockHighlight } from "./codeblock-highlight";
import { getShiki, ensureLang } from "./shiki-singleton";

vi.mock("./shiki-singleton", () => ({
  getShiki: vi.fn(),
  ensureLang: vi.fn(async (_shiki: unknown, lang: string) => lang),
  tokenToStyle: vi.fn(() => "color:red"),
}));

describe("findCodeBlocks", () => {
  it("returns empty for text with no code blocks", () => {
    const blocks = findCodeBlocks("Hello world\nNo fences here.");
    expect(blocks).toEqual([]);
  });

  it("finds a single code block with language tag", () => {
    const content = "# Title\n\n```javascript\nconst x = 1;\n```\n";
    const blocks = findCodeBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe("javascript");
    expect(blocks[0].code).toBe("const x = 1;");
    expect(blocks[0].codeFrom).toBeGreaterThan(0);
    expect(blocks[0].codeTo).toBe(blocks[0].codeFrom + blocks[0].code.length);
  });

  it("finds a code block without language tag", () => {
    const content = "```\nsome code\n```\n";
    const blocks = findCodeBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBeNull();
    expect(blocks[0].code).toBe("some code");
  });

  it("finds multiple code blocks", () => {
    const content = "```python\nprint('hi')\n```\n\n```rust\nfn main() {}\n```";
    const blocks = findCodeBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lang).toBe("python");
    expect(blocks[1].lang).toBe("rust");
  });

  it("handles code with newlines", () => {
    const content = "```js\nconst a = 1;\nconst b = 2;\n```";
    const blocks = findCodeBlocks(content);
    expect(blocks[0].code).toBe("const a = 1;\nconst b = 2;");
  });

  it("codeFrom points to first character of code, not the fence line", () => {
    const content = "```bash\ncargo test\n```";
    const blocks = findCodeBlocks(content);
    expect(blocks[0].codeFrom).toBe(8); // after "```bash\n"
    expect(content.slice(blocks[0].codeFrom, blocks[0].codeTo)).toBe("cargo test");
  });
});

// Regression: codeblockHighlight schedules an async Shiki tokenization on every
// doc change. buildDecorations() snapshots the document up front, then awaits
// ensureLang() per code block. The same EditorView is reused across tabs
// (content swapped via setValue), so if the document changes again (e.g. a
// tab switch) while that await is in flight, the eventually-resolved
// decorations are positioned for a document that no longer exists. Dispatching
// them maps stale, out-of-range positions through the new changeset and
// crashes CodeMirror's internal decoration diff (reported via console.error,
// not a synchronous throw) — so the fix must skip applying them entirely.
describe("codeblockHighlight async staleness", () => {
  it("does not dispatch decorations computed for a document that has since changed", async () => {
    const fakeHighlighter = {
      codeToTokens: () => ({
        tokens: [[{ offset: 0, content: "const x = 1;", color: "#fff", fontStyle: 0 }]],
      }),
    };
    vi.mocked(getShiki).mockResolvedValue(fakeHighlighter as never);

    let resolveEnsureLang!: (lang: string) => void;
    vi.mocked(ensureLang).mockImplementation(
      () => new Promise<string>((resolve) => { resolveEnsureLang = resolve; })
    );

    const longDoc = "```js\n" + "const x = 1;\n".repeat(50) + "```";
    const view = new EditorView({
      state: EditorState.create({ doc: longDoc, extensions: [codeblockHighlight] }),
    });

    // Let the scheduled rebuild run far enough to snapshot the long doc and
    // block on ensureLang() (mirrors Shiki loading a language grammar).
    for (let i = 0; i < 4; i++) await Promise.resolve();

    // Simulate a rapid tab switch while that rebuild is still in flight. This
    // also schedules its own (legitimate) rebuild for "short", which finds no
    // code blocks, completes without an async gap, and may overwrite
    // `decorations` again afterwards — masking the bug if we only inspect the
    // final state. So instead we watch every dispatch() call as it happens:
    // a dispatch made while decorations hold positions past the *current*
    // document length is exactly the moment CodeMirror's internal diff would
    // crash, even if a later, correct dispatch papers over it.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "short" } });

    const originalDispatch = view.dispatch.bind(view);
    let sawStaleDispatch = false;
    vi.spyOn(view, "dispatch").mockImplementation((...args) => {
      const docLenAtCallTime = view.state.doc.length;
      const cursor = view.plugin(codeblockHighlight)?.decorations.iter();
      while (cursor?.value) {
        if (cursor.to > docLenAtCallTime) sawStaleDispatch = true;
        cursor.next();
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalDispatch as any)(...args);
    });

    resolveEnsureLang("js");
    // Flush the rest of buildDecorations() and the apply-decorations .then().
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(sawStaleDispatch).toBe(false);
    expect(view.state.doc.toString()).toBe("short");
  });

  // Regression: even after a rebuild fully completes and `decorations` holds
  // positions that are genuinely valid for that (long) document, switching to
  // a much shorter document is itself a dispatch — and unless `decorations`
  // is remapped through *that* dispatch's own changes, CodeMirror's internal
  // decoration diff reads the still-long-document positions against the new,
  // short changeset and throws. This is independent of (and was not fixed
  // by) only guarding codeblockHighlight's own async resolution.
  it("does not crash when an unrelated dispatch follows a completed rebuild for a longer document", async () => {
    const fakeHighlighter = {
      codeToTokens: () => ({
        tokens: [[{ offset: 0, content: "const x = 1;", color: "#fff", fontStyle: 0 }]],
      }),
    };
    vi.mocked(getShiki).mockResolvedValue(fakeHighlighter as never);
    vi.mocked(ensureLang).mockImplementation(async (_shiki, lang) => lang);

    const longDoc = "```js\n" + "const x = 1;\n".repeat(200) + "```";
    const view = new EditorView({
      state: EditorState.create({ doc: longDoc, extensions: [codeblockHighlight] }),
    });

    // Let the initial rebuild fully resolve and apply against the long doc.
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const settledCursor = view.plugin(codeblockHighlight)?.decorations.iter();
    expect(settledCursor?.value).toBeTruthy(); // sanity: rebuild actually produced decorations

    // A later, unrelated dispatch — e.g. switchTab()'s editor.setValue() —
    // replaces the whole document with much shorter content.
    expect(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "short" } });
    }).not.toThrow();

    const docLength = view.state.doc.length;
    const cursor = view.plugin(codeblockHighlight)?.decorations.iter();
    while (cursor?.value) {
      expect(cursor.to).toBeLessThanOrEqual(docLength);
      cursor.next();
    }
  });
});
