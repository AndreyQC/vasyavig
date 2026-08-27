import {useEditorStore} from "../store/editorStore";
import {useFileStore} from "../store/fileStore";
import {useUiStore} from "../store/uiStore";
import {joinPath} from "../lib/utils";

/**
 * Действия для вкладок и файлов: закрытие dirty-вкладки, открытие папки с
 * несохранёнными изменениями, создание/удаление файлов, конвертация офисных
 * документов. Оркестрация модалок (аналог useSaveActions) — здесь.
 */
export function useFileActions() {
  /** Закрытие вкладки: dirty → промпт, чистая — закрыть сразу. */
  const requestCloseTab = (path: string) => {
    const tab = useEditorStore.getState().tabs.find((t) => t.path === path);
    if (tab?.dirty) {
      useUiStore.getState().setPendingClosePath(path);
    } else {
      useEditorStore.getState().closeTab(path);
    }
  };

  /** Markdown: сохранить (опционально) и закрыть. При ошибке сохранения не закрываем. */
  const confirmCloseTab = async (save: boolean) => {
    const path = useUiStore.getState().pendingClosePath;
    if (!path) return;
    useUiStore.getState().setPendingClosePath(null);
    const editor = useEditorStore.getState();
    if (save) {
      const error = await editor.saveTab(path);
      if (error) {
        useFileStore.getState().setError(error);
        return;
      }
    }
    editor.closeTab(path);
  };

  const cancelCloseTab = () => useUiStore.getState().setPendingClosePath(null);

  const confirmOpenFolder = async (saveAll: boolean) => {
    const path = useUiStore.getState().pendingOpenFolderPath;
    if (!path) return;
    useUiStore.getState().setPendingOpenFolderPath(null);
    const editor = useEditorStore.getState();
    if (saveAll) {
      const error = await editor.saveAllDirty();
      if (error) {
        useFileStore.getState().setError(error);
        return;
      }
    }
    editor.closeAllTabs();
    await useFileStore.getState().openFolderPathNow(path);
  };

  const cancelOpenFolder = () => useUiStore.getState().setPendingOpenFolderPath(null);

  /** Запрос на создание файла в каталоге dir (открывает модалку с именем). */
  const requestCreate = (dir: string) => useUiStore.getState().setPendingCreateDir(dir);

  const confirmCreate = async (name: string) => {
    const dir = useUiStore.getState().pendingCreateDir;
    const trimmed = name.trim();
    if (!dir || !trimmed) return;
    useUiStore.getState().setPendingCreateDir(null);
    await useFileStore.getState().createFile(joinPath(dir, trimmed));
  };

  const cancelCreate = () => useUiStore.getState().setPendingCreateDir(null);

  const requestDelete = (path: string) => useUiStore.getState().setPendingDeletePath(path);

  const confirmDelete = async () => {
    const path = useUiStore.getState().pendingDeletePath;
    if (!path) return;
    useUiStore.getState().setPendingDeletePath(null);
    await useFileStore.getState().deleteEntry(path);
  };

  const cancelDelete = () => useUiStore.getState().setPendingDeletePath(null);

  /** Конвертация офисного документа в Markdown-версию (`.md` рядом с исходником). */
  const confirmConvert = async () => {
    const path = useUiStore.getState().pendingConvertPath;
    if (!path) return;
    useUiStore.getState().setPendingConvertPath(null);
    await useFileStore.getState().convertOfficeToMarkdown(path);
  };

  const cancelConvert = () => useUiStore.getState().setPendingConvertPath(null);

  /** Переименование файла/папки (открывает модалку с именем). */
  const requestRename = (path: string) => useUiStore.getState().setPendingRenamePath(path);

  const confirmRename = async (newName: string) => {
    const path = useUiStore.getState().pendingRenamePath;
    if (!path) return;
    useUiStore.getState().setPendingRenamePath(null);
    await useFileStore.getState().renameEntry(path, newName);
  };

  const cancelRename = () => useUiStore.getState().setPendingRenamePath(null);

  return {
    requestCloseTab,
    confirmCloseTab,
    cancelCloseTab,
    confirmOpenFolder,
    cancelOpenFolder,
    requestCreate,
    confirmCreate,
    cancelCreate,
    requestDelete,
    confirmDelete,
    cancelDelete,
    confirmConvert,
    cancelConvert,
    requestRename,
    confirmRename,
    cancelRename,
  };
}
