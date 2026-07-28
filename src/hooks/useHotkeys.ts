import {useEffect} from "react";
import {useSaveActions} from "./useSaveActions";
import {useFileStore} from "../store/fileStore";

/**
 * Горячие клавиши:
 * Ctrl/Cmd+S — сохранить, Ctrl/Cmd+Shift+S — сохранить как, Ctrl/Cmd+O — открыть файл.
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActive, saveActiveAs]);
}
