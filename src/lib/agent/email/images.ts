/**
 * Встраивание локальных картинок письма в data URI (Phase 8.4, §6.2 п. 3).
 *
 * MIME определяется по сигнатуре файла (не по расширению): в письмо
 * встраивается только png/jpeg/gif/webp. Суммарный лимит — на размер
 * исходных байтов; превышение — отказ от встраивания (src остаётся
 * исходным, письмо не ломается). `.eml`/`cid:` — не в MVP.
 */

/** Суммарный лимит data URI (байты исходных файлов) — §6.2 «например 2 MB». */
export const EMAIL_IMAGE_LIMIT_BYTES = 2 * 1024 * 1024;

/** Читает байты картинки; null — файла нет/не прочитался. */
export type ReadImageBytes = (path: string) => Promise<Uint8Array | null>;

/** Итог попытки встраивания одной картинки. */
export interface EmbedResult {
  dataUri: string | null;
  /** embedded — встроено; limit — бюджет исчерпан; read — файл не прочитан;
   *  mime — формат не поддерживается (в письмо только растровые). */
  reason: "embedded" | "limit" | "read" | "mime";
  mime: string | null;
  /** Размер исходного файла (0, если не прочитан). */
  bytes: number;
}

const MIME_PNG = "image/png";
const MIME_JPEG = "image/jpeg";
const MIME_GIF = "image/gif";
const MIME_WEBP = "image/webp";

/** MIME по сигнатуре байтов; неизвестный формат — null (не встраиваем). */
export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return MIME_PNG;
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return MIME_JPEG;
  }
  // GIF: "GIF87a" / "GIF89a"
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (head === "GIF8") return MIME_GIF;
  // WebP: "RIFF"...."WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return MIME_WEBP;
  }
  return null;
}

/** Байты -> base64 (порциями, чтобы не упереться в лимит аргументов). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Прочитать файл и собрать data URI в рамках оставшегося бюджета.
 * `remainingBytes` — сколько ещё можно встроить; 0/отрицательный — отказ.
 */
export async function embedImage(
  path: string,
  remainingBytes: number,
  readImageBytes: ReadImageBytes,
): Promise<EmbedResult> {
  if (remainingBytes <= 0) return {dataUri: null, reason: "limit", mime: null, bytes: 0};
  const bytes = await readImageBytes(path);
  if (!bytes || bytes.length === 0) return {dataUri: null, reason: "read", mime: null, bytes: 0};
  const mime = detectImageMime(bytes);
  if (!mime) return {dataUri: null, reason: "mime", mime: null, bytes: bytes.length};
  if (bytes.length > remainingBytes) {
    return {dataUri: null, reason: "limit", mime, bytes: bytes.length};
  }
  return {
    dataUri: `data:${mime};base64,${bytesToBase64(bytes)}`,
    reason: "embedded",
    mime,
    bytes: bytes.length,
  };
}
