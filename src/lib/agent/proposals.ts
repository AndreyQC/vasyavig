import type {EditorTab} from "../../store/editorStore";
import type {RootInfo} from "../rootColors";
import {normalizePath} from "../roots";
import {getExtension} from "../utils";
import {contentHash, countOccurrences} from "./hash";

/**
 * Предложения правок (Phase 8.2, D13/D14): `propose_*` только строят объект,
 * буфер не меняется. `applyProposal` — app-only: перепроверяет hash,
 * уникальность/якорь и путь, применяет полный текст через editor.replace()
 * (вкладка становится dirty, undo работает) или создаёт файл + dirty-вкладку.
 */

export type ProposalKind = "replace" | "insert" | "create";
export type ProposalStatus = "pending" | "applied" | "rejected" | "stale";

export interface ProposalCommon {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  createdAt: number;
  rationale?: string;
}

export interface ReplaceProposal extends ProposalCommon {
  kind: "replace";
  docId: string;
  /** Абсолютный путь — только для приложения, не для модели/UI. */
  path: string;
  relativePath: string;
  fileName: string;
  oldText: string;
  newText: string;
  expectedCount: number;
  baseHash: string;
  /** Полный текст после применения (вычислен на момент предложения). */
  resultText: string;
}

export interface InsertProposal extends ProposalCommon {
  kind: "insert";
  docId: string;
  path: string;
  relativePath: string;
  fileName: string;
  anchor: string;
  position: "before" | "after";
  text: string;
  baseHash: string;
  resultText: string;
}

export interface CreateProposal extends ProposalCommon {
  kind: "create";
  rootId: string;
  /** Абсолютный путь корня — только для приложения. */
  rootPath: string;
  relativePath: string;
  absolutePath: string;
  content: string;
  baseHash: string;
}

export type Proposal = ReplaceProposal | InsertProposal | CreateProposal;

export class ProposalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProposalError";
    this.code = code;
  }
}

let proposalSeq = 0;

export function createProposalId(): string {
  proposalSeq++;
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `prop-${Date.now().toString(36)}-${random}-${proposalSeq}`;
}

export interface ProposalTarget {
  docId: string;
  /** Абсолютный путь вкладки. */
  path: string;
  relativePath: string;
  fileName: string;
  content: string;
}

/** Предложение строится только для открытой вкладки с путём. */
function assertEditableTarget(target: ProposalTarget): void {
  if (target.path === "") {
    throw new ProposalError("invalid_target", "Документ недоступен");
  }
}

export interface ReplaceInput {
  target: ProposalTarget;
  oldText: string;
  newText: string;
  expectedCount?: number;
  rationale?: string;
  id?: string;
  now?: number;
}

export function buildReplaceProposal(input: ReplaceInput): ReplaceProposal {
  const {target} = input;
  assertEditableTarget(target);
  if (input.oldText === "") {
    throw new ProposalError("empty_old_text", "oldText не может быть пустым");
  }
  if (input.newText === input.oldText) {
    throw new ProposalError("no_change", "Предложение не меняет документ");
  }
  const expectedCount = input.expectedCount ?? 1;
  const actual = countOccurrences(target.content, input.oldText);
  if (actual !== expectedCount) {
    throw new ProposalError(
      "count_mismatch",
      `oldText встречается ${actual} раз, ожидалось ${expectedCount}`,
    );
  }
  return {
    id: input.id ?? createProposalId(),
    kind: "replace",
    status: "pending",
    createdAt: input.now ?? Date.now(),
    rationale: input.rationale,
    docId: target.docId,
    path: target.path,
    relativePath: target.relativePath,
    fileName: target.fileName,
    oldText: input.oldText,
    newText: input.newText,
    expectedCount,
    baseHash: contentHash(target.content),
    resultText: applyReplaceAll(target.content, input.oldText, input.newText),
  };
}

export interface InsertInput {
  target: ProposalTarget;
  anchor: string;
  position?: "before" | "after";
  text: string;
  rationale?: string;
  id?: string;
  now?: number;
}

export function buildInsertProposal(input: InsertInput): InsertProposal {
  const {target} = input;
  assertEditableTarget(target);
  const anchor = input.anchor;
  if (anchor === "") throw new ProposalError("empty_anchor", "anchor не может быть пустым");
  if (input.text === "") throw new ProposalError("empty_text", "text не может быть пустым");
  const position = input.position ?? "after";
  const resultText = applyInsert(target.content, anchor, position, input.text);
  if (resultText === null) {
    const count = anchor === "end" ? 0 : countOccurrences(target.content, anchor);
    throw new ProposalError(
      count === 0 ? "anchor_not_found" : "anchor_ambiguous",
      count === 0
        ? "Якорь не найден"
        : `Якорь встречается ${count} раз, нужен ровно один`,
    );
  }
  return {
    id: input.id ?? createProposalId(),
    kind: "insert",
    status: "pending",
    createdAt: input.now ?? Date.now(),
    rationale: input.rationale,
    docId: target.docId,
    path: target.path,
    relativePath: target.relativePath,
    fileName: target.fileName,
    anchor,
    position,
    text: input.text,
    baseHash: contentHash(target.content),
    resultText,
  };
}

