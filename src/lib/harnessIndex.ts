/**
 * Реестр документов harness-репозитория `_docs_/_index/documents.jsonl`
 * (openspec task 20261025_001, план D4/D5).
 *
 * JSONL: `{"ulid","path","project","title","type","created","updated",
 * "related","based_on"}`, `path` — от корня репо (posix). Реестр коммитится и
 * пересобирается `make doc-index` в harness-репо — Vasyavig его только читает.
 * Резолвинг — полный ULID или уникальный префикс (как `make doc-find`).
 */

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

export const HARNESS_INDEX_REL = "_docs_/_index/documents.jsonl";

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
  /** Корень репозитория harness (каталог, содержащий `_docs_`). */
  repoRoot: string;
  content: string;
}

/**
 * Поиск реестра подъёмом от каталога: первый найденный
 * `<предок>/_docs_/_index/documents.jsonl` выигрывает (ближайший репозиторий).
 */
export async function findHarnessIndex(
  dir: string,
  probe: ReadProbe = defaultReadProbe,
): Promise<FoundHarnessIndex | null> {
  for (const ancestor of ancestorDirs(dir)) {
    const candidate = `${ancestor}/${HARNESS_INDEX_REL}`;
    const content = await probe(candidate);
    if (content != null) return {repoRoot: ancestor, content};
  }
  return null;
}

/** Нормализованный путь реестра по корню репо (для инвалидации по watcher-событию). */
export function harnessIndexPath(repoRoot: string): string {
  return `${repoRoot.replace(/\\/g, "/").replace(/\/+$/, "")}/${HARNESS_INDEX_REL}`;
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
