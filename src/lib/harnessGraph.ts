/**
 * Модель графа документов harness-репозитория (план 20261028_001, D1).
 *
 * Чистая функция от записей реестра `_docs_/_index/documents.jsonl`: никакого
 * I/O — на вход массив записей, на выход узлы и обратные индексы. Источник
 * (реестр) позже сменится на БД — поменяется только он, граф и UI останутся
 * прежними (D2).
 *
 * Направления рёбер:
 * - `based_on` — одностороннее: A.based_on = [B] значит «A основан на B»,
 *   то есть B — основание, A — порождённый. Обратное ребро выводится
 *   индексом `childrenByParent` (D3).
 * - `related` — симметричная смежность с пометкой направления (D4, Q3):
 *   документ видит и тех, кто ссылается на него, и тех, на кого ссылается
 *   он сам. В реестре взаимны лишь 138 из 696 записей `related`, поэтому
 *   симметризация существенно расширяет окрестность (1114 -> 788 документов
 *   «без связей»).
 */

import type {HarnessIndexEntry} from "./harnessIndex";

/** Направление связи `related` относительно текущего документа. */
export type RelatedDirection = "out" | "in" | "both";

export interface DocumentNode {
  ulid: string;
  /** Путь от корня репо, posix-разделители (как в реестре). */
  path: string;
  /** Заголовок реестра; запасной — имя файла (D7). */
  title: string;
  /** Тип документа (`plan`, `result`, …); пусто — в реестре не задан. */
  type: string;
  project?: string;
  created?: string;
  updated?: string;
}

/** Связь `related` с соседом: направление относительно текущего узла. */
export interface RelatedLink {
  ulid: string;
  direction: RelatedDirection;
}

export interface DocumentGraph {
  /** Узел графа по ULID. */
  nodes: Record<string, DocumentNode>;
  /** Путь (posix от корня репо) -> ULID: поиск документа по файлу. */
  byPath: Record<string, string>;
  /** Основание -> порождённые (обратный `based_on`, D3). */
  childrenByParent: Record<string, string[]>;
  /** Порождённый -> основания (`based_on` как записан в реестре). */
  parentsByChild: Record<string, string[]>;
  /** Симметричная смежность `related` с пометкой направления (D4). */
  relatedByNode: Record<string, RelatedLink[]>;
}

/** Запасной заголовок — имя файла из пути реестра (D7). */
export function fileNameOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/** Порядок узлов в дереве: сначала тип, затем заголовок. */
function compareNodes(a: DocumentNode, b: DocumentNode): number {
  const byType = a.type.localeCompare(b.type);
  if (byType !== 0) return byType;
  return a.title.localeCompare(b.title);
}

/**
 * Граф = чистая производная от записей реестра. Битые ULID (основания и
 * связанные, которых нет в реестре) рёбрами не становятся — сосед по такой
 * ссылке просто не показывается.
 */
export function buildDocumentGraph(entries: readonly HarnessIndexEntry[]): DocumentGraph {
  const nodes: Record<string, DocumentNode> = {};
  const byPath: Record<string, string> = {};
  for (const entry of entries) {
    nodes[entry.ulid] = {
      ulid: entry.ulid,
      path: entry.path,
      title: entry.title?.trim() || fileNameOf(entry.path),
      type: entry.type ?? "",
      project: entry.project,
      created: entry.created,
      updated: entry.updated,
    };
    byPath[entry.path] = entry.ulid;
  }

  // `based_on`: основание -> порождённый (D3)
  const parentsByChild: Record<string, string[]> = {};
  const childrenByParent: Record<string, string[]> = {};
  for (const entry of entries) {
    const ulid = entry.ulid;
    if (!nodes[ulid]) continue;
    for (const parent of entry.basedOn ?? []) {
      if (!nodes[parent] || parent === ulid) continue;
      const parents = parentsByChild[ulid];
      if (parents) parents.push(parent);
      else parentsByChild[ulid] = [parent];
      const children = childrenByParent[parent];
      if (children) children.push(ulid);
      else childrenByParent[parent] = [ulid];
    }
  }

  // `related`: сначала прямо записанные пары, потом симметризация (D4)
  const direct = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const other of entry.related ?? []) {
      if (!nodes[other] || other === entry.ulid) continue;
      const set = direct.get(entry.ulid);
      if (set) set.add(other);
      else direct.set(entry.ulid, new Set([other]));
    }
  }
  const relatedByNode: Record<string, RelatedLink[]> = {};
  const addLink = (from: string, to: string, direction: RelatedDirection) => {
    const list = relatedByNode[from];
    if (!list) {
      relatedByNode[from] = [{ulid: to, direction}];
      return;
    }
    const existing = list.find((l) => l.ulid === to);
    if (!existing) {
      list.push({ulid: to, direction});
      return;
    }
    // «out» + «in» = взаимная связь
    if (existing.direction !== direction) existing.direction = "both";
  };
  for (const [from, tos] of direct) {
    for (const to of tos) {
      addLink(from, to, "out");
      addLink(to, from, "in");
    }
  }

  return {nodes, byPath, childrenByParent, parentsByChild, relatedByNode};
}

