import type {EditorTab} from "../../../store/editorStore";
import type {FileNode} from "../../../types";
import {buildDocumentGraph, fileNameOf, neighborsOf} from "../../harnessGraph";
import {
  repoRelativePath,
  resolveUlid,
  type HarnessIndexEntry,
} from "../../harnessIndex";
import {canonicalStatus, type TaskVocabulary} from "../../harnessTasks";
import {normalizePath, resolveRoot} from "../../roots";
import type {RootInfo} from "../../rootColors";
import {getExtension, getFileName, normalizeJoin} from "../../utils";
import {isConfigFileName} from "../config";
import type {FindingRule} from "../findings";
import {collectFindings} from "../findings";
import type {SessionIds} from "../ids";
import type {PolicyLimits} from "../policy";
import type {ProposalTarget} from "../proposals";
import type {HarnessIndexSnapshot, ToolDeps} from "./deps";
import {ToolError} from "./errors";

/**
 * Read-инструменты (Phase 8.2, §5.1): только opaque docId/rootId, никаких
 * абсолютных путей в результатах. Содержимое документов режется лимитами,
 * списки — лимитами §5.1 (50/20/20/50/100).
 */

const MAX_SELECTION_CHARS = 20000;
const MAX_SEARCH_SNIPPET = 200;
const MAX_TASKS = 100;
const MAX_SCAN_FILES = 30;
const SEARCHABLE_EXTENSIONS = new Set(["md", "markdown", "yfm", "mdx", "txt"]);

export interface ActiveDocumentResult {
  docId: string;
  name: string;
  content: string;
  originalChars: number;
  truncated: boolean;
  mode: EditorTab["mode"];
  dirty: boolean;
  kind: EditorTab["kind"];
  ulid?: string;
}

function truncateText(text: string, max: number): {text: string; truncated: boolean} {
  if (text.length <= max) return {text, truncated: false};
  const omitted = text.length - max;
  return {
    text: `${text.slice(0, max)}\n\n[truncated: ${omitted} chars omitted]`,
    truncated: true,
  };
}

function isWithin(path: string, root: string): boolean {
  const p = normalizePath(path);
  const r = normalizePath(root);
  return p === r || p.startsWith(`${r}/`);
}

/** Относительный путь для модели/audit: от корня harness-репо или workspace-корня. */
export function relativePathOf(
  path: string,
  roots: readonly RootInfo[],
  indexes: readonly HarnessIndexSnapshot[],
): string {
  const harness = findHarnessRepo(path, indexes);
  if (harness) {
    const relative = repoRelativePath(harness.repoRoot, path);
    if (relative) return relative;
  }
  const owner = resolveRoot(path, roots);
  if (owner) {
    const rootNorm = owner.path.replace(/\\/g, "/").replace(/\/+$/, "");
    const fileNorm = path.replace(/\\/g, "/");
    if (fileNorm.toLowerCase().startsWith(`${rootNorm.toLowerCase()}/`)) {
      return fileNorm.slice(rootNorm.length + 1);
    }
  }
  return getFileName(path);
}

/** Самый глубокий harness-репозиторий, содержащий путь. */
export function findHarnessRepo(
  path: string,
  indexes: readonly HarnessIndexSnapshot[],
): HarnessIndexSnapshot | null {
  const target = normalizePath(path);
  let best: HarnessIndexSnapshot | null = null;
  let bestLength = -1;
  for (const index of indexes) {
    const root = normalizePath(index.repoRoot);
    if ((target === root || target.startsWith(`${root}/`)) && root.length > bestLength) {
      best = index;
      bestLength = root.length;
    }
  }
  return best;
}

function findEntryByPath(
  index: HarnessIndexSnapshot,
  path: string,
): HarnessIndexEntry | undefined {
  const relative = repoRelativePath(index.repoRoot, path);
  if (!relative) return undefined;
  const target = relative.toLowerCase();
  return index.entries.find((entry) => entry.path.toLowerCase() === target);
}

