import {create} from "zustand";
import type {FileNode} from "../types";
import {listDirectory, openFolderDialog, readFile, watchFolder} from "../hooks/useTauriFS";

interface FileState {
  rootPath: string | null;
  tree: FileNode[];
  /** Стабильная ссылка, меняется только при toggle/collapse — см. LESSONS_LEARNED §3. */
  expandedPaths: Record<string, true>;
  showHidden: boolean;
  activeFilePath: string | null;
  activeFileContent: string | null;
  isLoadingTree: boolean;
  error: string | null;

  openFolder: () => Promise<void>;
  refreshTree: () => Promise<void>;
  toggleDir: (path: string) => void;
  collapseAll: () => void;
  toggleShowHidden: () => void;
  openFile: (path: string) => Promise<void>;
  closeFile: () => void;
}

export const useFileStore = create<FileState>((set, get) => ({
  rootPath: null,
  tree: [],
  expandedPaths: {},
  showHidden: false,
  activeFilePath: null,
  activeFileContent: null,
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

  openFile: async (path) => {
    set({error: null});
    try {
      const content = await readFile(path);
      set({activeFilePath: path, activeFileContent: content});
      document.title = `${path.split(/[\\/]/).pop()} — Vasyavig`;
    } catch (e) {
      set({error: String(e)});
    }
  },

  closeFile: () => {
    set({activeFilePath: null, activeFileContent: null});
    document.title = "Vasyavig";
  },
}));
