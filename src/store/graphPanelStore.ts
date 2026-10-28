import {create} from "zustand";

/**
 * Состояние панели графа (UI, не данные): выбранный репозиторий, вид
 * демонстрации, фильтры обзора и раскрытые узлы дерева. Данные графа живут
 * в `harnessGraphStore` — здесь только то, что меняет сам пользователь.
 */

/** Вид демонстрационной панели: окрестность документа или обзор репозитория. */
export type GraphView = "around" | "overview";

interface GraphPanelState {
  /** Корень harness-репозитория, который показан (null — репозиторий не выбран). */
  repoRoot: string | null;
  view: GraphView;
  /** null — все проекты. */
  project: string | null;
  /** null — все типы. */
  type: string | null;
  /** Поиск по названию и пути. */
  query: string;
  /** Показывать только документы со связями (по умолчанию — да, Q5). */
  onlyLinked: boolean;
  /** Раскрытые узлы дерева по ULID. */
  expanded: Record<string, true>;

  setRepoRoot: (path: string | null) => void;
  setView: (view: GraphView) => void;
  setProject: (project: string | null) => void;
  setType: (type: string | null) => void;
  setQuery: (query: string) => void;
  setOnlyLinked: (onlyLinked: boolean) => void;
  toggleExpanded: (ulid: string) => void;
  collapseAll: () => void;
  reset: () => void;
}

export const useGraphPanelStore = create<GraphPanelState>((set) => ({
  repoRoot: null,
  view: "around",
  project: null,
  type: null,
  query: "",
  onlyLinked: true,
  expanded: {},

  setRepoRoot: (path) => set({repoRoot: path}),
  setView: (view) => set({view}),
  setProject: (project) => set({project}),
  setType: (type) => set({type}),
  setQuery: (query) => set({query}),
  setOnlyLinked: (onlyLinked) => set({onlyLinked}),
  toggleExpanded: (ulid) =>
    set((s) => {
      const expanded = {...s.expanded};
      if (expanded[ulid]) delete expanded[ulid];
      else expanded[ulid] = true;
      return {expanded};
    }),
  collapseAll: () => set({expanded: {}}),
  reset: () =>
    set({
      repoRoot: null,
      view: "around",
      project: null,
      type: null,
      query: "",
      onlyLinked: true,
      expanded: {},
    }),
}));
