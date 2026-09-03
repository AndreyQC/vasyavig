/**
 * Минимальный разбор .eml (plain-text скоуп, design D2): заголовки
 * (RFC 5322 + encoded-words RFC 2047) и первая часть text/plain
 * (content-transfer-encoding + charset). HTML и вложения не разбираются.
 *
 * Вход — latin-1 транспортировка байтов файла (команда read_file_latin1):
 * каждый символ строки равен байту файла; все декодирования кодировок
 * (utf-8 / windows-1251 / koi8-r и др.) выполняются здесь через TextDecoder.
 */

export interface ParsedEmlHeaders {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
}

export interface ParsedEml {
  headers: ParsedEmlHeaders;
  /** Тело из text/plain-части; null — текстовой части нет (html-only и т.п.). */
  textBody: string | null;
  /** Файл не похож на MIME-сообщение (пустой / нет блока заголовков). */
  parseError?: string;
}

/* ---------- байтовые помощники ---------- */

function toBytes(raw: string): Uint8Array {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xff;
  return out;
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return s;
}

function base64ToBytes(b64: string): Uint8Array | null {
  const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (!cleaned) return null;
  try {
    const bin = atob(cleaned);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hexVal(b: number | undefined): number {
  if (b === undefined) return -1;
  if (b >= 0x30 && b <= 0x39) return b - 0x30; // 0-9
  if (b >= 0x41 && b <= 0x46) return b - 0x37; // A-F
  if (b >= 0x61 && b <= 0x66) return b - 0x57; // a-f
  return -1;
}

function isHexChar(ch: string | undefined): boolean {
  return ch !== undefined && hexVal(ch.charCodeAt(0)) >= 0;
}

/* ---------- кодировки ---------- */

/** Псевдонимы, которые TextDecoder не знает; суффикс языка RFC 2231 отбрасывается. */
const CHARSET_ALIASES: Record<string, string> = {
  cp1251: "windows-1251",
  cp1252: "windows-1252",
  cp1250: "windows-1250",
  cp866: "ibm866",
  koi8: "koi8-r",
  "koi8-ru": "koi8-r",
};

function normalizeCharset(raw: string): string {
  const name = raw.split("*")[0].trim().toLowerCase();
  return CHARSET_ALIASES[name] ?? name;
}

function decodeCharset(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(normalizeCharset(charset)).decode(bytes);
  } catch {
    // неизвестная метка кодировки — лучший доступный текст
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/* ---------- encoded-words RFC 2047 (заголовки) ---------- */

/** Q-кодирование слова: `_` = пробел, `=XX` = байт, прочее — литеральный ASCII. */
function decodeQWord(data: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (ch === "_") {
      out.push(0x20);
    } else if (ch === "=" && isHexChar(data[i + 1]) && isHexChar(data[i + 2])) {
      out.push(parseInt(data.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/**
 * Декодирует encoded-words в значении заголовка. Смежные слова (между ними
 * только пробелы/переводы строк) склеиваются без разделителя (RFC 2047 §6.2);
 * маркер \u0000 держит склейку при повторных проходах.
 */
export function decodeRfc2047(value: string): string {
  let prev: string;
  do {
    prev = value;
    value = value.replace(
      /(=\?[^?]*\?[bBqQ]\?[^?]*\?=)[ \t\r\n]+(=\?[^?]*\?[bBqQ]\?[^?]*\?=)/g,
      "$1\u0000$2",
    );
  } while (value !== prev);

  return value
    .replace(/=\?([^?]*)\?([bBqQ])\?([^?]*)\?=/g, (match, charset: string, enc: string, data: string) => {
      const bytes =
        enc.toUpperCase() === "B" ? base64ToBytes(data.replace(/\s+/g, "")) : decodeQWord(data);
      return bytes ? decodeCharset(bytes, charset) : match;
    })
    .replace(/\u0000/g, "");
}

/* ---------- структура MIME ---------- */

interface HeaderBody {
  headerBlock: string;
  bodyBytes: Uint8Array;
}

/** Делит сообщение на блок заголовков и тело по первой пустой строке. */
function splitHeaderBody(raw: string): HeaderBody | null {
  const m = /\r\n\r\n|\n\n/.exec(raw);
  if (!m || m.index === 0) return null;
  const bytes = toBytes(raw);
  return {headerBlock: raw.slice(0, m.index), bodyBytes: bytes.subarray(m.index + m[0].length)};
}

/** Заголовки с unfolding-ом продолжений; ключи в нижнем регистре. */
function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const keys: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      const last = keys[keys.length - 1];
      if (last !== undefined) headers[last] += " " + line.trim();
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (headers[name] === undefined) {
      headers[name] = value;
      keys.push(name);
    } else {
      headers[name] += ", " + value;
    }
  }
  return headers;
}

function parseContentType(ct: string): {mime: string; params: Record<string, string>} {
  const semi = ct.indexOf(";");
  const mime = (semi === -1 ? ct : ct.slice(0, semi)).trim().toLowerCase();
  const params: Record<string, string> = {};
  if (semi !== -1) {
    for (const part of ct.slice(semi + 1).split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      let val = part.slice(eq + 1).trim();
      if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      params[key] = val;
    }
  }
  return {mime, params};
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Части multipart-тела; закрывающий `--boundary--` завершает обход. */
function* splitMultipart(body: Uint8Array, boundary: string): Generator<Uint8Array> {
  const text = latin1(body);
  const delimiter = new RegExp(`(?:^|\\r?\\n)--${escapeRegExp(boundary)}(--)?(?:\\r?\\n|$)`, "g");
  let start: number | null = null;
  for (const m of text.matchAll(delimiter)) {
    const idx = m.index;
    if (start !== null && idx !== undefined) yield body.subarray(start, idx);
    if (m[1] === "--") return;
    if (idx !== undefined) start = idx + m[0].length;
  }
}

interface TextPart {
  bytes: Uint8Array;
  charset: string;
  cte: string;
}

/** Рекурсивный поиск первой text/plain части (в порядке следования частей). */
function findTextPart(headers: Record<string, string>, body: Uint8Array): TextPart | null {
  const ct = headers["content-type"] ?? "text/plain; charset=us-ascii";
  const {mime, params} = parseContentType(ct);
  if (mime.startsWith("multipart/")) {
    if (!params.boundary) return null;
    for (const part of splitMultipart(body, params.boundary)) {
      const split = splitHeaderBody(latin1(part));
      if (!split) continue;
      const found = findTextPart(parseHeaderBlock(split.headerBlock), split.bodyBytes);
      if (found) return found;
    }
    return null;
  }
  if (mime !== "text/plain") return null;
  return {
    bytes: body,
    charset: params.charset ?? "us-ascii",
    cte: headers["content-transfer-encoding"] ?? "",
  };
}

function decodeBody(body: Uint8Array, cte: string): Uint8Array {
  switch (cte.trim().toLowerCase()) {
    case "base64": {
      const bytes = base64ToBytes(latin1(body).replace(/\s+/g, ""));
      return bytes ?? body;
    }
    case "quoted-printable":
      return decodeQuotedPrintable(body);
    default:
      return body; // 7bit / 8bit / binary / не указано
  }
}

/** Quoted-printable тела: мягкие переносы `=\n` / `=\r\n` убираются, `=XX` — байт. */
function decodeQuotedPrintable(body: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    if (b !== 0x3d) {
      out.push(b);
      continue;
    }
    if (body[i + 1] === 0x0a) {
      i += 1;
      continue;
    }
    if (body[i + 1] === 0x0d && body[i + 2] === 0x0a) {
      i += 2;
      continue;
    }
    const v1 = hexVal(body[i + 1]);
    const v2 = hexVal(body[i + 2]);
    if (v1 >= 0 && v2 >= 0) {
      out.push((v1 << 4) | v2);
      i += 2;
      continue;
    }
    out.push(b);
  }
  return Uint8Array.from(out);
}

/* ---------- входная точка ---------- */

const DISPLAY_HEADERS = ["from", "to", "cc", "subject", "date"] as const;

/**
 * Исходный текст письма для вида «Исходник»: байты файла (latin-1 транспорт),
 * декодированные best-effort — utf-8, при наличии невалидных последовательностей
 * windows-1251 (типичный не-UTF-8 русскоязычный источник).
 */
export function decodeRawDisplay(raw: string): string {
  const bytes = toBytes(raw);
  try {
    return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

export function parseEml(raw: string): ParsedEml {
  if (!raw.trim()) {
    return {headers: {}, textBody: null, parseError: "empty"};
  }
  const split = splitHeaderBody(raw);
  if (!split) {
    return {headers: {}, textBody: null, parseError: "no-structure"};
  }
  const headersRaw = parseHeaderBlock(split.headerBlock);
  if (Object.keys(headersRaw).length === 0) {
    return {headers: {}, textBody: null, parseError: "no-headers"};
  }

  const headers: ParsedEmlHeaders = {};
  for (const key of DISPLAY_HEADERS) {
    const value = headersRaw[key];
    if (value) headers[key] = decodeRfc2047(value);
  }

  const part = findTextPart(headersRaw, split.bodyBytes);
  if (!part) return {headers, textBody: null};
  return {headers, textBody: decodeCharset(decodeBody(part.bytes, part.cte), part.charset)};
}
