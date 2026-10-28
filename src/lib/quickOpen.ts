import type {FileNode} from "../types";
import {getFileKind, getParentDir} from "./utils";

/**
 * Быстрое открытие (план 20261028_004, D7): чистая модель палитры Ctrl+P.
 * Источник — уже загруженные деревья корней (рекурсивны, Rust list_dir_tree).
 */

export interface QuickOpenEntry {
  path: string;
  name: string;
  dir: string;
}

export const QUICK_OPEN_LIMIT = 50;

/** Плоский индекс файлов всех корней: только типы, открываемые приложением. */
export function flattenFiles(trees: Record<string, FileNode[]>): QuickOpenEntry[] {
  const out: QuickOpenEntry[] = [];
  const visit = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.isDir) {
        if (node.children) visit(node.children);
      } else if (getFileKind(node.path) !== "unsupported") {
        out.push({path: node.path, name: node.name, dir: getParentDir(node.path)});
      }
    }
  };
  for (const nodes of Object.values(trees)) visit(nodes);
  return out;
}

/**
 * Fuzzy-подпоследовательность query по target: очки или null. Бонус за
 * подряд идущие совпадения и начало имени; короткие цели чуть выше.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q === "") return 0;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return null;
    streak = idx === ti ? streak + 1 : 0;
    score += 10 + streak * 5 + (idx === 0 ? 10 : 0) - Math.min(idx - ti, 5);
    ti = idx + 1;
  }
  return score - t.length * 0.1;
}

/** Отфильтровать и отранжировать записи; limit — максимум результатов. */
export function filterQuickOpen(
  entries: QuickOpenEntry[],
  query: string,
  limit = QUICK_OPEN_LIMIT,
): QuickOpenEntry[] {
  const scored: Array<{entry: QuickOpenEntry; score: number}> = [];
  for (const entry of entries) {
    const score = fuzzyScore(query, entry.name);
    if (score !== null) scored.push({entry, score});
  }
  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, limit).map((s) => s.entry);
}
