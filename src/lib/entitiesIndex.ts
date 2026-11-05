/**
 * Словарь идентичности сущностей `entities.jsonl` (Phase 8.5, T3; план
 * 20261105_001, T3-3; вид строки — решение пользователя 2026-11-05):
 * одна строка JSONL = одна сущность `{ulid, type, canonical, forms[]}`.
 *
 * - `canonical` — эталонная форма (хранимое решение: первая размеченная);
 * - `forms` — все наблюдаемые тексты ссылок ULID (матчинг склонений:
 *   «форму видел где-то → узнал здесь»);
 * - `docs`/`occurrences` НЕ храним — считаются на лету сканом.
 *
 * Производный кэш: источник истины — разметка в документах (D8'); файл
 * дополняется инкрементально при сохранении размеченного документа, полный
 * пересбор — T3b. Значения наружу (модель/audit/логи) не уходят.
 */

import {readFile, writeFile} from "../hooks/useTauriFS";
import {defaultReadProbe, findHarnessRoot} from "./harnessIndex";
import type {EntityType} from "./agent/masking/types";
import {collectMarkedEntities, parseEntityLinks} from "./agent/masking/vasEntityMarkup";
import {expandEntityForms} from "./agent/masking/declension";
import {generateUlid} from "./agent/masking/ulid";

export const ENTITIES_FILE_NAME = "entities.jsonl";
/** В harness-репо лежит рядом с documents.jsonl. */
const HARNESS_ENTITIES_REL = `harness_docs/harness_index/${ENTITIES_FILE_NAME}`;

export interface EntityIndexEntry {
  ulid: string;
  /** lowercase-форма EntityType (как в href). */
  type: string;
  canonical: string;
  /** Наблюдаемые в документах тексты (из разметки/скана). */
  forms: string[];
  /**
   * Ручные формы сущности (T6-1): кросс-языковые синонимы, «John Smith» ≡
   * «Иванов Иван Иваныч». Наблюдаемых форм не портят — при merge/scan
   * сохраняются (раньше терялись). Необязательное поле: в файлах T3 его нет.
   */
  aliases?: string[];
}

/** Разбор JSONL: битые/неполные строки пропускаются. */
export function parseEntitiesJsonl(text: string): EntityIndexEntry[] {
  const entries: EntityIndexEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const raw: unknown = JSON.parse(trimmed);
      if (typeof raw !== "object" || raw === null) continue;
      const rec = raw as Record<string, unknown>;
      if (typeof rec.ulid !== "string" || typeof rec.type !== "string") continue;
      if (typeof rec.canonical !== "string" || !Array.isArray(rec.forms)) continue;
      const forms = rec.forms.filter((f): f is string => typeof f === "string");
      if (forms.length === 0) continue;
      // `aliases` — поле T6-1; в старых файлах отсутствует → пусто (бэкомпат).
      const aliases = Array.isArray(rec.aliases)
        ? rec.aliases.filter((a): a is string => typeof a === "string")
        : [];
      entries.push({
        ulid: rec.ulid,
        type: rec.type,
        canonical: rec.canonical,
        forms: [...new Set([rec.canonical, ...forms])].sort(),
        aliases: [...new Set(aliases)].sort(),
      });
    } catch {
      // битая строка — пропускаем, файл производный
    }
  }
  return entries;
}

/** Сериализация: sorted по ulid, одна строка на сущность. */
export function serializeEntitiesJsonl(entries: EntityIndexEntry[]): string {
  return [...entries]
    .sort((a, b) => (a.ulid < b.ulid ? -1 : a.ulid > b.ulid ? 1 : 0))
    .map((entry) => {
      const record: Record<string, unknown> = {
        ulid: entry.ulid,
        type: entry.type,
        canonical: entry.canonical,
        forms: [...new Set([entry.canonical, ...entry.forms])].sort(),
      };
      // пустые aliases не пишем — файл остаётся совместимым с T3-форматом.
      const aliases = [...new Set(entry.aliases ?? [])].sort();
      if (aliases.length > 0) record.aliases = aliases;
      return JSON.stringify(record);
    })
    .join("\n");
}

