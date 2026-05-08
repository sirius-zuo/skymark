import { VaultFile } from "./vault";

export interface LinkChecker {
  update(absPath: string, content: string, vaultFiles: VaultFile[]): void;
  getBrokenFiles(): Set<string>;
  remove(absPath: string): void;
  clear(): void;
}

export function createLinkChecker(): LinkChecker {
  const broken = new Set<string>();

  function dirOf(absPath: string): string {
    const sep = absPath.includes("\\") ? "\\" : "/";
    const i = absPath.lastIndexOf(sep);
    return i >= 0 ? absPath.slice(0, i) : "";
  }

  function normSep(p: string): string { return p.replace(/\\/g, "/"); }

  function resolvedMdLink(target: string, absPath: string, vaultFiles: VaultFile[]): boolean {
    if (/^https?:\/\//i.test(target) || target.startsWith("#")) return true;
    const resolved = normSep(dirOf(absPath) + "/" + target);
    return vaultFiles.some(f => normSep(f.abs_path) === resolved);
  }

  function resolvedWikilink(name: string, vaultFiles: VaultFile[]): boolean {
    const lower = name.toLowerCase().replace(/\.md$/i, "");
    return vaultFiles.some(f => f.name.toLowerCase().replace(/\.md$/i, "") === lower);
  }

  return {
    update(absPath, content, vaultFiles) {
      let hasBroken = false;

      const mdRe = /\[(?:[^\]]*)\]\(([^)#]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = mdRe.exec(content)) !== null) {
        if (!resolvedMdLink(m[1], absPath, vaultFiles)) { hasBroken = true; break; }
      }

      if (!hasBroken) {
        const wikiRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
        while ((m = wikiRe.exec(content)) !== null) {
          if (!resolvedWikilink(m[1].trim(), vaultFiles)) { hasBroken = true; break; }
        }
      }

      if (hasBroken) broken.add(absPath);
      else broken.delete(absPath);
    },

    getBrokenFiles() { return new Set(broken); },
    remove(absPath) { broken.delete(absPath); },
    clear() { broken.clear(); },
  };
}
