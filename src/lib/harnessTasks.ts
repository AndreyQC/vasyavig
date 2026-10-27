/**
 * Данные дашборда задач (план 20261027_005, D1-D4): кандидаты — из реестра
 * `documents.jsonl` (фильтр по type из словаря), подробности — из шапок
 * файлов (task-yaml конверт). Доступ — через сменный интерфейс TaskSource
 * (D3): сейчас IndexTaskSource (реестр + файлы), позже — источник на БД без
 * изменений UI и стора. Словарь задач (types/kinds/statuses) читается из
 * манифеста репозитория `_docs_/manifest.json` (§3), при его отсутствии или
 * повреждении — встроенный дефолт.
 */

import {
  defaultReadProbe,
  HARNESS_MANIFEST_REL,
  type HarnessIndexEntry,
  type ReadProbe,
} from "./harnessIndex";
import {parseTaskEnvelope} from "./harnessEnvelope";
import {normalizeJoin} from "./utils";

/**
 * Парсится только шапка файла (конверты — в первых строках). Файл читается
 * целиком средствами Tauri (Rust-команда head — вне скоупа, src-tauri
 * заморожен), но разбор ограничен начальными символами.
 */
export const TASK_HEAD_CHARS = 4096;

export interface TaskDocRef {
  repoRoot: string;
  ulid: string;
  /** Путь от корня репо, posix-разделители (как в реестре). */
  path: string;
  project?: string;
  title?: string;
  updated?: string;
  /** type из реестра (до фильтра — он и отфильтрован по словарю). */
  registryType: string;
}

export interface TaskDetails {
  kind: string | null;
  /** Сырое значение из файла (срез кавычек/инлайн-комментария), без канона. */
  status: string | null;
  task: string | null;
  tracker: string | null;
  priority: string | null;
  assignee: string | null;
}

export interface TaskStatusDef {
  /** Каноническое значение статуса. */
  value: string;
  label: {ru: string; en: string};
  /** Токен цвета бейджа дашборда (CSS-класс); неизвестные токены — нейтральные. */
  color: string;
  /** Варианты из файлов, приводимые к канону (нормализация D2). */
  aliases: string[];
}

export interface TaskVocabulary {
  /** Какие type реестра считаются задачами (критерий отбора D4). */
  types: string[];
  /** Справочник kind конверта task-yaml (фильтр в UI). */
  kinds: string[];
  statuses: TaskStatusDef[];
}

/**
 * Дефолтный словарь = содержимое манифеста lm_hrdo_2 (факт скана реестра
 * 2026-10-27). Пока манифест не появился в других репо — значения по умолчанию.
 */
export const DEFAULT_TASK_VOCABULARY: TaskVocabulary = {
  types: ["tracker", "backlog"],
  kinds: ["daily-task", "backlog", "external-tracker-task", "internal-task"],
  statuses: [
    {value: "open", label: {ru: "Открыта", en: "Open"}, color: "blue", aliases: ["Открыта"]},
    {
      value: "in_progress",
      label: {ru: "В работе", en: "In progress"},
      color: "orange",
      aliases: ["В работе", "active"],
    },
    {
      value: "done",
      label: {ru: "Выполнена", en: "Done"},
      color: "green",
      aliases: ["Выполнена", "finalized"],
    },
    {value: "cancelled", label: {ru: "Отменена", en: "Cancelled"}, color: "gray", aliases: ["Отменена"]},
  ],
};

/** Срез кавычек и инлайн-комментария ` # …` (в примере: `open # open | …`); пустое → null. */
export function normalizeTaskValue(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  const comment = s.indexOf(" #");
  if (comment >= 0) s = s.slice(0, comment).trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s === "" ? null : s;
}

/** Канон статуса по словарю (без регистра): пустое → null, неизвестное — как есть. */
export function canonicalStatus(raw: string | null, vocab: TaskVocabulary): string | null {
  const v = normalizeTaskValue(raw);
  if (!v) return null;
  const lv = v.toLowerCase();
  for (const def of vocab.statuses) {
    if (def.value.toLowerCase() === lv) return def.value;
    if (def.aliases.some((a) => a.toLowerCase() === lv)) return def.value;
  }
  return v;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length === value.length ? out : null;
}

/**
 * Разобрать манифест: валидные поля замещают дефолт по отдельности; битые
 * или отсутствующие — остаются дефолтными. null — манифест не JSON.
 */
