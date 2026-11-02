//! Tauri-команды ассистента (Phase 8.1).
//!
//! Набор намеренно минимален: стриминг чата и отмена + crypto для формы
//! настроек. Никаких shell/FS/произвольных URL — только endpoint модели.

use crate::services::agent_service::{AgentService, StreamChunk};
use crate::services::crypto;
use crate::services::path_policy::{self, CreateTarget};
use std::path::Path;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;

/// Стриминг OpenAI-совместимого chat completion. Байты ответа — в `on_event`.
/// `run_id` нужен для `cancel_run`; повторный id активного запуска — ошибка.
#[tauri::command]
pub async fn stream_chat(
    state: State<'_, Arc<AgentService>>,
    run_id: String,
    base_url: String,
    api_key: String,
    body: serde_json::Value,
    timeout_ms: Option<u64>,
    on_event: Channel<StreamChunk>,
) -> Result<(), String> {
    let service = state.inner().clone();
    service
        .stream_chat(run_id, base_url, api_key, body, timeout_ms, on_event)
        .await
}

/// Отмена активного запуска по `run_id`. true — флаг выставлен.
#[tauri::command]
pub fn cancel_run(state: State<'_, Arc<AgentService>>, run_id: String) -> bool {
    state.inner().cancel_run(&run_id)
}

/// Новый Fernet-ключ (base64-url, 32 bytes) для env-переменной.
#[tauri::command]
pub fn generate_fernet_key() -> String {
    crypto::generate_fernet_key()
}

/// Зашифровать plaintext ключом из env `env_var` -> `crypto__<ENV>__<ct>`.
#[tauri::command]
pub fn encrypt_text(plaintext: String, env_var: String) -> Result<String, String> {
    crypto::encrypt_text(&plaintext, &env_var)
}

/// Расшифровать crypto-токен (для проверки/отладки). Не-crypto — как есть.
#[tauri::command]
pub fn resolve_crypto_token(token: String) -> Result<String, String> {
    crypto::resolve_value(&token)
}

/// Проверить цель `propose_create`: путь внутри корня, без `..`/symlink-выхода,
/// разрешённое расширение, файла ещё нет. Ничего не пишет.
#[tauri::command]
pub fn validate_create_target(root: String, relative_path: String) -> Result<CreateTarget, String> {
    path_policy::validate_create_target(Path::new(&root), &relative_path)
}
