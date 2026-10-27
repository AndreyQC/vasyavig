/**
 * ULID-ссылки в теле документа (task 20261027_001, формат C):
 * `[<имя файла>](ulid:<ULID>)`, ссылка на место — `ulid:<docULID>#<anchorULID>`.
 * Единая точка разбора/сборки href для превью и WYSIWYG.
 */
import {isPlausibleUlid} from "./harnessEnvelope";

export const ULID_SCHEME = "ulid:";

export interface UlidHref {
  /** ULID документа-цели. */
  ulid: string;
  /** ULID якоря внутри документа (Q9), если ссылка ведёт к месту. */
  anchor?: string;
}

function normalizeUlid(value: string): string {
  return value.trim().toUpperCase();
}

/** href начинается со схемы `ulid:` (без разбора остального). */
export function isUlidHref(href: string | null | undefined): boolean {
  return typeof href === "string" && href.trim().toLowerCase().startsWith(ULID_SCHEME);
}

/**
 * Разбор `ulid:<ULID>[#<ULID>]`. Некорректная схема/ULID/таймстемп -> null.
 * Регистр приводится к верхнему (Crockford base32).
 */
export function parseUlidHref(href: string | null | undefined): UlidHref | null {
  if (!isUlidHref(href)) return null;
  const raw = (href as string).trim().slice(ULID_SCHEME.length);
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
