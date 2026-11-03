import {create} from "zustand";
import {
  diffEntitiesScan,
  listMarkdownFiles,
  scanMarkdownContents,
  scanToIndexEntries,
  type ChangedEntity,
  type EntitiesDiff,
} from "../lib/entityScan";
import {
  ensureEntitiesIndex,
  writeEntitiesIndex,
  type EntityIndexEntry,
} from "../lib/entitiesIndex";
import {listDirectory} from "../hooks/useTauriFS";
import {useFileStore} from "./fileStore";
import {useEditorStore} from "./editorStore";
import {generateUlid} from "../lib/agent/masking/ulid";
import {getEditor} from "../lib/editorRegistry";
import {buildVasEntityHref} from "../lib/agent/masking/vasEntityLink";
import type {FileNode} from "../types";

/**
 * Состояние скана re-markup (Phase 8.5, T3b; план 20261105_003, B-3): скан
 * репо → diff со словарём идентичности → решения пользователя. Кэш на корень
 * до следующего скана; записи в документы — только явными действиями и
 * только в открытых вкладках (B-6).
 */
interface RootScan {
  scanning: boolean;
  at: number | null;
  scannedDocs: number;
  diff: EntitiesDiff | null;
  error: string | null;
}

interface EntityScanState {
  byRoot: Record<string, RootScan>;
  scan: (root: string) => Promise<void>;
  rebuildIndex: (root: string) => Promise<void>;
  resolveChanged: (root: string, change: ChangedEntity, decision: "same" | "new") => Promise<void>;
  removeMissing: (root: string, ulid: string) => Promise<void>;
  /** Выбрать правильный тип для ULID с разными type в href (T3e-2). */
  resolveTypeConflict: (root: string, ulid: string, chosenType: string) => Promise<void>;
  clear: (root: string) => void;
}

const initialRoot: RootScan = {scanning: false, at: null, scannedDocs: 0, diff: null, error: null};

/** Патч raw-контента: заменить href в конструкции вхождения на новый ULID. */
function retargetHrefAt(content: string, start: number, end: number, newUlid: string): string | null {
  const link = content.slice(start, end);
  const close = link.lastIndexOf("](");
  const href = link.slice(close + 2, -1);
  const sep = href.indexOf(":");
  if (sep === -1) return null;
  const token = href.slice(0, sep);
  if (!/^[a-z_]+$/.test(token)) return null;
  return content.slice(0, start) + `[${link.slice(1, close)}](${buildVasEntityHref(token, newUlid)})` + content.slice(end);
}

async function readDocContents(files: string[]): Promise<Array<{path: string; content: string}>> {
  // открытые вкладки — источник правды для уже открытых файлов (могут быть
  // dirty); остальные читаются с диска
  const tabs = useEditorStore.getState().tabs;
  const open = new Map(tabs.map((t) => [t.path.replace(/\\/g, "/").toLowerCase(), t.content]));
  const {readFile} = await import("../hooks/useTauriFS");
  const contents: Array<{path: string; content: string}> = [];
  for (const path of files) {
    const key = path.replace(/\\/g, "/").toLowerCase();
    if (open.has(key)) {
      contents.push({path, content: open.get(key)!});
      continue;
    }
    try {
      contents.push({path, content: await readFile(path)});
    } catch {
      // файл исчез между списком и чтением — пропускаем
    }
  }
  return contents;
}

/** Список .md корня: дерево из fileStore, незагруженное — рекурсивный listDirectory. */
async function collectMarkdownPaths(root: string): Promise<string[]> {
  const tree = useFileStore.getState().trees[root];
  if (tree != null) return listMarkdownFiles(tree as never);
  const walk = async (dir: string, depth: number): Promise<string[]> => {
    if (depth <= 0) return [];
    let nodes: FileNode[];
    try {
      nodes = await listDirectory(dir);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const node of nodes) {
      if (node.isDir) {
        if (node.name.startsWith(".") || ["node_modules", "target", "dist", ".venv"].includes(node.name)) continue;
        out.push(...(await walk(node.path, depth - 1)));
      } else if (/\.md$/i.test(node.name)) {
        out.push(node.path);
      }
    }
    return out;
  };
  return walk(root, 8);
}

