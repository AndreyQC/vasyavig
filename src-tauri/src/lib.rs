mod commands;
mod services;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::watcher::WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_directory,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::watcher::watch_folder,
            commands::spellcheck::check_spelling_blocks,
            commands::spellcheck::suggest_word,
            commands::spellcheck::add_word_to_dictionary,
            commands::spellcheck::load_user_dictionary,
        ])
        .setup(|_app| {
            // Прогрев словарей в фоне (~4 МБ), чтобы первая проверка не тормозила
            std::thread::spawn(|| {
                services::spell_service::service();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
