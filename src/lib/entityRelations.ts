/**
 * Связи между сущностями (Phase 8.5, T6-1; план 20261105_008).
 *
 * Справочник — граф: узлы (`entities.jsonl`) + рёбра (`relations.jsonl`).
 * Рёбра позволяют различать однофамильцев: у двух «Иванов Иван Иванович»
 * разные связи `works_at`, поэтому по контексту (организация рядом в абзаце)
 * выбирается нужный.
 *
 * Виды связей:
 * - `works_at` — персона → организация;
 * - `member_of` — персона/объект → проект;
 * - `role_in` — персона → роль в проекте;
 * - `alias_of` — тождество двух записей (одна сущность);
 * - `co_occurs` — выведенная: совместные появления (confidence `inferred`).
 *
 * Явные связи (`confidence: "explicit"`) ставит пользователь; выведенные —
 * считаются сканом. Файл — производный кэш, как `entities.jsonl`.
 */

import {readFile, writeFile} from "../hooks/useTauriFS";
import {defaultReadProbe, findHarnessRoot} from "./harnessIndex";

export const RELATIONS_FILE_NAME = "relations.jsonl";
/** В harness-репо — рядом с entities.jsonl. */
const HARNESS_RELATIONS_REL = `harness_docs/harness_index/${RELATIONS_FILE_NAME}`;

/** Сколько соседей храним на сущность в профиле co-occurs. */
export const CO_OCCURRENCE_TOP_N = 20;

export type EntityRelationKind = "works_at" | "member_of" | "role_in" | "alias_of" | "co_occurs";

export interface EntityRelation {
  /** ULID источника. */
  from: string;
  /** ULID цели. */
  to: string;
  kind: EntityRelationKind;
  /** `explicit` — поставил пользователь; `inferred` — посчитали сканом. */
  confidence: "explicit" | "inferred";
  /** Документ-источник (для co_occurs и для ручных связей). */
  source?: string;
  /** Свидетельство: текст, по которому связь выведена/поставлена. */
  evidence?: string;
}

/** Разбор JSONL: битые строки пропускаются. */
export function parseRelationsJsonl(text: string): EntityRelation[] {
  const out: EntityRelation[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const raw: unknown = JSON.parse(trimmed);
      if (typeof raw !== "object" || raw === null) continue;
      const rec = raw as Record<string, unknown>;
      if (typeof rec.from !== "string" || typeof rec.to !== "string") continue;
      if (!isRelationKind(rec.kind)) continue;
      const relation: EntityRelation = {
        from: rec.from,
        to: rec.to,
        kind: rec.kind,
        confidence: rec.confidence === "inferred" ? "inferred" : "explicit",
      };
      if (typeof rec.source === "string") relation.source = rec.source;
      if (typeof rec.evidence === "string") relation.evidence = rec.evidence;
      out.push(relation);
    } catch {
      // битая строка — пропускаем, файл производный
    }
  }
  return out;
}

function isRelationKind(value: unknown): value is EntityRelationKind {
  return (
    value === "works_at" ||
    value === "member_of" ||
    value === "role_in" ||
    value === "alias_of" ||
    value === "co_occurs"
  );
}

/** Сериализация: детерминированный порядок (from, to, kind). */
export function serializeRelationsJsonl(relations: EntityRelation[]): string {
  return [...relations]
    .sort((a, b) => {
      if (a.from !== b.from) return a.from < b.from ? -1 : 1;
      if (a.to !== b.to) return a.to < b.to ? -1 : 1;
      return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    })
    .map((relation) => {
      const record: Record<string, unknown> = {
        from: relation.from,
        to: relation.to,
        kind: relation.kind,
        confidence: relation.confidence,
      };
      if (relation.source) record.source = relation.source;
      if (relation.evidence) record.evidence = relation.evidence;
      return JSON.stringify(record);
    })
    .join("\n");
}

/** Ключ связи: одна и та же пара+вид — одна запись. */
export function relationKey(relation: EntityRelation): string {
  return `${relation.from}|${relation.to}|${relation.kind}`;
}

/**
 * Слияние: по ключу (from,to,kind). Явная связь не вытесняется выведенной:
 * при конфликте побеждает `explicit`.
 */
export function mergeRelations(
  existing: readonly EntityRelation[],
  incoming: readonly EntityRelation[],
): EntityRelation[] {
  const byKey = new Map<string, EntityRelation>();
  for (const relation of existing) byKey.set(relationKey(relation), relation);
  for (const relation of incoming) {
    const key = relationKey(relation);
    const known = byKey.get(key);
    if (!known) {
      byKey.set(key, relation);
      continue;
    }
    if (known.confidence === "inferred" && relation.confidence === "explicit") {
      byKey.set(key, relation);
    }
  }
  return [...byKey.values()];
}

/** Все рёбра, где сущность участвует (источник или цель). */
export function relationsFor(
  relations: readonly EntityRelation[],
  ulid: string,
): EntityRelation[] {
  return relations.filter((relation) => relation.from === ulid || relation.to === ulid);
}

/**
 * Кандидат, связанный с контекстом: явная связь важнее выведенной.
 *
 * @param candidates — ULID-ы кандидатов (однофамильцы).
 * @param contextUlids — ULID-ы сущностей, найденных рядом (в контексте).
 * @param relations — все связи.
 * @returns ULID кандидата с самой сильной связью или null.
 */
