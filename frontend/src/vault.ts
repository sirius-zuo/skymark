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

  };
}
