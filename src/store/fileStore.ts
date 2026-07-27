import {create} from "zustand";
import type {FileNode} from "../types";
import {listDirectory, openFolderDialog, readFile, watchFolder} from "../hooks/useTauriFS";
import {getFileKind, getFileName} from "../lib/utils";
import {useEditorStore} from "./editorStore";

interface FileState {
  rootPath: string | null;
  tree: FileNode[];
  /** Стабильная ссылка, меняется только при toggle/collapse — см. LESSONS_LEARNED §3. */
  expandedPaths: Record<string, true>;
  showHidden: boolean;
  /** Путь файла, выбранного в дереве (для подсветки). */
  activeFilePath: string | null;
  isLoadingTree: boolean;
  error: string | null;

  openFolder: () => Promise<void>;
  refreshTree: () => Promise<void>;
  toggleDir: (path: string) => void;
  collapseAll: () => void;
  toggleShowHidden: () => void;
  openFile: (path: string) => Promise<void>;
  setActiveFilePath: (path: string | null) => void;
  setError: (error: string | null) => void;
}

export const useFileStore = create<FileState>((set, get) => ({
  rootPath: null,
  tree: [],
  expandedPaths: {},
  showHidden: false,
  activeFilePath: null,
  isLoadingTree: false,
  error: null,

  openFolder: async () => {
    const path = await openFolderDialog();
    if (!path) return;
    set({rootPath: path, error: null, isLoadingTree: true});
    try {
      const tree = await listDirectory(path);
      set({tree, isLoadingTree: false, expandedPaths: {}});
      // watcher стартует после загрузки дерева; ошибка watcher не блокирует работу
      await watchFolder(path).catch((e) => console.warn("watch_folder failed:", e));
    } catch (e) {
      set({error: String(e), isLoadingTree: false});
    }
  },

  refreshTree: async () => {
    const {rootPath} = get();
    if (!rootPath) return;
    try {
      const tree = await listDirectory(rootPath);
      set({tree});
    } catch (e) {
      set({error: String(e)});
    }
  },

  toggleDir: (path) => {
    const expanded = {...get().expandedPaths};
    if (expanded[path]) {
      delete expanded[path];
    } else {
      expanded[path] = true;
    }
    set({expandedPaths: expanded});
  },

  collapseAll: () => set({expandedPaths: {}}),

  toggleShowHidden: () => set((s) => ({showHidden: !s.showHidden})),

  setActiveFilePath: (path) => set({activeFilePath: path}),

  setError: (error) => set({error}),

  openFile: async (path) => {
    const kind = getFileKind(path);
    if (kind === "unsupported") {
      set({error: `Неподдерживаемый тип файла: ${getFileName(path)}`});
      return;
    }
    set({error: null, activeFilePath: path});
    try {
      const content = await readFile(path);
      useEditorStore.getState().openTab({path, kind, content});
      document.title = `${getFileName(path)} — Vasyavig`;
    } catch (e) {
      set({error: String(e)});
    }
  },
}));
