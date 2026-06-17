export function formatJsonForPaste(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  return JSON.stringify(parsed, null, 2);
}
