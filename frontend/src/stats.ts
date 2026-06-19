export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function countCharacters(text: string): number {
  return text.length;
}

export function countLines(text: string): number {
  return text.split("\n").length;
}

export function estimateTokens(text: string): number {
  return Math.round(countCharacters(text) / 4);
}
