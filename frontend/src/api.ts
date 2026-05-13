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

export interface DraftInfo {
  draft_key: string;
  original_path: string | null;
  saved_at_unix: number;
  needs_resolution: boolean;
}

export async function saveDraft(path: string | null, content: string): Promise<string> {
  return await invoke<string>("save_draft", { path, content });
}

export async function loadDraft(draftKey: string): Promise<string> {
  return await invoke<string>("load_draft", { draftKey });
}

export async function listDrafts(): Promise<DraftInfo[]> {
  return await invoke<DraftInfo[]>("list_drafts");
}

export async function discardDraft(draftKey: string): Promise<void> {
  await invoke<void>("discard_draft", { draftKey });
}

export async function exportFile(path: string, content: string): Promise<void> {
  await invoke<void>("export_file", { path, content });
}

export async function printWindow(html: string): Promise<void> {
  // Use a hidden iframe so the print captures the full rendered document,
  // not just the webview viewport (which is what plugin:webview|print does).
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;width:0;height:0;border:0;overflow:hidden;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title>
<style>
  body { font-family: sans-serif; max-width: 100%; margin: 0 auto; padding: 0; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.8em; margin: 0.8em 0; }
  h2 { font-size: 1.4em; margin: 0.7em 0; }
  h3 { font-size: 1.2em; margin: 0.6em 0; }
  h4,h5,h6 { margin: 0.5em 0; }
  a { color: #0366d6; }
  code { font-family: monospace; font-size: 0.88em; background: #f5f5f5; padding: 2px 5px; border-radius: 3px; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: monospace; background: #f5f5f5; padding: 1rem; border-radius: 4px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ddd; margin: 0; padding-left: 1rem; color: #666; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background: #f5f5f5; }
  img { max-width: 100%; height: auto; }
  ul, ol { padding-left: 1.5em; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
  .preview-content { max-width: none; padding: 2rem; }
  @media print {
    iframe { width: auto !important; height: auto !important; position: static !important; overflow: visible !important; }
    body { width: 100%; max-width: none; }
  }
</style>`);
  doc.write(`</head><body>${html}</body></html>`);
  doc.close();
  // Wait for images and mermaid diagrams to render
  await new Promise((resolve) => {
    const check = () => {
      const imgs = Array.from(doc!.images);
      const loaded = imgs.filter((i) => i.complete && (i.naturalWidth > 0 || i.naturalHeight === 0));
      if (loaded.length === imgs.length) {
        // Also wait for mermaid diagrams
        const svg = doc!.querySelectorAll("svg");
        if (svg.length > 0) {
          setTimeout(resolve, 300);
        } else {
          resolve(true);
        }
      } else {
        setTimeout(check, 100);
      }
    };
    setTimeout(resolve, 1000); // safety timeout
    check();
  });
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  // Remove iframe after a short delay to let the print dialog open
  setTimeout(() => iframe.remove(), 500);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
