import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openFile, saveFile, isTauri } from "./api";

export interface DocumentState {
  path: string | null;
  isDirty: boolean;
}

export interface FileFlow {
  state: DocumentState;
  onStateChange(listener: (s: DocumentState) => void): void;
  onAfterSave(listener: (path: string) => void): void;  // NEW
  markDirty(): void;
  openInteractive(): Promise<string | null>; // returns loaded content or null if cancelled
  saveInteractive(content: string): Promise<boolean>; // false if cancelled
  newDocument(): void;
}

export function createFileFlow(): FileFlow {
  const state: DocumentState = { path: null, isDirty: false };
  const listeners: Array<(s: DocumentState) => void> = [];
  const saveListeners: Array<(path: string) => void> = [];

  function emit(): void {
    for (const l of listeners) l({ ...state });
  }

  return {
    state,
    onStateChange(l) {
      listeners.push(l);
    },
    onAfterSave(l) {
      saveListeners.push(l);
    },
    markDirty() {
      if (!state.isDirty) {
        state.isDirty = true;
        emit();
      }
    },
    newDocument() {
      state.path = null;
      state.isDirty = false;
      emit();
    },
    async openInteractive() {
      if (!isTauri()) {
        console.warn("[skymark] open requires the Tauri host");
        return null;
      }
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (!picked || Array.isArray(picked)) return null;
      const opened = await openFile(picked);
      state.path = opened.path;
      state.isDirty = false;
      emit();
      return opened.content;
    },
    async saveInteractive(content) {
      if (!isTauri()) {
        console.warn("[skymark] save requires the Tauri host");
        return false;
      }
      let target = state.path;
      if (!target) {
        const picked = await saveDialog({
          filters: [{ name: "Markdown", extensions: ["md"] }],
          defaultPath: "untitled.md",
        });
        if (!picked) return false;
        target = picked;
      }
      await saveFile(target, content);
      state.path = target;
      state.isDirty = false;
      emit();
      for (const l of saveListeners) l(target);
      return true;
    },
  };
}