function ulidForPath(
  path: string,
  indexes: readonly HarnessIndexSnapshot[],
): string | undefined {
  const index = findHarnessRepo(path, indexes);
  if (!index) return undefined;
  return findEntryByPath(index, path)?.ulid;
}

function resolveUlidAcross(
  ulid: string,
  indexes: readonly HarnessIndexSnapshot[],
): {index: HarnessIndexSnapshot; entry: HarnessIndexEntry} {
  const matches: Array<{index: HarnessIndexSnapshot; entry: HarnessIndexEntry}> = [];
  let ambiguous = false;
  for (const index of indexes) {
    const result = resolveUlid(index.byUlid, ulid);
    if (result.status === "found") matches.push({index, entry: result.entry});
    if (result.status === "ambiguous") ambiguous = true;
  }
  if (ambiguous) throw new ToolError("ulid_ambiguous", "ULID неоднозначен");
  if (matches.length === 0) throw new ToolError("ulid_not_found", "Документ не найден в реестре");
  const unique = new Map(matches.map((match) => [match.entry.ulid, match]));
  if (unique.size > 1) throw new ToolError("ulid_ambiguous", "ULID найден в нескольких репозиториях");
  return [...unique.values()][0];
}

function editableTab(deps: ToolDeps, ids: SessionIds, docId: string): EditorTab {
  const path = ids.pathForDoc(docId);
  if (!path) throw new ToolError("unknown_doc_id", "Неизвестный docId");
  const tab = deps.getTabs().find((item) => item.path === path);
  if (!tab) throw new ToolError("document_not_open", "Документ не открыт");
  if (tab.kind !== "markdown" && tab.kind !== "text") {
    throw new ToolError("unsupported_document", "Поддерживаются только markdown/text");
  }
  if (isConfigFileName(tab.path)) {
    throw new ToolError("config_read_only", "vasyavig.yaml доступен только для просмотра");
  }
  return tab;
}

/** Цель предложения: абсолютный путь остаётся внутри приложения. */
export function proposalTargetFor(
  deps: ToolDeps,
  ids: SessionIds,
  docId: string,
): ProposalTarget {
  const tab = editableTab(deps, ids, docId);
  return {
    docId,
    path: tab.path,
    relativePath: relativePathOf(tab.path, deps.getRoots(), deps.getHarnessIndexes()),
    fileName: tab.name,
    content: tab.content,
  };
}

export function getActiveDocument(
  deps: ToolDeps,
  ids: SessionIds,
  limits: PolicyLimits,
): ActiveDocumentResult {
  const activePath = deps.getActivePath();
  if (!activePath) throw new ToolError("no_active_document", "Нет активного документа");
  const tab = deps.getTabs().find((item) => item.path === activePath);
  if (!tab) throw new ToolError("no_active_document", "Нет активного документа");
  if (tab.kind !== "markdown" && tab.kind !== "text") {
    throw new ToolError("unsupported_document", "Активная вкладка не редактируется");
  }
  const content = truncateText(tab.content, limits.maxDocumentChars);
  const ulid = ulidForPath(tab.path, deps.getHarnessIndexes());
  return {
    docId: ids.docId(tab.path),
    name: tab.name,
    content: content.text,
    originalChars: tab.content.length,
    truncated: content.truncated,
    mode: tab.mode,
    dirty: tab.dirty,
    kind: tab.kind,
    ...(ulid ? {ulid} : {}),
  };
}

export interface OpenDocumentInfo {
  docId: string;
  name: string;
  kind: EditorTab["kind"];
  dirty: boolean;
  active: boolean;
}

export function listOpenDocuments(deps: ToolDeps, ids: SessionIds): OpenDocumentInfo[] {
  const activePath = deps.getActivePath();
  return deps
    .getTabs()
    .slice(0, 50)
    .map((tab) => ({
      docId: ids.docId(tab.path),
      name: tab.name,
      kind: tab.kind,
      dirty: tab.dirty,
      active: tab.path === activePath,
    }));
}

