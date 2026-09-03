import {EML_EXTENSIONS, IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, OFFICE_EXTENSIONS, TEXT_EXTENSIONS} from "./constants";

export type FileKind = "markdown" | "text" | "office" | "image" | "email" | "unsupported";

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

/** Родительский каталог пути (по последнему разделителю / или \). */
export function getParentDir(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx > 0 ? path.slice(0, idx) : path;
}

/** Склейка каталога и имени файла/папки, сохраняя разделитель каталога. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** Лексическое склеивание base + rel с нормализацией `./`, `..` и смешанных сепараторов. */
export function normalizeJoin(base: string, rel: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const segs = base.split(/[\\/]+/).filter((s, i) => s !== "" || i < 2);
  for (const part of rel.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      // не поднимаемся выше корня склейки (диск/UNC-префикс остаётся)
      if (segs.length > 1) segs.pop();
      continue;
    }
    segs.push(part);
  }
  return segs.join(sep);
}

/** Если path равен oldPath или лежит внутри него — возвращает путь с новым префиксом, иначе null. */
export function remapPath(path: string, oldPath: string, newPath: string): string | null {
  if (path === oldPath) return newPath;
  const sep = oldPath.includes("\\") ? "\\" : "/";
  const prefix = oldPath.endsWith(sep) ? oldPath : oldPath + sep;
  if (path.startsWith(prefix)) return newPath + path.slice(oldPath.length);
  return null;
}

/** Определяет способ открытия файла по расширению. */
export function getFileKind(path: string): FileKind {
  const ext = getExtension(path);
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return "markdown";
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return "text";
  if ((OFFICE_EXTENSIONS as readonly string[]).includes(ext)) return "office";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if ((EML_EXTENSIONS as readonly string[]).includes(ext)) return "email";
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

/** Язык Monaco по расширению файла (идея §8). */
const MONACO_LANG_MAP: Record<string, string> = {
  json: "json",
  py: "python",
  sql: "sql",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  rs: "rust",
  go: "go",
  java: "java",
  cpp: "cpp",
  c: "c",
  h: "cpp",
};

export function getMonacoLanguage(path: string): string {
  return MONACO_LANG_MAP[getExtension(path)] ?? "plaintext";
}
