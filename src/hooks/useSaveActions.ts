import {useEditorStore} from "../store/editorStore";
import {useFileStore} from "../store/fileStore";
import {useUiStore} from "../store/uiStore";
import {getFileName} from "../lib/utils";

/** Синхронизация после переименования файла через «Сохранить как». */
function afterRename(newPath: string) {
  const fileStore = useFileStore.getState();
  fileStore.setActiveFilePath(newPath);
  fileStore.refreshTree();
  document.title = `${getFileName(newPath)} — Vasyavig`;
}

/**
 * Действия сохранения: Ctrl+S / Save As / подтверждение смены формата.
 * Вся работа с модалкой md↔yfm и синхронизацией fileStore — здесь.
 */
export function useSaveActions() {
  const saveActive = async () => {
    const error = await useEditorStore.getState().saveActive();
    if (error) useFileStore.getState().setError(error);
  };

  const saveActiveAs = async () => {
    const result = await useEditorStore.getState().saveActiveAs();
    switch (result.type) {
      case "confirm":
        useUiStore.getState().setPendingSaveAsPath(result.newPath);
        break;
      case "saved":
        afterRename(result.newPath);
        break;
      case "error":
        useFileStore.getState().setError(result.error);
        break;
      case "cancelled":
        break;
    }
  };

  /** Модалка: «Сохранить как <новый формат>». */
  const confirmSaveAs = async (newPath: string) => {
    useUiStore.getState().setPendingSaveAsPath(null);
    const error = await useEditorStore.getState().confirmSaveAs(newPath);
    if (error) {
      useFileStore.getState().setError(error);
    } else {
      afterRename(newPath);
    }
  };

  /** Модалка: «Отмена». */
  const cancelSaveAs = () => {
    useUiStore.getState().setPendingSaveAsPath(null);
  };

  return {saveActive, saveActiveAs, confirmSaveAs, cancelSaveAs};
}
