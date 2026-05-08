import { invoke } from "@tauri-apps/api/core";

export interface OpenedFile {
  path: string;
  content: string;
}

export function isTauri(): boolean {
  // @ts-expect-error window.__TAURI_INTERNALS__ is injected by Tauri at runtime
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function renderMarkdown(text: string): Promise<string> {
  if (!isTauri()) {
    // Browser-only dev fallback: return the raw text wrapped in a <pre> so the
    // preview pane is at least visible without the Tauri backend running.
    return `<pre>${escapeHtml(text)}</pre>`;
  }
  return await invoke<string>("render", { text });
}

export async function openFile(path: string): Promise<OpenedFile> {
  return await invoke<OpenedFile>("open_file", { path });
}

export async function saveFile(path: string, content: string): Promise<void> {
  await invoke<void>("save_file", { path, content });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
