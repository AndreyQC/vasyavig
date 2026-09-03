import {create} from "zustand";
import {getExtension, getFileName, isMdYfmSwap, remapPath, type FileKind} from "../lib/utils";
import {saveFileDialog, writeFile} from "../hooks/useTauriFS";

export type EditorMode = "wysiwyg" | "markup" | "split";

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
  /**
   * Эфемерная вкладка просмотра (спека preview-tabs): открывается одиночным
   * кликом по дереву, замещает предыдущую preview-вкладку, закрепляется
   * двойным кликом или первой правкой. Preview-вкладка никогда не dirty.
   */
  preview: boolean;
}

/** Результат «Сохранить как»: saved — записано; confirm — нужна модалка md↔yfm; cancelled — отмена. */
export type SaveAsResult =
  | {type: "saved"; newPath: string}
  | {type: "confirm"; newPath: string}
  | {type: "cancelled"}
  | {type: "error"; error: string};

/** Вкладки с полным циклом правки/сохранения; image/email — только просмотр. */
function isSavableKind(kind: FileKind): boolean {
  return kind === "markdown" || kind === "text";
}

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;

  openTab: (tab: {path: string; kind: FileKind; content: string}, opts?: {preview?: boolean}) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  setMode: (path: string, mode: EditorMode) => void;

  /** Сохраняет конкретную вкладку (markdown/text и только dirty). */
  saveTab: (path: string) => Promise<string | null>;
  /** Сохраняет все dirty вкладки (markdown/text); возвращает первую ошибку (или null). */
  saveAllDirty: () => Promise<string | null>;
  /** Закрывает все вкладки без промптов (промпт строится в UI ДО вызова). */
  closeAllTabs: () => void;
  /** Переименование/перемещение: пересчитывает пути вкладок и activePath. */
  remapPath: (oldPath: string, newPath: string) => void;
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

    openTab: ({path, kind, content}, opts) => {
      const existing = get().tabs.find((t) => t.path === path);
      if (existing) {
        // закреплённое открытие уже открытого файла (двойной клик) закрепляет
        // вкладку; preview-открытие лишь активирует её, статус не меняя
        set((s) => ({
          tabs: opts?.preview ? s.tabs : s.tabs.map((t) => (t.path === path ? {...t, preview: false} : t)),
          activePath: path,
        }));
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
        preview: opts?.preview ?? false,
      };
      set((s) => ({
        // новая preview-вкладка замещает предыдущую (та не бывает dirty —
        // первая правка закрепляет, поэтому промпт не нужен)
        tabs: [...(opts?.preview ? s.tabs.filter((t) => !t.preview) : s.tabs), tab],
        activePath: path,
      }));
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
        tabs: s.tabs.map((t) => {
          if (t.path !== path) return t;
          // вкладки-просмотрщики (image/email) не редактируются (design D1)
          if (t.kind === "image" || t.kind === "email") return t;
          const dirty = content !== t.savedContent;
          // переход в dirty закрепляет preview-вкладку (первая правка);
          // закрепление необратимо — возврат текста к saved не возвращает preview
          return {...t, content, dirty, preview: dirty ? false : t.preview};
        }),
      }));
    },

    setMode: (path, mode) => {
      set((s) => ({tabs: s.tabs.map((t) => (t.path === path ? {...t, mode} : t))}));
    },

    saveTab: async (path) => {
      const tab = get().tabs.find((t) => t.path === path);
      if (!tab || !isSavableKind(tab.kind) || !tab.dirty) return null;
      try {
        await writeFile(tab.path, tab.content);
      } catch (e) {
        return String(e);
      }
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === path ? {...t, savedContent: t.content, dirty: false} : t,
        ),
      }));
      return null;
    },

    saveAllDirty: async () => {
      const dirty = get().tabs.filter((t) => t.dirty && isSavableKind(t.kind));
      let firstError: string | null = null;
      for (const tab of dirty) {
        const error = await get().saveTab(tab.path);
        if (error && firstError === null) firstError = error;
      }
      return firstError;
    },

    closeAllTabs: () => set({tabs: [], activePath: null}),

    remapPath: (oldPath, newPath) => {
      set((s) => {
        const tabs = s.tabs.map((t) => {
          const np = remapPath(t.path, oldPath, newPath);
          return np ? {...t, path: np, name: getFileName(np)} : t;
        });
        const activePath = s.activePath
          ? (remapPath(s.activePath, oldPath, newPath) ?? s.activePath)
          : s.activePath;
        return {tabs, activePath};
      });
    },

    saveActive: async () => {
      const {activePath} = get();
      if (!activePath) return null;
      return get().saveTab(activePath);
    },

    saveActiveAs: async () => {
      const {tabs, activePath} = get();
      const tab = tabs.find((t) => t.path === activePath);
      if (!tab || !isSavableKind(tab.kind)) return {type: "cancelled"};

      const newPath = await saveFileDialog(tab.path);
      if (!newPath) return {type: "cancelled"};

      // Защита от случайной смены формата md ↔ yfm (идея §10.3) — только markdown
      if (tab.kind === "markdown" && isMdYfmSwap(getExtension(tab.path), getExtension(newPath))) {
        return {type: "confirm", newPath};
      }

      const error = await writeAndMove(newPath);
      return error ? {type: "error", error} : {type: "saved", newPath};
    },

    confirmSaveAs: async (newPath) => writeAndMove(newPath),
  };
});
