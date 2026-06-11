import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "./clipboard-md";

describe("htmlToMarkdown", () => {
  it("converts h1, h2, h3 headings", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title");
    expect(htmlToMarkdown("<h2>Sub</h2>")).toBe("## Sub");
    expect(htmlToMarkdown("<h3>Subsub</h3>")).toBe("### Subsub");
  });

  it("converts bold and italic", () => {
    expect(htmlToMarkdown("<strong>bold</strong>")).toBe("**bold**");
    expect(htmlToMarkdown("<em>italic</em>")).toBe("_italic_");
  });

  it("converts hyperlinks", () => {
    expect(htmlToMarkdown('<a href="https://example.com">click here</a>')).toBe(
      "[click here](https://example.com)"
    );
  });

  it("converts unordered lists", () => {
    const md = htmlToMarkdown("<ul><li>alpha</li><li>beta</li></ul>");
    expect(md).toMatch(/-\s+alpha/);
    expect(md).toMatch(/-\s+beta/);
  });

  it("converts ordered lists", () => {
    const md = htmlToMarkdown("<ol><li>first</li><li>second</li></ol>");
    expect(md).toMatch(/1\.\s+first/);
    expect(md).toMatch(/2\.\s+second/);
  });

  it("converts inline code", () => {
    expect(htmlToMarkdown("<code>foo()</code>")).toBe("`foo()`");
  });

  it("converts fenced code blocks", () => {
    const md = htmlToMarkdown("<pre><code>const x = 1;</code></pre>");
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });

  it("converts GFM tables", () => {
    const html =
      "<table><thead><tr><th>A</th><th>B</th></tr></thead>" +
      "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("| A");
    expect(md).toContain("| 1");
  });

  it("converts strikethrough", () => {
    expect(htmlToMarkdown("<del>gone</del>")).toBe("~~gone~~");
  });

  it("trims leading and trailing whitespace from the result", () => {
    const md = htmlToMarkdown("<p>hello world</p>");
    expect(md).toBe("hello world");
    expect(md).not.toMatch(/^\s/);
    expect(md).not.toMatch(/\s$/);
  });
});
