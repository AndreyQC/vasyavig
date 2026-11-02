import type {FileNode} from "../../../types";
import type {EditorTab} from "../../../store/editorStore";
import {useEditorStore} from "../../../store/editorStore";
import {useFileStore} from "../../../store/fileStore";
import {useHarnessStore} from "../../../store/harnessStore";
import {useUiStore} from "../../../store/uiStore";
import {currentSelection} from "../../../store/selectionStore";
import {
  createFile as createFileFs,
  getFileMetadata,
  readFile,
  validateCreateTarget,
} from "../../../hooks/useTauriFS";
import {getEditor} from "../../editorRegistry";
import {createIndexTaskSource, type TaskSource} from "../../harnessTasks";
import type {HarnessIndexEntry} from "../../harnessIndex";
import {normalizePath} from "../../roots";
import type {RootInfo} from "../../rootColors";
import {contentHash} from "../hash";
import type {ProposalApplyDeps} from "../proposals";
import type {SelectionSnapshot} from "../../../store/selectionStore";

/**
 * Зависимости инструментов/применения предложений (Phase 8.2).
 *
 * Инструменты не ходят в сторы напрямую: всё, что им нужно, приходит через
 * этот интерфейс. В приложении — `defaultToolDeps()`, в тестах — фейки без
 * Tauri/FS. Абсолютные пути существуют только внутри deps, наружу (модели,
 * audit, findings) уходят относительные.
 */

export interface HarnessIndexSnapshot {
  repoRoot: string;
  entries: HarnessIndexEntry[];
  byUlid: Record<string, HarnessIndexEntry>;
}

export interface SelectionToolSnapshot extends SelectionSnapshot {}

export interface ToolDeps {
  getTabs: () => readonly EditorTab[];
  getActivePath: () => string | null;
  getRoots: () => readonly RootInfo[];
  getSelection: () => SelectionToolSnapshot | null;
  readFile: (path: string) => Promise<string>;
  fileExists: (path: string) => Promise<boolean>;
  createFile: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  openDirtyTab: (path: string, content: string, kind: "markdown" | "text") => void;
  getHarnessIndexes: () => readonly HarnessIndexSnapshot[];
  getFileTree: (rootPath: string) => readonly FileNode[] | undefined;
  getTaskSource: () => TaskSource;
  validateCreateTarget: (
    rootPath: string,
    relativePath: string,
  ) => Promise<{absolutePath: string}>;
  getEditor: (path: string) => {replace: (text: string) => void} | null;
  setActiveTab: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  waitForEditor: (path: string) => Promise<{replace: (text: string) => void} | null>;
  hash: (text: string) => string;
  now: () => number;
}

/** Ожидание монтирования редактора после переключения вкладки (apply). */
async function waitForEditor(
  path: string,
  timeoutMs = 800,
): Promise<{replace: (text: string) => void} | null> {
  const started = Date.now();
  for (;;) {
    const editor = getEditor(path);
    if (editor) return editor;
    if (Date.now() - started >= timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function indexesSnapshot(): readonly HarnessIndexSnapshot[] {
  return Object.values(useHarnessStore.getState().indexes);
}

export function defaultToolDeps(): ToolDeps {
  return {
    getTabs: () => useEditorStore.getState().tabs,
    getActivePath: () => useEditorStore.getState().activePath,
    getRoots: () => useFileStore.getState().roots,
    getSelection: () => currentSelection(),
    readFile,
    fileExists: async (path) => {
      try {
        await getFileMetadata(path);
        return true;
      } catch {
        return false;
      }
    },
    createFile: createFileFs,
    refreshTree: () => useFileStore.getState().refreshTree(),
    openDirtyTab: (path, content, kind) => {
      const editor = useEditorStore.getState();
      // файл на диске пустой: savedContent="" -> первая запись делает dirty
      editor.openTab({path, kind, content: ""});
      editor.updateContent(path, content);
    },
    getHarnessIndexes: indexesSnapshot,
    getFileTree: (rootPath) => useFileStore.getState().trees[rootPath],
    getTaskSource: () => {
      const indexes = useHarnessStore.getState().indexes;
      return createIndexTaskSource({
        getEntries: (repoRoot) => indexes[normalizePath(repoRoot)]?.entries,
      });
    },
    validateCreateTarget,
    getEditor,
    setActiveTab: (path) => {
      // apply в неактивную вкладку: показать документ, иначе редактор не
      // смонтируется (вкладка «Граф» перекроет его) и undo будет недоступен
      useUiStore.getState().setMainPane("doc");
      useEditorStore.getState().setActiveTab(path);
    },
    updateContent: (path, content) => useEditorStore.getState().updateContent(path, content),
    waitForEditor: (path) => waitForEditor(path),
    hash: contentHash,
    now: () => Date.now(),
  };
}

/** Deps для app-only apply (тот же набор, что у инструментов). */
export function proposalApplyDeps(deps: ToolDeps = defaultToolDeps()): ProposalApplyDeps {
  return {
    getTabs: deps.getTabs,
    getEditor: deps.getEditor,
    setActiveTab: deps.setActiveTab,
    updateContent: deps.updateContent,
    createFile: deps.createFile,
    refreshTree: deps.refreshTree,
    getRoots: deps.getRoots,
    validateCreateTarget: deps.validateCreateTarget,
    fileExists: deps.fileExists,
    openDirtyTab: deps.openDirtyTab,
    waitForEditor: deps.waitForEditor,
  };
}
