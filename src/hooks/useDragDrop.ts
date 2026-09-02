import {useEffect} from "react";
import {getCurrentWebviewWindow} from "@tauri-apps/api/webviewWindow";
import {getFileMetadata} from "./useTauriFS";
import {useFileStore} from "../store/fileStore";

/**
 * Drag-and-drop файлов и папок в окно приложения (идея §9):
 * папка — ДОБАВЛЯЕТСЯ как корень workspace (не заменяет), файлы — в табы.
 */
export function useDragDrop() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // try/catch: в браузере (Edge-диагностика) Tauri-API недоступно — не падаем
    try {
      getCurrentWebviewWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          void handleDrop(event.payload.paths);
        })
        .then((fn) => {
          if (cancelled) {
            fn();
          } else {
            unlisten = fn;
          }
        });
    } catch (e) {
      console.warn("drag-drop listener unavailable:", e);
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

async function handleDrop(paths: string[]) {
  const fileStore = useFileStore.getState();
  for (const path of paths) {
    try {
      const meta = await getFileMetadata(path);
      if (meta.isDir) {
        await fileStore.addRootInteractive(path);
      } else {
        await fileStore.openFile(path);
      }
    } catch (e) {
      fileStore.setError(String(e));
    }
  }
}