export interface CreateInput {
  rootId: string;
  rootPath: string;
  relativePath: string;
  absolutePath: string;
  content: string;
  rationale?: string;
  id?: string;
  now?: number;
}

export function buildCreateProposal(input: CreateInput): CreateProposal {
  return {
    id: input.id ?? createProposalId(),
    kind: "create",
    status: "pending",
    createdAt: input.now ?? Date.now(),
    rationale: input.rationale,
    rootId: input.rootId,
    rootPath: input.rootPath,
    relativePath: input.relativePath,
    absolutePath: input.absolutePath,
    content: input.content,
    baseHash: contentHash(""),
  };
}

/** Заменить все вхождения oldText (количество уже проверено). */
export function applyReplaceAll(content: string, oldText: string, newText: string): string {
  return content.split(oldText).join(newText);
}

/**
 * Вставка по якорю или в конец. null — якорь не найден/неоднозначен.
 * `end` — в конец документа с отделением переводом строки при необходимости.
 */
export function applyInsert(
  content: string,
  anchor: string,
  position: "before" | "after",
  text: string,
): string | null {
  if (anchor === "end") {
    if (content === "") return text;
    return content.endsWith("\n") ? content + text : `${content}\n${text}`;
  }
  const count = countOccurrences(content, anchor);
  if (count !== 1) return null;
  const index = content.indexOf(anchor);
  const at = position === "before" ? index : index + anchor.length;
  return content.slice(0, at) + text + content.slice(at);
}

export interface DiffLine {
  type: "same" | "add" | "remove";
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  truncated: boolean;
}

const MAX_DIFF_LINES = 300;

function coarseDiff(oldText: string, newText: string, maxLines: number): DiffResult {
  const lines: DiffLine[] = [
    ...oldText.split("\n").map((text) => ({type: "remove" as const, text})),
    ...newText.split("\n").map((text) => ({type: "add" as const, text})),
  ];
  return {lines: lines.slice(0, maxLines), truncated: lines.length > maxLines};
}

/** Построчный diff (LCS) с ограничением; для карточки предложения. */
export function buildLineDiff(oldText: string, newText: string, maxLines = MAX_DIFF_LINES): DiffResult {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return coarseDiff(oldText, newText, maxLines);
  }

  // общий префикс/суффикс убираем до DP — фрагменты обычно небольшие
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  const n = aMid.length;
  const m = bMid.length;
  const dp: number[][] = Array.from({length: n + 1}, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aMid[i] === bMid[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aMid[i] === bMid[j]) {
      mid.push({type: "same", text: aMid[i]});
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      mid.push({type: "remove", text: aMid[i]});
      i++;
    } else {
      mid.push({type: "add", text: bMid[j]});
      j++;
    }
  }
  while (i < n) mid.push({type: "remove", text: aMid[i++]});
  while (j < m) mid.push({type: "add", text: bMid[j++]});

  const lines: DiffLine[] = [
    ...a.slice(0, prefix).map((text) => ({type: "same" as const, text})),
    ...mid,
    ...a.slice(a.length - suffix).map((text) => ({type: "same" as const, text})),
  ];
  return {lines: lines.slice(0, maxLines), truncated: lines.length > maxLines};
}

/** Diff для карточки: replace — old/new; insert/create — добавленный блок. */
export function proposalDiff(proposal: Proposal): DiffResult {
  if (proposal.kind === "replace") {
    return buildLineDiff(proposal.oldText, proposal.newText);
  }
  if (proposal.kind === "insert") {
    const context =
      proposal.anchor === "end" ? "" : proposal.anchor;
    const lines: DiffLine[] = [];
    if (context !== "") lines.push({type: "same", text: context});
    lines.push(...proposal.text.split("\n").map((text) => ({type: "add" as const, text})));
    return {lines: lines.slice(0, MAX_DIFF_LINES), truncated: lines.length > MAX_DIFF_LINES};
  }
  const lines = proposal.content.split("\n").map((text) => ({type: "add" as const, text}));
  return {lines: lines.slice(0, MAX_DIFF_LINES), truncated: lines.length > MAX_DIFF_LINES};
}

