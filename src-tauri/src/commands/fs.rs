use crate::services::file_service::{list_dir_tree, read_file_utf8, write_file_atomic, FileNode};
use serde::Serialize;
use std::path::Path;

/// Возвращает дерево файлов/папок (рекурсивно, с лимитом глубины).
/// FileNode: { name, path, isDir, children }
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileNode>, String> {
    list_dir_tree(Path::new(&path))
}

/// Читает файл как UTF-8 текст. Ошибка, если бинарный или не-UTF-8.
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    read_file_utf8(Path::new(&path))
}

/// Атомарно записывает UTF-8 текст в файл.
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    write_file_atomic(Path::new(&path), &content)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub name: String,
    pub extension: String,
    pub is_dir: bool,
    pub size: u64,
}

/// Метаданные файла (идея §6.1). Используется drag-and-drop для различения файл/папка.
#[tauri::command]
pub async fn get_file_metadata(path: String) -> Result<FileMeta, String> {
    let p = Path::new(&path);
    let meta = std::fs::metadata(p).map_err(|e| format!("cannot stat {path}: {e}"))?;
    Ok(FileMeta {
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        extension: p
            .extension()
            .map(|e| e.to_string_lossy().into_owned().to_lowercase())
            .unwrap_or_default(),
        is_dir: meta.is_dir(),
        size: meta.len(),
    })
}

/// Создаёт пустой файл по указанному пути (ошибка, если файл существует).
#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    crate::services::file_service::create_file(Path::new(&path))
}

/// Удаляет файл или папку (папки — рекурсивно, безвозвратно).
#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    crate::services::file_service::delete_path(Path::new(&path))
}

/// Переименовывает/перемещает файл или папку.
#[tauri::command]
pub async fn rename_path(from: String, to: String) -> Result<(), String> {
    crate::services::file_service::rename_path(Path::new(&from), Path::new(&to))
}
