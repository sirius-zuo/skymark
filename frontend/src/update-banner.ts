import { installUpdate } from "./update";
import { showToast } from "./toast";

export interface UpdateBannerHandle {
  show(version: string): void;
  hide(): void;
}

export function createUpdateBanner(host: HTMLElement): UpdateBannerHandle {
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.hidden = true;

  const msg = document.createElement("span");
  msg.className = "update-banner-msg";

  const installBtn = document.createElement("button");
  installBtn.className = "update-install-btn";
  installBtn.textContent = "Install & Restart";
  installBtn.addEventListener("click", () => {
    installBtn.disabled = true;
    installBtn.textContent = "Installing…";
    void installUpdate().catch((err) => {
      showToast(`Update failed: ${String(err)}`);
      installBtn.disabled = false;
      installBtn.textContent = "Install & Restart";
    });
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "update-dismiss-btn";
  dismissBtn.setAttribute("aria-label", "Dismiss");
  dismissBtn.textContent = "✕";
  dismissBtn.addEventListener("click", () => { banner.hidden = true; });

  banner.appendChild(msg);
  banner.appendChild(installBtn);
  banner.appendChild(dismissBtn);
  host.appendChild(banner);

  return {
    show(version: string): void {
      msg.textContent = `Skymark ${version} is available.`;
      banner.hidden = false;
    },
    hide(): void { banner.hidden = true; },
  };
}
