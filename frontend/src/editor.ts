import { EditorState, EditorSelection, RangeSetBuilder, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, ViewPlugin, DecorationSet, Decoration, ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
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
}

export type DocChangeListener = (text: string) => void;

function wrapSelection(view: EditorView, prefix: string, suffix: string): boolean {
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
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
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
          if (update.docChanged) {
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
    },
    scrollToLine(line: number) {
      const doc = view.state.doc;
      const target = doc.line(Math.min(line + 1, doc.lines));
      view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
    },
  };
}