export interface WorkspaceRootInfo {
  rootId: string;
  name: string;
  isHarness: boolean;
}

export function listWorkspaceRoots(deps: ToolDeps, ids: SessionIds): WorkspaceRootInfo[] {
  return deps.getRoots().slice(0, 20).map((root) => ({
    rootId: ids.rootId(root.path),
    name: root.alias?.trim() || getFileName(root.path),
    isHarness: root.harness === true,
  }));
}

export interface DocumentResult {
  ulid: string;
  path: string;
  title: string;
  content: string;
  originalChars: number;
  truncated: boolean;
  open: boolean;
  docId?: string;
}

export async function getDocument(
  deps: ToolDeps,
  ids: SessionIds,
  limits: PolicyLimits,
  args: {ulid: string},
): Promise<DocumentResult> {
  const {index, entry} = resolveUlidAcross(args.ulid, deps.getHarnessIndexes());
  const absolute = normalizeJoin(index.repoRoot, entry.path);
  let content: string;
  try {
    content = await deps.readFile(absolute);
  } catch (e) {
    throw new ToolError("read_failed", `Не удалось прочитать документ: ${String(e)}`);
  }
  const truncated = truncateText(content, limits.maxDocumentChars);
  const openTab = deps
    .getTabs()
    .find((tab) => normalizePath(tab.path) === normalizePath(absolute));
  return {
    ulid: entry.ulid,
    path: entry.path,
    title: entry.title?.trim() || fileNameOf(entry.path),
    content: truncated.text,
    originalChars: content.length,
    truncated: truncated.truncated,
    open: Boolean(openTab),
    ...(openTab ? {docId: ids.docIdForPath(openTab.path) ?? ids.docId(openTab.path)} : {}),
  };
}

export interface SearchResult {
  docId?: string;
  path: string;
  title: string;
  snippet: string;
  source: "open" | "registry" | "file";
}

