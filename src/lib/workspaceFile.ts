import {getParentDir, normalizeJoin} from "./utils";
import {isPaletteColor, type PaletteColor, type RootInfo} from "./rootColors";

/**
 * Файл workspace `.vasyavig-workspace` (спека workspace-file, design D6):
 * JSON version 1, упорядоченный список {path, color, alias?}. Порядок папок
 * в файле — порядок секций в дереве (план 20261028_002, D4). Чтение/запись —
 * существующими командами readFile/writeFile, JSON-логика здесь.
 *
 * В памяти — абсолютные пути; в файле — относительные к каталогу файла
 * workspace, когда это возможно (совпадает диск/корень), иначе абсолютные.
 */

export const WORKSPACE_EXTENSION = "vasyavig-workspace";

/** Предел длины псевдонима (план 20261028_002, D2): больше — обрезается. */
export const ALIAS_MAX_LENGTH = 100;

export interface WorkspaceFolder {
  path: string;
  color: PaletteColor;
  /**
   * Псевдоним (план 20261028_002): опциональное поле версии 1. Отсутствие
   * поля и пустая после trim строка равнозначны; нестроковое значение —
   * ошибка формата. Файлы без alias читаются как раньше, файл с alias
   * читается старой версией парсера (неизвестные поля не отвергаются).
   */
  alias?: string;
}

/** Ошибка формата: не JSON, чужая версия, кривая структура. Не крашит приложение. */
export class WorkspaceFormatError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Нормализация alias записи: undefined / непустая строка после trim (до ALIAS_MAX_LENGTH). */
function normalizeAlias(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new WorkspaceFormatError(`${where}: invalid alias`);
  }
  const trimmed = value.trim().slice(0, ALIAS_MAX_LENGTH);
  return trimmed === "" ? undefined : trimmed;
}

/** Парсинг содержимого файла workspace. Бросает WorkspaceFormatError при любом несоответствии. */
export function parseWorkspace(text: string): WorkspaceFolder[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new WorkspaceFormatError("invalid JSON");
  }
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.folders)) {
    throw new WorkspaceFormatError("unsupported format");
  }
  return data.folders.map((entry, i) => {
    if (!isRecord(entry) || typeof entry.path !== "string" || entry.path === "") {
      throw new WorkspaceFormatError(`folders[${i}]: invalid entry`);
    }
    if (typeof entry.color !== "string" || !isPaletteColor(entry.color)) {
      throw new WorkspaceFormatError(`folders[${i}]: unknown color`);
    }
    const alias = normalizeAlias(entry.alias, `folders[${i}]`);
    return alias === undefined ? {path: entry.path, color: entry.color} : {path: entry.path, color: entry.color, alias};
  });
}

/** Сериализация текущего состава корней в текст файла workspace. */
export function serializeWorkspace(roots: readonly RootInfo[], workspaceFilePath: string): string {
  const folders = roots.map((root) => {
    const folder: WorkspaceFolder = {
      path: toWorkspaceRelative(root.path, workspaceFilePath),
      color: root.color,
    };
    // alias пишем только непустой — не плодим шум в файле
    if (root.alias?.trim()) {
      folder.alias = root.alias.trim().slice(0, ALIAS_MAX_LENGTH);
    }
    return folder;
  });
  const json = {version: 1, folders};
  return JSON.stringify(json, null, 2);
}

/** Абсолютный путь папки из записи файла workspace (относительные — от каталога файла). */
export function resolveFolderPath(folderPath: string, workspaceFilePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(folderPath) || folderPath.startsWith("\\\\") || folderPath.startsWith("/")) {
    return folderPath;
  }
  return normalizeJoin(getParentDir(workspaceFilePath), folderPath);
}

/** Префикс корня пути для сравнения «один ли диск/корень»: `c:`, `//server/share`, `/`. */
function pathRoot(segments: string[]): string {
  const first = segments[0] ?? "";
  if (/^[a-z]:$/.test(first)) return first;
  if (first === "") return "/"; // POSIX-абсолют (ведущий пустой сегмент сохранён)
  if (first.startsWith("unc~")) return first; // временная метка UNC (см. toSegments)
  return ""; // относительный путь — корня нет
}

/** Разбор пути на [корневой маркер, ...сегменты] в нижнем регистре с `/`-разделителями. */
function toSegments(path: string): string[] {
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("//")) {
    // UNC: //server/share/... — корень = сервер+шара
    const parts = norm.split("/").filter(Boolean);
    return [`unc~${parts[0] ?? ""}~${parts[1] ?? ""}`, ...parts.slice(2)];
  }
  if (norm.startsWith("/")) {
    // POSIX-абсолют: ведущий пустой сегмент — маркер корня, хвостовые отбрасываем
    return norm.split("/").filter((s, i) => i === 0 || s !== "").map((s) => s.toLowerCase());
  }
  return norm.split("/").filter(Boolean).map((s) => s.toLowerCase());
}

/**
 * Относительный путь target от base (каталога файла workspace) в формате
 * `./x`, `../y`. Если относительный путь невозможен (другой диск/UNC-корень) —
 * абсолютный путь без изменений.
 */
export function toWorkspaceRelative(targetPath: string, workspaceFilePath: string): string {
  const base = getParentDir(workspaceFilePath);
  const t = toSegments(targetPath);
  const b = toSegments(base);

  const targetRoot = pathRoot(t);
  const baseRoot = pathRoot(b);
  if (!targetRoot || !baseRoot || targetRoot !== baseRoot) {
    return targetPath;
  }

  let common = 0;
  while (common < t.length && common < b.length && t[common] === b[common]) common++;

  const ups = b.length - common;
  if (ups === 0 && t.length === common) return ".";
  const rel = [...Array.from({length: ups}, () => ".."), ...t.slice(common)];
  const joined = rel.join("/");
  return joined.startsWith("..") ? joined : `./${joined}`;
}
