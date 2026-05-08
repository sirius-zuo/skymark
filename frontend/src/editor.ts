import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { continueList, isUrl } from "./smart_edit";

export interface EditorHandle {
  view: EditorView;
  getValue(): string;
  setValue(text: string): void;
}

export type DocChangeListener = (text: string) => void;

/** Wrap the current selection with prefix+suffix, or insert prefix+suffix at cursor. */
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
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

/** Enter handler: continue list or blockquote; cancel on empty item. */
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

export function createEditor(parent: HTMLElement, onChange: DocChangeListener): EditorHandle {
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
            view.dispatch(
              state.update({
                changes: { from: sel.from, to: sel.to, insert },
                selection: { anchor },
                userEvent: "input.paste",
              })
            );
            event.preventDefault();
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
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
  };
}
