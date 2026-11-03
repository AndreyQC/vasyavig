/**
 * Реестр прогона маскирования (Phase 8.5, T1; план 20261104_001, R3/R9):
 * value+type → стабильный ULID → алиас `[[VAS_<TYPE>_<ULID>]]`. Одинаковые
 * значения получают один алиас в пределах прогона — основа связности
 * сущностей между документами (P1); с T3 ULID придёт из разметки
 * `vas-entity:`, интерфейс реестра не изменится.
 *
 * Таблица соответствий живёт только в памяти (D8) и никогда не попадает
 * в audit и логи.
 */

import type {EntityRecord, EntityType} from "./types";
import {generateUlid} from "./ulid";

interface PrefixCandidate {
  open: string;
  close: string;
}

/** R9: если разделитель встречается в тексте — берём следующий из списка. */
const PREFIX_CANDIDATES: readonly PrefixCandidate[] = [
  {open: "[[VAS_", close: "]]"},
  {open: "{{VAS_", close: "}}"},
  {open: "<<VAS_", close: ">>"},
  {open: "((VAS_", close: "))"},
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function choosePrefix(text: string): PrefixCandidate {
  for (const candidate of PREFIX_CANDIDATES) {
    if (!text.includes(candidate.open)) return candidate;
  }
  return PREFIX_CANDIDATES[PREFIX_CANDIDATES.length - 1];
}

export class RunRegistry {
  /** Активный префикс алиасов (выбран по тексту документа, R9). */
  readonly prefix: PrefixCandidate;

  private readonly byKey = new Map<string, string>();
  private readonly records = new Map<string, EntityRecord>();

  constructor(text: string) {
    this.prefix = choosePrefix(text);
  }

  /** Сущность по значению и типу; повторный вызов возвращает ту же запись. */
  createOrGet(value: string, type: EntityType): EntityRecord {
    const key = `${type}\u0000${value}`;
    const existing = this.byKey.get(key);
    if (existing != null) {
      const record = this.records.get(existing);
      if (record != null) return record;
    }
    const record: EntityRecord = {ulid: generateUlid(), type, value};
    this.byKey.set(key, record.ulid);
    this.records.set(record.ulid, record);
    return record;
  }

  /** Алиас сущности активным префиксом: `<open><TYPE>_<ULID><close>` (D4'). */
  aliasOf(record: EntityRecord): string {
    return `${this.prefix.open}${record.type}_${record.ulid}${this.prefix.close}`;
  }

  /** Запись по ULID (для unmask); undefined — алиас неизвестен. */
  recordFor(ulid: string): EntityRecord | undefined {
    return this.records.get(ulid);
  }

  /** Все записи реестра (порядок создания). */
  allRecords(): EntityRecord[] {
    return [...this.records.values()];
  }

  /** Число сущностей (для audit-счётчиков). */
  get size(): number {
    return this.records.size;
  }

  /**
   * Regex всех алиасов активного префикса: группы (TYPE)(ULID); совпадения
   * перебирать через matchAll.
   */
  aliasPattern(): RegExp {
    const typePart = "[A-Z_]+";
    const ulidPart = "[0-9A-HJKMNP-TV-Z]{26}";
    return new RegExp(`${escapeRegExp(this.prefix.open)}(${typePart})_(${ulidPart})${escapeRegExp(this.prefix.close)}`, "g");
  }
}
