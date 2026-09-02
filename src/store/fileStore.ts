import {create} from "zustand";
import type {FileNode} from "../types";
import {
  convertToMarkdown,
  createFile as createFileFs,
  deletePath as deletePathFs,
  grantAssetScope,
  listDirectory,
  openFileDialog,
  openFolderDialog,
  readFile,
  renamePath,
  saveWorkspaceFileDialog,
  unwatchFolder,
  watchFolder,
  writeFile,
} from "../hooks/useTauriFS";
import {getFileKind, getFileName, getParentDir, joinPath, remapPath, replaceExtension} from "../lib/utils";
import i18n from "../lib/i18n";
import {pickNextColor, type PaletteColor, type RootInfo} from "../lib/rootColors";
import {normalizePath, pathsLosingRoot, resolveRoot} from "../lib/roots";
import {
  parseWorkspace,
  resolveFolderPath,
  serializeWorkspace,
  WORKSPACE_EXTENSION,
  WorkspaceFormatError,
} from "../lib/workspaceFile";
import {useEditorStore} from "./editorStore";
import {useUiStore} from "./uiStore";

type SetPartial = (partial: Partial<FileState>) => void;

interface FileState {
  /** Корни workspace в порядке добавления (design D1). */
  roots: RootInfo[];
  /** Дерево на каждый корень; ключ — путь корня. */
  trees: Record<string, FileNode[]>;
  /** Путь файла текущего workspace; null — файл ещё не выбран. */
  workspaceFilePath: string | null;
  /** Стабильная ссылка, меняется только при toggle/collapse — см. LESSONS_LEARNED §3. */
  expandedPaths: Record<string, true>;
  showHidden: boolean;
  /** Путь файла, выбранного в дереве (для подсветки). */
  activeFilePath: string | null;
  /** Выбранная в дереве папка (для «Создать файл»). */
  activeDirPath: string | null;
  isLoadingTree: boolean;
  error: string | null;
  /** Информационное уведомление (дубликат/вложенность корня) — тост, не ошибка. */
  notice: string | null;

