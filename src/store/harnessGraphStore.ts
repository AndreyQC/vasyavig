import {create} from "zustand";
import {buildDocumentGraph, type DocumentGraph, type DocumentNode} from "../lib/harnessGraph";
import {repoRelativePath, type HarnessIndexEntry} from "../lib/harnessIndex";
import {normalizePath} from "../lib/roots";
import {useHarnessStore} from "./harnessStore";

/**
 * Граф документов harness-репозитория (план 20261028_001, D2): производная
 * от реестра, который уже загружен в `harnessStore`. Источник данных сменится
 * на БД позже — тогда поменяется только он, UI и сам граф останутся прежними.
 *
 * Граф пересчитывается лениво: при обращении к корню сверяется ссылка на
 * массив записей реестра — если реестр не менялся, пересчёта нет.
 */

interface RootGraph {
  repoRoot: string;
  /** Ссылка на записи реестра — признак «реестр не изменился». */
  entries: readonly HarnessIndexEntry[];
  graph: DocumentGraph;
}

interface HarnessGraphState {
  graphs: Record<string /*нормализованный корень*/, RootGraph>;
  /** Растёт при пересчёте графа — триггер перерисовки панели. */
  version: number;
  /** Загрузить реестр (если ещё не загружен) и построить граф корня. */
  ensureGraph(repoRoot: string): Promise<void>;
  /** Пересчитать граф корня по текущему состоянию реестра. */
  syncGraph(repoRoot: string): void;
  /** Граф корня (undefined — реестр ещё не загружен). */
  getGraph(repoRoot: string): DocumentGraph | undefined;
  /** Запись реестра по абсолютному пути файла (null — не в реестре). */
  findByPath(repoRoot: string, filePath: string): DocumentNode | undefined;
  /** Только для тестов: сброс кэша. */
  reset(): void;
}

export const useHarnessGraphStore = create<HarnessGraphState>((set, get) => ({
  graphs: {},
  version: 0,

  ensureGraph: async (repoRoot) => {
    // реестр сам по себе грузится только при открытии markdown-файла
    // (MarkdownEditor -> ensureIndex); панель графа обязана быть
    // самостоятельной, иначе граф пуст до первого открытого файла репо
    await useHarnessStore.getState().ensureIndex(repoRoot);
    get().syncGraph(repoRoot);
  },

  syncGraph: (repoRoot) => {
    const rootKey = normalizePath(repoRoot);
    const index = useHarnessStore.getState().indexes[rootKey];
    if (!index) return;
    const current = get().graphs[rootKey];
    if (current && current.entries === index.entries) return; // реестр не менялся
    const graph = buildDocumentGraph(index.entries);
    set((s) => ({
      graphs: {...s.graphs, [rootKey]: {repoRoot, entries: index.entries, graph}},
      version: s.version + 1,
    }));
  },

  getGraph: (repoRoot) => get().graphs[normalizePath(repoRoot)]?.graph,

  findByPath: (repoRoot, filePath) => {
    const root = get().graphs[normalizePath(repoRoot)];
    if (!root) return undefined;
    const rel = repoRelativePath(root.repoRoot, filePath);
    if (!rel) return undefined;
    const ulid = root.graph.byPath[rel];
    return ulid ? root.graph.nodes[ulid] : undefined;
  },

  reset: () => set({graphs: {}, version: get().version + 1}),
}));
