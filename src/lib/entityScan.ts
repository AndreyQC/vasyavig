/**
 * Скан репо для re-markup (Phase 8.5, T3b; план 20261105_003, B-1/B-2):
 * обход .md документов, разбор чип-ссылок `vas-entity:`, diff со словарём
 * идентичности `entities.jsonl`. Чистые функции: список файлов и содержимое
 * приходят снаружи (fileStore-дерево / listDirectory), probe-инъекция для
 * тестов. Скан ничего не пишет — только отчёт (B-6).
 */

import {parseEntityLinks} from "./agent/masking/vasEntityMarkup";
import type {EntitiesIndexFile} from "./entitiesIndex";

/** Вхождение разметки в документе (позиции raw-markdown). */
export interface EntityOccurrence {
  doc: string;
  start: number;
  end: number;
  value: string;
  type: string;
}

export interface EntitiesScan {
  /** Корень репо (posix). */
  root: string;
  /** Просканировано .md документов. */
  docs: number;
  /** Вхождения по ULID (порядок первого вхождения). */
  byUlid: Map<string, EntityOccurrence[]>;
}

export interface ChangedEntity {
  ulid: string;
  type: string;
  /** Эталон из индекса (canonical). */
  canonical: string;
  /** Новая форма из документа. */
  value: string;
  /** Одно вхождение (позиция для возможной правки href). */
  occurrence: EntityOccurrence;
}

export interface MissingEntity {
  ulid: string;
  type: string;
  canonical: string;
}

export interface UnknownKnown {
  type: string;
  value: string;
  /** ULID из индекса — предложение размечать им. */
  ulid: string;
  /** Каноническая форма из индекса. */
  canonical: string;
  /** Где найдено (первое). */
  doc: string;
  start: number;
  end: number;
}

export interface EntitiesDiff {
  changed: ChangedEntity[];
  missing: MissingEntity[];
  unknownKnown: UnknownKnown[];
}

const MD_RE = /\.md$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "target", "dist", ".venv"]);

/** Рекурсивный обход FileNode-дерева: список .md; скрытые/сторож-каталоги пропускаются. */
export function listMarkdownFiles(
  nodes: readonly {name: string; path: string; isDir: boolean; children: readonly unknown[] | null}[] | null,
  depth = 8,
): string[] {
  if (nodes == null || depth <= 0) return [];
  const out: string[] = [];
  for (const node of nodes) {
    if (node.isDir) {
      if (SKIP_DIRS.has(node.name) || node.name.startsWith(".")) continue;
      out.push(...listMarkdownFiles(node.children as never, depth - 1));
    } else if (MD_RE.test(node.name)) {
      out.push(node.path);
    }
  }
  return out;
}

/** Скан списка документов: разметка → вхождения per-ULID. */
export async function scanMarkdownContents(
  root: string,
  files: readonly {path: string; content: string}[],
): Promise<EntitiesScan> {
  const byUlid = new Map<string, EntityOccurrence[]>();
  for (const file of files) {
    for (const span of parseEntityLinks(file.content)) {
      const list = byUlid.get(span.ulid) ?? [];
      list.push({doc: file.path, start: span.start, end: span.end, value: span.value, type: span.type});
      byUlid.set(span.ulid, list);
    }
  }
  return {root, docs: files.length, byUlid};
}

/**
 * Diff скана со словарём идентичности (B-2). changed — форма не из
 * `forms ∪ canonical` своего ULID; missing — ULID индекса без вхождений;
 * unknown-known — точные совпадения значений индекса в тексте вне разметки.
 */
export function diffEntitiesScan(
  scan: EntitiesScan,
  index: EntitiesIndexFile,
  docContents: readonly {path: string; content: string}[],
): EntitiesDiff {
  const changed: ChangedEntity[] = [];
  for (const [ulid, occurrences] of scan.byUlid) {
    const entry = index.entries.find((e) => e.ulid === ulid);
    if (!entry) continue; // новая сущность — не changed (индекс догонит при сохранении)
    const known = new Set([entry.canonical, ...entry.forms]);
    for (const occurrence of occurrences) {
      if (!known.has(occurrence.value)) {
        changed.push({
          ulid,
          type: entry.type,
          canonical: entry.canonical,
          value: occurrence.value,
          occurrence,
        });
        break; // одна строка на сущность в панели
      }
    }
  }

  const missing: MissingEntity[] = [];
  for (const entry of index.entries) {
    if (!scan.byUlid.has(entry.ulid)) {
      missing.push({ulid: entry.ulid, type: entry.type, canonical: entry.canonical});
    }
  }

  const unknownKnown: UnknownKnown[] = [];
  const markedRangesByDoc = new Map<string, Array<{start: number; end: number}>>();
  for (const file of docContents) {
    markedRangesByDoc.set(
      file.path,
      parseEntityLinks(file.content).map((s) => ({start: s.start, end: s.end})),
    );
  }
  const seen = new Set<string>();
  for (const file of docContents) {
    const marked = markedRangesByDoc.get(file.path) ?? [];
    for (const entry of index.entries) {
      for (const form of new Set([entry.canonical, ...entry.forms])) {
        let from = 0;
        for (;;) {
          const at = file.content.indexOf(form, from);
          if (at === -1) break;
          from = at + form.length;
          const end = at + form.length;
          if (marked.some((range) => at < range.end && range.start < end)) continue;
          const key = `${entry.ulid}\u0000${form}\u0000${file.path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unknownKnown.push({
            type: entry.type,
            value: form,
            ulid: entry.ulid,
            canonical: entry.canonical,
            doc: file.path,
            start: at,
            end,
          });
          break; // первое вхождение на форму на документ
        }
      }
    }
  }

  return {changed, missing, unknownKnown};
}

/**
 * Сводка скана для пересборки индекса (B-3 rebuild): canonical — из старого
 * индекса, иначе первая форма; forms — все тексты ссылок ULID.
 */
export function scanToIndexEntries(
  scan: EntitiesScan,
  previous: readonly {ulid: string; type: string; canonical: string; forms: string[]}[],
): Array<{ulid: string; type: string; canonical: string; forms: string[]}> {
  const out: Array<{ulid: string; type: string; canonical: string; forms: string[]}> = [];
  for (const [ulid, occurrences] of scan.byUlid) {
    const forms = [...new Set(occurrences.map((o) => o.value))].sort();
    const prev = previous.find((e) => e.ulid === ulid);
    const canonical = prev != null && (prev.canonical === "" || forms.includes(prev.canonical))
      ? prev.canonical
      : occurrences[0]?.value ?? forms[0] ?? "";
    out.push({ulid, type: occurrences[0]?.type ?? prev?.type ?? "", canonical, forms});
  }
  return out.sort((a, b) => (a.ulid < b.ulid ? -1 : a.ulid > b.ulid ? 1 : 0));
}
