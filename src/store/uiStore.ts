import {create} from "zustand";
import {persist} from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type UiLang = "ru" | "en";

/**
 * Содержимое сайдбара: дерево файлов, дашборд задач (план 20261027_005 §5)
 * или панель справочника (T6-2, план 20261105_011).
 */
export type SidebarMode = "tree" | "tasks" | "registry";

/**
 * Что показано в главной панели: документ активной вкладки или панель графа
 * (план 20261028_001, Q1). Граф — вкладка в верхней полосе главной панели,
 * закрывается крестиком, как обычная вкладка.
 */
export type MainPane = "doc" | "graph";

/** Запрос на правку mermaid-диаграммы в модалке (nodeView → модалка, design D3). */
export interface MermaidEditRequest {
  source: string;
  /** Вкладка-владелец: закрытие вкладки закрывает модалку (design D3). */
  ownerPath: string;
  /** Перенос правки в документ (транзакция редактора из nodeView). */
  apply: (next: string) => void;
}

/** Режим модалки создания: файл или папка (план 20261028_004, D3). */
export type CreateKind = "file" | "dir";

/** Позиция курсора для статус-бара (план 20261028_004, D5), 1-базная. */
export interface CursorPos {
  line: number;
  col: number;
}

interface UiState {
  theme: ThemeMode;
  lang: UiLang;
  /** Путь последнего открытого workspace-файла — восстановление на старте (спека workspace-file). */
  lastWorkspacePath: string | null;
  /** Недавние workspace-файлы, максимум 5 (план 20261028_004, D8). */
  recentWorkspaces: string[];
  /** Путь из Save As, ожидающий подтверждения смены формата md↔yfm. */
  pendingSaveAsPath: string | null;
  /** Вкладка (путь), ожидающая подтверждения закрытия. */
  pendingClosePath: string | null;
  /** Корень, удаление которого отложено до разрешения промпта (dirty-вкладки). */
  pendingRemoveRootPath: string | null;
  /** Workspace-файл, открытие которого отложено до разрешения промпта. */
  pendingOpenWorkspacePath: string | null;
  /** Путь нового workspace-файла, создание которого отложено до разрешения промпта. */
  pendingNewWorkspacePath: string | null;
  /** Путь файла/папки, ожидающий подтверждения удаления. */
  pendingDeletePath: string | null;
  /** Каталог, в котором создаётся новый файл (модалка «Создать файл»). */
  pendingCreateDir: string | null;
  /** Что создаётся в pendingCreateDir (план 20261028_004, D3). */
  pendingCreateKind: CreateKind;
  /** Офисный документ, ожидающий подтверждения конвертации в Markdown. */
  pendingConvertPath: string | null;
  /** Файл/папка, ожидающие переименования. */
  pendingRenamePath: string | null;
  /** Корень, псевдоним которого редактируется (план 20261028_002, D2). */
  pendingAliasPath: string | null;
  /** Markdown-вкладка, ожидающая выбора «заменить/вставить» оглавление. */
  pendingTocPath: string | null;
  /** Диаграмма mermaid, ожидающая правки в модалке. */
  pendingMermaidEdit: MermaidEditRequest | null;
  /** Содержимое сайдбара; сессионное — в persist не попадает (partialize). */
  sidebarMode: SidebarMode;
  /** Открыта ли вкладка «Граф» в главной панели. */
  graphTabOpen: boolean;
  /** Какая вкладка главной панели активна. */
  mainPane: MainPane;
  /** Открыта палитра быстрого открытия Ctrl+P (план 20261028_004, D7). */
  quickOpenOpen: boolean;
  /** Позиция курсора активной вкладки; null — неизвестна (D5). */
  cursorPos: CursorPos | null;
  /**
   * Подсветка форм справочника в WYSIWYG (T6-3, план 20261105_010): глобальный
   * флаг (пер-вкладные отключения не нужны, решение плана). Сессионная —
   * в persist не попадает.
   */
  registryHighlight: boolean;

