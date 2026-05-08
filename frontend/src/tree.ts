import { VaultFile } from "./vault";

export interface TreeHandle {
  render(files: VaultFile[], activeAbsPath: string | null): void;
  setActive(absPath: string): void;
}

export function createTree(
  container: HTMLElement,
  onSelect: (file: VaultFile) => void
): TreeHandle {
  const collapsed = new Set<string>();
  let currentFiles: VaultFile[] = [];
  let currentActive: string | null = null;

  function rerender(): void {
    const rootFiles: VaultFile[] = [];
    const dirMap = new Map<string, VaultFile[]>();

    for (const f of currentFiles) {
      const slash = f.rel_path.indexOf("/");
      if (slash === -1) {
        rootFiles.push(f);
      } else {
        const dir = f.rel_path.slice(0, slash);
        if (!dirMap.has(dir)) dirMap.set(dir, []);
        dirMap.get(dir)!.push(f);
      }
    }

    const ul = document.createElement("ul");

    for (const f of rootFiles) {
      ul.appendChild(makeFileItem(f));
    }

    const sortedDirs = [...dirMap.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    for (const [dir, dirFiles] of sortedDirs) {
      const li = document.createElement("li");
      const toggle = document.createElement("span");
      toggle.className = "tree-dir-toggle";
      const isCollapsed = collapsed.has(dir);
      toggle.textContent = (isCollapsed ? "▶ " : "▼ ") + dir;
      toggle.addEventListener("click", () => {
        if (collapsed.has(dir)) collapsed.delete(dir);
        else collapsed.add(dir);
        rerender();
      });
      li.appendChild(toggle);

      if (!isCollapsed) {
        const subUl = document.createElement("ul");
        subUl.style.paddingLeft = "12px";
        for (const f of dirFiles) {
          subUl.appendChild(makeFileItem(f));
        }
        li.appendChild(subUl);
      }

      ul.appendChild(li);
    }

    container.replaceChildren(ul);
  }

  function makeFileItem(f: VaultFile): HTMLElement {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "tree-file" + (f.abs_path === currentActive ? " active" : "");
    span.textContent = f.name;
    span.title = f.rel_path;
    span.addEventListener("click", () => onSelect(f));
    li.appendChild(span);
    return li;
  }

  return {
    render(files, activeAbsPath) {
      currentFiles = files;
      currentActive = activeAbsPath;
      rerender();
    },
    setActive(absPath) {
      currentActive = absPath;
      rerender();
    },
  };
}
