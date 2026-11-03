/**
 * Схема `vas-entity:` — носитель разметки сущностей в документе (Phase 8.5,
 * T3; план 20261105_001, T3-1): `[Иванову И. И.](vas-entity:person:01JBB…)`.
 * Тип — в href (решение пользователя 2026-11-05): переживает редактирование
 * ссылки через UI и копипаст, парсинг из одного места. Единая точка
 * разбора/сборки href для превью, редактора и маскирования — по образцу
 * `harnessUlidLink.ts`.
 */

import {isPlausibleUlid} from "../../harnessEnvelope";
import type {EntityType} from "./types";

export const VAS_ENTITY_SCHEME = "vas-entity:";

/** href хранит lowercase-форму; алиасу нужен верхний регистр EntityType. */
const TYPE_BY_LOWER: Readonly<Record<string, EntityType>> = {
  person: "PERSON",
  org: "ORG",
  loc: "LOC",
  secret: "SECRET",
  email: "EMAIL",
  phone: "PHONE",
  url_cred: "URL_CRED",
};

export interface VasEntityHref {
  type: EntityType;
  ulid: string;
}

/**
 * Разбор `vas-entity:<type>:<ULID>`. Некорректный тип/ULID -> null
 * (ссылка остаётся обычной, разметкой не считается).
 */
export function parseVasEntityHref(href: string | null | undefined): VasEntityHref | null {
  if (typeof href !== "string") return null;
  const value = href.trim();
  if (!value.toLowerCase().startsWith(VAS_ENTITY_SCHEME)) return null;
  const rest = value.slice(VAS_ENTITY_SCHEME.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  const type = TYPE_BY_LOWER[rest.slice(0, sep).trim().toLowerCase()];
  const ulid = rest.slice(sep + 1).trim().toUpperCase();
  if (type === undefined) return null;
  if (!isPlausibleUlid(ulid)) return null;
  return {type, ulid};
}

/** Сборка href для разметки (ручная разметка и предложения NER). */
export function buildVasEntityHref(type: EntityType, ulid: string): string {
  return `${VAS_ENTITY_SCHEME}${type.toLowerCase()}:${ulid.trim().toUpperCase()}`;
}
