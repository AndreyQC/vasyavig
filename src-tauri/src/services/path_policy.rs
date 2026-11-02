//! Проверка пути создания документа (Phase 8.2).
//!
//! `propose_create` принимает rootId + относительный путь; модель не видит
//! абсолютных путей. Фронтенд делает лексическую проверку, здесь — вторая
//! линия защиты: канонизация родительского каталога, запрет выхода за корень
//! через `..`/symlink, разрешённые расширения и запрет overwrite.
//!
//! Команда ничего не создаёт и не пишет — только валидирует.

use serde::Serialize;
use std::path::{Path, PathBuf};

const ALLOWED_EXTENSIONS: [&str; 3] = ["md", "yfm", "txt"];
const MAX_RELATIVE_LEN: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTarget {
    /// Нормализованный лексический путь (без `\\?\`-префикса canonicalize).
    pub absolute_path: String,
    /// Нормализованный относительный путь с `/`.
    pub relative_path: String,
}

/// Проверить цель создания файла внутри корня.
pub fn validate_create_target(root: &Path, relative: &str) -> Result<CreateTarget, String> {
    let relative = normalize_relative(relative)?;

    let canonical_root = std::fs::canonicalize(root)
        .map_err(|e| format!("Корень недоступен: {e}"))?;
    if !canonical_root.is_dir() {
        return Err("Корень не является каталогом".to_string());
    }

    let (parent_rel, file_name) = split_relative(&relative);
    let mut parent = root.to_path_buf();
    for part in parent_rel.split('/').filter(|part| !part.is_empty()) {
        parent.push(part);
    }
    let canonical_parent = std::fs::canonicalize(&parent)
        .map_err(|_| "Каталог назначения не существует".to_string())?;
    if !canonical_parent.is_dir() {
        return Err("Каталог назначения не является каталогом".to_string());
    }
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Путь выходит за корень workspace".to_string());
    }

    let mut absolute = parent;
    absolute.push(file_name);
    // symlink_metadata ловит и висячий symlink: overwrite запрещён для любой
    // существующей записи, а не только для обычного файла.
    if std::fs::symlink_metadata(&absolute).is_ok() {
        return Err("Файл уже существует: overwrite запрещён".to_string());
    }

    Ok(CreateTarget {
        absolute_path: absolute.to_string_lossy().into_owned(),
        relative_path: relative,
    })
}

fn split_relative(relative: &str) -> (&str, &str) {
    match relative.rsplit_once('/') {
        Some((parent, file)) => (parent, file),
        None => ("", relative),
    }
}

/// Лексическая нормализация: `/`-разделители, без `..`, `.`, пустых сегментов,
/// абсолютных путей, ADS/зарезервированных имён Windows и лишних расширений.
fn normalize_relative(value: &str) -> Result<String, String> {
    let raw = value.trim().replace('\\', "/");
    if raw.is_empty() {
        return Err("relativePath: пустой путь".to_string());
    }
    if raw.len() > MAX_RELATIVE_LEN {
        return Err("relativePath: слишком длинный путь".to_string());
    }
    if raw.starts_with('/') {
        return Err("relativePath: абсолютный путь запрещён".to_string());
    }
    let bytes = raw.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err("relativePath: абсолютный путь запрещён".to_string());
    }
    if raw.chars().any(char::is_control) {
        return Err("relativePath: управляющие символы запрещены".to_string());
    }

    let parts: Vec<&str> = raw.split('/').collect();
    for part in &parts {
        if part.is_empty() || *part == "." || *part == ".." {
            return Err("relativePath: пустые сегменты и '..' запрещены".to_string());
        }
        if part.ends_with('.') || part.ends_with(' ') {
            return Err("relativePath: сегмент не может заканчиваться точкой или пробелом".to_string());
        }
        if part.contains(':') {
            return Err("relativePath: ':' в имени запрещён".to_string());
        }
        if is_windows_reserved(part) {
            return Err("relativePath: зарезервированное имя Windows".to_string());
        }
    }

    let file_name = parts.last().copied().unwrap_or_default();
    let (stem, extension) = file_name
        .rsplit_once('.')
        .ok_or_else(|| "relativePath: нужно расширение .md/.yfm/.txt".to_string())?;
    if stem.is_empty() {
        return Err("relativePath: пустое имя файла".to_string());
    }
    if !ALLOWED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()) {
        return Err("relativePath: разрешены только .md/.yfm/.txt".to_string());
    }

    Ok(parts.join("/"))
}

fn is_windows_reserved(part: &str) -> bool {
    let stem = part
        .split('.')
        .next()
        .unwrap_or(part)
        .to_ascii_lowercase();
    if matches!(stem.as_str(), "con" | "prn" | "aux" | "nul") {
        return true;
    }
    let bytes = stem.as_bytes();
    if bytes.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) {
        let digit = bytes[3];
        return digit.is_ascii_digit() && digit != b'0';
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vasyavig-path-{}-{}",
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn normalizes_separators_and_nested_paths() {
        assert_eq!(normalize_relative("docs\\a.md").unwrap(), "docs/a.md");
        assert_eq!(normalize_relative("a.yfm").unwrap(), "a.yfm");
        assert_eq!(normalize_relative(" notes/task.txt ").unwrap(), "notes/task.txt");
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        for bad in [
            "../a.md",
            "docs/../a.md",
            "/etc/a.md",
            "C:\\temp\\a.md",
            "docs//a.md",
            "docs/./a.md",
            "",
        ] {
            assert!(normalize_relative(bad).is_err(), "должен быть отклонён: {bad}");
        }
    }

    #[test]
    fn rejects_disallowed_extensions_and_reserved_names() {
        for bad in ["a.exe", "a", ".md", "docs/con.md", "docs/COM1.txt", "docs/a.md:stream"] {
            assert!(normalize_relative(bad).is_err(), "должен быть отклонён: {bad}");
        }
    }

    #[test]
    fn accepts_existing_parent_and_returns_lexical_path() {
        let root = temp_root();
        std::fs::create_dir_all(root.join("docs")).unwrap();
        let target = validate_create_target(&root, "docs/new.md").unwrap();
        assert_eq!(target.relative_path, "docs/new.md");
        assert!(target.absolute_path.ends_with("new.md"));
        assert!(!std::path::Path::new(&target.absolute_path).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_missing_parent() {
        let root = temp_root();
        let result = validate_create_target(&root, "missing/new.md");
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_existing_file() {
        let root = temp_root();
        std::fs::write(root.join("a.md"), "x").unwrap();
        let result = validate_create_target(&root, "a.md");
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_root_escape_attempt_with_traversal() {
        let root = temp_root();
        let result = validate_create_target(&root, "../outside.md");
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
