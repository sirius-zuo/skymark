import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";

interface DirEntry {
  name: string;
  abs_path: string;
  is_dir: boolean;
  is_supported: boolean;
}

export interface DirTree {
  setRoot(rootDir: string, activeAbsPath: string | null): Promise<void>;
  setActive(absPath: string): void;
}

export function createDirTree(
  container: HTMLElement,
  onFileClick: (absPath: string) => void,
): DirTree {
  async function fetchEntries(path: string): Promise<DirEntry[]> {
    if (!isTauri()) return [];
    return invoke<DirEntry[]>("list_dir", { path });
  }

  function clearActive(): void {
    container.querySelectorAll<HTMLElement>(".tree-file.active")
      .forEach(el => el.classList.remove("active"));
  }

  function markActive(absPath: string): void {
    clearActive();
    container.querySelectorAll<HTMLElement>(".tree-file[data-path]").forEach(el => {
      if (el.dataset.path === absPath) el.classList.add("active");
    });
  }

  function renderEntries(
    parent: HTMLElement,
    entries: DirEntry[],
    depth: number,
  ): void {
    for (const entry of entries) {
      const item = document.createElement("div");
      item.dataset.path = entry.abs_path;
      item.style.paddingLeft = `${depth * 16 + 8}px`;

      if (entry.is_dir) {
        item.className = "tree-dir-toggle";
        item.textContent = "▶ " + entry.name;

        let expanded = false;
        let childContainer: HTMLElement | null = null;

        item.addEventListener("click", async () => {
          if (!expanded) {
            expanded = true;
            item.textContent = "▼ " + entry.name;
            childContainer = document.createElement("div");
            item.after(childContainer);
            const children = await fetchEntries(entry.abs_path);
            renderEntries(childContainer, children, depth + 1);
          } else {
            expanded = false;
            item.textContent = "▶ " + entry.name;
            childContainer?.remove();
            childContainer = null;
          }
        });
      } else {
        item.className = "tree-file";
        if (!entry.is_supported) item.classList.add("tree-file--unsupported");
        item.textContent = entry.name;
        if (entry.is_supported) {
          item.addEventListener("click", () => onFileClick(entry.abs_path));
        }
      }

      parent.appendChild(item);
    }
  }

  return {
    async setRoot(rootDir: string, activeAbsPath: string | null) {
      container.textContent = "";
      try {
        const entries = await fetchEntries(rootDir);
        renderEntries(container, entries, 0);
      } catch {
        // Directory may have been deleted; leave container empty.
      }
      if (activeAbsPath) markActive(activeAbsPath);
    },

    setActive(absPath: string) {
      markActive(absPath);
    },
  };
}
