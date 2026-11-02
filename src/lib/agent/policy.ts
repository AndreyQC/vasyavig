import {FINDING_RULES, type FindingRule} from "./findings";
import {
  FORBIDDEN_TOOL_NAMES,
  MODEL_TOOL_NAMES,
  toolDefinition,
  type ToolDefinition,
} from "./tools/catalog";

/**
 * Политика инструментов ассистента (Phase 8.2).
 *
 * - Allowlist по тирам: read-инструменты доступны обоим тирам, propose —
 *   только тиру `propose`; app-only `apply_proposal` моделью не вызывается.
 * - Аргументы валидируются по схемам каталога; неизвестные ключи запрещены.
 * - Бюджеты: число вызовов, суммарный размер результатов, число предложений.
 * - Запрещённые имена отсутствуют в каталоге; здесь — вторая проверка.
 */

export type ModelTier = "read" | "propose";

export class PolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}

export interface PolicyLimits {
  maxToolCallsPerRun: number;
  maxResultChars: number;
  maxSingleResultChars: number;
  maxDocumentChars: number;
  maxTextArgChars: number;
  maxOldTextChars: number;
  maxQueryChars: number;
  maxSearchResults: number;
  maxProposalsPerRun: number;
  maxProposalContentChars: number;
  maxRationaleChars: number;
}

export const DEFAULT_POLICY_LIMITS: PolicyLimits = {
  maxToolCallsPerRun: 32,
  maxResultChars: 300000,
  // JSON-обёртка документа (кавычки/экранирование) больше самого текста;
  // запас нужен, чтобы лимит 120k символов документа не срабатывал ложно.
  maxSingleResultChars: 160000,
  maxDocumentChars: 120000,
  maxTextArgChars: 200000,
  maxOldTextChars: 20000,
  maxQueryChars: 200,
  maxSearchResults: 20,
  maxProposalsPerRun: 10,
  maxProposalContentChars: 200000,
  maxRationaleChars: 2000,
};

export interface ToolBudget {
  calls: number;
  resultChars: number;
  proposals: number;
}

export function createToolBudget(): ToolBudget {
  return {calls: 0, resultChars: 0, proposals: 0};
}

function fail(code: string, message: string): never {
  throw new PolicyError(code, message);
}

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("invalid_args", "аргументы инструмента должны быть объектом");
  }
  return raw as Record<string, unknown>;
}

function checkKeys(obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail("unknown_argument", `неизвестный аргумент: ${key}`);
  }
}

function rawString(value: unknown, key: string): string {
  if (typeof value !== "string") fail("invalid_argument", `${key}: ожидается строка`);
  return value;
}

function requiredString(
  obj: Record<string, unknown>,
  key: string,
  opts: {max: number; allowEmpty?: boolean},
): string {
  const value = obj[key];
  if (value === undefined || value === null) fail("missing_argument", `${key}: обязательный аргумент`);
  const text = rawString(value, key);
  if (!opts.allowEmpty && text.trim() === "") fail("invalid_argument", `${key}: пустое значение`);
  if (text.length > opts.max) {
    fail("argument_too_large", `${key}: больше ${opts.max} символов`);
  }
  return text;
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  opts: {max: number; trim?: boolean},
): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  let text = rawString(value, key).trim();
  if (text === "") return undefined;
  if (text.length > opts.max) fail("argument_too_large", `${key}: больше ${opts.max} символов`);
  return opts.trim === false ? rawString(value, key) : text;
}

function readInteger(
  obj: Record<string, unknown>,
  key: string,
  opts: {min: number; max: number; fallback?: number},
): number {
  const value = obj[key];
  if (value === undefined || value === null) {
    if (opts.fallback !== undefined) return opts.fallback;
    fail("missing_argument", `${key}: обязательный аргумент`);
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail("invalid_argument", `${key}: ожидается целое число`);
  }
  if (value < opts.min || value > opts.max) {
    fail("invalid_argument", `${key}: вне диапазона ${opts.min}..${opts.max}`);
  }
  return value;
}