export const useEntityScanStore = create<EntityScanState>((set, get) => ({
  byRoot: {},

  scan: async (root) => {
    const key = root.replace(/\\/g, "/");
    set((s) => ({byRoot: {...s.byRoot, [key]: {...(s.byRoot[key] ?? initialRoot), scanning: true, error: null}}}));
    try {
      const paths = await collectMarkdownPaths(root);
      const contents = await readDocContents(paths);
      const scanResult = await scanMarkdownContents(key, contents);
      const index = await ensureEntitiesIndex(root);
      const diff = diffEntitiesScan(scanResult, index, contents);
      set((s) => ({
        byRoot: {
          ...s.byRoot,
          [key]: {scanning: false, at: Date.now(), scannedDocs: scanResult.docs, diff, error: null},
        },
      }));
    } catch (e) {
      set((s) => ({
        byRoot: {
          ...s.byRoot,
          [key]: {...(s.byRoot[key] ?? initialRoot), scanning: false, error: String(e)},
        },
      }));
    }
  },

  rebuildIndex: async (root) => {
    const key = root.replace(/\\/g, "/");
    const index = await ensureEntitiesIndex(root);
    const paths = await collectMarkdownPaths(root);
    const contents = await readDocContents(paths);
    const scanResult = await scanMarkdownContents(key, contents);
    const entries = scanToIndexEntries(scanResult, index.entries) as EntityIndexEntry[];
    await writeEntitiesIndex(index, entries);
    await get().scan(root); // пересчитать diff по свежему индексу
  },

  resolveChanged: async (root, change, decision) => {
    const index = await ensureEntitiesIndex(root);
    if (decision === "same") {
      // «та же сущность» (опечатка): форма дописывается в forms записи
      const entry = index.entries.find((e) => e.ulid === change.ulid);
      if (entry && !entry.forms.includes(change.value)) {
        entry.forms = [...new Set([...entry.forms, change.value])].sort();
        await writeEntitiesIndex(index, index.entries);
      }
    } else {
      // «новая»: href вхождения переписывается на новый ULID — только открытая вкладка
      const tab = useEditorStore.getState().tabs.find(
        (t) => t.path.replace(/\\/g, "/").toLowerCase() === change.occurrence.doc.replace(/\\/g, "/").toLowerCase(),
      );
      if (!tab) {
        set((s) => ({
          byRoot: {
            ...s.byRoot,
            [root.replace(/\\/g, "/")]: {
              ...(s.byRoot[root.replace(/\\/g, "/")] ?? initialRoot),
              error: "open_required",
            },
          },
        }));
        return;
      }
      const editor = getEditor(tab.path);
      const next = editor == null ? null : retargetHrefAt(tab.content, change.occurrence.start, change.occurrence.end, generateUlid());
      if (next != null) {
        editor!.replace(next); // вкладка dirty, сохранение за пользователем
      }
    }
    await get().scan(root);
  },

  removeMissing: async (root, ulid) => {
    const index = await ensureEntitiesIndex(root);
    const entries = index.entries.filter((e) => e.ulid !== ulid);
    if (entries.length !== index.entries.length) {
      await writeEntitiesIndex(index, entries);
    }
    await get().scan(root);
  },

  resolveTypeConflict: async (root, ulid, chosenType) => {
    // 1) href в открытых вкладках: vas-entity:<wrong>:<ULID> → <chosenType>
    const tabs = useEditorStore.getState().tabs;
    for (const tab of tabs) {
      if (!tab.content.includes(ulid)) continue;
      const re = new RegExp(`vas-entity:([a-z_]+):(${ulid})`, "gi");
      const next = tab.content.replace(re, (match, wrongType: string) =>
        wrongType.toLowerCase() === chosenType.toLowerCase()
          ? match
          : `vas-entity:${chosenType.toLowerCase()}:${ulid}`,
      );
      if (next === tab.content) continue;
      const editor = getEditor(tab.path);
      if (editor != null) {
        editor.replace(next); // change → store → dirty (паттерн restoreUrls)
      } else {
        // вкладка без зарегистрированного editor (монтирование/тест) — стор
        useEditorStore.getState().updateContent(tab.path, next);
      }
    }
    // 2) индекс: type записи → выбранный
    const index = await ensureEntitiesIndex(root);
    const entry = index.entries.find((e) => e.ulid === ulid);
    if (entry != null && entry.type !== chosenType.toLowerCase()) {
      entry.type = chosenType.toLowerCase();
      await writeEntitiesIndex(index, index.entries);
    }
    await get().scan(root);
  },

  clear: (root) => {
    const key = root.replace(/\\/g, "/");
    set((s) => {
      const next = {...s.byRoot};
      delete next[key];
      return {byRoot: next};
    });
  },
}));
