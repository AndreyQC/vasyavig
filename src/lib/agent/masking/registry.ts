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

/**
 * Резолвер постоянных сущностей (T3, R3): значение известно индексу
 * `entities.jsonl` (размечено в другом документе) -> его ULID, иначе null.
 * Вызывается до генерации per-run ULID; тип обязан совпадать.
 */
export type ExistingResolver = (value: string, type: EntityType) => string | null;

export class RunRegistry {
  /** Активный префикс алиасов (выбран по тексту документа, R9). */
  readonly prefix: PrefixCandidate;

  private readonly byKey = new Map<string, string>();
  private readonly records = new Map<string, EntityRecord>();
  private readonly resolveExisting: ExistingResolver | null;

  constructor(text: string, resolveExisting?: ExistingResolver) {
    this.prefix = choosePrefix(text);
    this.resolveExisting = resolveExisting ?? null;
  }

  /**
   * Постоянная сущность с фиксированным ULID — из разметки документа или
   * индекса (T3, R3). Повторный вызов с тем же ULID возвращает первую запись:
   * её value — каноническая форма (склонения дают один ULID, T3-2).
   */
  registerExisting(ulid: string, type: EntityType, value: string): EntityRecord {
    const known = this.records.get(ulid);
    if (known != null) return known;
    const record: EntityRecord = {ulid, type, value};
    this.records.set(ulid, record);
    const key = `${type}\u0000${value}`;
    if (!this.byKey.has(key)) this.byKey.set(key, ulid);
    return record;
  }

  /** Сущность по значению и типу; повторный вызов возвращает ту же запись. */
  createOrGet(value: string, type: EntityType): EntityRecord {
    const key = `${type}\u0000${value}`;
    const existing = this.byKey.get(key);
    if (existing != null) {
      const record = this.records.get(existing);
      if (record != null) return record;
    }
    if (this.resolveExisting != null) {
      const ulid = this.resolveExisting(value, type);
      if (ulid != null && ulid !== "") return this.registerExisting(ulid, type, value);
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
   *
   * Толерантен к «дрейфу» (T6-9, приём из guardrails): модель может вернуть
   * алиас с лишними пробелами или в другом регистре — `[[ VAS_PERSON_01J… ]]`.
   * Допускаем до 3 символов пробелов по краям и регистронезависимое сравнение.
   */
  aliasPattern(): RegExp {
    const typePart = "[A-Za-z_]+";
    const ulidPart = "[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}";
    const open = escapeRegExp(this.prefix.open);
    const close = escapeRegExp(this.prefix.close);
    return new RegExp(`${open}\\s{0,3}(${typePart})_(${ulidPart})\\s{0,3}${close}`, "gi");
  }
}
