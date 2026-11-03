/**
 * Схема `vas-entity:` — носитель разметки сущностей в документе (Phase 8.5,
 * T3/T3c; планы 20261105_001/002): `[Иванову И. И.](vas-entity:person:01JBB…)`.
 * Тип — в href (решение пользователя 2026-11-05): переживает редактирование
 * ссылки через UI и копипаст, парсинг из одного места. С T3c токен типа
 * валидируется справочником `harness.yaml` (система ∪ кастомные, HY-5);
 * кастомные типы не маскируются, но размечаются и собираются в индекс.
 */

import {isPlausibleUlid} from "../../harnessEnvelope";
import {knownEntityTypeToken, systemTypeOfToken} from "../../entityTypes";
import type {EntityType} from "./types";

export const VAS_ENTITY_SCHEME = "vas-entity:";

export interface VasEntityHref {
  /** lowercase-токен: системный (person…) или кастомный (project…) из справочника. */
  type: string;
  ulid: string;
}

/**
 * Разбор `vas-entity:<type>:<ULID>`. Некорректный тип (неизвестен
 * справочнику)/ULID -> null (ссылка остаётся обычной, разметкой не считается).
 */
export function parseVasEntityHref(href: string | null | undefined): VasEntityHref | null {
  if (typeof href !== "string") return null;
  const value = href.trim();
  if (!value.toLowerCase().startsWith(VAS_ENTITY_SCHEME)) return null;
  const rest = value.slice(VAS_ENTITY_SCHEME.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  const type = rest.slice(0, sep).trim().toLowerCase();
  const ulid = rest.slice(sep + 1).trim().toUpperCase();
  if (!knownEntityTypeToken(type)) return null;
  if (!isPlausibleUlid(ulid)) return null;
  return {type, ulid};
}

/** Сборка href для разметки: токен как есть (lowercase), ULID — верхний регистр. */
export function buildVasEntityHref(type: string, ulid: string): string {
  return `${VAS_ENTITY_SCHEME}${type.toLowerCase()}:${ulid.trim().toUpperCase()}`;
}

/** Системный EntityType по токену (алиас/статистика маскирования); null — кастомный. */
export function systemEntityType(hrefType: string): EntityType | null {
  return systemTypeOfToken(hrefType);
}
