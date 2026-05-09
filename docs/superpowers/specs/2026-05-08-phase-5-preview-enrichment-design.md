# Phase 5 — Preview Enrichment Design

## Goal

Add dark/light theme toggle, syntax highlighting in the preview, math rendering (KaTeX), and Mermaid diagram rendering to Skymark. All enrichment runs on the frontend after each Markdown render; the Rust core requires only one small change (enable math parsing).

## Architecture

The existing render pipeline — pulldown-cmark → ammonia → HTML string → IPC → `DOMParser` → `replaceChildren` — is unchanged. Three new frontend **enrichers** run after every `replaceChildren` call in `preview.ts`:

```
Markdown source
  → Rust: render_html (pulldown-cmark + ENABLE_MATH + ammonia) → HTML string
  → IPC
  → preview.ts: DOMParser + replaceChildren
  → enrichHighlight(content)   [async, lazy highlight.js]
  → enrichMath(content)        [async, lazy KaTeX]
  → enrichMermaid(content)     [async, lazy Mermaid.js]
```

Each enricher is a standalone module with a single exported async function. Heavy libraries are loaded via dynamic `import()` on first use; if a preview contains no math or no Mermaid blocks the corresponding library is never downloaded.

The theme system is orthogonal to rendering: `theme.ts` manages a `data-theme` attribute on `<html>`. On theme change, `main.ts` calls `preview.update(editor.getValue())`, re-running the full pipeline (enrichers re-run with the new theme automatically).

## Tech stack

- Rust: pulldown-cmark 0.10 (`ENABLE_MATH` option), existing ammonia 4 config (no changes needed)
- Frontend: TypeScript, Vite, `highlight.js`, `katex`, `mermaid`
- CodeMirror: `@codemirror/lang-markdown` `Mathematics` extension (already installed, zero new packages)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/styles/tokens.css` | Modify | Add `[data-theme="dark"]` variable block |
| `frontend/src/styles/app.css` | Modify | Theme toggle button styles, `.mermaid-diagram` wrapper |
| `frontend/src/theme.ts` | Create | `initTheme`, `toggleTheme`, `getTheme`, `onThemeChange` |
| `frontend/src/enrich-highlight.ts` | Create | highlight.js post-processor; swaps theme CSS on demand |
| `frontend/src/enrich-math.ts` | Create | KaTeX post-processor for `.math-inline` / `.math-display` spans |
| `frontend/src/enrich-mermaid.ts` | Create | Mermaid post-processor; replaces `pre>code.language-mermaid` with SVG |
| `frontend/src/preview.ts` | Modify | Import and call three enrichers after `replaceChildren` |
| `frontend/src/editor.ts` | Modify | Add `Mathematics` extension to `markdown()` call |
| `frontend/index.html` | Modify | Add `#theme-toggle` button to titlebar |
| `frontend/src/main.ts` | Modify | Wire theme toggle button; call `preview.update` on theme change |
| `crates/skymark-core/src/render.rs` | Modify | Add `Options::ENABLE_MATH` to `gfm_options()` |

`crates/skymark-core/src/sanitize.rs` — **no changes needed**. `span` and `code` with `class` are already whitelisted from the Phase 4 prep comment.

---

## Feature Details

### 1. Theme system (`theme.ts`)

- `initTheme()` — reads `localStorage["skymark:theme"]`; if absent, reads `window.matchMedia("(prefers-color-scheme: dark)").matches`; sets `document.documentElement.dataset.theme` to `"light"` or `"dark"`.
- `toggleTheme()` — flips `dataset.theme`, saves to `localStorage["skymark:theme"]`.
- `getTheme()` — returns `"light" | "dark"` from `dataset.theme`.
- `onThemeChange(cb: (t: "light" | "dark") => void)` — registers a callback fired by `toggleTheme`.

`tokens.css` adds a `[data-theme="dark"]` block that overrides the colour variables:

```css
[data-theme="dark"] {
  --color-bg: #1c1917;
  --color-surface: #292524;
  --color-border: #44403c;
  --color-text: #fafaf9;
  --color-text-muted: #a8a29e;
  --color-accent: #60a5fa;
}
```

`index.html` adds `<button id="theme-toggle" class="theme-toggle-btn" aria-label="Toggle theme"></button>` at the right end of the `.titlebar`. The button shows ☀ in dark mode and 🌙 in light mode (set via `theme.ts` after init).

`main.ts` calls `initTheme()` on startup, wires the button click to `toggleTheme()`, and registers an `onThemeChange` callback that calls `preview.update(editor.getValue())`.

