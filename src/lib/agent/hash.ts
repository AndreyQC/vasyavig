/**
 * Отпечаток содержимого для optimistic locking предложений (Phase 8.2).
 *
 * Это не криптография: hash нужен, чтобы заметить правку документа между
 * созданием proposal и нажатием «Применить». Два прохода FNV-1a 64 с разными
 * смещениями дают 128-битную строку без зависимости от WebCrypto (одинаково
 * работает в WebView2 и в vitest).
 */

const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
const OFFSET_A = 0xcbf29ce484222325n;
const OFFSET_B = 0x84222325cbf29ce4n;

function fnv1a64(text: string, offset: bigint): string {
  let hash = offset;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Стабильный отпечаток текста (32 hex-символа). */
export function contentHash(text: string): string {
  return fnv1a64(text, OFFSET_A) + fnv1a64(text, OFFSET_B);
}

/** Число неперекрывающихся вхождений needle (пустой needle — 0). */
export function countOccurrences(text: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = text.indexOf(needle, from);
    if (index === -1) return count;
    count++;
    from = index + needle.length;
  }
}

/** 1-базный номер строки, в которой начинается символ index. */
export function lineOfIndex(text: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}