export function resolveByRelations(
  candidates: readonly string[],
  contextUlids: readonly string[],
  relations: readonly EntityRelation[],
): string | null {
  if (candidates.length === 0 || contextUlids.length === 0) return null;
  const context = new Set(contextUlids);
  let best: {ulid: string; score: number} | null = null;
  for (const ulid of candidates) {
    let score = 0;
    for (const relation of relations) {
      if (relation.kind === "co_occurs") continue;
      const touchesCandidate =
        (relation.from === ulid && context.has(relation.to)) ||
        (relation.to === ulid && context.has(relation.from));
      if (!touchesCandidate) continue;
      // явная связь сильнее выведенной; alias_of — самая сильная (тождество).
      const weight = relation.confidence === "explicit" ? 10 : 1;
      score += relation.kind === "alias_of" ? weight * 2 : weight;
    }
    if (score > 0 && (best === null || score > best.score)) best = {ulid, score};
  }
  return best?.ulid ?? null;
}

export interface CoOccurrenceProfile {
  /** Соседи сущности: ULID → число совместных появлений. */
  byEntity: Record<string, Record<string, number>>;
  /** Документы совместного появления: "from|to" → список путей. */
  docs: Record<string, string[]>;
}

/**
 * Профиль совместных появлений: какие сущности встречаются в одном
 * документе. Основа разрешения однофамильцев без ручных связей (T6-5).
 *
 * @param docEntities — сущности по документам: путь → ULID-ы.
 */
export function computeCoOccurrences(
  docEntities: ReadonlyMap<string, readonly string[]>,
  topN = CO_OCCURRENCE_TOP_N,
): CoOccurrenceProfile {
  const counts = new Map<string, Map<string, number>>();
  const docs = new Map<string, Set<string>>();
  for (const [doc, ulids] of docEntities) {
    const unique = [...new Set(ulids)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [a, b] = unique[i] < unique[j] ? [unique[i], unique[j]] : [unique[j], unique[i]];
        const key = pairKey(a, b);
        const byNeighbor = counts.get(a) ?? new Map<string, number>();
        byNeighbor.set(b, (byNeighbor.get(b) ?? 0) + 1);
        counts.set(a, byNeighbor);
        const byNeighborB = counts.get(b) ?? new Map<string, number>();
        byNeighborB.set(a, (byNeighborB.get(a) ?? 0) + 1);
        counts.set(b, byNeighborB);
        const docSet = docs.get(key) ?? new Set<string>();
        docSet.add(doc);
        docs.set(key, docSet);
      }
    }
  }
  const byEntity: Record<string, Record<string, number>> = {};
  for (const [ulid, neighbors] of counts) {
    const top = [...neighbors.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, topN);
    byEntity[ulid] = Object.fromEntries(top);
  }
  const docMap: Record<string, string[]> = {};
  for (const [key, set] of docs) docMap[key] = [...set].sort();
  return {byEntity, docs: docMap};
}

/** Ключ пары сущностей (порядок не важен). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Кандидат с максимумом совместных появлений с **контекстом** в этом
 * документе: «Иванов» встречается в документе вместе с «ООО Ромашка» 12 раз,
 * второй «Иванов» — 1 раз → побеждает первый.
 */
export function resolveByCoOccurrence(
  candidates: readonly string[],
  contextUlids: readonly string[],
  docPath: string,
  profile: CoOccurrenceProfile,
): string | null {
  if (candidates.length === 0 || contextUlids.length === 0) return null;
  let best: {ulid: string; score: number} | null = null;
  for (const ulid of candidates) {
    const neighbors = profile.byEntity[ulid] ?? {};
    let score = 0;
    for (const other of contextUlids) {
      const count = neighbors[other];
      if (count == null) continue;
      if (!profile.docs[pairKey(ulid, other)]?.includes(docPath)) continue;
      score += count;
    }
    if (score > 0 && (best === null || score > best.score)) best = {ulid, score};
  }
  return best?.ulid ?? null;
}

export interface RelationsIndexFile {
  path: string;
  relations: EntityRelation[];
}

const cache = new Map<string, RelationsIndexFile>();

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/\/+$/, "");
}

function joinPath(dir: string, name: string): string {
  return `${normalizeDir(dir)}/${name}`;
}

/**
 * Индекс связей для каталога: harness-репо — рядом с entities.jsonl, обычная
 * папка — файл рядом с каталогом. Кэш в памяти на путь (как у сущностей).
 */
export async function ensureRelationsIndex(dir: string): Promise<RelationsIndexFile> {
  const key = normalizeDir(dir);
  const cached = cache.get(key);
  if (cached) return cached;

  const root = await findHarnessRoot(key, defaultReadProbe);
  const path =
    root != null ? joinPath(root, HARNESS_RELATIONS_REL) : joinPath(key, RELATIONS_FILE_NAME);
  let relations: EntityRelation[] = [];
  try {
    relations = parseRelationsJsonl(await readFile(path));
  } catch {
    // файла нет — начинаем с пустого (производный кэш)
  }
  const file: RelationsIndexFile = {path, relations};
  cache.set(key, file);
  return file;
}

/** Тестовый хук: сброс кэша. */
export function resetRelationsIndexCache(): void {
  cache.clear();
}

/** Записать связи на диск и обновить кэш. */
export async function writeRelationsIndex(
  file: RelationsIndexFile,
  relations: EntityRelation[],
): Promise<void> {
  await writeFile(file.path, serializeRelationsJsonl(relations));
  file.relations = relations;
}
