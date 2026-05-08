import { VaultFile } from "./vault";
import { HeadingEntry } from "./headings";

export interface PaletteHandle {
  show(
    files: VaultFile[],
    onSelect: (file: VaultFile) => void,
    headings?: HeadingEntry[],
    onSelectHeading?: (heading: HeadingEntry) => void,
  ): void;
  hide(): void;
}

type NavItem =
  | { type: 'file'; file: VaultFile }
  | { type: 'heading'; heading: HeadingEntry };

export function createPalette(overlayEl: HTMLElement): PaletteHandle {
  let currentOnSelect: ((file: VaultFile) => void) | null = null;
  let currentOnSelectHeading: ((h: HeadingEntry) => void) | null = null;
  let allFiles: VaultFile[] = [];
  let allHeadings: HeadingEntry[] = [];
  let navItems: NavItem[] = [];
  let selectedIdx = 0;

  const card = document.createElement("div");
  card.className = "palette-card";

  const input = document.createElement("input");
  input.className = "palette-input";
  input.type = "text";
  input.placeholder = "Go to file… (# for headings)";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");

  const resultsList = document.createElement("div");
  resultsList.className = "palette-results";

  card.appendChild(input);
  card.appendChild(resultsList);
  overlayEl.appendChild(card);

  overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) hide(); });

  function subseq(text: string, query: string): boolean {
    let qi = 0;
    for (let i = 0; i < text.length && qi < query.length; i++) {
      if (text[i] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  function renderResults(files: VaultFile[], headings: HeadingEntry[]): void {
    navItems = [];
    resultsList.replaceChildren();

    for (const f of files) {
      navItems.push({ type: 'file', file: f });
      const item = document.createElement("div");
      item.classList.add("palette-item");
      const nameSpan = document.createElement("span");
      nameSpan.className = "palette-item-name";
      nameSpan.textContent = f.name;
      const pathSpan = document.createElement("span");
      pathSpan.className = "palette-item-path";
      pathSpan.textContent = f.rel_path;
      item.appendChild(nameSpan);
      item.appendChild(pathSpan);
      const capturedFile = f;
      item.addEventListener("click", () => { if (currentOnSelect) currentOnSelect(capturedFile); hide(); });
      resultsList.appendChild(item);
    }

    if (headings.length > 0) {
      const divider = document.createElement("div");
      divider.className = "palette-divider";
      divider.textContent = "Headings";
      resultsList.appendChild(divider);

      for (const h of headings) {
        navItems.push({ type: 'heading', heading: h });
        const item = document.createElement("div");
        item.classList.add("palette-item");
        const levelSpan = document.createElement("span");
        levelSpan.className = "palette-item-level";
        levelSpan.textContent = `H${h.level}`;
        const nameSpan = document.createElement("span");
        nameSpan.className = "palette-item-name";
        nameSpan.textContent = h.text;
        const pathSpan = document.createElement("span");
        pathSpan.className = "palette-item-path";
        pathSpan.textContent = h.fileName;
        item.appendChild(levelSpan);
        item.appendChild(nameSpan);
        item.appendChild(pathSpan);
        const capturedH = h;
        item.addEventListener("click", () => { if (currentOnSelectHeading) currentOnSelectHeading(capturedH); hide(); });
        resultsList.appendChild(item);
      }
    }

    selectedIdx = 0;
    resultsList.querySelectorAll<HTMLElement>(".palette-item")[0]?.classList.add("selected");
  }

  function updateSelected(newIdx: number): void {
    const items = resultsList.querySelectorAll<HTMLElement>(".palette-item");
    items[selectedIdx]?.classList.remove("selected");
    selectedIdx = Math.max(0, Math.min(newIdx, navItems.length - 1));
    items[selectedIdx]?.classList.add("selected");
    items[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }

  function refresh(): void {
    const raw = input.value;
    if (raw.startsWith("#")) {
      const q = raw.slice(1).trim().toLowerCase();
      const matched = q
        ? allHeadings.filter(h => subseq(h.text.toLowerCase(), q)).slice(0, 50)
        : allHeadings.slice(0, 50);
      renderResults([], matched);
    } else {
      const q = raw.toLowerCase();
      const ff = q ? allFiles.filter(f => subseq(f.rel_path.toLowerCase(), q)).slice(0, 50) : allFiles.slice(0, 50);
      const hh = q ? allHeadings.filter(h => subseq(h.text.toLowerCase(), q)).slice(0, 10) : allHeadings.slice(0, 10);
      renderResults(ff, hh);
    }
  }

  input.addEventListener("input", refresh);

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); updateSelected(selectedIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); updateSelected(selectedIdx - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const nav = navItems[selectedIdx];
      if (!nav) return;
      if (nav.type === 'file' && currentOnSelect) currentOnSelect(nav.file);
      else if (nav.type === 'heading' && currentOnSelectHeading) currentOnSelectHeading(nav.heading);
      hide();
    } else if (e.key === "Escape") { e.preventDefault(); hide(); }
  });

  function hide(): void {
    overlayEl.classList.remove("visible");
    input.value = "";
    resultsList.replaceChildren();
    navItems = [];
    currentOnSelect = null;
    currentOnSelectHeading = null;
  }

  return {
    show(files, onSelect, headings, onSelectHeading) {
      currentOnSelect = onSelect;
      currentOnSelectHeading = onSelectHeading ?? null;
      allFiles = files;
      allHeadings = headings ?? [];
      overlayEl.classList.add("visible");
      input.value = "";
      renderResults(files.slice(0, 50), allHeadings.slice(0, 10));
      input.focus();
    },
    hide,
  };
}
