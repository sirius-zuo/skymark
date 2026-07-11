import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUpdateBanner } from "./update-banner";

const openUrl = vi.fn<(url: string) => Promise<void>>();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

vi.mock("./api", () => ({
  isTauri: () => true,
}));

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("update banner Open Release button", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    const toastRoot = document.createElement("div");
    toastRoot.id = "toast-root";
    document.body.appendChild(toastRoot);
    openUrl.mockReset();
  });

  it("opens the release url via the opener plugin", async () => {
    openUrl.mockResolvedValue(undefined);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const banner = createUpdateBanner(host);
    banner.show("9.9.9", "https://github.com/sirius-zuo/skymark/releases/tag/v9.9.9");

    host.querySelector<HTMLButtonElement>(".update-install-btn")!.click();
    await flushMicrotasks();

    expect(openUrl).toHaveBeenCalledWith("https://github.com/sirius-zuo/skymark/releases/tag/v9.9.9");
  });

  it("shows an error toast when opening fails instead of failing silently", async () => {
    openUrl.mockRejectedValue(new Error("url not allowed on the configured scope"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const banner = createUpdateBanner(host);
    banner.show("9.9.9", "https://github.com/sirius-zuo/skymark/releases/tag/v9.9.9");

    host.querySelector<HTMLButtonElement>(".update-install-btn")!.click();
    await flushMicrotasks();

    const toasts = Array.from(document.querySelectorAll(".toast"))
      .map((t) => t.textContent ?? "");
    expect(toasts.some((t) => t.includes("Could not open release page"))).toBe(true);
  });
});
