/**
 * Типы ядра маскирования (Phase 8.5, T1; план 20261104_001).
 *
 * Детекторы находят чувствительные значения (спаны), реестр прогона даёт
 * стабильные алиасы `[[VAS_<TYPE>_<ULID>]]`. Источник ULID в T1 — генератор
 * прогона; с T3 (разметка `vas-entity:`) — постоянный ULID сущности, интерфейс
 * реестра одинаков для обоих источников (R3 плана).
 */

/** Тип сущности в алиасе (верхний регистр — часть алиаса, читается моделью). */
export type EntityType =
  | "PERSON"
  | "ORG"
  | "LOC"
  | "SECRET"
  | "EMAIL"
  | "PHONE"
  | "URL_CRED";

/** Идентификаторы детекторов — совпадают со значениями `masking.detectors` конфига. */
export type DetectorId = "secrets" | "email" | "phone" | "url_credentials";

/** Найденное чувствительное значение: спан [start, end) в исходном тексте. */
export interface DetectorSpan {
  start: number;
  end: number;
  /** Исходное значение (в audit не попадает). */
  value: string;
  type: EntityType;
  detector: DetectorId;
}

/** Сущность реестра прогона: значение + тип + стабильный ULID. */
export interface EntityRecord {
  ulid: string;
  type: EntityType;
  /** Исходное значение (в audit не попадает). */
  value: string;
}
