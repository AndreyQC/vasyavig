import {create} from "zustand";

interface UiState {
  /** Путь из Save As, ожидающий подтверждения смены формата md↔yfm. */
  pendingSaveAsPath: string | null;
  setPendingSaveAsPath: (path: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  pendingSaveAsPath: null,
  setPendingSaveAsPath: (path) => set({pendingSaveAsPath: path}),
}));
