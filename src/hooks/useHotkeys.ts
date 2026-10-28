import {useEffect} from "react";
import {useSaveActions} from "./useSaveActions";
import {useFileActions} from "./useFileActions";
import {useEditorStore} from "../store/editorStore";
import {useFileStore} from "../store/fileStore";
import {useUiStore} from "../store/uiStore";

/**
 * Горячие клавиши:
 * Ctrl/Cmd+S — сохранить, Ctrl/Cmd+Shift+S — сохранить как, Ctrl/Cmd+O — открыть файл,
 * Ctrl/Cmd+W — закрыть вкладку, Ctrl/Cmd+Tab (+Shift) — переключить вкладку,
 * Ctrl/Cmd+P — быстрое открытие (план 20261028_004, D1/D7).
 *
 * Риск: WebView2 browser accelerator keys могут перехватить часть сочетаний
 * до страницы (Ctrl+W/Ctrl+P) — поведение проверяется GUI-приёмкой.
 */
export function useHotkeys() {
  const {saveActive, saveActiveAs} = useSaveActions();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();

      if (key === "s") {
        e.preventDefault();
        // читаем актуальное состояние через getState внутри экшенов (урок §5.3)
        if (e.shiftKey) {
          void saveActiveAs();
        } else {
          void saveActive();
        }
      } else if (key === "o" && !e.shiftKey) {
        e.preventDefault();
        void useFileStore.getState().openFileDialog();
      } else if (key === "w" && !e.shiftKey) {
        e.preventDefault();
        const activePath = useEditorStore.getState().activePath;
        if (activePath) useFileActions().requestCloseTab(activePath);
      } else if (key === "tab") {
        e.preventDefault();
        const {tabs, activePath, setActiveTab} = useEditorStore.getState();
        if (tabs.length < 2) return;
        const index = tabs.findIndex((t) => t.path === activePath);
        const step = e.shiftKey ? tabs.length - 1 : 1;
        setActiveTab(tabs[(index + step) % tabs.length].path);
      } else if (key === "p" && !e.shiftKey) {
        e.preventDefault();
        useUiStore.getState().setQuickOpenOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActive, saveActiveAs]);
}
