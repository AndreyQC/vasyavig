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
