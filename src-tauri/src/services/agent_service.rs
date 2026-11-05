//! HTTP/SSE-транспорт ассистента (Phase 8.1).
//!
//! Сеть — только POST `{base_url}/chat/completions` OpenAI-совместимого
//! endpoint'а модели. Никаких shell/FS-операций здесь нет.
//!
//! - `base_url`/`api_key` могут быть `crypto__<ENV>__<ciphertext>` и
//!   расшифровываются ключом из env; plain-значения тоже принимаются.
//! - Сырые байты ответа уходят во фронтенд через `Channel` (SSE-парсинг —
//!   на фронте, толерантный к границам чанков).
//! - Отмена — флагом run id: проверяется перед отправкой каждого чанка.
//! - Таймаут/лимит размера ответа защищают от зависшего endpoint'а.

use crate::services::crypto;
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;

/// Как часто проверяем флаг отмены, пока ждём ответ/чанк.
const CANCEL_POLL_MS: u64 = 200;

/// Ошибка отмены, которую фронтенд отличает от обычного сбоя.
pub const CANCELED: &str = "cancelled";

const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 600_000;
const CONNECT_TIMEOUT_SECS: u64 = 10;
/// Тело HTTP-ошибки обрезаем: не тащим мегабайты в UI/логи.
const MAX_ERROR_BODY: usize = 4 * 1024;
/// Суммарный лимит SSE-ответа одного запуска.
const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;

/// Временная диагностика T4: сколько байт ответа писать в temp-файл.
const MAX_CAPTURE_BYTES: usize = 64 * 1024;

/// Один чанк ответа: сырые байты, фронтенд сам режет на SSE-строки.
/// `end: true` — маркер конца потока: Tauri доставляет крупные сообщения
/// канала асинхронно (fetch), и без маркера фронтенд успевает закрыть буфер
/// раньше ответа (T4, D-4).
#[derive(Clone, Serialize)]
pub struct StreamChunk {
    pub data: Vec<u8>,
    pub end: bool,
}

