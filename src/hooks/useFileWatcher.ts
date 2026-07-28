import {useEffect} from "react";
import {listen} from "@tauri-apps/api/event";
import {useFileStore} from "../store/fileStore";

const DEBOUNCE_MS = 300;

/**
 * Подписка на события файловой системы ("fs-change" из Rust-watcher).
 * Дебаунс на случай шквала событий (см. идею §13).
 */
export function useFileWatcher() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // try/catch: в браузере (Edge-диагностика) Tauri-API недоступно — не падаем
    // (см. LESSONS_LEARNED §6).
    try {
      listen("fs-change", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          useFileStore.getState().refreshTree();
        }, DEBOUNCE_MS);
      }).then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });
    } catch (e) {
      console.warn("fs watcher listen unavailable:", e);
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, []);
}