function snippetAround(text: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + queryLength + 120);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`.slice(
    0,
    MAX_SEARCH_SNIPPET,
  );
}

function collectTreeFiles(nodes: readonly FileNode[], out: string[], limit: number): void {
  for (const node of nodes) {
    if (out.length >= limit) return;
    if (node.isDir) {
      if (node.children) collectTreeFiles(node.children, out, limit);
      continue;
    }
    out.push(node.path);
  }
}

export async function searchDocuments(
  deps: ToolDeps,
  ids: SessionIds,
  args: {query: string; rootId?: string; limit: number},
): Promise<SearchResult[]> {
  const roots = deps.getRoots();
  let rootFilter: {path: string} | null = null;
  if (args.rootId) {
    const rootPath = ids.pathForRoot(args.rootId);
    if (!rootPath) throw new ToolError("unknown_root_id", "Неизвестный rootId");
    const root = roots.find((item) => normalizePath(item.path) === normalizePath(rootPath));
    if (!root) throw new ToolError("root_not_open", "Корень больше не открыт");
    rootFilter = root;
  }

  const query = args.query.toLowerCase();
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const indexes = deps.getHarnessIndexes();
  const limit = Math.min(20, Math.max(1, args.limit));

  const push = (result: SearchResult, absolute: string) => {
    if (results.length >= limit) return;
    const key = normalizePath(absolute);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(result);
  };

  for (const tab of deps.getTabs()) {
    if (results.length >= limit) break;
    if (tab.kind !== "markdown" && tab.kind !== "text") continue;
    if (rootFilter && !isWithin(tab.path, rootFilter.path)) continue;
    const index = tab.content.toLowerCase().indexOf(query);
    if (index < 0) continue;
    push(
      {
        docId: ids.docId(tab.path),
        path: relativePathOf(tab.path, roots, indexes),
        title: tab.name,
        snippet: snippetAround(tab.content, index, query.length),
        source: "open",
      },
      tab.path,
    );
  }

  let scanned = 0;
  for (const index of indexes) {
    if (results.length >= limit) break;
    // репозиторий может быть внутри выбранного корня или содержать его
    if (
      rootFilter &&
      !isWithin(index.repoRoot, rootFilter.path) &&
      !isWithin(rootFilter.path, index.repoRoot)
    ) {
      continue;
    }
    for (const entry of index.entries) {
      if (results.length >= limit) break;
      const absolute = normalizeJoin(index.repoRoot, entry.path);
      if (rootFilter && !isWithin(absolute, rootFilter.path)) continue;
      if (seen.has(normalizePath(absolute))) continue;
      const title = entry.title?.trim() || fileNameOf(entry.path);
      const metaHit =
        title.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query);
      if (metaHit) {
        push(
          {path: entry.path, title, snippet: entry.path.slice(0, MAX_SEARCH_SNIPPET), source: "registry"},
          absolute,
        );
        continue;
      }
      if (scanned >= MAX_SCAN_FILES) continue;
      scanned++;
      let content: string;
      try {
        content = await deps.readFile(absolute);
      } catch {
        continue;
      }
      if (content.length > 2_000_000) continue;
      const found = content.toLowerCase().indexOf(query);
      if (found < 0) continue;
      push(
        {
          path: entry.path,
          title,
          snippet: snippetAround(content, found, query.length),
          source: "registry",
        },
        absolute,
      );
    }
  }

  // Не-harness корни: дерево уже загружено в fileStore, содержимое читаем
  // только для ограниченного числа кандидатов.
  let fileScanned = 0;
  for (const root of roots) {
    if (results.length >= limit) break;
    if (
      rootFilter &&
      !isWithin(root.path, rootFilter.path) &&
      !isWithin(rootFilter.path, root.path)
    ) {
      continue;
    }
    const files: string[] = [];
    collectTreeFiles(deps.getFileTree(root.path) ?? [], files, 200);
    for (const file of files) {
      if (results.length >= limit) break;
      if (rootFilter && !isWithin(file, rootFilter.path)) continue;
      if (!SEARCHABLE_EXTENSIONS.has(getExtension(file))) continue;
      if (findHarnessRepo(file, indexes)) continue; // уже покрыто реестром
      const key = normalizePath(file);
      if (seen.has(key)) continue;
      const name = getFileName(file);
      const relative = relativePathOf(file, roots, indexes);
      if (name.toLowerCase().includes(query) || relative.toLowerCase().includes(query)) {
        push({path: relative, title: name, snippet: relative.slice(0, MAX_SEARCH_SNIPPET), source: "file"}, file);
        continue;
      }
      if (fileScanned >= MAX_SCAN_FILES) continue;
      fileScanned++;
      let content: string;
      try {
        content = await deps.readFile(file);
      } catch {
        continue;
      }
      if (content.length > 2_000_000) continue;
      const found = content.toLowerCase().indexOf(query);
      if (found < 0) continue;
      push(
        {path: relative, title: name, snippet: snippetAround(content, found, query.length), source: "file"},
        file,
      );
    }
  }

  return results;
}

export interface RelatedDocument {
  ulid: string;
  path: string;
  title: string;
  type: string;
  relation: "base" | "child" | "related";
  direction?: "in" | "out" | "both";
}

export function getRelatedDocuments(
  deps: ToolDeps,
  args: {ulid: string},
): RelatedDocument[] {
  const {index, entry} = resolveUlidAcross(args.ulid, deps.getHarnessIndexes());
  const graph = buildDocumentGraph(index.entries);
  const neighborhood = neighborsOf(graph, entry.ulid);
  const result: RelatedDocument[] = [];
  for (const node of neighborhood.bases) {
    result.push({ulid: node.ulid, path: node.path, title: node.title, type: node.type, relation: "base"});
  }
  for (const node of neighborhood.children) {
    result.push({ulid: node.ulid, path: node.path, title: node.title, type: node.type, relation: "child"});
  }
  for (const {node, direction} of neighborhood.related) {
    result.push({
      ulid: node.ulid,
      path: node.path,
      title: node.title,
      type: node.type,
      relation: "related",
      direction,
    });
  }
  return result.slice(0, 50);
}

export interface TaskResult {
  ulid: string;
  path: string;
  title: string;
  project?: string;
  kind: string | null;
  status: string | null;
  assignee: string | null;
  priority: string | null;
  tracker: string | null;
}

export async function listTasks(
  deps: ToolDeps,
  args: {status?: string; assignee?: string; project?: string},
): Promise<TaskResult[]> {
  const source = deps.getTaskSource();
  const indexes = deps.getHarnessIndexes();
  const result: TaskResult[] = [];
  const statusFilter = args.status?.toLowerCase();
  const assigneeFilter = args.assignee?.toLowerCase();
  const projectFilter = args.project?.toLowerCase();

  for (const index of indexes) {
    if (result.length >= MAX_TASKS) break;
    const vocab: TaskVocabulary = await source.loadVocabulary(index.repoRoot);
    const docs = source.listTaskDocs(index.repoRoot, vocab).slice(0, 200);
    const details = await Promise.all(
      docs.map(async (doc) => {
        try {
          return await source.loadTaskDetails(index.repoRoot, doc.path);
        } catch {
          return null; // битый/нечитаемый task-yaml не роняет список
        }
      }),
    );
    for (let i = 0; i < docs.length && result.length < MAX_TASKS; i++) {
      const doc = docs[i];
      const detail = details[i];
      if (projectFilter && (doc.project ?? "").toLowerCase() !== projectFilter) continue;
      const status = canonicalStatus(detail?.status ?? null, vocab);
      if (statusFilter && (status ?? "").toLowerCase() !== statusFilter) continue;
      if (assigneeFilter && (detail?.assignee ?? "").toLowerCase() !== assigneeFilter) continue;
      result.push({
        ulid: doc.ulid,
        path: doc.path,
        title: doc.title?.trim() || fileNameOf(doc.path),
        project: doc.project,
        kind: detail?.kind ?? null,
        status,
        assignee: detail?.assignee ?? null,
        priority: detail?.priority ?? null,
        tracker: detail?.tracker ?? null,
      });
    }
  }
  return result;
}

export interface SelectionResult {
  empty: boolean;
  docId?: string;
  text?: string;
  from?: number;
  to?: number;
  unit?: "prosemirror" | "codemirror";
  truncated?: boolean;
}

export function getSelection(deps: ToolDeps, ids: SessionIds): SelectionResult {
  const selection = deps.getSelection();
  const activePath = deps.getActivePath();
  if (!selection || selection.text === "" || !activePath || selection.path !== activePath) {
    return {empty: true};
  }
  const truncated = truncateText(selection.text, MAX_SELECTION_CHARS);
  return {
    empty: false,
    docId: ids.docId(selection.path),
    text: truncated.text,
    from: selection.from,
    to: selection.to,
    unit: selection.unit,
    truncated: truncated.truncated,
  };
}

export interface CheckDocumentResult {
  docId: string;
  path: string;
  findings: Awaited<ReturnType<typeof collectFindings>>;
  counts: {error: number; warning: number; info: number};
}

export async function checkDocument(
  deps: ToolDeps,
  ids: SessionIds,
  args: {docId: string; rules?: readonly FindingRule[]},
): Promise<CheckDocumentResult> {
  const tab = editableTab(deps, ids, args.docId);
  const indexes = deps.getHarnessIndexes();
  const harness = findHarnessRepo(tab.path, indexes) !== null;
  const findings = await collectFindings({
    content: tab.content,
    path: tab.path,
    rules: args.rules,
    harness,
    fileExists: deps.fileExists,
  });
  return {
    docId: args.docId,
    path: relativePathOf(tab.path, deps.getRoots(), indexes),
    findings,
    counts: {
      error: findings.filter((item) => item.severity === "error").length,
      warning: findings.filter((item) => item.severity === "warning").length,
      info: findings.filter((item) => item.severity === "info").length,
    },
  };
}
