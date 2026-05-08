import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { showToast } from "./toast";

export interface VaultFile {
  abs_path: string;
  rel_path: string;
  name: string;
}

export interface VaultHandle {
  readonly root: string | null;
  readonly files: VaultFile[];
  open(): Promise<boolean>;
  filter(query: string): VaultFile[];
}

export function createVaultHandle(): VaultHandle {
  let root: string | null = null;
  let files: VaultFile[] = [];

  return {
    get root() { return root; },
    get files() { return files; },

    async open() {
      if (!isTauri()) return false;
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return false;
      try {
        const result = await invoke<VaultFile[]>("scan_vault", { path: picked });
        root = picked;
        files = result;
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(msg.startsWith("vault too large") ? msg : `Failed to open vault: ${msg}`);
        return false;
      }
    },

    filter(query) {
      if (!query) return files.slice(0, 50);
      const q = query.toLowerCase();
      return files
        .filter(f => subsequenceMatch(f.rel_path.toLowerCase(), q))
        .slice(0, 50);
    },
  };
}

function subsequenceMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}
