import {create} from "zustand";
import {
  canonicalStatus,
  createIndexTaskSource,
  type TaskRow,
  type TaskSource,
  type TaskVocabulary,
} from "../lib/harnessTasks";
import {HARNESS_INDEX_REL} from "../lib/harnessIndex";
import {normalizePath} from "../lib/roots";
import {normalizeJoin} from "../lib/utils";
import {useHarnessStore} from "./harnessStore";

/**
 * Кэш дашборда задач (план 20261027_005, §4). Ключ — нормализованный корень
 * репо; кандидаты производятся от реестра harnessStore, подробности читаются
 * из шапок файлов лениво (при первом открытии дашборда) и патчатся точечно
 * по watcher-событиям. Инвалидация реестра сбрасывает корень целиком и
 * перезагружает его сразу — открытый дашборд не ждёт действий пользователя
 * (урок GUI-приёмки harnessStore).
 */

/** Параллельное чтение шапок: ограничение, чтобы не валить диск запросами. */
const DETAILS_CONCURRENCY = 8;

interface RootTasks {
  repoRoot: string;
  vocab: TaskVocabulary;
  rows: TaskRow[];
  /** Нормализованный абсолютный путь файла -> строка (точечный патч по watcher). */
  byPath: Map<string, TaskRow>;
}

interface HarnessTasksState {
  roots: Record<string /*нормализованный корень*/, RootTasks>;
  loading: Record<string, true>;
  /** Растёт при любом изменении — триггер перерисовки дашборда. */
  version: number;
  /** Загрузить словарь + подробности кандидатов (лениво, при открытии дашборда). */
  ensureTasks(repoRoot: string): Promise<void>;
  /** Событие watcher: .md — точечный патч; documents.jsonl — сброс и перезагрузка. */
  invalidatePath(path: string): void;
  /** Полная перезагрузка корня (кнопка «Обновить»). */
  refreshRoot(repoRoot: string): Promise<void>;
  /** Только для тестов: сброс кэша. */
  reset(): void;
}

export const useHarnessTasksStore = create<HarnessTasksState>((set, get) => {
  const source: TaskSource = createIndexTaskSource({
    getEntries: (repoRoot) => {
      const index = useHarnessStore.getState().indexes[normalizePath(repoRoot)];
      return index ? Object.values(index.byUlid) : undefined;
    },
  });

  const loadRows = async (repoRoot: string, vocab: TaskVocabulary): Promise<TaskRow[]> => {
    const refs = source.listTaskDocs(repoRoot, vocab);
    const rows: TaskRow[] = [];
    for (let i = 0; i < refs.length; i += DETAILS_CONCURRENCY) {
      const batch = refs.slice(i, i + DETAILS_CONCURRENCY);
      const details = await Promise.all(batch.map((ref) => source.loadTaskDetails(repoRoot, ref.path)));
      for (let j = 0; j < batch.length; j++) {
        // кандидат без task-yaml в файле из списка исключается (D2)
        const d = details[j];
        if (!d) continue;
        rows.push({
          ref: batch[j],
          details: d,
          statusCanonical: canonicalStatus(d.status, vocab),
        });
      }
    }
    return rows;
  };

  return {
    roots: {},
    loading: {},
    version: 0,

    ensureTasks: async (repoRoot) => {
      const rootKey = normalizePath(repoRoot);
      if (get().roots[rootKey] || get().loading[rootKey]) return;
      set((s) => ({loading: {...s.loading, [rootKey]: true}}));
      try {
        const vocab = await source.loadVocabulary(repoRoot);
        const rows = await loadRows(repoRoot, vocab);
        const byPath = new Map<string, TaskRow>();
        for (const row of rows) {
          byPath.set(normalizePath(normalizeJoin(repoRoot, row.ref.path)), row);
        }
        set((s) => ({
          roots: {...s.roots, [rootKey]: {repoRoot, vocab, rows, byPath}},
          version: s.version + 1,
        }));
      } finally {
        set((s) => {
          const loading = {...s.loading};
          delete loading[rootKey];
          return {loading};
        });
      }
    },

    invalidatePath: (path) => {
      const norm = normalizePath(path);
      if (norm.endsWith(`/${HARNESS_INDEX_REL}`)) {
        const rootKey = norm.slice(0, norm.length - HARNESS_INDEX_REL.length - 1);
        const existing = get().roots[rootKey];
        if (!existing) return;
        set((s) => {
          const roots = {...s.roots};
          delete roots[rootKey];
          return {roots, version: s.version + 1};
        });
        // перечитываем сразу: открытый дашборд не должен ждать действий
        void get()
          .ensureTasks(existing.repoRoot)
          .catch(() => {});
        return;
      }
      if (!norm.endsWith(".md")) return;
      // точечный патч: файл принадлежит загруженному harness-корню
      for (const [rootKey, root] of Object.entries(get().roots)) {
        if (!norm.startsWith(rootKey + "/")) continue;
        const row = root.byPath.get(norm);
        if (!row) continue; // нового файла нет в реестре — появится после make doc-index
        void source
          .loadTaskDetails(root.repoRoot, row.ref.path)
          .then((details) => {
            const current = get().roots[rootKey];
            if (!current || current.byPath.get(norm) !== row) return;
            const rows = current.rows.filter((r) => r !== row);
            const byPath = new Map(current.byPath);
            if (details) {
              const next: TaskRow = {
                ...row,
                details,
                statusCanonical: canonicalStatus(details.status, current.vocab),
              };
              rows.push(next);
              byPath.set(norm, next);
            } else {
              byPath.delete(norm);
            }
            set((s) => ({
              roots: {...s.roots, [rootKey]: {...current, rows, byPath}},
              version: s.version + 1,
            }));
          })
          .catch(() => {});
      }
    },

    refreshRoot: async (repoRoot) => {
      const rootKey = normalizePath(repoRoot);
      set((s) => {
        const roots = {...s.roots};
        delete roots[rootKey];
        return {roots, version: s.version + 1};
      });
      await get().ensureTasks(repoRoot);
    },

    reset: () => set({roots: {}, loading: {}, version: get().version + 1}),
  };
});
