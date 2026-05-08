const root = () => document.getElementById("toast-root");

export function showToast(message: string, durationMs = 3000): void {
  const container = root();
  if (!container) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  container.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("visible"));
  });

  setTimeout(() => {
    el.classList.remove("visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 500);
  }, durationMs);
}
