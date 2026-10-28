import {Plugin} from "prosemirror-state";
import type {EditorState} from "prosemirror-state";
import type {Extension} from "@gravity-ui/markdown-editor";
import type {Extension as CM6Extension} from "@codemirror/state";
import {EditorView as CMEditorView} from "@codemirror/view";
import {useUiStore} from "../store/uiStore";

/**
 * Позиция курсора для статус-бара (план 20261028_004, D5): WYSIWYG —
 * PM-плагин (блок верхнего уровня + офсет внутри текстблока), Markup —
 * CM updateListener (настоящие строка:столбец). Оба пишут в uiStore
 * напрямую — подписан только StatusBar.
 */

function reportPm(state: EditorState) {
  const $from = state.selection.$from;
  useUiStore.getState().setCursorPos({
    // 1-базный номер блока верхнего уровня (для markdown ≈ строка) и офсет
    col: $from.parentOffset + 1,
    line: $from.index(0) + 1,
  });
}

export function cursorPosExtension(): Extension {
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          view(view) {
            reportPm(view.state);
            return {
              update(view) {
                reportPm(view.state);
              },
            };
          },
        }),
    );
  };
}

export function cursorPosMarkupExtension(): CM6Extension {
  return CMEditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head);
    useUiStore.getState().setCursorPos({col: head - line.from + 1, line: line.number});
  });
}
