use crate::services::spell_service::{service, tokenize};
use serde::Serialize;
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MisspelledWord {
    pub word: String,
    /// Офсеты в символах внутри переданного блока текста.
    pub start: usize,
    pub end: usize,
}

/// Проверяет массив текстовых блоков (по одному textblock'у редактора).
/// lang: "ru" | "en" | "both". Офсеты — в символах внутри каждого блока.
#[tauri::command]
pub async fn check_spelling_blocks(
    texts: Vec<String>,
    lang: String,
) -> Result<Vec<Vec<MisspelledWord>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let svc = service();
        texts
            .iter()
            .map(|text| {
                tokenize(text)
                    .into_iter()
                    .filter(|(word, _, _)| !svc.check(word, &lang))
                    .map(|(word, start, end)| MisspelledWord { word, start, end })
                    .collect()
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Варианты замены для слова (до 5).
#[tauri::command]
pub async fn suggest_word(word: String, lang: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || service().suggest(&word, &lang))
        .await
        .map_err(|e| e.to_string())
}

/// Добавляет слово в пользовательский словарь (app_data_dir/user_words.txt + runtime).
#[tauri::command]
pub fn add_word_to_dictionary(word: String, _lang: String, app: AppHandle) -> Result<(), String> {
    let svc = service();
    svc.add_user_word(&word);

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("user_words.txt");
    let mut content = fs::read_to_string(&file).unwrap_or_default();
    content.push_str(&format!("{}\n", word.to_lowercase()));
    fs::write(&file, content).map_err(|e| e.to_string())
}

/// Загружает пользовательский словарь из app_data_dir (вызывается при старте).
#[tauri::command]
pub fn load_user_dictionary(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = dir.join("user_words.txt");
    let content = fs::read_to_string(&file).unwrap_or_default();
    let words: Vec<String> = content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    service().load_user_words(words);
    Ok(())
}
