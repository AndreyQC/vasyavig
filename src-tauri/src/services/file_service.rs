use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Максимальная глубина рекурсивного обхода дерева (см. идею §4.1.1).
const MAX_DEPTH: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

/// Рекурсивно читает структуру директории с лимитом глубины.
/// Папки сортируются перед файлами, внутри групп — по имени (case-insensitive).
pub fn list_dir_tree(root: &Path) -> Result<Vec<FileNode>, String> {
    list_dir_level(root, 0)
}

fn list_dir_level(dir: &Path, depth: usize) -> Result<Vec<FileNode>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read dir {}: {e}", dir.display()))?;

    let mut nodes: Vec<FileNode> = Vec::new();
    for entry in entries.flatten() {
        let path: PathBuf = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = path.is_dir();
        let children = if is_dir && depth + 1 < MAX_DEPTH {
            Some(list_dir_level(&path, depth + 1).unwrap_or_default())
        } else {
            None
        };
        nodes.push(FileNode {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir,
            children,
        });
    }

    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(nodes)
}

/// Читает файл как UTF-8 текст. Ошибка для бинарных и не-UTF-8 файлов (идея §13).
pub fn read_file_utf8(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if bytes.contains(&0) {
        return Err("Файл выглядит как бинарный и не может быть открыт".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "Файл не в UTF-8".to_string())
}