export interface MergeEntitiesResult {
  entries: EntityIndexEntry[];
  /** Один ULID с разными type — флаг для панели (T3b). */
  typeConflicts: Array<{ulid: string; types: string[]}>;
}

/**
 * Слияние индексов по ULID: canonical и type существующей записи неизменны
 * (первая размеченная форма — решение, T3-2), forms — объединение.
 * Ручные `aliases` (T6-1) сохраняются: скан/пересборка их не теряет.
 */
export function mergeEntitiesIndex(
  existing: readonly EntityIndexEntry[],
  incoming: readonly EntityIndexEntry[],
): MergeEntitiesResult {
  const byUlid = new Map<string, EntityIndexEntry>();
  for (const entry of existing) {
    byUlid.set(entry.ulid, {
      ...entry,
      forms: [...new Set([entry.canonical, ...entry.forms])].sort(),
      aliases: [...new Set(entry.aliases ?? [])].sort(),
    });
  }
  const conflicts: Array<{ulid: string; types: string[]}> = [];
  for (const entry of incoming) {
    const known = byUlid.get(entry.ulid);
    if (!known) {
      byUlid.set(entry.ulid, {
        ...entry,
        forms: [...new Set([entry.canonical, ...entry.forms])].sort(),
        aliases: [...new Set(entry.aliases ?? [])].sort(),
      });
      continue;
    }
    if (known.type !== entry.type) {
      const types = [...new Set([known.type, entry.type])];
      if (!conflicts.some((c) => c.ulid === entry.ulid)) conflicts.push({ulid: entry.ulid, types});
    }
    known.forms = [...new Set([...known.forms, entry.canonical, ...entry.forms])].sort();
    known.aliases = [...new Set([...(known.aliases ?? []), ...(entry.aliases ?? [])])].sort();
  }
  return {entries: [...byUlid.values()], typeConflicts: conflicts};
}

/**
 * Точное совпадение значения с формой/каноном/алиасом записи (матчинг
 * склонений). Алиас (ручной, T6-1) проверяется первым — это явное намерение
 * пользователя, оно сильнее наблюдаемой формы.
 */
export function matchEntityEntry(
  entries: readonly EntityIndexEntry[],
  value: string,
  type?: EntityType,
  opts?: {fuzzy?: boolean},
): EntityIndexEntry | null {
  const wantType = type?.toLowerCase();
  // алиас — ручное намерение пользователя (кросс-языковая связка)
  for (const entry of entries) {
    if (wantType != null && entry.type !== wantType) continue;
    if ((entry.aliases ?? []).includes(value)) return entry;
  }
  // точное — приоритет: наблюдаемые формы важнее сгенерированных
  for (const entry of entries) {
    if (wantType != null && entry.type !== wantType) continue;
    if (entry.canonical === value || entry.forms.includes(value)) return entry;
  }
  if (opts?.fuzzy !== true) return null;
  // T3d: сгенерированные падежные формы (person/loc) — неразмеченные склонения
  for (const entry of entries) {
    if (wantType != null && entry.type !== wantType) continue;
    if (expandEntityForms(entry.canonical, entry.type).includes(value)) return entry;
  }
  return null;
}

export interface EntitiesIndexFile {
  /** Путь к файлу индекса (может ещё не существовать). */
  path: string;
  entries: EntityIndexEntry[];
}

const cache = new Map<string, EntitiesIndexFile>();

/**
 * Подписчики на изменение файла индекса (T6-3): runtime-подсветка
 * перестраивает декорации, когда индекс записан (save/rebuild/панель) или
 * изменён извне (watcher → invalidate). Аргумент — путь файла индекса.
 */
type EntitiesIndexListener = (path: string) => void;
const indexListeners = new Set<EntitiesIndexListener>();

/** Подписка на изменения файла индекса; возвращает отписку. */
export function subscribeEntitiesIndex(listener: EntitiesIndexListener): () => void {
  indexListeners.add(listener);
  return () => {
    indexListeners.delete(listener);
  };
}

function notifyEntitiesIndex(path: string): void {
  for (const listener of indexListeners) listener(path);
}

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/\/+$/, "");
}

