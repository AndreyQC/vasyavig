import {create} from "zustand";
import {
  buildUlidIndex,
  defaultReadProbe,
  findHarnessIndex,
  HARNESS_INDEX_REL,
  harnessIndexPath,
  parseDocumentsJsonl,
  resolveUlid,
  type HarnessIndexEntry,
} from "../lib/harnessIndex";
import {normalizePath} from "../lib/roots";
import i18n from "../lib/i18n";
import {normalizeJoin} from "../lib/utils";
import {useFileStore} from "./fileStore";

/**
 * Кэш реестров harness-репозиториев (openspec task 20261025_001, план D4).
 * Ключ стора — нормализованный корень репо; кэш «каталог файла -> корень
 * репо» (включая отрицательный) — модульный, чтобы не ходить по дискам на
 * каждое открытие вкладки. Инвалидация — watcher-событие по пути индекса.
 */

interface RepoIndex {
  /** Корень репозитория в исходной форме (для склейки путей). */
  repoRoot: string;
  byUlid: Record<string, HarnessIndexEntry>;
}

interface HarnessState {
  indexes: Record<string /*нормализованный корень*/, RepoIndex>;
  /** Растёт при любом изменении индексов — триггер пересчёта превью/декораций. */
  version: number;
  /** Загрузить реестр для каталога файла (лениво, при открытии markdown-вкладки). */
  ensureIndex(dir: string): Promise<void>;
  /** Событие watcher: путь == <root>/_docs_/_index/documents.jsonl — перечитать реестр. */
  invalidatePath(path: string): void;
  /** Резолв ULID в записи реестра репозитория, которому принадлежит каталог. */
  resolveFor(dir: string, ulid: string):
    | {status: "found"; repoRoot: string; entry: HarnessIndexEntry}
    | {status: "unknown"}
    | {status: "ambiguous"};
}

/** Каталог -> корень репо (или null — репо нет); кэш переживает инвалидацию индекса. */
const rootCache = new Map<string, string | null>();

/** Только для тестов: сброс кэшей каталогов. */
export function resetHarnessCaches(): void {
  rootCache.clear();
}

export const useHarnessStore = create<HarnessState>((set, get) => ({
  indexes: {},
  version: 0,

  ensureIndex: async (dir) => {
    const dirKey = normalizePath(dir);
    let content: string | null = null;
    let root: string;
    const cached = rootCache.get(dirKey);
    if (cached === undefined) {
      const found = await findHarnessIndex(dir);
      rootCache.set(dirKey, found?.repoRoot ?? null);
      if (!found) return;
      root = found.repoRoot;
      content = found.content; // проба уже прочитала реестр — второго чтения нет
    } else {
      if (!cached) return; // репозитория с реестром нет
      root = cached;
    }
    const rootKey = normalizePath(root);
    if (get().indexes[rootKey]) return; // уже загружен (с этого или другого каталога)
    if (content === null) {
      content = await defaultReadProbe(harnessIndexPath(root)); // перезагрузка после инвалидации
      if (content === null) return; // реестр исчез — не блокируем просмотр
    }
    const byUlid = buildUlidIndex(parseDocumentsJsonl(content));
    const repoRoot = root;
    set((s) => ({
      indexes: {...s.indexes, [rootKey]: {repoRoot, byUlid}},
      version: s.version + 1,
    }));
  },

  invalidatePath: (path) => {
    const norm = normalizePath(path);
    const suffix = `/${HARNESS_INDEX_REL}`;
    if (!norm.endsWith(suffix)) return;
    const rootKey = norm.slice(0, norm.length - suffix.length);
    const existing = get().indexes[rootKey];
    if (!existing) return;
    // сбрасываем и СРАЗУ перечитываем: открытые вкладки не должны ждать
    // открытия новой markdown-вкладки, чтобы связи ожили (урок GUI-приёмки:
    // после git pull/make doc-index чипы оставались «неизвестными»)
    const next = {...get().indexes};
    delete next[rootKey];
    set({indexes: next, version: get().version + 1});
    void get()
      .ensureIndex(existing.repoRoot)
      .catch((e) => console.warn("harness index reload failed:", e));
  },

  resolveFor: (dir, ulid) => {
    const root = rootCache.get(normalizePath(dir));
    if (!root) return {status: "unknown"}; // репо не найден/индекс не загружен
    const index = get().indexes[normalizePath(root)];
    if (!index) return {status: "unknown"};
    const res = resolveUlid(index.byUlid, ulid);
    if (res.status === "found") {
      return {status: "found", repoRoot: index.repoRoot, entry: res.entry};
    }
    return res.status === "ambiguous" ? {status: "ambiguous"} : {status: "unknown"};
  },
}));

/**
 * Переход по ULID (план D5): резолв -> открытие документа вкладкой.
 * Неизвестный/неоднозначный — уведомление, просмотр не прерывается.
 * `anchor` (Q9) пока только фиксируется: переход к месту — отдельная задача.
 */
export async function openUlidTarget(dir: string, ulid: string, anchor?: string): Promise<void> {
  const res = useHarnessStore.getState().resolveFor(dir, ulid);
  const fileStore = useFileStore.getState();
  if (res.status === "found") {
    await fileStore.openFile(normalizeJoin(res.repoRoot, res.entry.path));
    if (anchor) fileStore.setNotice(i18n.t("harness.link.anchorSoon"));
    return;
  }
  if (res.status === "ambiguous") {
    fileStore.setNotice(i18n.t("harness.ulidAmbiguous"));
    return;
  }
  fileStore.setNotice(i18n.t("harness.ulidUnknown"));
}
