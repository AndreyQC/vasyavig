use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Дебаунс событий файловой системы (идея §13: notify генерирует много событий).
const DEBOUNCE_MS: u64 = 300;

/// Payload события "fs-change": абсолютный путь затронутого файла/папки —
/// frontend резолвит его в корень и обновляет только затронутое дерево (design D5).
#[derive(Clone, serde::Serialize)]
pub struct FsChangePayload {
    pub path: String,
}

/// Один watcher на все корни workspace (design D5): несколько watch() на общем
/// RecommendedWatcher + множество смотренных путей. Добавление/удаление корней —
/// watch/unwatch без пересоздания watcher'а.
pub struct WatchState {
    watcher: RecommendedWatcher,
    watched: HashSet<String>,
}

impl WatchState {
    /// Создаёт watcher; возвращает канал событий (его получает поток дебаунса).
    pub fn new() -> Result<(Self, mpsc::Receiver<notify::Result<Event>>), String> {
        let (tx, rx) = mpsc::channel();
        let watcher = RecommendedWatcher::new(tx, Config::default())
            .map_err(|e| format!("cannot create watcher: {e}"))?;
        Ok((WatchState { watcher, watched: HashSet::new() }, rx))
    }

    /// Смотрит папку рекурсивно. Повторный watch уже смотренного пути — no-op.
    pub fn watch(&mut self, path: &str) -> Result<(), String> {
        if self.watched.contains(path) {
            return Ok(());
        }
        self.watcher
            .watch(Path::new(path), RecursiveMode::Recursive)
            .map_err(|e| format!("cannot watch {path}: {e}"))?;
        self.watched.insert(path.to_string());
        Ok(())
    }

    /// Перестаёт смотреть папку. Unwatch не-смотренного пути — предупреждение,
    /// не ошибка (крэш-устойчивость при рассинхроне состояний).
    pub fn unwatch(&mut self, path: &str) -> Result<(), String> {
        if !self.watched.contains(path) {
            eprintln!("watcher: unwatch of not-watched path: {path}");
            return Ok(());
        }
        self.watcher
            .unwatch(Path::new(path))
            .map_err(|e| format!("cannot unwatch {path}: {e}"))?;
        self.watched.remove(path);
        Ok(())
    }

    pub fn is_watched(&self, path: &str) -> bool {
        self.watched.contains(path)
    }
}

pub struct WatcherState(pub Mutex<Option<WatchState>>);

/// Запускает слежение за папкой (общий watcher создаётся при первом вызове).
#[tauri::command]
pub fn watch_folder(
    path: String,
    app: AppHandle,
    state: State<WatcherState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let (watch_state, rx) = WatchState::new()?;
        let app_handle = app.clone();
        std::thread::spawn(move || debounce_loop(rx, app_handle));
        *guard = Some(watch_state);
    }
    let watch_state = guard.as_mut().expect("watch state just initialized");
    watch_state.watch(&path)
}

/// Прекращает слежение за папкой.
#[tauri::command]
pub fn unwatch_folder(path: String, state: State<WatcherState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    match guard.as_mut() {
        Some(watch_state) => watch_state.unwatch(&path),
        None => {
            eprintln!("watcher: unwatch of not-watched path: {path}");
            Ok(())
        }
    }
}

/// Поток дебаунса: собирает пути всех событий за окно DEBOUNCE_MS и шлёт по
/// одному событию "fs-change" на каждый уникальный путь.
fn debounce_loop(rx: mpsc::Receiver<notify::Result<Event>>, app: AppHandle) {
    while let Ok(event) = rx.recv() {
        let mut paths: HashSet<String> = HashSet::new();
        collect_paths(&event, &mut paths);
        while let Ok(event) = rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
            collect_paths(&event, &mut paths);
        }
        for path in paths {
            let _ = app.emit("fs-change", FsChangePayload { path });
        }
    }
}

fn collect_paths(event: &notify::Result<Event>, out: &mut HashSet<String>) {
    if let Ok(event) = event {
        for path in &event.paths {
            if let Some(path) = path.to_str() {
                out.insert(path.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Временный каталог для теста (tempfile не в зависимостях).
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "vasyavig-watcher-test-{name}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).expect("create temp dir");
            TempDir(dir)
        }

        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn multi_watch_and_unwatch() {
        let dir1 = TempDir::new("a");
        let dir2 = TempDir::new("b");
        let (mut ws, _rx) = WatchState::new().expect("watch state");

        ws.watch(&dir1.path()).expect("watch dir1");
        ws.watch(&dir2.path()).expect("watch dir2");
        assert!(ws.is_watched(&dir1.path()));
        assert!(ws.is_watched(&dir2.path()));

        ws.unwatch(&dir1.path()).expect("unwatch dir1");
        assert!(!ws.is_watched(&dir1.path()));
        assert!(ws.is_watched(&dir2.path()), "unwatch одного пути не трогает другой");
    }

    #[test]
    fn watch_same_path_twice_is_noop() {
        let dir = TempDir::new("dup");
        let (mut ws, _rx) = WatchState::new().expect("watch state");
        ws.watch(&dir.path()).expect("first watch");
        ws.watch(&dir.path()).expect("second watch");
        assert!(ws.is_watched(&dir.path()));
        ws.unwatch(&dir.path()).expect("unwatch after duplicate watch");
        assert!(!ws.is_watched(&dir.path()));
    }

    #[test]
    fn unwatch_not_watched_is_warn_not_error() {
        let (mut ws, _rx) = WatchState::new().expect("watch state");
        assert!(ws.unwatch("C:/definitely/not/watched").is_ok());
    }

    #[test]
    fn fs_change_payload_serializes_with_path() {
        let payload = FsChangePayload {
            path: "C:/docs/a.md".to_string(),
        };
        let json = serde_json::to_string(&payload).expect("serialize payload");
        assert_eq!(json, r#"{"path":"C:/docs/a.md"}"#);
    }
}
