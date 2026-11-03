import {create} from "zustand";

/**
 * Состояние панели ассистента (Phase 8.1): открыта ли панель и модалки
 * настроек/audit. Session-only, в localStorage не персистится.
 */
interface AssistantState {
  panelOpen: boolean;
  settingsOpen: boolean;
  /** id модели, которую нужно сразу открыть в форме (null — список). */
  settingsModelId: string | null;
  /** Модалка просмотра audit-лога (T3e). */
  auditOpen: boolean;

  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  openSettings: (modelId?: string | null) => void;
  closeSettings: () => void;
  openAudit: () => void;
  closeAudit: () => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  panelOpen: false,
  settingsOpen: false,
  settingsModelId: null,
  auditOpen: false,

  setPanelOpen: (open) =>
    set({
      panelOpen: open,
      // Закрытие панели закрывает и модалки: они часть панели.
      ...(open ? {} : {settingsOpen: false, settingsModelId: null, auditOpen: false}),
    }),
  togglePanel: () =>
    set((s) => {
      const panelOpen = !s.panelOpen;
      return panelOpen
        ? {panelOpen}
        : {panelOpen, settingsOpen: false, settingsModelId: null, auditOpen: false};
    }),
  openSettings: (modelId = null) => set({settingsOpen: true, settingsModelId: modelId, auditOpen: false}),
  closeSettings: () => set({settingsOpen: false, settingsModelId: null}),
  openAudit: () => set({auditOpen: true, settingsOpen: false, settingsModelId: null}),
  closeAudit: () => set({auditOpen: false}),
}));
