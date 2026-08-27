import {create} from "zustand";
import type {FileNode} from "../types";
import {
  convertToMarkdown,
  createFile as createFileFs,
  deletePath as deletePathFs,
  listDirectory,
  openFileDialog,
  openFolderDialog,
  readFile,
  renamePath,
  watchFolder,
  writeFile,
} from "../hooks/useTauriFS";
import {getFileKind, getFileName, getParentDir, joinPath, remapPath, replaceExtension} from "../lib/utils";
import i18n from "../lib/i18n";
import {useEditorStore} from "./editorStore";
import {useUiStore} from "./uiStore";

interface FileState {
  rootPath: string | null;
  tree: FileNode[];
  /** Стабильная ссылка, меняется только при toggle/collapse — см. LESSONS_LEARNED §3. */
  expandedPaths: Record<string, true>;
  showHidden: boolean;
  /** Путь файла, выбранного в дереве (для подсветки). */
  activeFilePath: string | null;
  /** Выбранная в дереве папка (для «Создать файл»). */
  activeDirPath: string | null;
  isLoadingTree: boolean;
  error: string | null;

  openFolder: () => Promise<void>;
  openFolderPath: (path: string) => Promise<void>;
  openFolderPathNow: (path: string) => Promise<void>;
  openFileDialog: () => Promise<void>;
  refreshTree: () => Promise<void>;
  toggleDir: (path: string) => void;
  collapseAll: () => void;
  toggleShowHidden: () => void;
  openFile: (path: string) => Promise<void>;
  setActiveFilePath: (path: string | null) => void;
  selectDir: (path: string) => void;
  createFile: (path: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  renameEntry: (oldPath: string, newName: string) => Promise<void>;
  convertOfficeToMarkdown: (path: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useFileStore = create<FileState>((set, get) => ({
  rootPath: null,
  tree: [],
  expandedPaths: {},
  showHidden: false,
  activeFilePath: null,
  activeDirPath: null,
  isLoadingTree: false,
  error: null,

  openFolder: async () => {
    const path = await openFolderDialog();
    if (path) await get().openFolderPath(path);
  },

  openFolderPath: async (path) => {
    const dirty = useEditorStore.getState().tabs.filter((t) => t.dirty);
    if (dirty.length > 0) {
      useUiStore.getState().setPendingOpenFolderPath(path);
      return;
    }
    await get().openFolderPathNow(path);
  },

  openFolderPathNow: async (path) => {
    set({
      rootPath: path,
      error: null,
      isLoadingTree: true,
      activeDirPath: null,
      activeFilePath: null,
    });
    try {
      const tree = await listDirectory(path);
      set({tree, isLoadingTree: false, expandedPaths: {}});
      // watcher стартует после загрузки дерева; ошибка watcher не блокирует работу
      await watchFolder(path).catch((e) => console.warn("watch_folder failed:", e));
    } catch (e) {
      set({error: String(e), isLoadingTree: false});
    }
  },

  openFileDialog: async () => {
    const path = await openFileDialog();
    if (path) await get().openFile(path);
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
    const kind = getFileKind(path);
    if (kind === "unsupported") {
      set({error: i18n.t("errors.unsupportedType", {name: getFileName(path)})});
      return;
    }
    if (kind === "office") {
      set({error: null, activeFilePath: path});
      useUiStore.getState().setPendingConvertPath(path);
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

  convertOfficeToMarkdown: async (path) => {
    try {
      const markdown = await convertToMarkdown(path);
      const target = replaceExtension(path, "md");
      await writeFile(target, markdown);
      await get().refreshTree();
      set({activeFilePath: target});
      useEditorStore.getState().openTab({path: target, kind: "markdown", content: markdown});
      document.title = `${getFileName(target)} — Vasyavig`;
    } catch (e) {
      set({error: String(e)});
    }
  },

  setActiveFilePath: (path) => set({activeFilePath: path}),

  selectDir: (path) => set({activeDirPath: path}),

  createFile: async (path) => {
    try {
      await createFileFs(path);
    } catch (e) {
      set({error: String(e)});
      return;
    }
    set({activeFilePath: path});
    await get().refreshTree();
    const kind = getFileKind(path);
    // Офисные файлы не открываем пустыми — конвертация имеет смысл только для реального документа.
    if (kind === "markdown" || kind === "text") {
      useEditorStore.getState().openTab({path, kind, content: ""});
      document.title = `${getFileName(path)} — Vasyavig`;
    }
  },

  deleteEntry: async (path) => {
    try {
      await deletePathFs(path);
    } catch (e) {
      set({error: String(e)});
      return;
    }
    const editor = useEditorStore.getState();
    if (editor.tabs.some((t) => t.path === path)) {
      editor.closeTab(path);
    }
    await get().refreshTree();
  },

  renameEntry: async (oldPath, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const newPath = joinPath(getParentDir(oldPath), trimmed);
    if (newPath === oldPath) return;

    const wasRoot = get().rootPath === oldPath;

    try {
      await renamePath(oldPath, newPath);
    } catch (e) {
      set({error: String(e)});
      return;
    }

    useEditorStore.getState().remapPath(oldPath, newPath);

    set((s) => {
      const remap = (p: string | null) => (p ? (remapPath(p, oldPath, newPath) ?? p) : p);
      return {
        rootPath: remap(s.rootPath),
        activeFilePath: remap(s.activeFilePath),
        activeDirPath: remap(s.activeDirPath),
      };
    });

    if (wasRoot) {
      await watchFolder(newPath).catch((e) => console.warn("watch_folder failed:", e));
    }

    await get().refreshTree();

    const active = useEditorStore.getState().activePath;
    if (active) document.title = `${getFileName(active)} — Vasyavig`;
  },

  setError: (error) => set({error}),
}));
