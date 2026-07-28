import {invoke} from "@tauri-apps/api/core";
import {open, save} from "@tauri-apps/plugin-dialog";
import type {FileNode} from "../types";

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

export function writeFile(path: string, content: string): Promise<void> {
  return invoke("write_file", {path, content});
}

/** Диалог «Сохранить как». Возвращает выбранный путь или null (отмена). */
export async function saveFileDialog(defaultPath: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [
      {name: "Markdown", extensions: ["md", "markdown"]},
      {name: "YFM", extensions: ["yfm"]},
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export function watchFolder(path: string): Promise<void> {
  return invoke("watch_folder", {path});
}
