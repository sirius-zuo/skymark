import { saveDraft, loadDraft, listDrafts, discardDraft, isTauri, DraftInfo } from "./api";

const AUTOSAVE_INTERVAL_MS = 10_000;
const IDLE_DEBOUNCE_MS = 1_000;

export type { DraftInfo };

export interface DraftHandle {
  onDocChange(path: string | null, getContent: () => string): void;
  onExplicitSave(path: string): void;
  checkRecovery(): Promise<DraftInfo[]>;
  recoverDraft(draftKey: string): Promise<string>;
  dismissDraft(draftKey: string): Promise<void>;
  dispose(): void;
}

export function createDraftHandle(): DraftHandle {
  let intervalId: number | null = null;
  let idleId: number | null = null;
  let pending = false;
  let currentPath: string | null = null;
  let getContent: (() => string) | null = null;
  const pathToDraftKey = new Map<string, string>();
  let latestKey: string | null = null;

  async function flush(): Promise<void> {
    if (!pending || !isTauri() || !getContent) return;
    // Don't save drafts for untitled documents or if no path is set
    if (!currentPath) return;
    pending = false;
    try {
      const key = await saveDraft(currentPath, getContent());
      latestKey = key;
      if (currentPath) pathToDraftKey.set(currentPath, key);
    } catch (err) {
      console.warn("[skymark] draft autosave failed:", err);
    }
  }

  function scheduleIdle(): void {
    if (idleId !== null) window.clearTimeout(idleId);
    idleId = window.setTimeout(() => { idleId = null; void flush(); }, IDLE_DEBOUNCE_MS);
  }

  intervalId = window.setInterval(() => { void flush(); }, AUTOSAVE_INTERVAL_MS);

  return {
    onDocChange(path, gc) {
      currentPath = path;
      getContent = gc;
      pending = true;
      scheduleIdle();
    },

    onExplicitSave(path) {
      pending = false;
      if (idleId !== null) { window.clearTimeout(idleId); idleId = null; }
      const key = pathToDraftKey.get(path) ?? latestKey;
      if (key && isTauri()) {
        void discardDraft(key).catch(() => { /* best-effort */ });
        pathToDraftKey.delete(path);
        if (latestKey === key) latestKey = null;
      }
    },

    async checkRecovery() {
      if (!isTauri()) return [];
      try { return await listDrafts(); } catch { return []; }
    },

    async recoverDraft(draftKey) {
      return loadDraft(draftKey);
    },

    async dismissDraft(draftKey) {
      await discardDraft(draftKey).catch(() => { /* best-effort */ });
    },

    dispose() {
      if (intervalId !== null) window.clearInterval(intervalId);
      if (idleId !== null) window.clearTimeout(idleId);
    },
  };
}
