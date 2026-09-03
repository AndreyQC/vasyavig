import {useEditorStore} from "../store/editorStore";
import {useFileStore} from "../store/fileStore";
import {useUiStore} from "../store/uiStore";
import {joinPath} from "../lib/utils";
import {pathsLosingRoot} from "../lib/roots";
import {openWorkspaceDialog, saveWorkspaceFileDialog} from "./useTauriFS";

/**
 * Действия для вкладок и файлов: закрытие dirty-вкладки, workspace-операции
 * (открыть/новый/удалить корень), создание/удаление/переименование файлов,
 * конвертация офисных документов. Оркестрация модалок (аналог useSaveActions)
 * — здесь.
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

  /**
   * Удаление корня из workspace: dirty-вкладки теряющих корень файлов →
   * промпт, иначе — сразу (спека multi-root-workspace).
   */
  const requestRemoveRoot = (path: string) => {
    const fs = useFileStore.getState();
    const tabPaths = useEditorStore.getState().tabs.map((t) => t.path);
    const losing = new Set(pathsLosingRoot(tabPaths, fs.roots, path));
    const hasDirty = useEditorStore.getState().tabs.some((t) => t.dirty && losing.has(t.path));
    if (hasDirty) {
      useUiStore.getState().setPendingRemoveRootPath(path);
    } else {
      void fs.removeRoot(path);
    }
  };

  /** Сохранить (опционально) dirty-вкладки удаляемого корня и убрать корень. */
  const confirmRemoveRoot = async (save: boolean) => {
    const path = useUiStore.getState().pendingRemoveRootPath;
    if (!path) return;
    useUiStore.getState().setPendingRemoveRootPath(null);
    if (save) {
      const fs = useFileStore.getState();
      const editor = useEditorStore.getState();
      const losing = new Set(pathsLosingRoot(editor.tabs.map((t) => t.path), fs.roots, path));
      for (const tab of editor.tabs.filter((t) => t.dirty && losing.has(t.path))) {
        const error = await editor.saveTab(tab.path);
        if (error) {
          fs.setError(error);
          return;
        }
      }
    }
    await useFileStore.getState().removeRoot(path);
  };

  const cancelRemoveRoot = () => useUiStore.getState().setPendingRemoveRootPath(null);

  /** Открытие другого workspace-файла: dirty-вкладки → промпт, иначе — сразу. */
  const requestOpenWorkspace = async () => {
    const path = await openWorkspaceDialog();
    if (!path) return;
    if (useEditorStore.getState().tabs.some((t) => t.dirty)) {
      useUiStore.getState().setPendingOpenWorkspacePath(path);
      return;
    }
    await applyOpenWorkspace(path);
  };

  /** Сохранить все dirty (опционально), закрыть вкладки, заменить состав корней. */
  const confirmOpenWorkspace = async (saveAll: boolean) => {
    const path = useUiStore.getState().pendingOpenWorkspacePath;
    if (!path) return;
    useUiStore.getState().setPendingOpenWorkspacePath(null);
    if (saveAll) {
      const error = await useEditorStore.getState().saveAllDirty();
      if (error) {
        useFileStore.getState().setError(error);
        return;
      }
    }
    useEditorStore.getState().closeAllTabs();
    await useFileStore.getState().openWorkspaceFile(path);
  };

  const cancelOpenWorkspace = () => useUiStore.getState().setPendingOpenWorkspacePath(null);

  /** Новый пустой workspace: выбор файла, dirty-вкладки → промпт, иначе — сразу. */
  const requestNewWorkspace = async () => {
    const path = await saveWorkspaceFileDialog();
    if (!path) return;
    if (useEditorStore.getState().tabs.some((t) => t.dirty)) {
      useUiStore.getState().setPendingNewWorkspacePath(path);
      return;
    }
    await applyNewWorkspace(path);
  };

  const confirmNewWorkspace = async (saveAll: boolean) => {
    const path = useUiStore.getState().pendingNewWorkspacePath;
    if (!path) return;
    useUiStore.getState().setPendingNewWorkspacePath(null);
    if (saveAll) {
      const error = await useEditorStore.getState().saveAllDirty();
      if (error) {
        useFileStore.getState().setError(error);
        return;
      }
    }
    await applyNewWorkspace(path);
  };

  const cancelNewWorkspace = () => useUiStore.getState().setPendingNewWorkspacePath(null);

  async function applyOpenWorkspace(path: string) {
    useEditorStore.getState().closeAllTabs();
    await useFileStore.getState().openWorkspaceFile(path);
  }

  async function applyNewWorkspace(path: string) {
    useEditorStore.getState().closeAllTabs();
    await useFileStore.getState().newWorkspaceFile(path);
  }

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
    requestRemoveRoot,
    confirmRemoveRoot,
    cancelRemoveRoot,
    requestOpenWorkspace,
    confirmOpenWorkspace,
    cancelOpenWorkspace,
    requestNewWorkspace,
    confirmNewWorkspace,
    cancelNewWorkspace,
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
