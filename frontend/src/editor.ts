import { EditorState, EditorSelection, RangeSetBuilder, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, ViewPlugin, DecorationSet, Decoration, ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { codeblockHighlight } from "./codeblock-highlight";
import { searchKeymap } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { continueList, isUrl } from "./smart_edit";

const mathMark = Decoration.mark({ class: "cm-math" });

function buildMathDecorations(doc: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const mathPattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let m: RegExpExecArray | null;
  while ((m = mathPattern.exec(doc)) !== null) {
    builder.add(m.index, m.index + m[0].length, mathMark);
  }
  return builder.finish();
}

const mathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildMathDecorations(view.state.doc.toString());
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = buildMathDecorations(update.state.doc.toString());
      }
    }
  },
  { decorations: (v: { decorations: DecorationSet }) => v.decorations }
);

export interface EditorHandle {
  view: EditorView;
  getValue(): string;
  setValue(text: string): void;
  scrollToLine(line: number): void;
  scrollToSourceLine(line: number): void;
}

export type DocChangeListener = (text: string) => void;

export function wrapSelection(view: EditorView, prefix: string, suffix: string): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: [{ from: range.from, insert: prefix + suffix }],
        range: EditorSelection.cursor(range.from + prefix.length),
      };
    }
    const selected = state.sliceDoc(range.from, range.to);
    return {
      changes: [{ from: range.from, to: range.to, insert: prefix + selected + suffix }],
      range: EditorSelection.range(range.from + prefix.length, range.to + prefix.length),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

function leadingGroupPrefix(text: string, group: string[]): string | null {
  let best: string | null = null;
  for (const g of group) {
    if (text.startsWith(g) && (best === null || g.length > best.length)) {
      best = g;
    }
  }
  return best;
}

export function toggleLinePrefix(view: EditorView, prefix: string, group?: string[]): void {
  const { state } = view;
  const sel = state.selection.main;
  const fromLine = state.doc.lineAt(sel.from);
  const toLine = state.doc.lineAt(sel.to);

  const lines: Array<{ from: number; text: string }> = [];
  for (let n = fromLine.number; n <= toLine.number; n++) {
    const l = state.doc.line(n);
    lines.push({ from: l.from, text: l.text });
  }

  const effectiveGroup = group ?? [prefix];
  const allHavePrefix = lines.every(
    (l) => leadingGroupPrefix(l.text, effectiveGroup) === prefix
  );
  const changes: Array<{ from: number; to: number; insert: string }> = [];

  for (const l of lines) {
    if (allHavePrefix) {
      changes.push({ from: l.from, to: l.from + prefix.length, insert: "" });
      continue;
    }
    const leading = leadingGroupPrefix(l.text, effectiveGroup);
    if (leading === prefix) continue; // already has this exact prefix, skip
    const removeLen = leading ? leading.length : 0;
    changes.push({ from: l.from, to: l.from + removeLen, insert: prefix });
  }

  if (changes.length > 0) {
    view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
  }
}

export function insertTemplate(view: EditorView, template: string, cursorOffset?: number): void {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const anchor = range.from + (cursorOffset ?? template.length);
    return {
      changes: { from: range.from, to: range.to, insert: template },
      range: EditorSelection.cursor(anchor),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
}

function listContinuationEnter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const action = continueList(line.text);
  if (!action) return false;

  if (action.type === "cancel") {
    // Remove the empty list marker, then insert a plain newline.
    const from = line.to - action.removeChars;
    view.dispatch(
      state.update({
        changes: { from, to: line.to, insert: "" },
        selection: { anchor: from },
        scrollIntoView: true,
        userEvent: "input",
      })
    );
    return insertNewlineAndIndent({ state: view.state, dispatch: view.dispatch.bind(view) });
  }

  // Continue: newline + prefix.
  view.dispatch(
    state.update({
      changes: { from: sel.head, insert: "\n" + action.prefix },
      selection: { anchor: sel.head + 1 + action.prefix.length },
      scrollIntoView: true,
      userEvent: "input",
    })
  );
  return true;
}

const formattingKeymap = [
  { key: "Mod-b", run: (v: EditorView) => wrapSelection(v, "**", "**") },
  { key: "Mod-i", run: (v: EditorView) => wrapSelection(v, "_", "_") },
  { key: "Mod-k", run: (v: EditorView) => wrapSelection(v, "[", "](url)") },
];

const listContinuationKeymap = [
  { key: "Enter", run: listContinuationEnter },
];

function insertFourSpaces(view: EditorView): boolean {
  const { state } = view;
  view.dispatch(state.update(state.replaceSelection("    "), { scrollIntoView: true, userEvent: "input" }));
  return true;
}

const tabKeymap = [
  { key: "Tab", run: insertFourSpaces },
];

export function createEditor(
  parent: HTMLElement,
  onChange: DocChangeListener,
  extra: Extension[] = []
): EditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        history(),
        closeBrackets(),
        keymap.of([
          ...listContinuationKeymap,
          ...formattingKeymap,
          ...tabKeymap,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        markdown(),
        syntaxHighlighting(oneDarkHighlightStyle, { fallback: true }),
        codeblockHighlight,
        mathPlugin,
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          paste(event, view) {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const url = text.trim();
            if (!isUrl(url)) return false;
            const { state } = view;
            const sel = state.selection.main;
            let insert: string;
            let anchor: number;
            if (sel.empty) {
              insert = `<${url}>`;
              anchor = sel.from + insert.length;
            } else {
              const selected = state.sliceDoc(sel.from, sel.to);
              insert = `[${selected}](${url})`;
              anchor = sel.from + insert.length;
            }
            event.preventDefault();
            view.dispatch(
              state.update({
                changes: { from: sel.from, to: sel.to, insert },
                selection: { anchor },
                userEvent: "input.paste",
              })
            );
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && update.transactions.some(
            tr => tr.annotation(Transaction.userEvent) !== undefined
          )) {
            onChange(update.state.doc.toString());
          }
        }),
        ...extra,
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
      // Corrects stale editorHeight when called before CM6's first measure pass (e.g. startup).
      view.requestMeasure();
    },
    scrollToLine(line: number) {
      const doc = view.state.doc;
      const target = doc.line(Math.min(line + 1, doc.lines));
      view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
    },
    scrollToSourceLine(line: number) {
      const doc = view.state.doc;
      const clampedLine = Math.min(Math.max(1, line), doc.lines);
      const pos = doc.line(clampedLine).from;
      // Set scrollTop directly from the line block's pixel position so we don't
      // move the cursor and don't trigger an extra viewportChanged dispatch.
      const block = view.lineBlockAt(pos);
      view.scrollDOM.scrollTop = block.top + view.documentPadding.top;
    },
  };
}
