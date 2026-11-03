/**
 * Маскирование текста (Phase 8.5, T1/T3; планы 20261104_001, 20261105_001):
 * спаны разметки `vas-entity:` (постоянные ULID) + детекторы → алиасы
 * реестра. Чистая функция, содержимое документа не покидает модуль: наружу —
 * маскированный текст и счётчики по типам (в audit значения не попадают, D8).
 */

import {detectText, mergeSpans} from "./detectors";
import {RunRegistry} from "./registry";
import type {DetectorId, EntityType} from "./types";
import type {EntityLinkSpan} from "./vasEntityMarkup";

export interface MaskResult {
  /** Маскированный текст (алиасы вместо значений). */
  text: string;
  /** Активный префикс алиасов (R9). */
  prefix: string;
  /** Сколько значений замаскировано. */
  count: number;
  /** Счётчики по типам — единственное, что уходит в audit (D8). */
  stats: Partial<Record<EntityType, number>>;
}

/** Внутренний спан маскирования: источник — разметка (ulid) или детектор. */
interface MaskSpan {
  start: number;
  end: number;
  type: EntityType;
  value: string;
  /** ULID из разметки: алиас постоянный (T3-5); нет — реестр решает сам. */
  ulid?: string;
}

/**
 * Заменить чувствительные значения алиасами реестра. Разметка `vas-entity:`
 * первична (T3-5): её спаны получают постоянные ULID; детекторы работают по
 * неразмеченному тексту (resolver может дать постоянный ULID из индекса,
 * остальное — per-run, R3). Пересечения — longest-wins (R8): конструкция
 * ссылки длиннее значения детектора внутри неё.
 */
export function maskText(
  text: string,
  registry: RunRegistry,
  detectors: readonly DetectorId[],
  entitySpans: readonly EntityLinkSpan[] = [],
): MaskResult {
  const spans: MaskSpan[] = entitySpans.map((link) => ({
    start: link.start,
    end: link.end,
    type: link.type,
    value: link.value,
    ulid: link.ulid,
  }));
  spans.push(...detectText(text, detectors));
  const merged = mergeSpans(spans);
  const stats: Partial<Record<EntityType, number>> = {};
  let out = "";
  let cursor = 0;
  for (const span of merged) {
    const record =
      span.ulid != null
        ? (registry.recordFor(span.ulid) ?? registry.registerExisting(span.ulid, span.type, span.value))
        : registry.createOrGet(span.value, span.type);
    out += text.slice(cursor, span.start);
    out += registry.aliasOf(record);
    cursor = span.end;
    stats[record.type] = (stats[record.type] ?? 0) + 1;
  }
  out += text.slice(cursor);
  return {text: out, prefix: registry.prefix.open, count: merged.length, stats};
}

/**
 * Правила и словарь алиасов для промпта (D9): модель видит «алиас → тип»,
 * никогда «алиас → значение». Требование сохранять плейсхолдеры дословно —
 * §3.9 п.4.
 */
export function maskingPromptNote(registry: RunRegistry): string {
  const records = registry.allRecords();
  if (records.length === 0) return "";
  return [
    "Чувствительные значения в документе заменены плейсхолдерами.",
    "Правила: сохраняйте плейсхолдеры дословно — не переводите, не перефразируйте и не сокращайте их; в replacement используйте плейсхолдеры ровно как в документе.",
    "Словарь плейсхолдеров (плейсхолдер — тип):",
    ...records.map((record) => `${registry.aliasOf(record)} — ${record.type.toLowerCase()}`),
  ].join("\n");
}
