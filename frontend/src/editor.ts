import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";

export interface EditorHandle {
  view: EditorView;
  getValue(): string;
  setValue(text: string): void;
}

export type DocChangeListener = (text: string) => void;

export function createEditor(parent: HTMLElement, onChange: DocChangeListener): EditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
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