function readBoolean(
  obj: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = obj[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") fail("invalid_argument", `${key}: ожидается true/false`);
  return value;
}

function readOpaqueId(obj: Record<string, unknown>, key: string, kind: "doc" | "root" | "prop"): string {
  const value = obj[key];
  if (value === undefined || value === null) fail("missing_argument", `${key}: обязательный аргумент`);
  const text = rawString(value, key).trim();
  const pattern =
    kind === "doc" ? /^doc-\d+$/ : kind === "root" ? /^root-\d+$/ : /^prop-[A-Za-z0-9-]+$/;
  if (!pattern.test(text)) fail("invalid_argument", `${key}: некорректный opaque id`);
  return text;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{4,26}$/;

function readUlid(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (value === undefined || value === null) fail("missing_argument", `${key}: обязательный аргумент`);
  const text = rawString(value, key).trim().toUpperCase();
  if (!ULID_RE.test(text)) fail("invalid_argument", `${key}: ожидается ULID или его префикс`);
  return text;
}

export const ALLOWED_CREATE_EXTENSIONS = ["md", "yfm", "txt"] as const;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * Лексическая проверка относительного пути create (Q5). Абсолютные пути,
 * `..`, пустые сегменты, ADS/зарезервированные имена Windows и неразрешённые
 * расширения запрещены. Symlink-выход проверяет Rust (`validate_create_target`).
 */
export function normalizeCreateRelativePath(value: string): string {
  let path = value.trim().replace(/\\/g, "/");
  if (path === "") fail("invalid_path", "relativePath: пустой путь");
  if (path.length > 500) fail("invalid_path", "relativePath: слишком длинный путь");
  if (path.startsWith("/")) fail("invalid_path", "relativePath: абсолютный путь запрещён");
  if (/^[a-z]:/i.test(path)) fail("invalid_path", "relativePath: абсолютный путь запрещён");
  if (/[\0-\x1f]/.test(path)) fail("invalid_path", "relativePath: управляющие символы запрещены");

  const parts = path.split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") {
      fail("invalid_path", "relativePath: пустые сегменты и '..' запрещены");
    }
    if (part.endsWith(".") || part.endsWith(" ")) {
      fail("invalid_path", "relativePath: сегмент не может заканчиваться точкой или пробелом");
    }
    if (part.includes(":")) fail("invalid_path", "relativePath: ':' в имени запрещён");
    if (WINDOWS_RESERVED.test(part)) {
      fail("invalid_path", "relativePath: зарезервированное имя Windows");
    }
  }

  const fileName = parts[parts.length - 1];
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) fail("invalid_extension", "relativePath: нужно расширение .md/.yfm/.txt");
  const extension = fileName.slice(dot + 1).toLowerCase();
  if (!(ALLOWED_CREATE_EXTENSIONS as readonly string[]).includes(extension)) {
    fail("invalid_extension", "relativePath: разрешены только .md/.yfm/.txt");
  }

  path = parts.join("/");
  return path;
}

/** Проверка инструмента по тиру; возвращает объявление или бросает PolicyError. */
export function assertToolAllowed(name: string, tier: ModelTier): ToolDefinition {
  if (FORBIDDEN_TOOL_NAMES.includes(name)) {
    fail("forbidden_tool", `инструмент ${name} запрещён`);
  }
  const definition = toolDefinition(name);
  if (!definition) fail("unknown_tool", `неизвестный инструмент: ${name}`);
  if (definition.tier === "app") {
    fail("app_only_tool", `инструмент ${name} доступен только приложению`);
  }
  if (definition.tier === "propose" && tier !== "propose") {
    fail("tier_denied", `инструмент ${name} недоступен в read-тире`);
  }
  return definition;
}

export function isToolAllowed(name: string, tier: ModelTier): boolean {
  try {
    assertToolAllowed(name, tier);
    return true;
  } catch {
    return false;
  }
}

/** Model-реестр: имена read/propose без app-only. */
export function modelToolNames(): readonly string[] {
  return MODEL_TOOL_NAMES;
}

