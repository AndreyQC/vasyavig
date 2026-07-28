import {create} from "zustand";
import {persist} from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type UiLang = "ru" | "en";

interface UiState {
  theme: ThemeMode;
  lang: UiLang;
  /** Путь из Save As, ожидающий подтверждения смены формата md↔yfm. */
  pendingSaveAsPath: string | null;

  setTheme: (theme: ThemeMode) => void;
  setLang: (lang: UiLang) => void;
  setPendingSaveAsPath: (path: string | null) => void;
}

/** Настройки (theme, lang) персистятся в localStorage (идея §4.5). */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      lang: "ru",
      pendingSaveAsPath: null,

      setTheme: (theme) => set({theme}),
      setLang: (lang) => set({lang}),
      setPendingSaveAsPath: (path) => set({pendingSaveAsPath: path}),
    }),
    {
      name: "vasyavig.settings",
      partialize: (s) => ({theme: s.theme, lang: s.lang}),
    },
  ),
);
