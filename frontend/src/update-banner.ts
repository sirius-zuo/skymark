import { showToast } from "./toast";
import { isTauri } from "./api";

export interface UpdateBannerHandle {
  show(version: string, url: string): void;
  hide(): void;
}

export function createUpdateBanner(host: HTMLElement): UpdateBannerHandle {
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.hidden = true;

  const msg = document.createElement("span");
  msg.className = "update-banner-msg";

  const openLinkBtn = document.createElement("button");
  openLinkBtn.className = "update-install-btn";
  openLinkBtn.textContent = "Open Release";

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "update-dismiss-btn";
  dismissBtn.setAttribute("aria-label", "Dismiss");
  dismissBtn.textContent = "✕";
  dismissBtn.addEventListener("click", () => { banner.hidden = true; });

  banner.appendChild(msg);
  banner.appendChild(openLinkBtn);
  banner.appendChild(dismissBtn);
  host.appendChild(banner);

  let releaseUrl = "";

  openLinkBtn.addEventListener("click", () => {
    if (!releaseUrl) return;
    showToast("Opening release page…");
    if (isTauri()) {
      // Tauri's webview blocks <a target="_blank">; route through the OS instead.
      void import("@tauri-apps/plugin-opener")
        .then((m) => m.openUrl(releaseUrl))
        .catch((err) => {
          showToast(`Could not open release page: ${String(err)}`);
        });
    } else {
      window.open(releaseUrl, "_blank", "noopener,noreferrer");
    }
  });

  return {
    show(version: string, url: string): void {
      releaseUrl = url;
      msg.textContent = `Skymark ${version} is available.`;
      banner.hidden = false;
    },
    hide(): void { banner.hidden = true; },
  };
}
