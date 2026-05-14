import { save } from "@tauri-apps/plugin-dialog";
import { exportFile, printWindow } from "./api";
import { showToast } from "./toast";

export async function exportHtml(previewEl: HTMLElement, title: string): Promise<void> {
  const bodyHtml = previewEl.innerHTML;
  const html = buildHtml(title, bodyHtml);
  const path = await save({ filters: [{ name: "HTML", extensions: ["html"] }] });
  if (path === null) return;
  try {
    await exportFile(path, html);
    const filename = path.split(/[/\\]/).pop() ?? path;
    showToast(`Exported to ${filename}`);
  } catch (err) {
    showToast(`Export failed: ${String(err)}`);
  }
}

export async function exportPdf(): Promise<void> {
  await printWindow();
}

function buildHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeTitle(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11/styles/github.min.css" />
  <style>
    body { max-width: 800px; margin: 40px auto; padding: 0 24px; font-family: system-ui, sans-serif; line-height: 1.6; color: #1c1917; }
    pre { background: #f5f5f4; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
    code { font-family: ui-monospace, monospace; font-size: 0.9em; }
    blockquote { border-left: 4px solid #d6d3d1; margin: 0; padding-left: 16px; color: #78716c; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e7e5e4; padding: 8px 12px; text-align: left; }
    img { max-width: 100%; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeTitle(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
