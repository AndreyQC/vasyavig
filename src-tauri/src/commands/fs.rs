use crate::services::file_service::{list_dir_tree, read_file_utf8, write_file_atomic, FileNode};
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