export function parseTaskVocabulary(text: string): TaskVocabulary | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const task = (raw as {vocabularies?: {task?: unknown}})?.vocabularies?.task;
  if (typeof task !== "object" || task === null) return null;
  const t = task as Record<string, unknown>;
  const types = asStringArray(t.types);
  const kinds = asStringArray(t.kinds);
  let statuses: TaskStatusDef[] | null = null;
  if (Array.isArray(t.statuses)) {
    statuses = t.statuses
      .filter(
        (s): s is Record<string, unknown> =>
          typeof s === "object" && s !== null && typeof (s as {value?: unknown}).value === "string",
      )
      .map((s) => {
        const value = s.value as string;
        const label = (s.label ?? {}) as {ru?: unknown; en?: unknown};
        return {
          value,
          label: {
            ru: typeof label.ru === "string" ? label.ru : value,
            en: typeof label.en === "string" ? label.en : value,
          },
          color: typeof s.color === "string" ? s.color : "neutral",
          aliases: asStringArray(s.aliases) ?? [],
        };
      });
  }
  return {
    types: types && types.length > 0 ? types : DEFAULT_TASK_VOCABULARY.types,
    kinds: kinds && kinds.length > 0 ? kinds : DEFAULT_TASK_VOCABULARY.kinds,
    statuses: statuses && statuses.length > 0 ? statuses : DEFAULT_TASK_VOCABULARY.statuses,
  };
}

/** Словарь репозитория: манифест, иначе (нет/битый) — встроенный дефолт. */
export async function loadTaskVocabulary(
  repoRoot: string,
  probe: ReadProbe = defaultReadProbe,
): Promise<TaskVocabulary> {
  const root = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const text = await probe(`${root}/${HARNESS_MANIFEST_REL}`);
  if (text == null) return DEFAULT_TASK_VOCABULARY;
  return parseTaskVocabulary(text) ?? DEFAULT_TASK_VOCABULARY;
}

/**
 * Сменный источник данных дашборда (D3). UI и стор знают только этот
 * интерфейс; переход на БД — новая реализация, потребители не меняются.
 */
export interface TaskSource {
  /** Словарь задач репозитория (манифест, иначе дефолт). */
  loadVocabulary(repoRoot: string): Promise<TaskVocabulary>;
  /** Кандидаты: записи реестра с task-типом из словаря (D1/D4). */
  listTaskDocs(repoRoot: string, vocab: TaskVocabulary): TaskDocRef[];
  /** Подробности task-yaml из шапки файла; null — конверта нет/битый. */
  loadTaskDetails(repoRoot: string, path: string): Promise<TaskDetails | null>;
}

export interface IndexTaskSourceDeps {
  /** Записи реестра репозитория (harnessStore); undefined — реестр ещё не загружен. */
  getEntries: (repoRoot: string) => HarnessIndexEntry[] | undefined;
  readProbe?: ReadProbe;
}

/** Реализация на реестре + шапках файлов (v1). */
export function createIndexTaskSource(deps: IndexTaskSourceDeps): TaskSource {
  const probe = deps.readProbe ?? defaultReadProbe;
  return {
    loadVocabulary: (repoRoot) => loadTaskVocabulary(repoRoot, probe),

    listTaskDocs: (repoRoot, vocab) => {
      const entries = deps.getEntries(repoRoot) ?? [];
      const types = new Set(vocab.types.map((t) => t.toLowerCase()));
      return entries
        .filter((e) => types.has((e.type ?? "").toLowerCase()))
        .map((e) => ({
          repoRoot,
          ulid: e.ulid,
          path: e.path,
          project: e.project,
          title: e.title,
          updated: e.updated,
          registryType: e.type ?? "",
        }));
    },

    loadTaskDetails: async (repoRoot, path) => {
      const content = await probe(normalizeJoin(repoRoot, path));
      if (content == null) return null;
      const env = parseTaskEnvelope(content.slice(0, TASK_HEAD_CHARS));
      if (!env) return null;
      return {
        kind: normalizeTaskValue(env.kind),
        status: normalizeTaskValue(env.status),
        task: normalizeTaskValue(env.task),
        tracker: normalizeTaskValue(env.tracker),
        priority: normalizeTaskValue(env.priority),
        assignee: normalizeTaskValue(env.assignee),
      };
    },
  };
}

/** Строка дашборда: ссылка реестра + подробности из файла. */
export interface TaskRow {
  ref: TaskDocRef;
  details: TaskDetails;
  /** Канон статуса по словарю (null — пусто; неизвестное — как есть). */
  statusCanonical: string | null;
}
