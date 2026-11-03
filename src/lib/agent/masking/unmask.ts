/**
 * Unmask и валидация ответа модели (Phase 8.5, T1; план 20261104_001,
 * §3.9 п.5–6): восстановление значений по реестру, поиск неизвестных алиасов
 * и потерянных сущностей. Сырьё для notice и блокировки авто-apply в T1c:
 * полный remap не гарантирован (§3.9) — осознанное ограничение.
 */

import type {EntityRecord} from "./types";
import type {RunRegistry} from "./registry";

export interface UnmaskResult {
  /** Текст с восстановленными значениями (известные алиасы заменены). */
  text: string;
  /** Неизвестные алиасы (нет в реестре) — оставлены как есть, без дублей. */
  unknown: string[];
}

/** Заменить известные алиасы исходными значениями; неизвестные оставить как есть. */
export function unmaskText(text: string, registry: RunRegistry): UnmaskResult {
  const unknown: string[] = [];
  const seen = new Set<string>();
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(registry.aliasPattern())) {
    const full = match[0];
    const ulid = match[2] ?? "";
    const record = registry.recordFor(ulid);
    if (record == null) {
      if (!seen.has(full)) {
        seen.add(full);
        unknown.push(full);
      }
      continue;
    }
    out += text.slice(cursor, match.index);
    out += record.value;
    cursor = match.index + full.length;
  }
  out += text.slice(cursor);
  return {text: out, unknown};
}

/** Неизвестные алиасы в тексте (нет в реестре) — без замены, только список. */
export function scanUnknownAliases(text: string, registry: RunRegistry): string[] {
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(registry.aliasPattern())) {
    const full = match[0];
    const ulid = match[2] ?? "";
    if (registry.recordFor(ulid) == null && !seen.has(full)) {
      seen.add(full);
      unknown.push(full);
    }
  }
  return unknown;
}

/**
 * Потерянные сущности: алиасы, присутствовавшие в промпте, но отсутствующие
 * в ответе модели (модель потеряла или перефразировала). Порядок — создания
 * в реестре.
 */
export function missingAliasIds(
  maskedPrompt: string,
  response: string,
  registry: RunRegistry,
): EntityRecord[] {
  const missing: EntityRecord[] = [];
  for (const record of registry.allRecords()) {
    const alias = registry.aliasOf(record);
    if (maskedPrompt.includes(alias) && !response.includes(alias)) missing.push(record);
  }
  return missing;
}