export interface EditorLike {
  replace: (text: string) => void;
}

export interface ProposalApplyDeps {
  getTabs: () => readonly EditorTab[];
  getEditor: (path: string) => EditorLike | null;
  setActiveTab: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  createFile: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  getRoots: () => readonly RootInfo[];
  validateCreateTarget: (
    rootPath: string,
    relativePath: string,
  ) => Promise<{absolutePath: string}>;
  fileExists: (path: string) => Promise<boolean>;
  openDirtyTab: (path: string, content: string, kind: "markdown" | "text") => void;
  waitForEditor?: (path: string) => Promise<EditorLike | null>;
}

export interface ApplyResult {
  ok: boolean;
  status: "applied" | "stale" | "error";
  error?: string;
  /** true — правка прошла через editor.replace(), undo работает. */
  undo?: boolean;
}

function stale(message: string): ApplyResult {
  return {ok: false, status: "stale", error: message};
}

async function applyFullText(
  proposal: ReplaceProposal | InsertProposal,
  deps: ProposalApplyDeps,
): Promise<ApplyResult> {
  const tab = deps.getTabs().find((item) => item.path === proposal.path);
  if (!tab) return stale("Документ больше не открыт");
  if (contentHash(tab.content) !== proposal.baseHash) {
    return stale("Документ изменился — предложение устарело");
  }
  if (proposal.kind === "replace") {
    if (countOccurrences(tab.content, proposal.oldText) !== proposal.expectedCount) {
      return stale("Текст изменился — предложение устарело");
    }
  } else if (
    proposal.anchor !== "end" &&
    countOccurrences(tab.content, proposal.anchor) !== 1
  ) {
    return stale("Якорь изменился — предложение устарело");
  }
  const resultText =
    proposal.kind === "replace"
      ? applyReplaceAll(tab.content, proposal.oldText, proposal.newText)
      : applyInsert(tab.content, proposal.anchor, proposal.position, proposal.text);
  if (resultText === null || resultText !== proposal.resultText) {
    return stale("Документ изменился — предложение устарело");
  }

  let undo = false;
  let appliedByEditor = false;
  if (tab.kind === "markdown") {
    if (!deps.getEditor(tab.path)) {
      deps.setActiveTab(tab.path);
      await deps.waitForEditor?.(tab.path);
    }
    const editor = deps.getEditor(tab.path);
    if (editor) {
      editor.replace(resultText);
      undo = true;
      appliedByEditor = true;
    }
  }
  if (appliedByEditor) {
    // Обычно editor.replace() синхронно эмитит change и стор обновляет сам.
    // Если change не пришёл — гарантируем dirty вручную; если пришёл с
    // нормализованным WYSIWYG-текстом — не затираем его сырым markdown.
    const after = deps.getTabs().find((item) => item.path === tab.path);
    if (!after || after.content === tab.content) {
      deps.updateContent(tab.path, resultText);
    }
  } else {
    deps.updateContent(tab.path, resultText);
  }
  return {ok: true, status: "applied", undo};
}

async function applyCreate(proposal: CreateProposal, deps: ProposalApplyDeps): Promise<ApplyResult> {
  const root = deps
    .getRoots()
    .find((item) => normalizePath(item.path) === normalizePath(proposal.rootPath));
  if (!root) return stale("Корень больше не открыт");
  if (
    deps
      .getTabs()
      .some((tab) => normalizePath(tab.path) === normalizePath(proposal.absolutePath))
  ) {
    return stale("Документ уже открыт");
  }

  let absolutePath: string;
  try {
    const target = await deps.validateCreateTarget(root.path, proposal.relativePath);
    absolutePath = target.absolutePath;
  } catch (e) {
    return stale(`Путь больше недопустим: ${String(e)}`);
  }
  if (await deps.fileExists(absolutePath)) {
    return stale("Файл уже существует — overwrite запрещён");
  }

  try {
    await deps.createFile(absolutePath);
  } catch (e) {
    return {ok: false, status: "error", error: `Не удалось создать файл: ${String(e)}`};
  }
  const kind: "markdown" | "text" = getExtension(absolutePath) === "txt" ? "text" : "markdown";
  deps.openDirtyTab(absolutePath, proposal.content, kind);
  await deps.refreshTree();
  return {ok: true, status: "applied", undo: false};
}

/** Применить предложение. Никогда не вызывается моделью. */
export async function applyProposal(
  proposal: Proposal,
  deps: ProposalApplyDeps,
): Promise<ApplyResult> {
  try {
    return proposal.kind === "create"
      ? await applyCreate(proposal, deps)
      : await applyFullText(proposal, deps);
  } catch (e) {
    return {ok: false, status: "error", error: String(e)};
  }
}
