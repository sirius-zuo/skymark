import { VaultNode } from "./vault";

export interface TreeHandle {
  render(nodes: VaultNode[], activeAbsPath: string | null): void;
  setActive(absPath: string): void;
  onLazyLoad(callback: (absPath: string) => void): void;
}

export function createTree(
  container: HTMLElement,
  onSelect: (file: VaultNode) => void,
  getBrokenFiles?: () => Set<string>,
): TreeHandle {
  const collapsed = new Map<string, boolean>();
  let currentNodes: VaultNode[] = [];
  let currentActive: string | null = null;
  let lazyLoadCallback: ((absPath: string) => void) | null = null;

  function rerender(): void {
    const ul = document.createElement("ul");
    for (const node of currentNodes) {
      ul.appendChild(renderNode(node, 0));
    }
    container.replaceChildren(ul);
  }

  function renderNode(node: VaultNode, depth: number): HTMLElement {
    const li = document.createElement("li");

    if (node.type === "file") {
      const span = document.createElement("span");
      span.classList.add("tree-file");
      if (node.abs_path === currentActive) span.classList.add("active");
      span.textContent = node.name;
      span.title = node.abs_path;
      span.addEventListener("click", () => onSelect(node));
      li.appendChild(span);

      if (getBrokenFiles && getBrokenFiles().has(node.abs_path)) {
        const badge = document.createElement("span");
        badge.className = "tree-badge-broken";
        badge.title = "Contains broken links";
        badge.textContent = "⚠";
        li.appendChild(badge);
      }
    } else {
      // Directory node
      const toggle = document.createElement("span");
      toggle.className = "tree-dir-toggle";
      const isCollapsed = collapsed.get(node.abs_path) ?? false;
      toggle.textContent = (isCollapsed ? "▶ " : "▼ ") + node.name;
      toggle.addEventListener("click", () => {
        collapsed.set(node.abs_path, !isCollapsed);
        rerender();
      });
      li.appendChild(toggle);

      const subUl = document.createElement("ul");
      subUl.style.paddingLeft = "12px";

      if (!isCollapsed) {
        if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            subUl.appendChild(renderNode(child, depth + 1));
          }
        } else if (depth >= 2) {
          // Lazy-load directory at depth 2+
          toggle.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (lazyLoadCallback) {
              lazyLoadCallback(node.abs_path);
            }
          });
          const hint = document.createElement("span");
          hint.className = "tree-lazy-hint";
          hint.textContent = " (double-click to load)";
          hint.style.color = "var(--color-text-muted)";
          hint.style.fontSize = "0.85em";
          li.appendChild(hint);
        }
      }
      li.appendChild(subUl);
    }

    return li;
  }

  return {
    render(nodes, activeAbsPath) {
      currentNodes = nodes;
      currentActive = activeAbsPath;
      rerender();
    },
    setActive(absPath) {
      currentActive = absPath;
      rerender();
    },
    onLazyLoad(callback) {
      lazyLoadCallback = callback;
    },
  };
}
