/**
 * Движок разрешения сущностей по контексту (Phase 8.5, T6-5; план
 * 20261105_012): цепочка «якорь → единственная форма → явные связи →
 * co_occurs → конфликт». Разрешение не меняет данные — только предлагает
 * кандидата; фиксация решения — якорь (чип) в документе, явное действие
 * пользователя (тихая подмена исключена: co_occurs — только предложения).
 */

import type {EntityIndexEntry} from "./entitiesIndex";
import {
  resolveByCoOccurrence,
  resolveByRelations,
  type CoOccurrenceProfile,
  type EntityRelation,
} from "./entityRelations";

export interface ResolutionContext {
  /** Документ вхождения (для профиля co_occurs). */
  docPath: string;
  /**
   * ULID-ы других известных сущностей в контекст-блоке (кроме кандидатов):
   * организация рядом в абзаце различает однофамильцев.
   */
  contextUlids: readonly string[];
}

export type EntityResolution =
  | {status: "unique"; entry: EntityIndexEntry}
  | {status: "resolved"; entry: EntityIndexEntry; via: "relations" | "co_occurs"}
  | {status: "conflict"; candidates: EntityIndexEntry[]};

/**
 * Все записи, у которых value — canonical/форма/алиас (точное совпадение).
 * В отличие от matchEntityEntry (первая запись) — весь список: конфликты
 * начинаются там, где совпадений несколько.
 */
export function matchesOfForm(
  entries: readonly EntityIndexEntry[],
  value: string,
): EntityIndexEntry[] {
  return entries.filter(
    (entry) =>
      entry.canonical === value ||
      entry.forms.includes(value) ||
      (entry.aliases ?? []).includes(value),
  );
}

/**
 * Разрешить значение по контексту. null — значение не в справочнике.
 * Несколько кандидатов: явная связь с сущностью контекста сильнее профиля
 * co_occurs; ничья или пустой контекст — конфликт.
 */
export function resolveRegistryForm(
  value: string,
  context: ResolutionContext,
  entries: readonly EntityIndexEntry[],
  relations: readonly EntityRelation[],
  profile: CoOccurrenceProfile,
): EntityResolution | null {
  const candidates = matchesOfForm(entries, value);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return {status: "unique", entry: candidates[0]};

  const candidateUlids = candidates.map((c) => c.ulid);
  const byRelations = resolveByRelations(candidateUlids, context.contextUlids, relations);
  if (byRelations != null) {
    const entry = candidates.find((c) => c.ulid === byRelations);
    if (entry != null) return {status: "resolved", entry, via: "relations"};
  }
  const byCoOccurrence = resolveByCoOccurrence(
    candidateUlids,
    context.contextUlids,
    context.docPath,
    profile,
  );
  if (byCoOccurrence != null) {
    const entry = candidates.find((c) => c.ulid === byCoOccurrence);
    if (entry != null) return {status: "resolved", entry, via: "co_occurs"};
  }
  return {status: "conflict", candidates};
}
