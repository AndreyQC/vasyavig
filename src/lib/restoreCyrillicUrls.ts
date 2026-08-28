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
 * Декодирует dest целиком. Сначала снимает escape-артефакты anydoc (`\_` -> `_`,
 * phase 5), затем пробует полное %-декодирование: если оно валидно и даёт
 * не-ASCII — используем его. Bare-dest с пробелами/скобками после декодирования
 * переключается на <angle> форму (иначе ломается markdown). При частично битых
 * последовательностях — консервативный режим по цепочкам.
 */
function decodeDest(dest: string): string {
  const angle = dest.startsWith("<") && dest.endsWith(">");
  const raw = angle ? dest.slice(1, -1) : dest;
  // `\_` в destination — всегда интерпретируется как `_` (CommonMark),
  // unescape семантически нейтрален и не добавляет пробелов/скобок
  const body = raw.replace(/\\_/g, "_");

  const wrap = (b: string): string => {
    if (angle) return `<${b}>`;
    return /[()\s]/.test(b) ? `<${b}>` : b;
  };

  let full: string | null = null;
  try {
    full = decodeURIComponent(body);
  } catch {
    full = null;
  }
  if (full !== null) {
    // чистый ASCII (например, только %20) — не декодируем, но unescape остаётся
    if (full !== body && /[^\x00-\x7F]/.test(full)) return wrap(full);
    return body === raw ? dest : wrap(body);
  }

  const partial = decodeNonAsciiRuns(body);
  if (partial !== body) return wrap(partial);
  return body === raw ? dest : wrap(body);
}

/**
 * Чинит ссылки/пути картинок в markdown (кнопка «Восстановить ссылки»):
 * декодирует %-кодированную кириллицу (`#1-%D0%B2...` -> `#1-введение`) и
 * снимает escape-артефакты anydoc в destinations (`assets\_img.png` ->
 * `assets_img.png`). Проза со штатным экранированием `\_` не меняется
 * (phase 4, план §3.6).
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
