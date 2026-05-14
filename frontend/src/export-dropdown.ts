import { exportHtml, exportPdf } from "./export";

export interface ExportDropdownHandle {
  el: HTMLElement;
}

export function createExportDropdown(
  previewEl: HTMLElement,
  getTitle: () => string
): ExportDropdownHandle {
  const root = document.createElement("div");
  root.className = "export-dropdown";

  const btn = document.createElement("button");
  btn.className = "export-btn";
  btn.textContent = "Export ▾";
  btn.setAttribute("aria-label", "Export document");

  const menu = document.createElement("div");
  menu.className = "export-menu";
  menu.hidden = true;

  const htmlItem = document.createElement("button");
  htmlItem.textContent = "Export as HTML";
  htmlItem.addEventListener("click", () => {
    menu.hidden = true;
    void exportHtml(previewEl, getTitle());
  });

  const pdfItem = document.createElement("button");
  pdfItem.textContent = "Print / Save as PDF";
  pdfItem.addEventListener("click", () => {
    menu.hidden = true;
    void exportPdf();
  });

  menu.appendChild(htmlItem);
  menu.appendChild(pdfItem);
  root.appendChild(btn);
  root.appendChild(menu);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  document.addEventListener("mousedown", (e) => {
    if (!root.contains(e.target as Node)) {
      menu.hidden = true;
    }
  });

  return { el: root };
}
