import { describe, it, expect } from "vitest";
import { findCodeBlocks } from "./codeblock-highlight";

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
