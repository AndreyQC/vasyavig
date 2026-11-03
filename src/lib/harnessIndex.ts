/**
 * Реестр документов harness-репозитория `harness_docs/harness_index/documents.jsonl`
 * (openspec task 20261025_001, план D4/D5).
 *
 * JSONL: `{"ulid","path","project","title","type","created","updated",
 * "related","based_on"}`, `path` — от корня репо (posix). Реестр коммитится и
 * пересобирается `make doc-index` в harness-репо — Vasyavig его только читает.
 * Резолвинг — полный ULID или уникальный префикс (как `make doc-find`).
 */

import {parseDocument} from "yaml";
import {readFile} from "../hooks/useTauriFS";
import {findUlidMatches} from "./harnessEnvelope";

export interface HarnessIndexEntry {
  ulid: string;
  /** Путь от корня репо, posix-разделители. */
  path: string;
  project?: string;
  title?: string;
  type?: string;
  created?: string;
  updated?: string;
  related?: string[];
  basedOn?: string[];
}

export const HARNESS_INDEX_REL = "harness_docs/harness_index/documents.jsonl";

/**
 * Единственный якорь harness-репозитория (T3c, план 20261105_002, HY-1):
 * `harness.yaml` в корне репо — per-repo конфигурация харнеса. Манифест
 * `harness_manifest.json` больше не читается (HY-2); `documents.jsonl` —
 * внутренность репо (реестр документов), не признак.
 */
export const HARNESS_YAML_REL = "harness.yaml";

/** Парсинг JSONL: пустые и битые строки пропускаются (реестр не должен ронять просмотр). */
export function parseDocumentsJsonl(text: string): HarnessIndexEntry[] {
  const entries: HarnessIndexEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const rec = raw as Record<string, unknown>;
    if (typeof rec?.ulid !== "string" || typeof rec?.path !== "string") continue;
    entries.push({
      ulid: rec.ulid,
      path: rec.path,
      project: typeof rec.project === "string" ? rec.project : undefined,
      title: typeof rec.title === "string" ? rec.title : undefined,
      type: typeof rec.type === "string" ? rec.type : undefined,
      created: typeof rec.created === "string" ? rec.created : undefined,
      updated: typeof rec.updated === "string" ? rec.updated : undefined,
      related: Array.isArray(rec.related) ? rec.related.map(String) : [],
      basedOn: Array.isArray(rec.based_on) ? rec.based_on.map(String) : [],
    });
  }
  return entries;
}

/** Индекс ULID -> запись; при дубле ULID побеждает последняя запись реестра. */
export function buildUlidIndex(entries: HarnessIndexEntry[]): Record<string, HarnessIndexEntry> {
  const byUlid: Record<string, HarnessIndexEntry> = {};
  for (const entry of entries) byUlid[entry.ulid] = entry;
  return byUlid;
}

export type UlidLookup =
  | {status: "found"; entry: HarnessIndexEntry}
  | {status: "unknown"}
  | {status: "ambiguous"; matches: number};

/** Резолв: точный ULID, иначе уникальный префикс (неоднозначный — ambiguous). */
export function resolveUlid(
  byUlid: Record<string, HarnessIndexEntry>,
  ulid: string,
): UlidLookup {
  const exact = byUlid[ulid];
  if (exact) return {status: "found", entry: exact};
  const prefix = ulid.toUpperCase();
  let found: HarnessIndexEntry | undefined;
  let count = 0;
  for (const key of Object.keys(byUlid)) {
    if (key.startsWith(prefix)) {
      count++;
      if (!found) found = byUlid[key];
    }
  }
  if (count === 1 && found) return {status: "found", entry: found};
  if (count > 1) return {status: "ambiguous", matches: count};
  return {status: "unknown"};
}

/** Каталог и его предки (нормализованные к `/`), максимум maxLevels подъёмов. */
export function ancestorDirs(dir: string, maxLevels = 10): string[] {
  const norm = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  const out: string[] = [];
  let cur = norm;
  for (let i = 0; i <= maxLevels && cur; i++) {
    out.push(cur);
    const idx = cur.lastIndexOf("/");
    if (idx <= 0) break; // дошли до корня диска/posix-корня
    cur = cur.slice(0, idx);
  }
  return out;
}

/** Проба чтения файла-кандидата: содержимое или null (нет файла/не читается). */
export type ReadProbe = (candidate: string) => Promise<string | null>;

export const defaultReadProbe: ReadProbe = async (candidate) => {
  try {
    return await readFile(candidate);
  } catch {
    return null;
  }
};

export interface FoundHarnessIndex {
  /** Корень репозитория harness (каталог с `harness.yaml`). */
  repoRoot: string;
  content: string;
}

/**
 * Корень harness-репо подъёмом от каталога: ближайший предок с валидным
 * `harness.yaml` (HY-1). null — якоря нет.
 */
export async function findHarnessRoot(
  dir: string,
  probe: ReadProbe = defaultReadProbe,
): Promise<string | null> {
  for (const ancestor of ancestorDirs(dir)) {
    const text = await probe(`${ancestor}/${HARNESS_YAML_REL}`);
    if (text != null && isHarnessYamlShape(text)) return ancestor;
  }
  return null;
}

