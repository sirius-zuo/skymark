import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { NodeProp } from "@lezer/common";
import { describe, it, expect } from "vitest";
import { detectFrontmatterSpan, markdownWithFrontmatter } from "./frontmatter-lang";

describe("detectFrontmatterSpan", () => {
  it("finds the span from the start of the document through the closing fence", () => {
    const doc = "---\nname: skill\n---\n\n# Heading\n";
    const span = detectFrontmatterSpan(doc);
    expect(span).not.toBeNull();
    expect(doc.slice(span!.from, span!.to)).toBe("---\nname: skill\n---");
  });

  it("returns null when --- is not the first line", () => {
    expect(detectFrontmatterSpan("# Heading\n\n---\nnot frontmatter\n---\n")).toBeNull();
  });

  it("returns null when there is no closing fence", () => {
    expect(detectFrontmatterSpan("---\nname: skill\n\n# Heading\n")).toBeNull();
  });

  it("accepts ... as a closing fence", () => {
    const doc = "---\nname: skill\n...\nbody\n";
    const span = detectFrontmatterSpan(doc);
    expect(span).not.toBeNull();
    expect(doc.slice(span!.from, span!.to)).toBe("---\nname: skill\n...");
  });

  it("handles an empty frontmatter body", () => {
    const doc = "---\n---\n\nbody\n";
    const span = detectFrontmatterSpan(doc);
    expect(span).not.toBeNull();
    expect(doc.slice(span!.from, span!.to)).toBe("---\n---");
  });
});

function mountedOverlay(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdownWithFrontmatter()] });
  return syntaxTree(state).topNode.tree?.prop(NodeProp.mounted);
}

describe("markdownWithFrontmatter", () => {
  it("mounts a YAML overlay over the detected frontmatter span", () => {
    const doc = "---\nname: skill\n---\n\n# Heading\n";
    const mounted = mountedOverlay(doc);
    expect(mounted).toBeDefined();
    expect(mounted?.overlay?.[0].from).toBe(0);
    expect(mounted?.overlay?.[0].to).toBe(19);
  });

  it("does not mount an overlay when there's no closing fence", () => {
    expect(mountedOverlay("---\nJust text, no closing fence\nmore text below\n")).toBeUndefined();
  });

  it("does not mount an overlay when --- is not the first line", () => {
    expect(mountedOverlay("# Heading\n\n---\nnot frontmatter\n---\n")).toBeUndefined();
  });

  it("still parses the body as markdown after the frontmatter block", () => {
    const doc = "---\nname: skill\n---\n\n# Heading\n";
    const state = EditorState.create({ doc, extensions: [markdownWithFrontmatter()] });
    const headingPos = doc.indexOf("# Heading") + 2;
    const node = syntaxTree(state).resolve(headingPos, 1);
    expect(node.name).toBe("ATXHeading1");
  });
});
