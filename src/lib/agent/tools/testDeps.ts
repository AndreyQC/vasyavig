import type {EditorTab} from "../../../store/editorStore";
import type {FileNode} from "../../../types";
import {buildUlidIndex, type HarnessIndexEntry} from "../../harnessIndex";
import type {TaskSource} from "../../harnessTasks";
import type {RootInfo} from "../../rootColors";
import {getFileName, joinPath} from "../../utils";
import {contentHash} from "../hash";
import type {SelectionToolSnapshot} from "./deps";
import type {HarnessIndexSnapshot, ToolDeps} from "./deps";

/**
 * Фейковые зависимости инструментов для тестов: без Tauri, FS и сети.
 * Состояние мутабельное — тесты проверяют, что propose_* его не меняют,
 * а apply/create — меняют.
 */

export interface FakeState {
  tabs: EditorTab[];
  activePath: string | null;
  roots: RootInfo[];
  selection: SelectionToolSnapshot | null;
  files: Record<string, string>;
  indexes: HarnessIndexSnapshot[];
  trees: Record<string, FileNode[]>;
  taskSource: TaskSource | null;
  created: string[];
  opened: Array<{path: string; content: string; kind: string}>;
  updated: Array<{path: string; content: string}>;
  activated: string[];
  refreshCount: number;
  editors: Map<string, {replace: (text: string) => void}>;
  validateCalls: Array<{root: string; relativePath: string}>;
}

export interface FakeOptions {
  tabs?: EditorTab[];
  activePath?: string | null;
  roots?: RootInfo[];
  selection?: SelectionToolSnapshot | null;
  files?: Record<string, string>;
  indexes?: HarnessIndexSnapshot[];
  trees?: Record<string, FileNode[]>;
  taskSource?: TaskSource | null;
  editors?: Map<string, {replace: (text: string) => void}>;
  validateCreateTarget?: (
    root: string,
    relativePath: string,
  ) => Promise<{absolutePath: string}>;
}

export function makeTab(path: string, content: string, extra: Partial<EditorTab> = {}): EditorTab {
  return {
    path,
    name: getFileName(path),
    kind: "markdown",
    content,
    savedContent: content,
    dirty: false,
    mode: "wysiwyg",
    preview: false,
    ...extra,
  };
}

export function makeIndex(
  repoRoot: string,
  entries: HarnessIndexEntry[],
): HarnessIndexSnapshot {
  return {repoRoot, entries, byUlid: buildUlidIndex(entries)};
}

export function fakeDeps(options: FakeOptions = {}): {deps: ToolDeps; state: FakeState} {
  let clock = 1000;
  const state: FakeState = {
    tabs: options.tabs ?? [],
    activePath: options.activePath ?? options.tabs?.[0]?.path ?? null,
    roots: options.roots ?? [],
    selection: options.selection ?? null,
    files: {...(options.files ?? {})},
    indexes: options.indexes ?? [],
    trees: options.trees ?? {},
    taskSource: options.taskSource ?? null,
    created: [],
    opened: [],
    updated: [],
    activated: [],
    refreshCount: 0,
    editors: options.editors ?? new Map(),
    validateCalls: [],
  };

  const deps: ToolDeps = {
    getTabs: () => state.tabs,
    getActivePath: () => state.activePath,
    getRoots: () => state.roots,
    getSelection: () => state.selection,
    readFile: async (path) => {
      if (!(path in state.files)) throw new Error(`нет файла: ${path}`);
      return state.files[path];
    },
    fileExists: async (path) => path in state.files,
    createFile: async (path) => {
      if (path in state.files) throw new Error("файл уже существует");
      state.files[path] = "";
      state.created.push(path);
    },
    refreshTree: async () => {
      state.refreshCount++;
    },
    openDirtyTab: (path, content, kind) => {
      state.opened.push({path, content, kind});
      state.tabs = [
        ...state.tabs.filter((tab) => tab.path !== path),
        makeTab(path, content, {kind, savedContent: "", dirty: true}),
      ];
      state.activePath = path;
    },
    getHarnessIndexes: () => state.indexes,
    getFileTree: (rootPath) => state.trees[rootPath],
    getTaskSource: () => {
      if (!state.taskSource) throw new Error("task source не задан");
      return state.taskSource;
    },
    validateCreateTarget:
      options.validateCreateTarget ??
      (async (root, relativePath) => {
        state.validateCalls.push({root, relativePath});
        const absolutePath = joinPath(
          root,
          relativePath.replace(/\//g, root.includes("\\") ? "\\" : "/"),
        );
        if (absolutePath in state.files) throw new Error("файл уже существует");
        return {absolutePath};
      }),
    getEditor: (path) => state.editors.get(path) ?? null,
    setActiveTab: (path) => {
      state.activePath = path;
      state.activated.push(path);
    },
    updateContent: (path, content) => {
      state.updated.push({path, content});
      state.tabs = state.tabs.map((tab) =>
        tab.path === path
          ? {...tab, content, dirty: content !== tab.savedContent, preview: false}
          : tab,
      );
    },
    waitForEditor: async (path) => state.editors.get(path) ?? null,
    hash: contentHash,
    now: () => ++clock,
  };

  return {deps, state};
}
