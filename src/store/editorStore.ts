import {create} from "zustand";
import {getFileName, type FileKind} from "../lib/utils";

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

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;

  openTab: (tab: {path: string; kind: FileKind; content: string}) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  setMode: (path: string, mode: EditorMode) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
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
}));
