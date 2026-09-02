import {useEffect} from "react";
import {listen} from "@tauri-apps/api/event";
import {useFileStore} from "../store/fileStore";
import {resolveRoot} from "../lib/roots";

const DEBOUNCE_MS = 300;

/**
 * Подписка на события файловой системы ("fs-change" из Rust-watcher, design D5).
 * Событие несёт путь; резолвим его в корень и обновляем ТОЛЬКО затронутое
 * дерево. Дебаунс 300 мс на корень — шквал событий в одном корне даёт одну
 * перезагрузку (идея §13), корни не мешают друг другу.
 */
export function useFileWatcher() {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // try/catch: в браузере (Edge-диагностика) Tauri-API недоступно — не падаем
    // (см. LESSONS_LEARNED §6).
    try {
      listen<{path: string}>("fs-change", (event) => {
        const path = event.payload?.path;
        if (!path) return;
        const root = resolveRoot(path, useFileStore.getState().roots);
        if (!root) return; // изменения вне корней не инициируют обновление деревьев
        if (timers.has(root.path)) clearTimeout(timers.get(root.path));
        timers.set(
          root.path,
          setTimeout(() => {
            timers.delete(root.path);
            void useFileStore.getState().refreshRoot(root.path);
          }, DEBOUNCE_MS),
        );
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
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      unlisten?.();
    };
  }, []);
}
