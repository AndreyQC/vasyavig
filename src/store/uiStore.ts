import {create} from "zustand";
import {persist} from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type UiLang = "ru" | "en";

interface UiState {
  theme: ThemeMode;
  lang: UiLang;
  /** Путь из Save As, ожидающий подтверждения смены формата md↔yfm. */
  pendingSaveAsPath: string | null;
  /** Вкладка (путь), ожидающая подтверждения закрытия. */
  pendingClosePath: string | null;
  /** Путь папки, открытие которой отложено до разрешения промпта. */
  pendingOpenFolderPath: string | null;
  /** Путь файла/папки, ожидающий подтверждения удаления. */
  pendingDeletePath: string | null;
  /** Каталог, в котором создаётся новый файл (модалка «Создать файл»). */
  pendingCreateDir: string | null;
  /** Офисный документ, ожидающий подтверждения конвертации в Markdown. */
  pendingConvertPath: string | null;
  /** Файл/папка, ожидающие переименования. */
  pendingRenamePath: string | null;

  setTheme: (theme: ThemeMode) => void;
  setLang: (lang: UiLang) => void;
  setPendingSaveAsPath: (path: string | null) => void;
  setPendingClosePath: (path: string | null) => void;
  setPendingOpenFolderPath: (path: string | null) => void;
  setPendingDeletePath: (path: string | null) => void;
  setPendingCreateDir: (dir: string | null) => void;
  setPendingConvertPath: (path: string | null) => void;
  setPendingRenamePath: (path: string | null) => void;
}

/** Настройки (theme, lang) персистятся в localStorage (идея §4.5). */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      lang: "ru",
      pendingSaveAsPath: null,
      pendingClosePath: null,
      pendingOpenFolderPath: null,
      pendingDeletePath: null,
      pendingCreateDir: null,
      pendingConvertPath: null,
      pendingRenamePath: null,

      setTheme: (theme) => set({theme}),
      setLang: (lang) => set({lang}),
      setPendingSaveAsPath: (path) => set({pendingSaveAsPath: path}),
      setPendingClosePath: (path) => set({pendingClosePath: path}),
      setPendingOpenFolderPath: (path) => set({pendingOpenFolderPath: path}),
      setPendingDeletePath: (path) => set({pendingDeletePath: path}),
      setPendingCreateDir: (dir) => set({pendingCreateDir: dir}),
      setPendingConvertPath: (path) => set({pendingConvertPath: path}),
      setPendingRenamePath: (path) => set({pendingRenamePath: path}),
    }),
    {
      name: "vasyavig.settings",
      partialize: (s) => ({theme: s.theme, lang: s.lang}),
    },
  ),
);