  /** «Добавить папку»: диалог выбора + добавление корня. */
  addFolder: () => Promise<void>;
  /** Добавление корня с обеспечением workspace-файла: при первом корне — диалог места файла. */
  addRootInteractive: (path: string) => Promise<void>;
  /** Добавление корня без диалогов. Повторное добавление того же пути — no-op. */
  addRoot: (path: string) => Promise<void>;
  /** Удаление корня: закрывает вкладки потерявших корень файлов (после подтверждения в UI). */
  removeRoot: (path: string) => Promise<void>;
  setRootColor: (path: string, color: PaletteColor) => void;
  refreshRoot: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  /** Замена состава корней из workspace-файла (dirty уже решён в UI). */
  openWorkspaceFile: (wsPath: string) => Promise<void>;
  /** Новый пустой workspace в выбранном файле (dirty уже решён в UI). */
  newWorkspaceFile: (wsPath: string) => Promise<void>;
  /** Загрузка последнего workspace на старте; ошибка/отсутствие — чистый старт. */
  restoreLastWorkspace: () => Promise<void>;
  openFileDialog: () => Promise<void>;
  toggleDir: (path: string) => void;
  collapseAll: () => void;
  toggleShowHidden: () => void;
  openFile: (path: string) => Promise<void>;
  setActiveFilePath: (path: string | null) => void;
  selectDir: (path: string) => void;
  createFile: (path: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  renameEntry: (oldPath: string, newName: string) => Promise<void>;
  convertOfficeToMarkdown: (path: string) => Promise<void>;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
}

/** Счётчик загрузок деревьев в полёте — скалярный isLoadingTree (design D1). */
let pendingLoads = 0;

function beginTreeLoad(set: SetPartial) {
  pendingLoads++;
  set({isLoadingTree: true});
}

function endTreeLoad(set: SetPartial) {
  pendingLoads = Math.max(0, pendingLoads - 1);
  if (pendingLoads === 0) set({isLoadingTree: false});
}

/** Автозапись состава workspace (спека workspace-file): любое изменение — сразу на диск. */
async function persistWorkspace(
  roots: readonly RootInfo[],
  workspaceFilePath: string | null,
  set: SetPartial,
) {
  if (!workspaceFilePath) return;
  try {
    await writeFile(workspaceFilePath, serializeWorkspace(roots, workspaceFilePath));
  } catch (e) {
    set({error: i18n.t("errors.workspaceSave", {reason: String(e)})});
  }
}

/** Загрузка дерева корня; ошибка одного корня не блокирует остальные (деградация). */
async function loadRootTree(root: RootInfo, set: SetPartial, get: () => FileState) {
  beginTreeLoad(set);
  try {
    const tree = await listDirectory(root.path);
    // корень могли убрать, пока шла загрузка
    if (get().roots.some((r) => r.path === root.path)) {
      set({trees: {...get().trees, [root.path]: tree}});
    }
  } catch (e) {
    set({error: String(e)});
  } finally {
    endTreeLoad(set);
  }
}

export const useFileStore = create<FileState>((set, get) => ({
  roots: [],
  trees: {},
  workspaceFilePath: null,
  expandedPaths: {},
  showHidden: false,
  activeFilePath: null,
  activeDirPath: null,
  isLoadingTree: false,
  error: null,
  notice: null,

  addFolder: async () => {
    const path = await openFolderDialog();
    if (path) await get().addRootInteractive(path);
  },

  addRootInteractive: async (path) => {
    // Первый корень без файла workspace: сначала выбираем место файла, потом добавляем
    if (!get().workspaceFilePath) {
      const defaultPath = joinPath(path, `${getFileName(path)}.${WORKSPACE_EXTENSION}`);
      const wsPath = await saveWorkspaceFileDialog(defaultPath);
      if (!wsPath) return;
      set({workspaceFilePath: wsPath});
      useUiStore.getState().setLastWorkspacePath(wsPath);
    }
    await get().addRoot(path);
  },

  addRoot: async (path) => {
    const {roots} = get();
    const np = normalizePath(path);

    // Точный дубликат (тот же путь в любом виде) — no-op с уведомлением
    if (roots.some((r) => normalizePath(r.path) === np)) {
      set({notice: i18n.t("notices.rootAlreadyAdded", {name: getFileName(path)})});
      return;
    }

    // Вложенные корни — фича спеки (отдельная секция + свой цвет), но
    // информируем пользователя о пересечении с уже добавленными
    const owner = resolveRoot(path, roots);
    const nestedIn = owner && normalizePath(owner.path) !== np ? owner : null;
    const containsRoot = roots.find((r) => normalizePath(r.path).startsWith(np + "/")) ?? null;

    const root: RootInfo = {path, color: pickNextColor(roots)};
    set((s) => ({roots: [...s.roots, root], error: null}));
    if (nestedIn) {
      set({
        notice: i18n.t("notices.rootNested", {
          name: getFileName(path),
          parent: getFileName(nestedIn.path),
        }),
      });
    } else if (containsRoot) {
      set({
        notice: i18n.t("notices.rootContains", {
          name: getFileName(path),
          child: getFileName(containsRoot.path),
        }),
      });
    }
    // картинки phase 5: asset protocol получает доступ к папке; ошибка гранта не
    // блокирует работу — просто не покажутся изображения
    grantAssetScope(path).catch((e) => console.warn("grant_asset_scope failed:", e));
    // watcher идемпотентен: повторный watch того же пути — no-op
    watchFolder(path).catch((e) => console.warn("watch_folder failed:", e));
    await loadRootTree(root, set, get);
    await persistWorkspace(get().roots, get().workspaceFilePath, set);
  },

  removeRoot: async (path) => {
    const {roots} = get();
    if (!roots.some((r) => r.path === path)) return;
    // единая точка закрытия вкладок (design D7): только файлы, теряющие корень
    const losing = pathsLosingRoot(
      useEditorStore.getState().tabs.map((t) => t.path),
      roots,
      path,
    );
    const editor = useEditorStore.getState();
    for (const tabPath of losing) editor.closeTab(tabPath);
    set((s) => {
      const trees = {...s.trees};
      delete trees[path];
      const keep = (p: string | null) => (p && losing.includes(p) ? null : p);
      return {
        roots: s.roots.filter((r) => r.path !== path),
        trees,
        activeFilePath: keep(s.activeFilePath),
        activeDirPath: keep(s.activeDirPath),
      };
    });
    unwatchFolder(path).catch((e) => console.warn("unwatch_folder failed:", e));
    await persistWorkspace(get().roots, get().workspaceFilePath, set);
  },

  setRootColor: (path, color) => {
    if (!get().roots.some((r) => r.path === path)) return;
    set((s) => ({roots: s.roots.map((r) => (r.path === path ? {...r, color} : r))}));
    void persistWorkspace(get().roots, get().workspaceFilePath, set);
  },

  refreshRoot: async (path) => {
    if (!get().roots.some((r) => r.path === path)) return;
    try {
      const tree = await listDirectory(path);
      if (get().roots.some((r) => r.path === path)) {
        set((s) => ({trees: {...s.trees, [path]: tree}}));
      }
    } catch (e) {
      set({error: String(e)});
    }
  },

  refreshTree: async () => {
    for (const root of get().roots) {
      await get().refreshRoot(root.path);
    }
  },

  openWorkspaceFile: async (wsPath) => {
    let folders;
    try {
      folders = parseWorkspace(await readFile(wsPath));
    } catch (e) {
      const reason =
        e instanceof WorkspaceFormatError ? i18n.t("errors.workspaceBadFormat") : String(e);
      // чистый старт: состав не меняется, workspace-файл не назначается
      set({error: i18n.t("errors.workspaceLoad", {reason})});
      return;
    }
    const roots: RootInfo[] = folders.map((f) => ({
      path: resolveFolderPath(f.path, wsPath),
      color: f.color,
    }));
    await replaceRoots(roots, wsPath, set, get);
    useUiStore.getState().setLastWorkspacePath(wsPath);
  },

  newWorkspaceFile: async (wsPath) => {
    for (const old of get().roots) {
      unwatchFolder(old.path).catch((e) => console.warn("unwatch_folder failed:", e));
    }
    set({
      roots: [],
      trees: {},
      expandedPaths: {},
      workspaceFilePath: wsPath,
      error: null,
      activeFilePath: null,
      activeDirPath: null,
    });
    useUiStore.getState().setLastWorkspacePath(wsPath);
    await persistWorkspace([], wsPath, set);
  },

  restoreLastWorkspace: async () => {
    const wsPath = useUiStore.getState().lastWorkspacePath;
    if (!wsPath) return;
    await get().openWorkspaceFile(wsPath);
  },

  openFileDialog: async () => {
    const path = await openFileDialog();
    if (path) await get().openFile(path);
  },

  toggleDir: (path) => {
    const expanded = {...get().expandedPaths};
    if (expanded[path]) {
      delete expanded[path];
    } else {
      expanded[path] = true;
    }
    set({expandedPaths: expanded});
  },

  collapseAll: () => set({expandedPaths: {}}),

  toggleShowHidden: () => set((s) => ({showHidden: !s.showHidden})),

  openFile: async (path) => {
    const kind = getFileKind(path);
    if (kind === "unsupported") {
      set({error: i18n.t("errors.unsupportedType", {name: getFileName(path)})});
      return;
    }
    if (kind === "office") {
      set({error: null, activeFilePath: path});
      useUiStore.getState().setPendingConvertPath(path);
      return;
    }
    set({error: null, activeFilePath: path});
    // файл мог быть открыт вне корней (Ctrl+O / drag-and-drop) — грантим его
    // каталог; внутри корня грант избыточен, но идемпотентен
    grantAssetScope(getParentDir(path)).catch((e) => console.warn("grant_asset_scope failed:", e));
    try {
      const content = await readFile(path);
      useEditorStore.getState().openTab({path, kind, content});
    } catch (e) {
      set({error: String(e)});
    }
  },

  convertOfficeToMarkdown: async (path) => {
    try {
      const markdown = await convertToMarkdown(path);
      const target = replaceExtension(path, "md");
      await writeFile(target, markdown);
      await get().refreshTree();
      set({activeFilePath: target});
      useEditorStore.getState().openTab({path: target, kind: "markdown", content: markdown});
    } catch (e) {
      set({error: String(e)});
    }
  },

  setActiveFilePath: (path) => set({activeFilePath: path}),

  selectDir: (path) => set({activeDirPath: path}),

  createFile: async (path) => {
    try {
      await createFileFs(path);
    } catch (e) {
      set({error: String(e)});
      return;
    }
    set({activeFilePath: path});
    await get().refreshTree();
    const kind = getFileKind(path);
    // Офисные файлы не открываем пустыми — конвертация имеет смысл только для реального документа.
    if (kind === "markdown" || kind === "text") {
      useEditorStore.getState().openTab({path, kind, content: ""});
    }
  },

  deleteEntry: async (path) => {
    try {
      await deletePathFs(path);
    } catch (e) {
      set({error: String(e)});
      return;
    }
    // удалённый с диска корень уходит из workspace целиком
    if (get().roots.some((r) => r.path === path)) {
      await get().removeRoot(path);
      return;
    }
    const editor = useEditorStore.getState();
    if (editor.tabs.some((t) => t.path === path)) {
      editor.closeTab(path);
    }
    await get().refreshTree();
  },

  renameEntry: async (oldPath, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const newPath = joinPath(getParentDir(oldPath), trimmed);
    if (newPath === oldPath) return;

    const wasRoot = get().roots.some((r) => r.path === oldPath);

    try {
      await renamePath(oldPath, newPath);
    } catch (e) {
      set({error: String(e)});
      return;
    }

    useEditorStore.getState().remapPath(oldPath, newPath);

    set((s) => {
      const remap = (p: string | null) => (p ? (remapPath(p, oldPath, newPath) ?? p) : p);
      let {roots, trees} = s;
      if (wasRoot) {
        roots = s.roots.map((r) => (r.path === oldPath ? {...r, path: newPath} : r));
        trees = {};
        for (const [key, tree] of Object.entries(s.trees)) {
          trees[key === oldPath ? newPath : key] = tree;
        }
      }
      return {
        roots,
        trees,
        activeFilePath: remap(s.activeFilePath),
        activeDirPath: remap(s.activeDirPath),
      };
    });

    if (wasRoot) {
      grantAssetScope(newPath).catch((e) => console.warn("grant_asset_scope failed:", e));
      unwatchFolder(oldPath).catch((e) => console.warn("unwatch_folder failed:", e));
      watchFolder(newPath).catch((e) => console.warn("watch_folder failed:", e));
      await persistWorkspace(get().roots, get().workspaceFilePath, set);
    }

    await get().refreshTree();
  },

  setError: (error) => set({error}),

  setNotice: (notice) => set({notice}),
}));

/** Полная замена состава корней (открытие workspace): unwatch старых, деревья заново. */
async function replaceRoots(roots: RootInfo[], wsPath: string, set: SetPartial, get: () => FileState) {
  for (const old of get().roots) {
    unwatchFolder(old.path).catch((e) => console.warn("unwatch_folder failed:", e));
  }
  set({
    roots,
    trees: {},
    expandedPaths: {},
    workspaceFilePath: wsPath,
    error: null,
    activeFilePath: null,
    activeDirPath: null,
  });
  for (const root of roots) {
    grantAssetScope(root.path).catch((e) => console.warn("grant_asset_scope failed:", e));
    watchFolder(root.path).catch((e) => console.warn("watch_folder failed:", e));
  }
  await Promise.all(roots.map((root) => loadRootTree(root, set, get)));
}
