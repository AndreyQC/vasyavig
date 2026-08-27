use std::path::{Path, PathBuf};

/// Конвертирует офисный документ (Word/PowerPoint/Excel/OpenDocument/RTF/EPUB/CSV/PDF)
/// в GitHub-Flavored Markdown. Встроенные изображения извлекаются в соседнюю папку
/// `<имя>_assets/`, а в markdown проставляются ссылки `![...](<имя>_assets/...)`.
#[tauri::command]
pub async fn convert_to_markdown(path: String) -> Result<String, String> {
    let src = Path::new(&path);
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let parent = src.parent().unwrap_or_else(|| Path::new("."));
    let assets_dir: PathBuf = parent.join(format!("{stem}_assets"));
    anydoc::to_markdown_with_assets(src, &assets_dir).map_err(|e| e.to_string())
}
