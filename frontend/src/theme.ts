type Theme = "light" | "dark";
type ThemeCallback = (t: Theme) => void;

const callbacks: ThemeCallback[] = [];

export function initTheme(): void {
  const saved = localStorage.getItem("skymark:theme") as Theme | null;
  const theme: Theme =
    saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  syncButton();
}

export function toggleTheme(): void {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("skymark:theme", next);
  syncButton();
  for (const cb of callbacks) cb(next);
}

export function getTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme | undefined) ?? "light";
}

export function onThemeChange(cb: ThemeCallback): void {
  callbacks.push(cb);
}

function syncButton(): void {
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = getTheme() === "dark" ? "☀" : "🌙";
}