/// Реестр активных запусков для отмены.
pub struct AgentService {
    runs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AgentService {
    pub fn new() -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
        }
    }

    fn register(&self, run_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent state poisoned".to_string())?;
        if runs.contains_key(run_id) {
            return Err(format!("Запуск {run_id} уже активен"));
        }
        let token = Arc::new(AtomicBool::new(false));
        runs.insert(run_id.to_string(), token.clone());
        Ok(token)
    }

    fn unregister(&self, run_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.remove(run_id);
        }
    }

    /// Устанавливает флаг отмены. false — запуска с таким id уже нет.
    pub fn cancel_run(&self, run_id: &str) -> bool {
        let Ok(runs) = self.runs.lock() else {
            return false;
        };
        match runs.get(run_id) {
            Some(token) => {
                token.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }

    /// POST в OpenAI-совместимый endpoint; байты ответа — в `on_event`.
    ///
    /// `self: Arc<Self>`, чтобы guard снял регистрацию запуска на любом выходе
    /// (в том числе при early-return по ошибке/отмене).
    pub async fn stream_chat(
        self: Arc<Self>,
        run_id: String,
        base_url: String,
        api_key: String,
        body: serde_json::Value,
        timeout_ms: Option<u64>,
        on_event: Channel<StreamChunk>,
    ) -> Result<(), String> {
        let cancel_token = self.register(&run_id)?;
        let _guard = RunGuard {
            service: Arc::clone(&self),
            run_id: run_id.clone(),
        };

        let base_url =
            crypto::resolve_value(&base_url).map_err(|e| format!("Ошибка base_url: {e}"))?;
        let api_key =
            crypto::resolve_value(&api_key).map_err(|e| format!("Ошибка api_key: {e}"))?;
        let url = build_chat_url(&base_url)?;

        let timeout = Duration::from_millis(
            timeout_ms
                .unwrap_or(DEFAULT_TIMEOUT_MS)
                .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
        );
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .timeout(timeout)
            .build()
            .map_err(|e| format!("Не удалось создать HTTP-клиент: {e}"))?;

        let mut request = client.post(&url).json(&body);
        if !api_key.is_empty() {
            request = request.bearer_auth(&api_key);
        }

        let response = wait_cancellable(request.send(), &cancel_token)
            .await?
            .map_err(|e| {
                if e.is_timeout() {
                    "Таймаут запроса к модели".to_string()
                } else if e.is_connect() {
                    "Не удалось подключиться к endpoint модели".to_string()
                } else {
                    format!("HTTP-запрос упал: {e}")
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            let bytes = response.bytes().await.unwrap_or_default();
            let limit = bytes.len().min(MAX_ERROR_BODY);
            let text = String::from_utf8_lossy(&bytes[..limit]);
            return Err(format!("HTTP {status}: {}", text.trim()));
        }

        let mut stream = response.bytes_stream();
        let mut total = 0usize;
        // Временная диагностика T4: сырое тело ответа в temp-файл.
        let mut capture: Vec<u8> = Vec::new();
        loop {
            let Some(chunk) = wait_cancellable(stream.next(), &cancel_token).await? else {
                break;
            };
            if cancel_token.load(Ordering::SeqCst) {
                return Err(CANCELED.to_string());
            }
            let bytes = chunk.map_err(|e| format!("Чтение стрима: {e}"))?;
            total += bytes.len();
            if total > MAX_STREAM_BYTES {
                return Err("Ответ модели превысил допустимый размер".to_string());
            }
            if capture.len() < MAX_CAPTURE_BYTES {
                let room = MAX_CAPTURE_BYTES - capture.len();
                let take = room.min(bytes.len());
                capture.extend_from_slice(&bytes[..take]);
            }
            on_event
                .send(StreamChunk {
                    data: bytes.to_vec(),
                    end: false,
                })
                .map_err(|e| format!("Отправка чанка: {e}"))?;
        }
        // Маркер конца потока: фронтенд ждёт его, чтобы закрыть буфер ответа.
        on_event
            .send(StreamChunk {
                data: Vec::new(),
                end: true,
            })
            .map_err(|e| format!("Отправка маркера конца: {e}"))?;
        let _ = std::fs::write(std::env::temp_dir().join("vasyavig-t4-raw.txt"), &capture);

        if cancel_token.load(Ordering::SeqCst) {
            return Err(CANCELED.to_string());
        }
        Ok(())
    }
}

impl Default for AgentService {
    fn default() -> Self {
        Self::new()
    }
}

struct RunGuard {
    service: Arc<AgentService>,
    run_id: String,
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.service.unregister(&self.run_id);
    }
}

/// Ждёт future, но раз в CANCEL_POLL_MS проверяет флаг отмены — чтобы
/// `cancel_run` срабатывал и на «зависшем» endpoint'е до истечения таймаута.
async fn wait_cancellable<T, F>(future: F, cancel: &AtomicBool) -> Result<T, String>
where
    F: Future<Output = T>,
{
    tokio::pin!(future);
    loop {
        tokio::select! {
            value = &mut future => return Ok(value),
            _ = tokio::time::sleep(Duration::from_millis(CANCEL_POLL_MS)) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(CANCELED.to_string());
                }
            }
        }
    }
}

/// `{base}/chat/completions`; база должна быть http(s) без query/fragment.
fn build_chat_url(base_url: &str) -> Result<String, String> {
    let base = base_url.trim();
    if base.is_empty() {
        return Err("Пустой base_url модели".to_string());
    }
    if base.contains(char::is_whitespace) || base.contains('?') || base.contains('#') {
        return Err("base_url не должен содержать пробелы, query или fragment".to_string());
    }
    let lower = base.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("base_url должен начинаться с http:// или https://".to_string());
    }
    Ok(format!("{}/chat/completions", base.trim_end_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_chat_url() {
        assert_eq!(
            build_chat_url("https://llm.example/v1").unwrap(),
            "https://llm.example/v1/chat/completions"
        );
        assert_eq!(
            build_chat_url("https://llm.example/v1/").unwrap(),
            "https://llm.example/v1/chat/completions"
        );
        assert!(build_chat_url("ftp://llm.example/v1").is_err());
        assert!(build_chat_url("https://llm.example/v1?x=1").is_err());
        assert!(build_chat_url("https://llm.example/v1 #frag").is_err());
        assert!(build_chat_url("").is_err());
    }

    #[test]
    fn register_cancel_and_unregister() {
        let service = AgentService::new();
        let token = service.register("run-1").unwrap();
        assert!(!token.load(Ordering::SeqCst));
        assert!(service.register("run-1").is_err());

        assert!(service.cancel_run("run-1"));
        assert!(token.load(Ordering::SeqCst));
        assert!(!service.cancel_run("unknown"));

        service.unregister("run-1");
        assert!(!service.cancel_run("run-1"));
    }
}
