import {create} from "zustand";
import {getExtension, getFileName, isMdYfmSwap, type FileKind} from "../lib/utils";
import {saveFileDialog, writeFile} from "../hooks/useTauriFS";

export type EditorMode = "wysiwyg" | "markup";

export interface EditorTab {
  path: string;
  name: string;
  kind: FileKind;
  /** Текущее содержимое вкладки (урок §5: хранится в store, не в useState). */
  content: string;
  /** Содержимое на момент последнего сохранения/открытия. */
  savedContent: string;
  dirty: boolean;
  mode: EditorMode;
}

/** Результат «Сохранить как»: saved — записано; confirm — нужна модалка md↔yfm; cancelled — отмена. */
export type SaveAsResult =
  | {type: "saved"; newPath: string}
  | {type: "confirm"; newPath: string}
  | {type: "cancelled"}
  | {type: "error"; error: string};

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;

  openTab: (tab: {path: string; kind: FileKind; content: string}) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  setMode: (path: string, mode: EditorMode) => void;

  /** Ctrl+S: прямое сохранение, расширение не меняется никогда (идея §4.1.3). */
  saveActive: () => Promise<string | null>;
  /** Ctrl+Shift+S: диалог «Сохранить как». */
  saveActiveAs: () => Promise<SaveAsResult>;
  /** Подтверждённое «Сохранить как» (после модалки или без смены формата). */
  confirmSaveAs: (newPath: string) => Promise<string | null>;
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** Записывает содержимое активной вкладки в newPath и переносит вкладку на новый путь. */
  async function writeAndMove(newPath: string): Promise<string | null> {
    const {tabs, activePath} = get();
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab) return null;
    try {
      await writeFile(newPath, tab.content);
    } catch (e) {
      return String(e);
    }
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === tab.path
          ? {
              ...t,
              path: newPath,
              name: getFileName(newPath),
              savedContent: t.content,
              dirty: false,
            }
          : t,
      ),
      activePath: s.activePath === tab.path ? newPath : s.activePath,
    }));
    return null;
  }

  return {
    tabs: [],
    activePath: null,

    openTab: ({path, kind, content}) => {
      const existing = get().tabs.find((t) => t.path === path);
      if (existing) {
        set({activePath: path});
        return;
      }
      const tab: EditorTab = {
        path,
        name: getFileName(path),
        kind,
        content,
        savedContent: content,
        dirty: false,
        mode: "wysiwyg",
      };
      set((s) => ({tabs: [...s.tabs, tab], activePath: path}));
    },

    closeTab: (path) => {
      set((s) => {
        const tabs = s.tabs.filter((t) => t.path !== path);
        const activePath =
          s.activePath === path ? (tabs.length > 0 ? tabs[tabs.length - 1].path : null) : s.activePath;
        return {tabs, activePath};
      });
    },

    setActiveTab: (path) => set({activePath: path}),

    updateContent: (path, content) => {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === path ? {...t, content, dirty: content !== t.savedContent} : t,
        ),
      }));
    },

    setMode: (path, mode) => {
      set((s) => ({tabs: s.tabs.map((t) => (t.path === path ? {...t, mode} : t))}));
    },

    saveActive: async () => {
      const {tabs, activePath} = get();
      const tab = tabs.find((t) => t.path === activePath);
      if (!tab || tab.kind !== "markdown" || !tab.dirty) return null;
      try {
        await writeFile(tab.path, tab.content);
      } catch (e) {
        return String(e);
      }
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === tab.path ? {...t, savedContent: t.content, dirty: false} : t,
        ),
      }));
      return null;
    },

    saveActiveAs: async () => {
      const {tabs, activePath} = get();
      const tab = tabs.find((t) => t.path === activePath);
      if (!tab || tab.kind !== "markdown") return {type: "cancelled"};

      const newPath = await saveFileDialog(tab.path);
      if (!newPath) return {type: "cancelled"};

      // Защита от случайной смены формата md ↔ yfm (идея §10.3)
      if (isMdYfmSwap(getExtension(tab.path), getExtension(newPath))) {
        return {type: "confirm", newPath};
      }

      const error = await writeAndMove(newPath);
      return error ? {type: "error", error} : {type: "saved", newPath};
    },

    confirmSaveAs: async (newPath) => writeAndMove(newPath),
  };
});