  setTheme: (theme: ThemeMode) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  /** Открыть вкладку «Граф» и показать её. */
  openGraphTab: () => void;
  /** Закрыть вкладку «Граф» (главная панель возвращается к документу). */
  closeGraphTab: () => void;
  setMainPane: (pane: MainPane) => void;
  setLang: (lang: UiLang) => void;
  setLastWorkspacePath: (path: string | null) => void;
  setQuickOpenOpen: (open: boolean) => void;
  setCursorPos: (pos: CursorPos | null) => void;
  setRegistryHighlight: (on: boolean) => void;
  setPendingSaveAsPath: (path: string | null) => void;
  setPendingClosePath: (path: string | null) => void;
  setPendingRemoveRootPath: (path: string | null) => void;
  setPendingOpenWorkspacePath: (path: string | null) => void;
  setPendingNewWorkspacePath: (path: string | null) => void;
  setPendingDeletePath: (path: string | null) => void;
  setPendingCreateDir: (dir: string | null, kind?: CreateKind) => void;
  setPendingConvertPath: (path: string | null) => void;
  setPendingRenamePath: (path: string | null) => void;
  setPendingAliasPath: (path: string | null) => void;
  setPendingTocPath: (path: string | null) => void;
  setPendingMermaidEdit: (request: MermaidEditRequest | null) => void;
}

/** Настройки (theme, lang, последний workspace) персистятся в localStorage (идея §4.5). */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      lang: "ru",
      lastWorkspacePath: null,
      recentWorkspaces: [],
      pendingSaveAsPath: null,
      pendingClosePath: null,
      pendingRemoveRootPath: null,
      pendingOpenWorkspacePath: null,
      pendingNewWorkspacePath: null,
      pendingDeletePath: null,
      pendingCreateDir: null,
      pendingCreateKind: "file",
      pendingConvertPath: null,
      pendingRenamePath: null,
      pendingAliasPath: null,
      pendingTocPath: null,
      pendingMermaidEdit: null,
      sidebarMode: "tree",
      graphTabOpen: false,
      mainPane: "doc",
      quickOpenOpen: false,
      cursorPos: null,
      registryHighlight: true,

      setTheme: (theme) => set({theme}),
      setSidebarMode: (mode) => set({sidebarMode: mode}),
      openGraphTab: () => set({graphTabOpen: true, mainPane: "graph"}),
      closeGraphTab: () => set({graphTabOpen: false, mainPane: "doc"}),
      setMainPane: (pane) => set({mainPane: pane}),
      setLang: (lang) => set({lang}),
      // недавние workspace: вперёд, без дубликатов, максимум 5 (D8)
      setLastWorkspacePath: (path) =>
        set((s) => {
          if (!path) return {lastWorkspacePath: null};
          return {
            lastWorkspacePath: path,
            recentWorkspaces: [path, ...s.recentWorkspaces.filter((p) => p !== path)].slice(0, 5),
          };
        }),
      setQuickOpenOpen: (open) => set({quickOpenOpen: open}),
      setCursorPos: (pos) => set({cursorPos: pos}),
      setRegistryHighlight: (on) => set({registryHighlight: on}),
      setPendingSaveAsPath: (path) => set({pendingSaveAsPath: path}),
      setPendingClosePath: (path) => set({pendingClosePath: path}),
      setPendingRemoveRootPath: (path) => set({pendingRemoveRootPath: path}),
      setPendingOpenWorkspacePath: (path) => set({pendingOpenWorkspacePath: path}),
      setPendingNewWorkspacePath: (path) => set({pendingNewWorkspacePath: path}),
      setPendingDeletePath: (path) => set({pendingDeletePath: path}),
      // null (закрытие модалки) не сбрасывает kind — confirmCreate читает его до сброса
      setPendingCreateDir: (dir, kind) =>
        set((s) => ({
          pendingCreateDir: dir,
          pendingCreateKind: dir === null ? s.pendingCreateKind : (kind ?? "file"),
        })),
      setPendingConvertPath: (path) => set({pendingConvertPath: path}),
      setPendingRenamePath: (path) => set({pendingRenamePath: path}),
      setPendingAliasPath: (path) => set({pendingAliasPath: path}),
      setPendingTocPath: (path) => set({pendingTocPath: path}),
      setPendingMermaidEdit: (request) => set({pendingMermaidEdit: request}),
    }),
    {
      name: "vasyavig.settings",
      partialize: (s) => ({
        theme: s.theme,
        lang: s.lang,
        lastWorkspacePath: s.lastWorkspacePath,
        recentWorkspaces: s.recentWorkspaces,
      }),
    },
  ),
);