/** Валидация и нормализация аргументов по схеме инструмента. */
export function parseToolArgs(
  name: string,
  raw: unknown,
  limits: PolicyLimits = DEFAULT_POLICY_LIMITS,
): Record<string, unknown> {
  const definition = toolDefinition(name);
  if (!definition) fail("unknown_tool", `неизвестный инструмент: ${name}`);
  const obj = asObject(raw ?? {});
  checkKeys(obj, Object.keys(definition.parameters));

  switch (name) {
    case "get_active_document":
    case "get_selection":
    case "list_open_documents":
    case "list_workspace_roots":
      return {};

    case "get_document":
      return {ulid: readUlid(obj, "ulid")};

    case "get_related_documents":
      return {ulid: readUlid(obj, "ulid")};

    case "search_documents": {
      const query = requiredString(obj, "query", {max: limits.maxQueryChars}).trim();
      if (query === "") fail("invalid_argument", "query: пустая строка");
      const rootId = obj.rootId === undefined ? undefined : readOpaqueId(obj, "rootId", "root");
      const limit = readInteger(obj, "limit", {
        min: 1,
        max: limits.maxSearchResults,
        fallback: 10,
      });
      return {query, ...(rootId ? {rootId} : {}), limit};
    }

    case "list_tasks": {
      const status = optionalString(obj, "status", {max: 100});
      const assignee = optionalString(obj, "assignee", {max: 100});
      const project = optionalString(obj, "project", {max: 100});
      return {
        ...(status ? {status} : {}),
        ...(assignee ? {assignee} : {}),
        ...(project ? {project} : {}),
      };
    }

    case "check_document": {
      const docId = readOpaqueId(obj, "docId", "doc");
      let rules: FindingRule[] | undefined;
      if (obj.rules !== undefined && obj.rules !== null) {
        if (!Array.isArray(obj.rules) || obj.rules.length === 0) {
          fail("invalid_argument", "rules: ожидается непустой список");
        }
        const parsed: FindingRule[] = [];
        for (const item of obj.rules) {
          if (typeof item !== "string" || !(FINDING_RULES as readonly string[]).includes(item)) {
            fail("invalid_argument", `rules: неизвестное правило ${String(item)}`);
          }
          if (!parsed.includes(item as FindingRule)) parsed.push(item as FindingRule);
        }
        rules = parsed;
      }
      return {docId, ...(rules ? {rules} : {})};
    }

    case "propose_replace": {
      const docId = readOpaqueId(obj, "docId", "doc");
      const oldText = requiredString(obj, "oldText", {max: limits.maxOldTextChars});
      const newText = requiredString(obj, "newText", {
        max: limits.maxTextArgChars,
        allowEmpty: true,
      });
      const expectedCount = readInteger(obj, "expectedCount", {min: 1, max: 100, fallback: 1});
      const rationale = optionalString(obj, "rationale", {max: limits.maxRationaleChars});
      return {docId, oldText, newText, expectedCount, ...(rationale ? {rationale} : {})};
    }

    case "propose_insert": {
      const docId = readOpaqueId(obj, "docId", "doc");
      const anchor = requiredString(obj, "anchor", {max: 500});
      const position = obj.position === undefined ? "after" : rawString(obj.position, "position");
      if (position !== "before" && position !== "after") {
        fail("invalid_argument", "position: ожидается before или after");
      }
      const text = requiredString(obj, "text", {max: limits.maxTextArgChars});
      const rationale = optionalString(obj, "rationale", {max: limits.maxRationaleChars});
      return {docId, anchor, position, text, ...(rationale ? {rationale} : {})};
    }

    case "propose_create": {
      const rootId = readOpaqueId(obj, "rootId", "root");
      const relativePath = normalizeCreateRelativePath(rawString(obj.relativePath, "relativePath"));
      const content = requiredString(obj, "content", {
        max: limits.maxProposalContentChars,
        allowEmpty: true,
      });
      if (readBoolean(obj, "overwrite", false)) {
        fail("overwrite_forbidden", "overwrite запрещён: файл не должен существовать");
      }
      const rationale = optionalString(obj, "rationale", {max: limits.maxRationaleChars});
      return {rootId, relativePath, content, ...(rationale ? {rationale} : {})};
    }

    case "apply_proposal":
      return {proposalId: readOpaqueId(obj, "proposalId", "prop")};

    default:
      return fail("unknown_tool", `неизвестный инструмент: ${name}`);
  }
}

export function chargeToolCall(budget: ToolBudget, limits: PolicyLimits = DEFAULT_POLICY_LIMITS): void {
  budget.calls++;
  if (budget.calls > limits.maxToolCallsPerRun) {
    fail("budget_exceeded", `превышен лимит вызовов инструментов (${limits.maxToolCallsPerRun})`);
  }
}

export function chargeResult(
  budget: ToolBudget,
  chars: number,
  limits: PolicyLimits = DEFAULT_POLICY_LIMITS,
): void {
  if (chars > limits.maxSingleResultChars) {
    fail("result_too_large", `результат больше ${limits.maxSingleResultChars} символов`);
  }
  budget.resultChars += chars;
  if (budget.resultChars > limits.maxResultChars) {
    fail("budget_exceeded", `превышен лимит суммарного размера результатов (${limits.maxResultChars})`);
  }
}

export function chargeProposal(
  budget: ToolBudget,
  contentChars: number,
  limits: PolicyLimits = DEFAULT_POLICY_LIMITS,
): void {
  if (contentChars > limits.maxProposalContentChars) {
    fail("content_too_large", `содержимое предложения больше ${limits.maxProposalContentChars} символов`);
  }
  budget.proposals++;
  if (budget.proposals > limits.maxProposalsPerRun) {
    fail("budget_exceeded", `превышен лимит предложений (${limits.maxProposalsPerRun})`);
  }
}
