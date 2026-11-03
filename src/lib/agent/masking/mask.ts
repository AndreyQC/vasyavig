/**
 * Маскирование текста (Phase 8.5, T1; план 20261104_001): детекторы → спаны →
 * алиасы реестра. Чистая функция, содержимое документа не покидает модуль:
 * наружу — маскированный текст и счётчики по типам (в audit значения не
 * попадают, D8).
 */

import {detectText} from "./detectors";
import {RunRegistry} from "./registry";
import type {DetectorId, EntityType} from "./types";

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

/** Заменить все найденные чувствительные значения алиасами реестра. */
export function maskText(
  text: string,
  registry: RunRegistry,
  detectors: readonly DetectorId[],
): MaskResult {
  const spans = detectText(text, detectors);
  const stats: Partial<Record<EntityType, number>> = {};
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    const record = registry.createOrGet(span.value, span.type);
    out += text.slice(cursor, span.start);
    out += registry.aliasOf(record);
    cursor = span.end;
    stats[span.type] = (stats[span.type] ?? 0) + 1;
  }
  out += text.slice(cursor);
  return {text: out, prefix: registry.prefix.open, count: spans.length, stats};
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
