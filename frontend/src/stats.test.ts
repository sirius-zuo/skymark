import { describe, it, expect } from "vitest";
import { countWords, countCharacters, countLines, estimateTokens } from "./stats";

describe("countWords", () => {
  it("counts words separated by whitespace", () => {
    expect(countWords("hello world")).toBe(2);
  });

  it("returns 0 for an empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("returns 0 for a whitespace-only string", () => {
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("collapses runs of whitespace between words", () => {
    expect(countWords("hello   world\nfoo")).toBe(3);
  });
});

describe("countCharacters", () => {
  it("counts all characters including whitespace", () => {
    expect(countCharacters("hello world")).toBe(11);
  });

  it("returns 0 for an empty string", () => {
    expect(countCharacters("")).toBe(0);
  });
});

describe("countLines", () => {
  it("returns 1 for a single-line string", () => {
    expect(countLines("hello")).toBe(1);
  });

  it("returns 1 for an empty string", () => {
    expect(countLines("")).toBe(1);
  });

  it("counts newline-separated lines", () => {
    expect(countLines("line one\nline two\nline three")).toBe(3);
  });
});

describe("estimateTokens", () => {
  it("estimates roughly characters / 4", () => {
    expect(estimateTokens("12345678")).toBe(2);
  });

  it("rounds to the nearest integer", () => {
    expect(estimateTokens("123456789")).toBe(2);   // 9 / 4 = 2.25 -> 2
    expect(estimateTokens("1234567890")).toBe(3);  // 10 / 4 = 2.5 -> 3
  });

  it("returns 0 for an empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