function joinPath(dir: string, name: string): string {
  return `${normalizeDir(dir)}/${name}`;
}

/**
 * Индекс сущностей для каталога: harness-репо — по якорю `harness.yaml`
 * (HY-1) → `harness_docs/harness_index/entities.jsonl`, обычная папка — файл
 * рядом с workspace (каталогом). Кэш в памяти на путь.
 */
export async function ensureEntitiesIndex(dir: string): Promise<EntitiesIndexFile> {
  const key = normalizeDir(dir);
  const cached = cache.get(key);
  if (cached) return cached;

  const root = await findHarnessRoot(key, defaultReadProbe);
  const path = root != null ? joinPath(root, HARNESS_ENTITIES_REL) : joinPath(key, ENTITIES_FILE_NAME);
  let entries: EntityIndexEntry[] = [];
  try {
    const text = await readFile(path);
    entries = parseEntitiesJsonl(text);
  } catch {
    // файла нет или не читается — начинаем с пустого (производный кэш)
  }
  const file: EntitiesIndexFile = {path, entries};
  cache.set(key, file);
  return file;
}

/** Тестовый хук: сброс кэша (и подмена каталога). */
export function resetEntitiesIndexCache(): void {
  cache.clear();
}

/**
 * Сброс кэша по пути файла (watcher, B-5): изменился entities.jsonl —
 * кэш каталога устарел, следующий ensureEntitiesIndex перечитает с диска.
 */
export function invalidateEntitiesIndex(path: string): void {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  if (!norm.endsWith(`/${ENTITIES_FILE_NAME}`)) return;
  for (const key of [...cache.keys()]) {
    const file = cache.get(key);
    if (file && file.path.replace(/\\/g, "/").toLowerCase() === norm) {
      cache.delete(key);
      notifyEntitiesIndex(file.path);
    }
  }
}

/**
 * Инкремент индекса содержимым документа (save-хук, T3-11): разметка ->
 * записи {ulid, type, canonical, forms} -> merge -> запись на диск.
 * Ошибки глотаются: индекс производный, send не должен падать.
 */
export async function updateEntitiesIndexForContent(dir: string, markdown: string): Promise<void> {
  try {
    const marked = collectMarkedEntities(parseEntityLinks(markdown));
    const file = await ensureEntitiesIndex(dir);
    const incoming: EntityIndexEntry[] = marked.records.map((record) => ({
      ulid: record.ulid,
      type: record.type.toLowerCase(),
      canonical: record.canonical,
      forms: record.forms,
    }));
    const {entries} = mergeEntitiesIndex(file.entries, incoming);
    await writeEntitiesIndex(file, entries);
  } catch {
    // индекс — кэш; сбой записи не ломает сохранение документа
  }
}

/**
 * Новая запись справочника без разметки документа (T6-4): NER-предложение
 * «В справочник» / «Создать отдельную» (однофамилец). Запись с свежим ULID
 * мержится в индекс и пишется на диск; возвращается записанная запись.
 * Совпадение канона с формой другой записи не проверяется — это осознанное
 * действие пользователя (неоднозначность разрешает панель, T6-5).
 */
export async function addEntityToIndex(
  dir: string,
  spec: {type: string; canonical: string; forms?: string[]; aliases?: string[]},
): Promise<EntityIndexEntry> {
  const file = await ensureEntitiesIndex(dir);
  const entry: EntityIndexEntry = {
    ulid: generateUlid(),
    type: spec.type.toLowerCase(),
    canonical: spec.canonical,
    forms: spec.forms ?? [],
    aliases: spec.aliases ?? [],
  };
  const {entries} = mergeEntitiesIndex(file.entries, [entry]);
  await writeEntitiesIndex(file, entries);
  return entry;
}

/** Записать индекс на диск и обновить кэш (rebuild/решения панели, B-3). */
export async function writeEntitiesIndex(
  file: EntitiesIndexFile,
  entries: EntityIndexEntry[],
): Promise<void> {
  await writeFile(file.path, serializeEntitiesJsonl(entries));
  file.entries = entries;
  notifyEntitiesIndex(file.path);
}
