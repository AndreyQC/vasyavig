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

/// Читает файл побайтово в latin-1-строку (байт → символ U+00XX). Транспорт
/// не-UTF-8 текста (.eml с 8bit-кодировкой) через валидную UTF-8 строку IPC:
/// фронт восстанавливает байты по charCodeAt и декодирует по charset из MIME.
pub fn read_file_latin1(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    Ok(bytes.into_iter().map(|b| b as char).collect())
}

/// Атомарная запись: temp-файл в той же директории + rename (идея §6.1).
pub fn write_file_atomic(path: &Path, content: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("no parent dir for {}", path.display()))?;
    let tmp = dir.join(format!(
        ".vasyavig-tmp-{}",
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_string())
    ));
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot rename to {}: {e}", path.display())
    })
}

/// Создаёт пустой файл по указанному пути. Ошибка, если файл уже существует.
pub fn create_file(path: &Path) -> Result<(), String> {
    use std::fs::OpenOptions;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(|_| ())
        .map_err(|e| format!("cannot create {}: {e}", path.display()))
}

/// Удаляет файл или папку (папки — рекурсивно, безвозвратно).
pub fn delete_path(path: &Path) -> Result<(), String> {
    let meta = fs::metadata(path).map_err(|e| format!("cannot stat {}: {e}", path.display()))?;
    if meta.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("cannot remove dir {}: {e}", path.display()))
    } else {
        fs::remove_file(path).map_err(|e| format!("cannot remove file {}: {e}", path.display()))
    }
}

/// Переименовывает/перемещает файл или папку (fs::rename).
pub fn rename_path(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to)
        .map_err(|e| format!("cannot rename {} to {}: {e}", from.display(), to.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "vasyavig-test-{}-{}-{}",
            std::process::id(),
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn create_file_makes_empty_file_and_rejects_existing() {
        let p = temp_path("create.md");
        create_file(&p).unwrap();
        assert!(p.exists());
        assert_eq!(fs::read(&p).unwrap().len(), 0);
        assert!(create_file(&p).is_err());
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn delete_path_removes_file_and_dir_recursively() {
        let dir = temp_path("del-dir");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("a.txt"), b"x").unwrap();
        fs::write(dir.join("root.txt"), b"y").unwrap();

        delete_path(&dir.join("root.txt")).unwrap();
        assert!(!dir.join("root.txt").exists());

        delete_path(&dir).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn rename_path_renames_file() {
        let dir = temp_path("rename-dir");
        fs::create_dir_all(&dir).unwrap();
        let from = dir.join("a.txt");
        let to = dir.join("b.txt");
        fs::write(&from, b"x").unwrap();

        rename_path(&from, &to).unwrap();
        assert!(!from.exists());
        assert!(to.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_file_latin1_transports_non_utf8_bytes() {
        let p = temp_path("cp1251.eml");
        // «тест» в windows-1251 + ноль и байт >0x7F — не-UTF-8 и «бинарный» для read_file_utf8
        fs::write(&p, [0xF2, 0xE5, 0xF1, 0xF2, 0x00, 0xFF]).unwrap();

        assert!(read_file_utf8(&p).is_err());

        let s = read_file_latin1(&p).unwrap();
        let bytes: Vec<u8> = s.chars().map(|c| c as u32 as u8).collect();
        assert_eq!(bytes, vec![0xF2, 0xE5, 0xF1, 0xF2, 0x00, 0xFF]);
        let _ = fs::remove_file(&p);
    }
}
