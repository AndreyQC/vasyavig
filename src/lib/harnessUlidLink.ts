/**
 * ULID-ссылки в теле документа (task 20261027_001, формат C; схема —
 * `harness_ulid:` с 20261027_003):
 * `[<имя файла>](harness_ulid:<ULID>)`,
 * якорь — `harness_ulid:<docULID>#<anchorULID>`.
 * Legacy `ulid:` читается, но не пишется.
 * Единая точка разбора/сборки href для превью и WYSIWYG.
 */
import {isPlausibleUlid} from "./harnessEnvelope";

export const ULID_SCHEME = "harness_ulid:";

/** Исторический формат (до 2026-10-27): читаем, но не пишем. */
export const LEGACY_ULID_SCHEME = "ulid:";

const ULID_SCHEMES = [ULID_SCHEME, LEGACY_ULID_SCHEME];

export interface UlidHref {
  /** ULID документа-цели. */
  ulid: string;
  /** ULID якоря внутри документа (Q9), если ссылка ведёт к месту. */
  anchor?: string;
}

function normalizeUlid(value: string): string {
  return value.trim().toUpperCase();
}

/** href начинается с одной из схем ULID-ссылки (новая или legacy). */
export function isUlidHref(href: string | null | undefined): boolean {
  if (typeof href !== "string") return false;
  const value = href.trim().toLowerCase();
  return ULID_SCHEMES.some((scheme) => value.startsWith(scheme));
}

function stripUlidScheme(href: string): string {
  const value = href.trim();
  const lower = value.toLowerCase();
  const scheme = ULID_SCHEMES.find((s) => lower.startsWith(s)) ?? "";
  return value.slice(scheme.length);
}

/**
 * Разбор `<scheme><ULID>[#<ULID>]`. Некорректная схема/ULID/таймстемп -> null.
 * Регистр приводится к верхнему (Crockford base32).
 */
export function parseUlidHref(href: string | null | undefined): UlidHref | null {
  if (!isUlidHref(href)) return null;
  const raw = stripUlidScheme(href as string);
  const hash = raw.indexOf("#");
  const docPart = normalizeUlid(hash === -1 ? raw : raw.slice(0, hash));
  if (!docPart || !isPlausibleUlid(docPart)) return null;
  if (hash === -1) return {ulid: docPart};
  const anchor = normalizeUlid(raw.slice(hash + 1));
  if (!anchor || !isPlausibleUlid(anchor)) return null;
  return {ulid: docPart, anchor};
}

/** Сборка href для вставки ссылки (ручной ввод/будущее автодополнение). */
export function buildUlidHref(ulid: string, anchor?: string): string {
  const doc = normalizeUlid(ulid);
  return anchor ? `${ULID_SCHEME}${doc}#${normalizeUlid(anchor)}` : `${ULID_SCHEME}${doc}`;
}
