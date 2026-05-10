import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

type UpdateCallback = (info: UpdateInfo) => void;
const callbacks: UpdateCallback[] = [];
let pending: Update | null = null;

export function onUpdateAvailable(cb: UpdateCallback): void {
  callbacks.push(cb);
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update) return null;
    pending = update;
    const info: UpdateInfo = { version: update.version, body: update.body ?? null };
    callbacks.forEach((cb) => cb(info));
    return info;
  } catch {
    return null;
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending) throw new Error("no update pending");
  await pending.downloadAndInstall();
  await relaunch();
}
