export interface RestoreResult {
  text: string;
  /** Сколько URL изменено. */
  changedUrls: number;
}

/** Непрерывная цепочка %-последовательностей (возможно, многобайтовый UTF-8). */
const PERCENT_RUN_RE = /(?:%[0-9A-Fa-f]{2})+/g;

/**
 * Inline-ссылка/картинка: [label](dest) или ![label](dest), dest — либо <angle>,
 * либо bare с балансом скобок (как у путей anydoc «...(1)\_assets/...»).
 */
const INLINE_LINK_RE =
  /(^|[^\\])(\[[^\[\]]*\])\(\s*(<[^<>\s]*>|[^()\s]+(?:\([^()]*\)[^()\s]*)*)/g;

/** Link reference definition: [label]: dest (в начале строки, до 3 пробелов). */
const REF_DEF_RE = /^(\s{0,3}\[[^\]\n]+\]:\s*)(<[^<>\s]*>|\S+)/gm;

/** Декодирует %-цепочки, дающие не-ASCII; чистые ASCII-коды (%20, %28) не трогает. */
function decodeNonAsciiRuns(url: string): string {
  return url.replace(PERCENT_RUN_RE, (run) => {
    try {
      const decoded = decodeURIComponent(run);
      return /[^\x00-\x7F]/.test(decoded) ? decoded : run;
    } catch {
      return run; // битая последовательность (незавершённый UTF-8) — пропускаем
    }
  });
}

/**
 * Декодирует dest целиком. Сначала пробует полное декодирование: если оно
 * валидно и даёт не-ASCII — используем его. Bare-dest с пробелами/скобками
 * после декодирования переключается на <angle> форму (иначе ломается markdown).
 * При частично битых последовательностях — консервативный режим по цепочкам.
 */
function decodeDest(dest: string): string {
  const angle = dest.startsWith("<") && dest.endsWith(">");
  const wrap = (body: string, isAngle: boolean): string => {
    if (isAngle || !/[()\s]/.test(body)) return isAngle ? `<${body}>` : body;
    return `<${body}>`;
  };

  const body = angle ? dest.slice(1, -1) : dest;

  let full: string | null = null;
  try {
    full = decodeURIComponent(body);
  } catch {
    full = null;
  }
  if (full !== null) {
    // чистый ASCII (например, только %20) — не трогаем
    if (full === body || !/[^\x00-\x7F]/.test(full)) return dest;
    return wrap(full, angle);
  }

  const partial = decodeNonAsciiRuns(body);
  if (partial === body) return dest;
  return wrap(partial, angle);
}

/**
 * Возвращает %-кодированную кириллицу (и другой не-ASCII) в URL к исходному
 * виду: якоря `#1-%D0%B2...` -> `#1-введение`, пути картинок — аналогично.
 * Текст вне URL не меняется (phase 4, план §3.2).
 */
export function restoreCyrillicUrls(md: string): RestoreResult {
  let changedUrls = 0;

  const text = md
    .replace(INLINE_LINK_RE, (match, prefix: string, label: string, dest: string) => {
      const decoded = decodeDest(dest);
      if (decoded === dest) return match;
      changedUrls++;
      return `${prefix}${label}(${decoded}`;
    })
    .replace(REF_DEF_RE, (match, prefix: string, dest: string) => {
      const decoded = decodeDest(dest);
      if (decoded === dest) return match;
      changedUrls++;
      return `${prefix}${decoded}`;
    });

  return {text, changedUrls};
}
