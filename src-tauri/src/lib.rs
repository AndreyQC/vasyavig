mod commands;
mod services;

use std::sync::{Arc, Mutex};

/// DevTools из JS (F12 в dev-сборках): browser accelerator keys WebView2
/// отключены (disable_browser_accelerator_keys), штатный F12 больше не работает.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = window;
}

/// WebView2 перехватывает часть сочетаний до страницы (Ctrl+P — печать,
/// Ctrl+W, Ctrl+F и пр., включая F12), JS keydown их не видит. Отключаем
/// browser accelerator keys целиком (план 20261028_004, риск D1/D7);
/// редактирующие сочетания (копировать/вставить) это не затрагивает.
#[cfg(windows)]
fn disable_browser_accelerator_keys(app: &tauri::AppHandle) {
    use tauri::Manager as _;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(webview2) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = webview2.Settings() else {
            return;
        };
        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

#[cfg(not(windows))]
fn disable_browser_accelerator_keys(_app: &tauri::AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::watcher::WatcherState(Mutex::new(None)))
        .manage(Arc::new(services::agent_service::AgentService::new()))
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_directory,
            commands::fs::read_file,
            commands::fs::read_file_latin1,
            commands::fs::write_file,
            commands::fs::get_file_metadata,
            commands::fs::create_file,
            commands::fs::create_dir,
            commands::fs::delete_path,
            commands::fs::rename_path,
            commands::fs::grant_asset_scope,
            commands::convert::convert_to_markdown,
            commands::watcher::watch_folder,
            commands::watcher::unwatch_folder,
            commands::spellcheck::check_spelling_blocks,
            commands::spellcheck::suggest_word,
            commands::spellcheck::add_word_to_dictionary,
            commands::spellcheck::load_user_dictionary,
            commands::agent::stream_chat,
            commands::agent::cancel_run,
            commands::agent::generate_fernet_key,
            commands::agent::encrypt_text,
            commands::agent::resolve_crypto_token,
            commands::agent::validate_create_target,
            open_devtools,
        ])
        .setup(|_app| {
            // Прогрев словарей в фоне (~4 МБ), чтобы первая проверка не тормозила
            std::thread::spawn(|| {
                services::spell_service::service();
            });
            disable_browser_accelerator_keys(_app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
