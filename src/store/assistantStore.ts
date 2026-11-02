import {create} from "zustand";

/**
 * Состояние панели ассистента (Phase 8.1): открыта ли панель и модалка
 * настроек. Session-only, в localStorage не персистится — при следующем
 * этапе сюда добавятся прогоны и предложения.
 */
interface AssistantState {
  panelOpen: boolean;
  settingsOpen: boolean;
  /** id модели, которую нужно сразу открыть в форме (null — список). */
  settingsModelId: string | null;

  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  openSettings: (modelId?: string | null) => void;
  closeSettings: () => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  panelOpen: false,
  settingsOpen: false,
  settingsModelId: null,

  setPanelOpen: (open) =>
    set({
      panelOpen: open,
      // Закрытие панели закрывает и модалку: она часть панели.
      ...(open ? {} : {settingsOpen: false, settingsModelId: null}),
    }),
  togglePanel: () =>
    set((s) => {
      const panelOpen = !s.panelOpen;
      return panelOpen
        ? {panelOpen}
        : {panelOpen, settingsOpen: false, settingsModelId: null};
    }),
  openSettings: (modelId = null) => set({settingsOpen: true, settingsModelId: modelId}),
  closeSettings: () => set({settingsOpen: false, settingsModelId: null}),
}));
