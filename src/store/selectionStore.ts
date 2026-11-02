import {create} from "zustand";

/**
 * Выделение активной вкладки (Phase 8.2, `get_selection`).
 *
 * Заполняется расширениями редактора: WYSIWYG — ProseMirror-плагин (позиции
 * документа PM), Markup — CodeMirror updateListener (смещения символов).
 * Хранится только текст и позиции; абсолютные пути в контекст модели не
 * уходят. Пустое выделение очищает запись.
 */
export interface SelectionSnapshot {
  path: string;
  text: string;
  from: number;
  to: number;
  unit: "prosemirror" | "codemirror";
}

interface SelectionState {
  path: string | null;
  text: string;
  from: number;
  to: number;
  unit: SelectionSnapshot["unit"] | null;

  setSelection: (snapshot: SelectionSnapshot) => void;
  clearFor: (path?: string) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  path: null,
  text: "",
  from: 0,
  to: 0,
  unit: null,

  setSelection: (snapshot) => {
    if (snapshot.text === "") {
      get().clearFor(snapshot.path);
      return;
    }
    const current = get();
    // не дёргаем подписчиков, если выделение не изменилось
    if (
      current.path === snapshot.path &&
      current.text === snapshot.text &&
      current.from === snapshot.from &&
      current.to === snapshot.to &&
      current.unit === snapshot.unit
    ) {
      return;
    }
    set({
      path: snapshot.path,
      text: snapshot.text,
      from: snapshot.from,
      to: snapshot.to,
      unit: snapshot.unit,
    });
  },

  clearFor: (path) => {
    const current = get();
    if (path !== undefined && current.path !== null && current.path !== path) return;
    if (current.path === null && current.text === "") return;
    set({path: null, text: "", from: 0, to: 0, unit: null});
  },
}));

/** Снимок для инструментов/панели; null — выделения нет. */
export function currentSelection(): SelectionSnapshot | null {
  const state = useSelectionStore.getState();
  if (!state.path || state.text === "" || !state.unit) return null;
  return {
    path: state.path,
    text: state.text,
    from: state.from,
    to: state.to,
    unit: state.unit,
  };
}
