import {Plugin} from "prosemirror-state";
import type {EditorState} from "prosemirror-state";
import type {Extension} from "@gravity-ui/markdown-editor";
import type {Extension as CM6Extension} from "@codemirror/state";
import {EditorView as CMEditorView} from "@codemirror/view";
import {useSelectionStore} from "../../store/selectionStore";

/**
 * Выделение активной вкладки для `get_selection` (Phase 8.2).
 *
 * Публичный API Gravity-редактора выделение не отдаёт, поэтому:
 * - WYSIWYG — PM-плагин: текст через `doc.textBetween`, позиции PM;
 * - Markup — CodeMirror updateListener: `sliceDoc`, смещения символов.
 * Оба пишут в selectionStore; UI и инструменты читают только оттуда.
 */

function reportPm(path: string, state: EditorState): void {
  const {from, to, empty} = state.selection;
  if (empty || from === to) {
    useSelectionStore.getState().clearFor(path);
    return;
  }
  useSelectionStore.getState().setSelection({
    path,
    text: state.doc.textBetween(from, to, "\n"),
    from,
    to,
    unit: "prosemirror",
  });
}

export function selectionPmExtension(path: string): Extension {
  return (builder) => {
    builder.addPlugin(
      () =>
        new Plugin({
          view(view) {
            reportPm(path, view.state);
            return {
              update(view) {
                reportPm(path, view.state);
              },
            };
          },
        }),
    );
  };
}

export function selectionMarkupExtension(path: string): CM6Extension {
  return CMEditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;
    const {from, to} = update.state.selection.main;
    if (from === to) {
      useSelectionStore.getState().clearFor(path);
      return;
    }
    useSelectionStore.getState().setSelection({
      path,
      text: update.state.sliceDoc(from, to),
      from,
      to,
      unit: "codemirror",
    });
  });
}
