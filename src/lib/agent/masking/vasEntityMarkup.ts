/**
 * Парсер инлайн-разметки сущностей (Phase 8.5, T3; план 20261105_001,
 * T3-4): находит чип-ссылки `[текст](vas-entity:<type>:<ULID>)` в raw
 * markdown. Спан покрывает всю конструкцию — при маскировании она целиком
 * заменяется алиасом (href наружу не идёт). Идентичность — по ULID: один
 * ULID может покрывать разные грамматические формы (склонения, T3-2).
 */

import type {EntityType} from "./types";
import {parseVasEntityHref} from "./vasEntityLink";

export interface EntityLinkSpan {
  /** Начало конструкции `[` в raw markdown. */
  start: number;
  /** Конец `)` включительно. */
  end: number;
  ulid: string;
  type: EntityType;
  /** Текст ссылки как в документе — может быть склонением канонической формы. */
  value: string;
}

/** Markdown-ссылка с любым href; фильтрация по схеме — parseVasEntityHref. */
const LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;

interface TextRange {
  from: number;
  to: number;
}

/** Диапазоны fenced-код-блоков: примеры ссылок внутри кода — не разметка. */
function fencedCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const fenceRe = /^ {0,3}(```|~~~)[^\n]*$/gm;
  let open: {start: number; marker: string} | null = null;
  for (const m of text.matchAll(fenceRe)) {
    const marker = m[1];
    if (!open) {
      open = {start: m.index, marker};
    } else if (marker === open.marker) {
      ranges.push({from: open.start, to: m.index + m[0].length});
      open = null;
    }
  }
  if (open) ranges.push({from: open.start, to: text.length});
  return ranges;
}

/** Все чип-ссылки сущностей в raw markdown (в порядке следования). */
export function parseEntityLinks(markdown: string): EntityLinkSpan[] {
  const excluded = fencedCodeRanges(markdown);
  const spans: EntityLinkSpan[] = [];
  for (const m of markdown.matchAll(LINK_RE)) {
    if (excluded.some((range) => m.index >= range.from && m.index < range.to)) continue;
    const parsed = parseVasEntityHref(m[2]);
    if (!parsed) continue;
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      ulid: parsed.ulid,
      type: parsed.type,
      value: m[1],
    });
  }
  return spans;
}

/** Запись сущности из разметки: каноническая форма + все формы (T3-2/T3-3). */
export interface MarkedEntityRecord {
  ulid: string;
  type: EntityType;
  /** Первое вхождение в порядке документа — детерминированная каноническая форма. */
  canonical: string;
  /** Уникальные тексты ссылок (склонения), sorted. */
  forms: string[];
}

export interface MarkedEntitiesResult {
  records: MarkedEntityRecord[];
  /** Один ULID с разными type в href — не блокирует, флаг для панели (T3b). */
  typeConflicts: Array<{ulid: string; types: EntityType[]}>;
}

/** Свести спаны в записи по ULID: canonical = первое вхождение (T3-2). */
export function collectMarkedEntities(spans: readonly EntityLinkSpan[]): MarkedEntitiesResult {
  const order: string[] = [];
  const byUlid = new Map<string, {type: EntityType; types: Set<EntityType>; canonical: string; forms: Set<string>}>();
  for (const span of spans) {
    let entry = byUlid.get(span.ulid);
    if (!entry) {
      entry = {type: span.type, types: new Set([span.type]), canonical: span.value, forms: new Set()};
      byUlid.set(span.ulid, entry);
      order.push(span.ulid);
    } else {
      entry.types.add(span.type);
    }
    entry.forms.add(span.value);
  }
  const records = order.map((ulid) => {
    const entry = byUlid.get(ulid)!;
    return {
      ulid,
      type: entry.type,
      canonical: entry.canonical,
      forms: [...entry.forms].sort(),
    };
  });
  const typeConflicts = [...byUlid.entries()]
    .filter(([, entry]) => entry.types.size > 1)
    .map(([ulid, entry]) => ({ulid, types: [...entry.types]}));
  return {records, typeConflicts};
}
