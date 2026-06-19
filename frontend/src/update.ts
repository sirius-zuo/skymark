import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
  version: string;
  body: string | null;
  url: string;
}

type UpdateCallback = (info: UpdateInfo) => void;
const callbacks: UpdateCallback[] = [];

export function onUpdateAvailable(cb: UpdateCallback): void {
  callbacks.push(cb);
}

// Minimal semantic version comparison: returns true if a > b.
// Extracts only the leading numeric portion of each part to handle
// non-numeric suffixes like "10-beta" or "+build" (where Number() gives NaN).
function isNewer(a: string, b: string): boolean {
  const aParts = a.replace(/^v/, "").split(".").map((p) =>
    parseInt(p.match(/\d+/)?.[0] ?? "0", 10),
  );
  const bParts = b.replace(/^v/, "").split(".").map((p) =>
    parseInt(p.match(/\d+/)?.[0] ?? "0", 10),
  );
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal > bVal) return true;
    if (aVal < bVal) return false;
  }
  return false;
}

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/sirius-zuo/skymark/releases/latest";

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const currentVersion = await invoke<string>("get_app_version");

  let release: { tag_name: string; body: string | null; html_url: string };
  try {
    const resp = await fetch(GITHUB_RELEASES_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    release = await resp.json();
  } catch (err) {
    throw new Error(`Failed to check for updates: ${String(err)}`);
  }

  const latestVersion = release.tag_name;

  console.log(
    "[skymark] update check: latest=%s, current=%s, isNewer=%s",
    latestVersion,
    currentVersion,
    isNewer(latestVersion, currentVersion),
  );

  if (!isNewer(latestVersion, currentVersion)) return null;

  const info: UpdateInfo = {
    version: latestVersion.replace(/^v/, ""),
    body: release.body ?? null,
    url: release.html_url ??
      `https://github.com/sirius-zuo/skymark/releases/tag/${latestVersion}`,
  };

  callbacks.forEach((cb) => cb(info));
  return info;
}
