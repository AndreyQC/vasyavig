import {invoke} from "@tauri-apps/api/core";
import {open, save} from "@tauri-apps/plugin-dialog";
import type {FileNode} from "../types";
import {EML_EXTENSIONS, IMAGE_EXTENSIONS, OFFICE_EXTENSIONS, TEXT_EXTENSIONS} from "../lib/constants";
import {getExtension} from "../lib/utils";

/** Нативный диалог выбора папки. Возвращает абсолютный путь или null (отмена). */
export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({directory: true});
  return typeof selected === "string" ? selected : null;
}

/** Нативный диалог выбора файла (Ctrl+O). Путь или null. */
export async function openFileDialog(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [
      {name: "Markdown", extensions: ["md", "markdown", "yfm", "mdx"]},
      {
        name: "Text",
        extensions: ["txt", "json", "py", "sql", "js", "ts", "jsx", "tsx", "yaml", "yml", "xml", "log", "rs", "go", "java", "cpp", "c", "h"],
      },
      {name: "Office", extensions: [...OFFICE_EXTENSIONS]},
      {name: "Images", extensions: [...IMAGE_EXTENSIONS]},
      {name: "Email", extensions: [...EML_EXTENSIONS]},
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export interface FileMeta {
  name: string;
  extension: string;
  isDir: boolean;
  size: number;
}

export function getFileMetadata(path: string): Promise<FileMeta> {
  return invoke<FileMeta>("get_file_metadata", {path});
}

export function listDirectory(path: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_directory", {path});
}

export function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", {path});
}

/**
 * Читает файл побайтово в latin-1-строку (байт = символ U+00XX): транспорт
 * не-UTF-8 текста (.eml с 8bit-кодировкой) для декодирования на фронте.
 */
export function readFileLatin1(path: string): Promise<string> {
  return invoke<string>("read_file_latin1", {path});
}

export function writeFile(path: string, content: string): Promise<void> {
  return invoke("write_file", {path, content});
}

/** Создаёт пустой файл (ошибка, если уже существует). */
export function createFile(path: string): Promise<void> {
  return invoke("create_file", {path});
}

/** Удаляет файл или папку (папки — рекурсивно). */
export function deletePath(path: string): Promise<void> {
  return invoke("delete_path", {path});
}

/** Переименовывает/перемещает файл или папку. */
export function renamePath(from: string, to: string): Promise<void> {
  return invoke("rename_path", {from, to});
}

/** Конвертирует офисный документ в Markdown (anydoc). */
export function convertToMarkdown(path: string): Promise<string> {
  return invoke<string>("convert_to_markdown", {path});
}

/**
 * Диалог «Сохранить как». Возвращает выбранный путь или null (отмена).
 * Фильтры — по расширению текущего файла: markdown-семейство как раньше,
 * прочие текстовые — текущее расширение + все текстовые + все файлы.
 */
export async function saveFileDialog(defaultPath: string): Promise<string | null> {
  const ext = getExtension(defaultPath);
  const isMd = ["md", "markdown", "yfm"].includes(ext);
  const filters = isMd
    ? [
        {name: "Markdown", extensions: ["md", "markdown"]},
        {name: "YFM", extensions: ["yfm"]},
      ]
    : [
        {
          name: "Text",
          extensions: Array.from(new Set([ext || "txt", ...TEXT_EXTENSIONS])),
        },
        {name: "All files", extensions: ["*"]},
      ];
  const selected = await save({defaultPath, filters});
  return typeof selected === "string" ? selected : null;
}

export function watchFolder(path: string): Promise<void> {
  return invoke("watch_folder", {path});
}

/** Перестаёт следить за папкой (мульти-root watcher). */
export function unwatchFolder(path: string): Promise<void> {
  return invoke("unwatch_folder", {path});
}

/** Диалог выбора файла workspace. Путь или null. */
export async function openWorkspaceDialog(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{name: "Vasyavig workspace", extensions: ["vasyavig-workspace"]}],
  });
  return typeof selected === "string" ? selected : null;
}

/** Диалог выбора места файла workspace. Путь или null (отмена). */
export async function saveWorkspaceFileDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [{name: "Vasyavig workspace", extensions: ["vasyavig-workspace"]}],
  });
  return typeof selected === "string" ? selected : null;
}

/** Разрешает asset protocol доступ к каталогу (рекурсивно) — картинки phase 5. */
export function grantAssetScope(path: string): Promise<void> {
  return invoke("grant_asset_scope", {path});
}
