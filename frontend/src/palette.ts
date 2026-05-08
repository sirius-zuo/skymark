import { VaultFile } from "./vault";

export interface PaletteHandle {
  show(files: VaultFile[], onSelect: (file: VaultFile) => void): void;
  hide(): void;
}

export function createPalette(overlayEl: HTMLElement): PaletteHandle {
  let currentOnSelect: ((file: VaultFile) => void) | null = null;
  let allFiles: VaultFile[] = [];
  let filteredFiles: VaultFile[] = [];
  let selectedIdx = 0;

  const card = document.createElement("div");
  card.className = "palette-card";

  const input = document.createElement("input");
  input.className = "palette-input";
  input.type = "text";
  input.placeholder = "Go to file…";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");

  const resultsList = document.createElement("div");
  resultsList.className = "palette-results";

  card.appendChild(input);
  card.appendChild(resultsList);
  overlayEl.appendChild(card);

  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) hide();
  });

  function renderResults(files: VaultFile[]): void {
    filteredFiles = files;
    selectedIdx = 0;
    resultsList.replaceChildren();
    for (let i = 0; i < files.length; i++) {
      const item = document.createElement("div");
      item.classList.add("palette-item");
      if (i === 0) item.classList.add("selected");

      const nameSpan = document.createElement("span");
      nameSpan.className = "palette-item-name";
      nameSpan.textContent = files[i].name;

      const pathSpan = document.createElement("span");
      pathSpan.className = "palette-item-path";
      pathSpan.textContent = files[i].rel_path;

      item.appendChild(nameSpan);
      item.appendChild(pathSpan);

      const idx = i;
      item.addEventListener("click", () => {
        if (currentOnSelect) currentOnSelect(files[idx]);
        hide();
      });
      resultsList.appendChild(item);
    }
  }

  function updateSelected(newIdx: number): void {
    const items = resultsList.querySelectorAll<HTMLElement>(".palette-item");
    items[selectedIdx]?.classList.remove("selected");
    selectedIdx = Math.max(0, Math.min(newIdx, filteredFiles.length - 1));
    items[selectedIdx]?.classList.add("selected");
    items[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    const filtered = q
      ? allFiles.filter(f => subsequenceMatch(f.rel_path.toLowerCase(), q)).slice(0, 50)
      : allFiles.slice(0, 50);
    renderResults(filtered);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      updateSelected(selectedIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      updateSelected(selectedIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredFiles[selectedIdx] && currentOnSelect) {
        currentOnSelect(filteredFiles[selectedIdx]);
        hide();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  });

  function hide(): void {
    overlayEl.classList.remove("visible");
    input.value = "";
    resultsList.replaceChildren();
    currentOnSelect = null;
  }

  return {
    show(files, onSelect) {
      currentOnSelect = onSelect;
      allFiles = files;
      overlayEl.classList.add("visible");
      input.value = "";
      renderResults(files.slice(0, 50));
      input.focus();
    },
    hide,
  };
}

function subsequenceMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}