### 2. Syntax highlighting (`enrich-highlight.ts`)

```ts
export async function enrichHighlight(container: HTMLElement): Promise<void>
```

- Finds all `container.querySelectorAll('code[class^="language-"]')` elements.
- On first call, dynamically imports `highlight.js` and injects theme CSS. On subsequent calls, swaps CSS if the theme changed.
- Theme CSS: `highlight.js/styles/github.css` (light) and `highlight.js/styles/github-dark.css` (dark), loaded with Vite's `?inline` query and injected into a `<style id="hljs-theme">` element in `<head>`.
- Calls `hljs.highlightElement(el)` on each matched element. Elements without a recognised language class are highlighted anyway (highlight.js auto-detects).

### 3. Math rendering (`enrich-math.ts`)

**Rust:** `gfm_options()` in `render.rs` becomes:
```rust
Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_MATH
```

pulldown-cmark emits `<span class="math math-inline">LATEX</span>` for `$...$` and `<span class="math math-display">LATEX</span>` for `$$...$$`. The sanitizer already passes these through.

**Frontend:**
```ts
export async function enrichMath(container: HTMLElement): Promise<void>
```

- Finds `container.querySelectorAll('.math-inline, .math-display')`.
- On first call, dynamically imports `katex` and injects `katex/dist/katex.min.css` once into `<head>`.
- For each element: reads `el.textContent` (gives decoded LaTeX — HTML entities are unescaped), calls `katex.renderToString(latex, { throwOnError: false, displayMode: el.classList.contains('math-display') })`, sets `el.innerHTML` to the result.
- Errors are caught per-element; the raw LaTeX text is left visible if KaTeX cannot parse it.

**Editor:** `editor.ts` changes `markdown()` to `markdown({ extensions: [Mathematics] })`, importing `Mathematics` from `@codemirror/lang-markdown`. This gives syntax highlighting for math delimiters in the editor pane. No new packages required.

### 4. Mermaid diagrams (`enrich-mermaid.ts`)

```ts
export async function enrichMermaid(container: HTMLElement): Promise<void>
```

- Finds all `pre:has(code.language-mermaid)` elements. Returns immediately if none (avoids importing Mermaid).
- On first call (or when theme changes), dynamically imports `mermaid` and calls:
  ```ts
  mermaid.initialize({ startOnLoad: false, theme: getTheme() === 'dark' ? 'dark' : 'default' })
  ```
- For each `<pre>`: reads `code.textContent` as diagram source, calls `await mermaid.render('mermaid-' + idx, source)` which returns `{ svg }`, wraps the SVG in `<div class="mermaid-diagram">`, replaces the `<pre>` in the DOM.
- Invalid diagrams: error is caught; the original `<pre>` is annotated with `class="mermaid-error"` and kept visible with an error message prepended.

---

## Error handling

| Scenario | Behaviour |
|---|---|
| KaTeX parse error | `throwOnError: false` — KaTeX renders a red error span in place; raw LaTeX stays visible |
| Mermaid parse error | `<pre>` kept; `class="mermaid-error"` added; error message prepended as `<p>` |
| highlight.js unknown language | Auto-detects or renders unstyled; never throws |
| Mermaid import failure | Error logged; `<pre>` blocks stay as plain text |
| KaTeX import failure | Error logged; math spans stay as plain text |

---

## Testing

- `cargo test --workspace` — existing Rust suite; add one test asserting `render_html("$x^2$")` produces a `<span class="math math-inline">` element and `render_html("$$E=mc^2$$")` produces a display span.
- TypeScript: `npx tsc --noEmit` must pass.
- Build: `npm run build` must succeed.
- Manual smoke tests:
  1. Launch app — respects OS theme.
  2. Click toggle — switches theme, preview re-renders.
  3. Reload — persists chosen theme.
  4. Fenced code block (` ```rust `) — highlighted in preview, theme-aware.
  5. `$x^2$` in editor — highlighted in editor; rendered by KaTeX in preview.
  6. `$$E=mc^2$$` — display math in preview.
  7. ` ```mermaid\nflowchart LR\nA-->B\n``` ` — renders as SVG diagram.
  8. Invalid math (`$\notacommand$`) — red error span visible, no crash.
  9. Invalid Mermaid — error message shown, app stable.

---

## Dependencies to install

```bash
cd frontend && npm install highlight.js katex mermaid
npm install --save-dev @types/katex
```

`mermaid` ships its own types. `highlight.js` ships its own types.
