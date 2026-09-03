import {create} from "zustand";
import {persist} from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type UiLang = "ru" | "en";

interface UiState {
  theme: ThemeMode;
  lang: UiLang;
  /** Путь последнего открытого workspace-файла — восстановление на старте (спека workspace-file). */
  lastWorkspacePath: string | null;
  /** Путь из Save As, ожидающий подтверждения смены формата md↔yfm. */
  pendingSaveAsPath: string | null;
  /** Вкладка (путь), ожидающая подтверждения закрытия. */
  pendingClosePath: string | null;
  /** Корень, удаление которого отложено до разрешения промпта (dirty-вкладки). */
  pendingRemoveRootPath: string | null;
  /** Workspace-файл, открытие которого отложено до разрешения промпта. */
  pendingOpenWorkspacePath: string | null;
  /** Путь нового workspace-файла, создание которого отложено до разрешения промпта. */
  pendingNewWorkspacePath: string | null;
  /** Путь файла/папки, ожидающий подтверждения удаления. */
  pendingDeletePath: string | null;
  /** Каталог, в котором создаётся новый файл (модалка «Создать файл»). */
  pendingCreateDir: string | null;
  /** Офисный документ, ожидающий подтверждения конвертации в Markdown. */
  pendingConvertPath: string | null;
  /** Файл/папка, ожидающие переименования. */
  pendingRenamePath: string | null;
  /** Markdown-вкладка, ожидающая выбора «заменить/вставить» оглавление. */
  pendingTocPath: string | null;

  setTheme: (theme: ThemeMode) => void;
  setLang: (lang: UiLang) => void;
  setLastWorkspacePath: (path: string | null) => void;
  setPendingSaveAsPath: (path: string | null) => void;
  setPendingClosePath: (path: string | null) => void;
  setPendingRemoveRootPath: (path: string | null) => void;
  setPendingOpenWorkspacePath: (path: string | null) => void;
  setPendingNewWorkspacePath: (path: string | null) => void;
  setPendingDeletePath: (path: string | null) => void;
  setPendingCreateDir: (dir: string | null) => void;
  setPendingConvertPath: (path: string | null) => void;
  setPendingRenamePath: (path: string | null) => void;
  setPendingTocPath: (path: string | null) => void;
}

/** Настройки (theme, lang, последний workspace) персистятся в localStorage (идея §4.5). */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      lang: "ru",
      lastWorkspacePath: null,
      pendingSaveAsPath: null,
      pendingClosePath: null,
      pendingRemoveRootPath: null,
      pendingOpenWorkspacePath: null,
      pendingNewWorkspacePath: null,
      pendingDeletePath: null,
      pendingCreateDir: null,
      pendingConvertPath: null,
      pendingRenamePath: null,
      pendingTocPath: null,

      setTheme: (theme) => set({theme}),
      setLang: (lang) => set({lang}),
      setLastWorkspacePath: (path) => set({lastWorkspacePath: path}),
      setPendingSaveAsPath: (path) => set({pendingSaveAsPath: path}),
      setPendingClosePath: (path) => set({pendingClosePath: path}),
      setPendingRemoveRootPath: (path) => set({pendingRemoveRootPath: path}),
      setPendingOpenWorkspacePath: (path) => set({pendingOpenWorkspacePath: path}),
      setPendingNewWorkspacePath: (path) => set({pendingNewWorkspacePath: path}),
      setPendingDeletePath: (path) => set({pendingDeletePath: path}),
      setPendingCreateDir: (dir) => set({pendingCreateDir: dir}),
      setPendingConvertPath: (path) => set({pendingConvertPath: path}),
      setPendingRenamePath: (path) => set({pendingRenamePath: path}),
      setPendingTocPath: (path) => set({pendingTocPath: path}),
    }),
    {
      name: "vasyavig.settings",
      partialize: (s) => ({
        theme: s.theme,
        lang: s.lang,
        lastWorkspacePath: s.lastWorkspacePath,
      }),
    },
  ),
);
