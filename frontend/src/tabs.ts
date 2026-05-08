export interface TabEntry {
  absPath: string;
  isDirty: boolean;
  content: string;
  cursorPos: number;
  scrollTop: number;
  externallyModified: boolean;
}

export interface TabHandle {
  readonly entries: TabEntry[];
  readonly activeIdx: number;
  readonly active: TabEntry | null;
  addTab(absPath: string, content: string): void;
  closeTab(idx: number): boolean;
  forceCloseTab(idx: number): void;
  activateTab(idx: number): void;
  updateActive(patch: Partial<Pick<TabEntry, 'content' | 'isDirty' | 'cursorPos' | 'scrollTop' | 'externallyModified'>>): void;
  markExternallyModified(idx: number): void;
  clearAll(): void;
  onActiveChange(listener: (entry: TabEntry | null) => void): void;
  renderBar(container: HTMLElement): void;
  persist(): void;
  restore(): Array<{ absPath: string }>;
}

export function createTabHandle(onCloseClick: (idx: number) => void): TabHandle {
  const entries: TabEntry[] = [];
  let activeIdx = -1;
  const listeners: Array<(entry: TabEntry | null) => void> = [];

  function notify(): void {
    const e = activeIdx >= 0 ? entries[activeIdx] : null;
    for (const l of listeners) l(e);
  }

  function fileBasename(absPath: string): string {
    const sep = absPath.includes("\\") ? "\\" : "/";
    const i = absPath.lastIndexOf(sep);
    return i >= 0 ? absPath.slice(i + 1) : absPath;
  }

  function doPersist(): void {
    localStorage.setItem(
      'skymark:tabs',
      JSON.stringify({ paths: entries.map(e => e.absPath), activeIdx })
    );
  }

  return {
    get entries() { return entries; },
    get activeIdx() { return activeIdx; },
    get active() { return activeIdx >= 0 ? entries[activeIdx] : null; },

    addTab(absPath, content) {
      const existing = entries.findIndex(e => e.absPath === absPath);
      if (existing !== -1) { activeIdx = existing; notify(); return; }
      entries.push({ absPath, isDirty: false, content, cursorPos: 0, scrollTop: 0, externallyModified: false });
      activeIdx = entries.length - 1;
      notify();
    },

    closeTab(idx) {
      if (idx < 0 || idx >= entries.length) return false;
      if (entries[idx].isDirty) return false;
      entries.splice(idx, 1);
      if (entries.length === 0) {
        activeIdx = -1;
      } else if (activeIdx >= entries.length) {
        activeIdx = entries.length - 1;
      } else if (activeIdx > idx) {
        activeIdx--;
      }
      notify();
      doPersist();
      return true;
    },

    forceCloseTab(idx) {
      if (idx < 0 || idx >= entries.length) return;
      entries[idx].isDirty = false;
      this.closeTab(idx);
    },

    activateTab(idx) {
      if (idx < 0 || idx >= entries.length) return;
      activeIdx = idx;
      notify();
    },

    updateActive(patch) {
      if (activeIdx >= 0) Object.assign(entries[activeIdx], patch);
    },

    markExternallyModified(idx) {
      if (idx >= 0 && idx < entries.length) entries[idx].externallyModified = true;
    },

    clearAll() {
      entries.splice(0, entries.length);
      activeIdx = -1;
      notify();
      doPersist();
    },

    onActiveChange(listener) { listeners.push(listener); },

    renderBar(container) {
      container.replaceChildren();
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const btn = document.createElement("button");
        btn.classList.add("tab-item");
        if (i === activeIdx) btn.classList.add("active");
        if (entry.isDirty) btn.classList.add("dirty");
        if (entry.externallyModified) btn.classList.add("ext-modified");

        if (entry.isDirty) {
          const ds = document.createElement("span");
          ds.className = "tab-dirty";
          ds.textContent = "●";
          btn.appendChild(ds);
        }
        if (entry.externallyModified) {
          const es = document.createElement("span");
          es.className = "tab-ext-modified";
          es.textContent = "⊙";
          btn.appendChild(es);
        }

        const nameSpan = document.createElement("span");
        nameSpan.className = "tab-name";
        nameSpan.textContent = fileBasename(entry.absPath);
        btn.appendChild(nameSpan);

        const closeSpan = document.createElement("span");
        closeSpan.className = "tab-close";
        closeSpan.textContent = "×";
        const ci = i;
        closeSpan.addEventListener("click", (e) => { e.stopPropagation(); onCloseClick(ci); });
        btn.appendChild(closeSpan);

        container.appendChild(btn);
      }
    },

    persist() { doPersist(); },

    restore() {
      try {
        const raw = localStorage.getItem('skymark:tabs');
        if (!raw) return [];
        const parsed = JSON.parse(raw) as { paths: unknown };
        if (!Array.isArray(parsed.paths)) return [];
        return (parsed.paths as string[]).map(p => ({ absPath: p }));
      } catch {
        return [];
      }
    },
  };
}
