import {normalizePath} from "../roots";

/**
 * Opaque идентификаторы для инструментов ассистента (Phase 8.2, Q5).
 *
 * Модель не видит абсолютных путей: она получает `doc-1`/`root-1`, а
 * приложение держит соответствие в памяти сессии. Id не кодирует путь,
 * стабилен, пока живёт сессия, и сбрасывается при смене workspace.
 */

export interface SessionIds {
  docId: (path: string) => string;
  docIdForPath: (path: string) => string | null;
  pathForDoc: (id: string) => string | null;
  rootId: (path: string) => string;
  rootIdForPath: (path: string) => string | null;
  pathForRoot: (id: string) => string | null;
}

export function createSessionIds(): SessionIds {
  const docToId = new Map<string, string>();
  const idToDoc = new Map<string, string>();
  const rootToId = new Map<string, string>();
  const idToRoot = new Map<string, string>();
  let docSeq = 0;
  let rootSeq = 0;

  return {
    docId: (path) => {
      const key = normalizePath(path);
      const existing = docToId.get(key);
      if (existing) return existing;
      const id = `doc-${++docSeq}`;
      docToId.set(key, id);
      idToDoc.set(id, path);
      return id;
    },
    docIdForPath: (path) => docToId.get(normalizePath(path)) ?? null,
    pathForDoc: (id) => idToDoc.get(id) ?? null,
    rootId: (path) => {
      const key = normalizePath(path);
      const existing = rootToId.get(key);
      if (existing) return existing;
      const id = `root-${++rootSeq}`;
      rootToId.set(key, id);
      idToRoot.set(id, path);
      return id;
    },
    rootIdForPath: (path) => rootToId.get(normalizePath(path)) ?? null,
    pathForRoot: (id) => idToRoot.get(id) ?? null,
  };
}

let currentIds = createSessionIds();

/** Id текущей сессии приложения. */
export function sessionIds(): SessionIds {
  return currentIds;
}

/** Сброс при смене workspace: старые docId/rootId больше не валидны. */
export function resetSessionIds(): void {
  currentIds = createSessionIds();
}
