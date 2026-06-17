import { describe, it, expect } from "vitest";
import { formatJsonForPaste } from "./clipboard-json";

describe("formatJsonForPaste", () => {
  it("pretty-prints a flat object with 2-space indent", () => {
    expect(formatJsonForPaste('{"a":1,"b":2}')).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it("pretty-prints an array with 2-space indent", () => {
    expect(formatJsonForPaste("[1,2,3]")).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("pretty-prints nested objects and arrays", () => {
    const input = '{"a":{"b":[1,2]}}';
    const expected = '{\n  "a": {\n    "b": [\n      1,\n      2\n    ]\n  }\n}';
    expect(formatJsonForPaste(input)).toBe(expected);
  });

  it("returns null for a bare number", () => {
    expect(formatJsonForPaste("42")).toBeNull();
  });

  it("returns null for a bare string", () => {
    expect(formatJsonForPaste('"hello"')).toBeNull();
  });

  it("returns null for a bare boolean", () => {
    expect(formatJsonForPaste("true")).toBeNull();
  });

  it("returns null for bare null", () => {
    expect(formatJsonForPaste("null")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(formatJsonForPaste("{a: 1}")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(formatJsonForPaste("hello world")).toBeNull();
  });

  it("re-indents minified and already-pretty JSON to the same 2-space output", () => {
    const minified = '{"x":1,"y":{"z":2}}';
    const fourSpacePretty = '{\n    "x": 1,\n    "y": {\n        "z": 2\n    }\n}';
    expect(formatJsonForPaste(minified)).toBe(formatJsonForPaste(fourSpacePretty));
    expect(formatJsonForPaste(minified)).toBe('{\n  "x": 1,\n  "y": {\n    "z": 2\n  }\n}');
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(formatJsonForPaste('  {"a":1}  \n')).toBe('{\n  "a": 1\n}');
  });
});
