use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Дебаунс событий файловой системы (идея §13: notify генерирует много событий).
const DEBOUNCE_MS: u64 = 300;

/// Держим текущий watcher живым. Смотрим одну корневую папку за раз:
/// при открытии новой папки старый watcher дропается.
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

/// Запускает watcher на папку и шлёт событие "fs-change" во frontend
/// (debounced, без деталей — frontend просто перечитывает дерево).
#[tauri::command]
pub fn watch_folder(path: String, app: AppHandle, state: State<WatcherState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|e| format!("cannot create watcher: {e}"))?;
    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("cannot watch {path}: {e}"))?;

    // Поток дебаунса: ждёт первое событие, собирает всё за DEBOUNCE_MS, шлёт один emit.
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // Собрать все события, прилетевшие в течение окна дебаунса.
            while rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)).is_ok() {}
            let _ = app.emit("fs-change", ());
        }
    });

    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}