/**
 * Поиск реестра: якорь `harness.yaml` (ближайший предок) + реестр
 * `harness_docs/harness_index/documents.jsonl` под ним. Репо с якорем, но
 * без реестра → null (репо распознан, ULID-функции отключены).
 */
export async function findHarnessIndex(
  dir: string,
  probe: ReadProbe = defaultReadProbe,
): Promise<FoundHarnessIndex | null> {
  const root = await findHarnessRoot(dir, probe);
  if (root == null) return null;
  const content = await probe(`${root}/${HARNESS_INDEX_REL}`);
  if (content == null) return null;
  return {repoRoot: root, content};
}

/** Нормализованный путь реестра по корню репо (для инвалидации по watcher-событию). */
export function harnessIndexPath(repoRoot: string): string {
  return `${repoRoot.replace(/\\/g, "/").replace(/\/+$/, "")}/${HARNESS_INDEX_REL}`;
}

/**
 * Единый предикат «каталог является harness-репо» (HY-1): только валидный
 * `harness.yaml` в этом каталоге. Потребители (флаг корня, дашборд) не меняются.
 */
export async function isHarnessRepoDir(
  dir: string,
  probe: ReadProbe = defaultReadProbe,
): Promise<boolean> {
  const root = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  const text = await probe(`${root}/${HARNESS_YAML_REL}`);
  return text != null && isHarnessYamlShape(text);
}

/** Якорь — читаемый YAML-объект; битый/пустой harness.yaml не маркер. */
export function isHarnessYamlShape(text: string): boolean {
  try {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) return false;
    const value = doc.toJS();
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Поддерево содержит harness-репо: узел дерева — якорь `harness.yaml`
 * (план 20261027_005, D9b; HY-1). Для пометки корня-родителя, содержащего
 * репо, без новых чтений диска.
 */
export function treeContainsHarnessRepo(nodes: readonly FileNodeLike[]): boolean {
  for (const node of nodes) {
    const p = node.path.replace(/\\/g, "/").toLowerCase();
    if (p.endsWith(`/${HARNESS_YAML_REL}`)) return true;
    if (node.children && treeContainsHarnessRepo(node.children)) return true;
  }
  return false;
}

/** Минимальный набор полей FileNode, нужный для обхода дерева (избегаем импорта типов Tauri). */
export interface FileNodeLike {
  path: string;
  children: readonly FileNodeLike[] | null;
}

/**
 * Корни harness-репозиториев внутри уже загруженного дерева: по якорю
 * `harness.yaml` (HY-1). Нужно, когда в workspace добавлен родительский
 * каталог, а сам репозиторий лежит во вложенной папке.
 */
export function collectHarnessRepoRoots(nodes: readonly FileNodeLike[]): string[] {
  const out: string[] = [];
  const suffix = `/${HARNESS_YAML_REL}`;
  const walk = (list: readonly FileNodeLike[]) => {
    for (const node of list) {
      const p = node.path.replace(/\\/g, "/");
      if (p.toLowerCase().endsWith(suffix)) {
        const root = p.slice(0, p.length - suffix.length);
        if (root) out.push(root);
      }
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return [...new Set(out)];
}

/**
 * Путь файла относительно корня репозитория (posix) — по нему ищется запись
 * реестра. null — файл вне репозитория. Регистр результата сохраняется:
 * пути реестра пишутся как есть.
 */
export function repoRelativePath(repoRoot: string, filePath: string): string | null {
  const root = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = filePath.replace(/\\/g, "/");
  if (!file.toLowerCase().startsWith(root.toLowerCase() + "/")) return null;
  return file.slice(root.length + 1);
}

export interface UlidLinkMeta {
  title: string;
  type: string;
}

/**
 * DOM-проход линкификации (план D3): правдоподобные ULID в текстовых узлах
 * оборачиваются в `<a class="ulid-link" data-ulid>` (найден в реестре) или
 * `<span class="ulid-unknown" data-ulid-unknown>` (нет в реестре). Текст
 * внутри ссылок не трогаем (не вкладываем a в a).
 */
export function linkifyUlidsInElement(
  root: ParentNode,
  lookup: (ulid: string) => UlidLinkMeta | null,
  unknownTitle: string,
  dir?: string,
): void {
  const doc = root.ownerDocument;
  if (!doc) return;
  const view = doc.defaultView;
  const SHOW_TEXT = view?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(root, SHOW_TEXT);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (parent?.closest("a")) continue;
    if (findUlidMatches(text.nodeValue ?? "").length > 0) targets.push(text);
  }
  for (const node of targets) {
    const text = node.nodeValue ?? "";
    const matches = findUlidMatches(text);
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const match of matches) {
      if (match.start > last) frag.append(text.slice(last, match.start));
      const hit = lookup(match.ulid);
      const el = hit ? doc.createElement("a") : doc.createElement("span");
      if (hit) {
        el.className = "ulid-link";
        el.setAttribute("data-ulid", match.ulid);
        el.setAttribute("aria-label", `${hit.title} · ${hit.type}`);
      } else {
        el.className = "ulid-unknown";
        el.setAttribute("data-ulid-unknown", match.ulid);
        el.setAttribute("aria-label", unknownTitle);
      }
      if (dir) el.setAttribute("data-ulid-dir", dir);
      el.textContent = match.ulid;
      frag.append(el);
      last = match.end;
    }
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}
