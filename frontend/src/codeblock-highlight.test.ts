import { describe, it, expect } from "vitest";
import { findCodeBlocks, highlightBlock } from "./codeblock-highlight";

// Mock hljs for tests
const mockHljs = {
  highlight: (code: string, opts: { language?: string; ignoreIllegals?: boolean }) => {
    if (code.length === 0) return { value: '', relevance: 0 };
    if (opts.language === 'nonexistent-lang-xyz') throw new Error('Unknown language');
    return { value: '<span class="hljs-keyword">const</span> x = 1;', relevance: 0 };
  },
  highlightAuto: (code: string) => {
    if (code.length === 0) return { value: '', secondBest: null, relevance: 0 };
    return { value: '<span class="hljs-keyword">code</span> text here', secondBest: null, relevance: 0 };
  },
} as unknown as typeof import("highlight.js").default;

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
});

describe("highlightBlock", () => {
  it("returns structured spans for known language", () => {
    const block = { codeFrom: 10, codeTo: 22, lang: "javascript", code: "const x = 1;" };
    const spans = highlightBlock(mockHljs, block);
    expect(spans).toBeInstanceOf(Array);
    // Should have at least one span with classes
    const keywordSpans = spans.filter((s: { classes: string[] }) => s.classes.includes("hljs-keyword"));
    expect(keywordSpans.length).toBeGreaterThan(0);
  });

  it("handles empty code gracefully", () => {
    const block = { codeFrom: 10, codeTo: 10, lang: "javascript", code: "" };
    const spans = highlightBlock(mockHljs, block);
    expect(spans).toEqual([]);
  });

  it("falls back gracefully for unknown language", () => {
    const block = { codeFrom: 10, codeTo: 20, lang: "nonexistent-lang-xyz", code: "foo bar" };
    const spans = highlightBlock(mockHljs, block);
    // Should not throw; returns empty array on catch
    expect(spans).toEqual([]);
  });
});
