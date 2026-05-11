import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { showToast } from "./toast";

export interface VaultNode {
  type: "dir" | "file";
  abs_path: string;
  name: string;
  children?: VaultNode[];
}

export interface VaultFile {
  abs_path: string;
  rel_path: string;
  name: string;
}

export interface VaultHandle {
  readonly root: string | null;
  tree: VaultNode[];
  open(): Promise<boolean>;
  openFromPath(path: string): Promise<boolean>;
}

export function createVaultHandle(): VaultHandle {
  let root: string | null = null;
  let tree: VaultNode[] = [];

  return {
    get root() { return root; },
    get tree() { return tree; },

    async open() {
      if (!isTauri()) return false;
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return false;
      try {
        const result = await invoke<VaultNode[]>("scan_vault", { path: picked });
        root = picked;
        tree = result;
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(msg.startsWith("vault too large") ? msg : `Failed to open vault: ${msg}`);
        return false;
      }
    },

    async openFromPath(path: string) {
      if (!isTauri()) return false;
      try {
        const result = await invoke<VaultNode[]>("scan_vault", { path });
        root = path;
        tree = result;
        return true;
      } catch {
        return false;
      }
    },

  };
}