/** Есть ли у документа хоть какая-то связь (основания, порождённые, related). */
export function hasLinks(graph: DocumentGraph, ulid: string): boolean {
  return (
    (graph.childrenByParent[ulid]?.length ?? 0) > 0 ||
    (graph.parentsByChild[ulid]?.length ?? 0) > 0 ||
    (graph.relatedByNode[ulid]?.length ?? 0) > 0
  );
}

export interface DocumentNeighborhood {
  /** Основания: документы, на которых основан текущий (`based_on`). */
  bases: DocumentNode[];
  /** Порождённые: документы, созданные на основе текущего. */
  children: DocumentNode[];
  /** Связанные: соседи по `related` (в обе стороны, с направлением). */
  related: {node: DocumentNode; direction: RelatedDirection}[];
}

/** Окрестность документа: основания / порождённые / связанные. */
export function neighborsOf(graph: DocumentGraph, ulid: string): DocumentNeighborhood {
  const pick = (list: string[] | undefined): DocumentNode[] =>
    (list ?? [])
      .map((id) => graph.nodes[id])
      .filter((n): n is DocumentNode => !!n)
      .sort(compareNodes);
  const related = (graph.relatedByNode[ulid] ?? [])
    .map((link) => {
      const node = graph.nodes[link.ulid];
      return node ? {node, direction: link.direction} : null;
    })
    .filter((x): x is {node: DocumentNode; direction: RelatedDirection} => x !== null)
    .sort((a, b) => compareNodes(a.node, b.node));
  return {
    bases: pick(graph.parentsByChild[ulid]),
    children: pick(graph.childrenByParent[ulid]),
    related,
  };
}

/** Фильтр обзора (D8): проект, тип, текстовый поиск, «только с связями». */
export interface GraphFilter {
  /** null — все проекты. */
  project?: string | null;
  /** null — все типы. */
  type?: string | null;
  /** Поиск по названию и пути (без регистра). */
  query?: string;
  /** Показывать только документы, у которых есть связи (Q5). */
  onlyLinked?: boolean;
}

export interface GraphTreeNode {
  node: DocumentNode;
  /** Дети дерева — порождённые по `based_on`, прошедшие фильтр. */
  children: GraphTreeNode[];
  /** Сколько связей `related` (бейдж в строке). */
  relatedCount: number;
}

/**
 * Лес обзора: корни — видимые документы без видимого основания; если
 * основание отфильтровано, его порождённый поднимается в корень. Циклы в
 * битом реестре не приводят к зацикливанию (защита `seen`).
 */
export function buildForest(graph: DocumentGraph, filter: GraphFilter = {}): GraphTreeNode[] {
  const query = (filter.query ?? "").trim().toLowerCase();
  const visible = (node: DocumentNode): boolean => {
    if (filter.project && node.project !== filter.project) return false;
    if (filter.type && node.type !== filter.type) return false;
    if (query) {
      const hay = `${node.title} ${node.path}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (filter.onlyLinked && !hasLinks(graph, node.ulid)) return false;
    return true;
  };

  const shown = Object.values(graph.nodes).filter(visible);
  const shownSet = new Set(shown.map((n) => n.ulid));

  const kids = new Map<string, string[]>();
  for (const node of shown) {
    for (const child of graph.childrenByParent[node.ulid] ?? []) {
      if (!shownSet.has(child)) continue;
      const list = kids.get(node.ulid);
      if (list) list.push(child);
      else kids.set(node.ulid, [child]);
    }
  }

  const roots = shown.filter(
    (node) => !(graph.parentsByChild[node.ulid] ?? []).some((p) => shownSet.has(p)),
  );

  const seen = new Set<string>();
  const build = (node: DocumentNode): GraphTreeNode => {
    seen.add(node.ulid);
    const children: GraphTreeNode[] = [];
    for (const ulid of kids.get(node.ulid) ?? []) {
      if (seen.has(ulid)) continue;
      const child = graph.nodes[ulid];
      if (!child) continue;
      children.push(build(child));
    }
    children.sort((a, b) => compareNodes(a.node, b.node));
    return {
      node,
      children,
      relatedCount: (graph.relatedByNode[node.ulid] ?? []).length,
    };
  };

  const forest = roots.sort(compareNodes).map((root) => build(root));
  // Узлы цикла `based_on` не достижимы ни из одного корня (у каждого есть
  // видимое основание) — иначе они исчезли бы из обзора целиком. Такие узлы
  // поднимаются в корень; ребро обратно по циклу обрезается защитой `seen`.
  for (const node of shown) {
    if (seen.has(node.ulid)) continue;
    forest.push(build(node));
  }
  return forest.sort((a, b) => compareNodes(a.node, b.node));
}

/** Значения поля `project` реестра (для фильтра). */
export function listProjects(graph: DocumentGraph): string[] {
  const set = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.project) set.add(node.project);
  }
  return [...set].sort();
}

/** Значения поля `type` реестра (для фильтра). */
export function listTypes(graph: DocumentGraph): string[] {
  const set = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.type) set.add(node.type);
  }
  return [...set].sort();
}
