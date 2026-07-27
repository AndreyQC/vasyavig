import {useEffect} from "react";
import {useSaveActions} from "./useSaveActions";

/** Горячие клавиши сохранения: Ctrl/Cmd+S — сохранить, Ctrl/Cmd+Shift+S — сохранить как. */
export function useSaveHotkeys() {
  const {saveActive, saveActiveAs} = useSaveActions();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      // читаем актуальное состояние через getState внутри экшенов (урок §5.3)
      if (e.shiftKey) {
        void saveActiveAs();
      } else {
        void saveActive();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActive, saveActiveAs]);
}
