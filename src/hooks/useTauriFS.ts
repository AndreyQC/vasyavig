import {invoke} from "@tauri-apps/api/core";
import {open} from "@tauri-apps/plugin-dialog";
import type {FileNode} from "../types";

/** Нативный диалог выбора папки. Возвращает абсолютный путь или null (отмена). */
export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({directory: true});
  return typeof selected === "string" ? selected : null;
}

export function listDirectory(path: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_directory", {path});
}

export function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", {path});
}

export function watchFolder(path: string): Promise<void> {
  return invoke("watch_folder", {path});
}
