import {convertFileSrc} from "@tauri-apps/api/core";
import {normalizeJoin} from "./utils";

/**
 * Резолвинг src картинок для отображения (phase 5).
 *
 * Сырой src в markdown не переписывается никогда (идея src/renderSrc из
 * gramax): утилита только вычисляет URL для показа — WYSIWYG nodeView и
 * DOM-проход в SplitPreview вызывают её при рендере.
 */

/** Схема из 2+ символов (`http:`, `data:`, `mailto:`); однокорневая `C:` — не схема. */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;
/** Windows-абсолют: `C:\...` / `C:/...`. */
const WIN_ABS_RE = /^[a-zA-Z]:[\\/]/;
/** Непрерывная цепочка %-последовательностей (возможно, многобайтовый UTF-8). */
const PERCENT_RUN_RE = /(?:%[0-9A-Fa-f]{2})+/g;

/** Внешний src, который не нужно переписывать: http(s)/data/mailto-схема или #якорь. */
export function isExternalSrc(src: string): boolean {
  return src.startsWith("#") || SCHEME_RE.test(src);
}

/** Снимает escape-артефакты anydoc: `\_` -> `_` (только в памяти, файл не меняется). */
function unescapeMdEscapes(path: string): string {
  return path.replace(/\\_/g, "_");
}

/**
 * Декодирует валидные %-цепочки (в отличие от кнопки «Восстановить ссылки»
 * здесь декодируется и ASCII: %20 и т.п. — URL-семантика; вывод идёт только
 * в convertFileSrc, markdown не затрагивается). Битые последовательности
 * остаются как есть.
 */
function decodePercentRuns(path: string): string {
  return path.replace(PERCENT_RUN_RE, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * Вычисляет абсолютный путь локального изображения или null, если src
 * переписывать не нужно (внешняя ссылка, якорь, пусто, root-relative без
 * открытой папки). Файл на диске не читает — существование проверяет
 * загрузчик картинки (битый путь -> штатная сломанная иконка).
 */
export function resolveLocalImagePath(
  src: string,
  baseDir: string,
  rootPath?: string | null,
): string | null {
  const trimmed = src.trim();
  if (!trimmed || isExternalSrc(trimmed)) return null;

  let path = decodePercentRuns(unescapeMdEscapes(trimmed));

  if (WIN_ABS_RE.test(path)) return path.replace(/\//g, "\\");

  // root-relative `/img.png` — от корня открытой папки (plan §3.3, USER_INPUT #3);
  // на POSIX это же совпадает с абсолютным путём — лучший доступный смысл
  if (path.startsWith("/")) {
    return rootPath ? normalizeJoin(rootPath, path) : null;
  }

  return normalizeJoin(baseDir, path);
}

const isTauri = "__TAURI_INTERNALS__" in globalThis;

/** Абсолютный путь -> URL asset protocol. Вне Tauri (vitest) — identity. */
export function toAssetUrl(path: string): string {
  return isTauri ? convertFileSrc(path) : path;
}

/**
 * Полный конвейер для рендера: src -> asset-URL или null (показывать исходный src).
 * Порядок важен: сначала резолвинг, потом кодирование — convertFileSrc сам
 * %-кодирует путь (кириллица, пробелы).
 */
export function resolveImageDisplayUrl(
  src: string,
  baseDir: string,
  rootPath?: string | null,
): string | null {
  const local = resolveLocalImagePath(src, baseDir, rootPath);
  return local === null ? null : toAssetUrl(local);
}
