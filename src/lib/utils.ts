import {MARKDOWN_EXTENSIONS, TEXT_EXTENSIONS} from "./constants";

export type FileKind = "markdown" | "text" | "unsupported";

/** Извлекает расширение файла из пути (без точки, в нижнем регистре). */
export function getExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Имя файла из пути. */
export function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Определяет способ открытия файла по расширению. */
export function getFileKind(path: string): FileKind {
  const ext = getExtension(path);
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return "markdown";
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return "text";
  return "unsupported";
}

/** Нормализует расширение markdown-семейства: markdown/mdx → md, остальное — как есть. */
export function normalizeMdExt(ext: string): string {
  return ext === "markdown" || ext === "mdx" ? "md" : ext;
}

/** Меняет расширение в пути на новое (без точки). */
export function replaceExtension(path: string, newExt: string): string {
  const dot = path.lastIndexOf(".");
  const base = dot > 0 ? path.slice(0, dot) : path;
  return `${base}.${newExt}`;
}

/** Проверка пары расширений на смену формата md ↔ yfm (идея §10.3). */
export function isMdYfmSwap(oldExt: string, newExt: string): boolean {
  const a = normalizeMdExt(oldExt);
  const b = normalizeMdExt(newExt);
  return (a === "md" && b === "yfm") || (a === "yfm" && b === "md");
}
