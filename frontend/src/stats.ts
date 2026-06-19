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

export interface StatsBarHandle {
  update(doc: string, selection: { from: number; to: number }): void;
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const TOKEN_ESTIMATE_TOOLTIP =
  "Estimated at ~4 characters per token; actual token count varies by model.";

export function createStatsBar(el: HTMLElement): StatsBarHandle {
  return {
    update(doc, selection) {
      const hasSelection = selection.to > selection.from;
      const text = hasSelection ? doc.slice(selection.from, selection.to) : doc;
      const suffix = hasSelection ? " selected" : "";

      el.textContent = [
        `${pluralize(countWords(text), "word")}${suffix}`,
        `${pluralize(countCharacters(text), "character")}${suffix}`,
        `~${pluralize(estimateTokens(text), "token")}${suffix}`,
        `${pluralize(countLines(text), "line")}${suffix}`,
      ].join(" · ");
      el.title = TOKEN_ESTIMATE_TOOLTIP;
    },
  };
}

const STATS_VISIBLE_KEY = "skymark:stats-visible";

export function initStatsVisible(): void {
  const footer = document.getElementById("stats-footer");
  if (!footer) return;
  footer.hidden = localStorage.getItem(STATS_VISIBLE_KEY) === "false";
}

export function toggleStatsVisible(): void {
  const footer = document.getElementById("stats-footer");
  if (!footer) return;
  footer.hidden = !footer.hidden;
  localStorage.setItem(STATS_VISIBLE_KEY, footer.hidden ? "false" : "true");
}
