import {Document, parseDocument} from "yaml";
import {getFileName, getParentDir, joinPath} from "../utils";

/**
 * Конфиг приложения `vasyavig.yaml` рядом с `.vasyavig-workspace`
 * (Phase 8.1, решения D2/D4/D5/D6).
 *
 * - В памяти — camelCase; в файле — snake_case.
 * - Неизвестные секции и ключи сохраняются при записи: сериализация идёт
 *   через YAML Document и меняет только известные пути.
 * - Секреты (`api_key`, при необходимости `base_url`) — только
 *   `crypto__<ENV>__<ciphertext>`; plain-ключ в файле — ошибка валидации.
 * - Невалидный файл не перезаписывается: стор остаётся на defaults и
 *   блокирует запись до успешного перечитывания.
 */

export const CONFIG_FILE_NAME = "vasyavig.yaml";
export const CONFIG_FILE_NAMES = ["vasyavig.yaml", "vasyavig.yml"];
export const CONFIG_VERSION = 1;

export type DataScope = "perimeter" | "local" | "external";
export type EditorSpellcheck = "off" | "ru" | "en" | "ru+en";
export type EditorDefaultMode = "wysiwyg" | "markup" | "split";
export type ContextChunking = "headings" | "none";
export type MaskingMode = "off" | "preview";
export type MaskingDetector = "secrets" | "email" | "phone" | "url_credentials";

export interface ModelCapabilities {
  streaming: boolean;
  jsonMode: boolean;
  tools: boolean;
}

export interface LlmModelConfig {
  /** Отображаемое имя; по умолчанию — id модели. */
  label: string;
  /** Base URL с `/v1`; может быть crypto-токеном. */
  baseUrl: string;
  /** Имя модели у провайдера. */
  model: string;
  /** Пустая строка или `crypto__<ENV>__<ciphertext>`. */
  apiKey: string;
  temperature: number;
  maxTokens: number;
  contextLimit: number;
  timeoutMs: number;
  capabilities: ModelCapabilities;
  dataScope: DataScope;
}

export interface LlmRequestConfig {
  timeoutMs: number;
  retries: number;
  retryBackoffMs: number;
}

export interface LlmConfig {
  defaultModel: string;
  request: LlmRequestConfig;
  models: Record<string, LlmModelConfig>;
}

export interface EditorSettings {
  spellcheck: EditorSpellcheck;
  defaultMode: EditorDefaultMode;
  fontSize: number;
}

export interface FilesSettings {
  hidden: boolean;
}

export interface AssistantContextSettings {
  includeDocument: boolean;
  includeSelection: boolean;
  maxChars: number;
  chunking: ContextChunking;
}

export interface AssistantWritesSettings {
  requireConfirmation: boolean;
}

export interface AssistantMaskingSettings {
  mode: MaskingMode;
  detectors: MaskingDetector[];
}

export interface AssistantAuditSettings {
  enabled: boolean;
  retainRuns: number;
}

export interface AssistantSettings {
  enabled: boolean;
  context: AssistantContextSettings;
  writes: AssistantWritesSettings;
  masking: AssistantMaskingSettings;
  audit: AssistantAuditSettings;
}

export interface AppSettings {
  editor: EditorSettings;
  files: FilesSettings;
  assistant: AssistantSettings;
}

export interface VasyavigConfig {
  version: typeof CONFIG_VERSION;
  llm: LlmConfig;
  app: AppSettings;
}

/** Ошибка схемы/формата конфига. Сообщение пригодно для показа пользователю. */
export class ConfigError extends Error {
  readonly path?: string;

  constructor(message: string, path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "ConfigError";
    this.path = path;
  }
}

export function createDefaultConfig(): VasyavigConfig {
  return {
    version: CONFIG_VERSION,
    llm: {
      defaultModel: "",
      request: {timeoutMs: 60000, retries: 2, retryBackoffMs: 500},
      models: {},
    },
    app: {
      editor: {spellcheck: "ru+en", defaultMode: "wysiwyg", fontSize: 14},
      files: {hidden: false},
      assistant: {
        enabled: true,
        context: {
          includeDocument: true,
          includeSelection: true,
          maxChars: 120000,
          chunking: "headings",
        },
        writes: {requireConfirmation: true},
        masking: {mode: "preview", detectors: ["secrets", "email", "phone"]},
        audit: {enabled: true, retainRuns: 50},
      },
    },
  };
}

/** Путь к конфигу для открытого workspace-файла (лежит в том же каталоге). */
export function configPathForWorkspace(workspaceFilePath: string): string {
  return joinPath(getParentDir(workspaceFilePath), CONFIG_FILE_NAME);
}

/** Это файл конфига (открывается read-only, правится только через форму)? */
export function isConfigFileName(path: string): boolean {
  return CONFIG_FILE_NAMES.includes(getFileName(path).toLowerCase());
}

/** Проверка формата `crypto__<ENV>__<ciphertext>`. */
export function isCryptoToken(value: string): boolean {
  const parts = value.trim().split("__");
  return parts.length === 3 && parts[0] === "crypto" && parts[1] !== "" && parts[2] !== "";
}

/** Разбор crypto-токена: имя env-переменной и ciphertext. */
export function parseCryptoToken(value: string): {env: string; ciphertext: string} | null {
  if (!isCryptoToken(value)) return null;
  const [, env, ciphertext] = value.trim().split("__");
  return {env, ciphertext};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new ConfigError("ожидается объект", path);
  return value;
}

function readString(value: unknown, path: string, fallback?: string): string {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new ConfigError("ожидается строка", path);
  }
  if (typeof value !== "string") throw new ConfigError("ожидается строка", path);
  return value;
}

function readNonEmptyString(value: unknown, path: string): string {
  const result = readString(value, path);
  if (result.trim() === "") throw new ConfigError("пустое значение", path);
  return result;
}

function readBoolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new ConfigError("ожидается true/false", path);
  return value;
}

function readNumber(
  value: unknown,
  path: string,
  opts: {fallback: number; min: number; max: number; integer?: boolean},
): number {
  if (value === undefined || value === null) return opts.fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigError("ожидается число", path);
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new ConfigError("ожидается целое число", path);
  }
  if (value < opts.min || value > opts.max) {
    throw new ConfigError(`значение вне диапазона ${opts.min}..${opts.max}`, path);
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ConfigError(`ожидается одно из: ${allowed.join(", ")}`, path);
  }
  return value as T;
}

function validateEndpoint(value: string, path: string): void {
  if (isCryptoToken(value)) return;
  if (!/^https?:\/\/[^\s?#]+$/i.test(value)) {
    throw new ConfigError(
      "base_url должен начинаться с http:// или https:// (или быть crypto-токеном)",
      path,
    );
  }
}

const DATA_SCOPES: readonly DataScope[] = ["perimeter", "local", "external"];
const MASKING_MODES: readonly MaskingMode[] = ["off", "preview"];
const MASKING_DETECTORS: readonly MaskingDetector[] = [
  "secrets",
  "email",
  "phone",
  "url_credentials",
];

function parseCapabilities(value: unknown, path: string): ModelCapabilities {
  const raw = readRecord(value, path);
  return {
    streaming: readBoolean(raw.streaming, `${path}.streaming`, true),
    jsonMode: readBoolean(raw.json_mode, `${path}.json_mode`, false),
    tools: readBoolean(raw.tools, `${path}.tools`, false),
  };
}

function parseModel(id: string, value: unknown): LlmModelConfig {
  const path = `llm.models.${id}`;
  const raw = readRecord(value, path);
  const baseUrl = readNonEmptyString(raw.base_url, `${path}.base_url`);
  validateEndpoint(baseUrl, `${path}.base_url`);

  const apiKey = readString(raw.api_key, `${path}.api_key`, "").trim();
  if (apiKey !== "" && !isCryptoToken(apiKey)) {
    throw new ConfigError(
      "api_key должен быть crypto__<ENV>__<ciphertext>; plain-ключи в конфиге не хранятся",
      `${path}.api_key`,
    );
  }

  return {
    label: readString(raw.label, `${path}.label`, id),
    baseUrl,
    model: readNonEmptyString(raw.model, `${path}.model`),
    apiKey,
    temperature: readNumber(raw.temperature, `${path}.temperature`, {
      fallback: 0.2,
      min: 0,
      max: 2,
    }),
    maxTokens: readNumber(raw.max_tokens, `${path}.max_tokens`, {
      fallback: 4096,
      min: 1,
      max: 1_000_000,
      integer: true,
    }),
    contextLimit: readNumber(raw.context_limit, `${path}.context_limit`, {
      fallback: 32000,
      min: 1,
      max: 10_000_000,
      integer: true,
    }),
    timeoutMs: readNumber(raw.timeout_ms, `${path}.timeout_ms`, {
      fallback: 60000,
      min: 1000,
      max: 600000,
      integer: true,
    }),
    capabilities: parseCapabilities(raw.capabilities, `${path}.capabilities`),
    dataScope: readEnum(raw.data_scope, `${path}.data_scope`, DATA_SCOPES, "perimeter"),
  };
}

function parseRequest(value: unknown): LlmRequestConfig {
  const raw = readRecord(value, "llm.request");
  return {
    timeoutMs: readNumber(raw.timeout_ms, "llm.request.timeout_ms", {
      fallback: 60000,
      min: 1000,
      max: 600000,
      integer: true,
    }),
    retries: readNumber(raw.retries, "llm.request.retries", {
      fallback: 2,
      min: 0,
      max: 5,
      integer: true,
    }),
    retryBackoffMs: readNumber(raw.retry_backoff_ms, "llm.request.retry_backoff_ms", {
      fallback: 500,
      min: 0,
      max: 60000,
      integer: true,
    }),
  };
}

function parseLlm(value: unknown): LlmConfig {
  const raw = readRecord(value, "llm");
  const modelsRaw = readRecord(raw.models, "llm.models");
  const models: Record<string, LlmModelConfig> = {};
  for (const [id, modelRaw] of Object.entries(modelsRaw)) {
    const trimmedId = id.trim();
    if (trimmedId === "") throw new ConfigError("id модели не может быть пустым", "llm.models");
    models[trimmedId] = parseModel(trimmedId, modelRaw);
  }

  const modelIds = Object.keys(models);
  const defaultModel =
    raw.default_model === undefined || raw.default_model === null
      ? (modelIds[0] ?? "")
      : readString(raw.default_model, "llm.default_model");
  if (defaultModel !== "" && !(defaultModel in models)) {
    throw new ConfigError(
      `default_model "${defaultModel}" отсутствует в llm.models`,
      "llm.default_model",
    );
  }

  return {defaultModel, request: parseRequest(raw.request), models};
}

function parseEditor(value: unknown): EditorSettings {
  const raw = readRecord(value, "app.editor");
  return {
    spellcheck: readEnum(
      raw.spellcheck,
      "app.editor.spellcheck",
      ["off", "ru", "en", "ru+en"] as const,
      "ru+en",
    ),
    defaultMode: readEnum(
      raw.default_mode,
      "app.editor.default_mode",
      ["wysiwyg", "markup", "split"] as const,
      "wysiwyg",
    ),
    fontSize: readNumber(raw.font_size, "app.editor.font_size", {
      fallback: 14,
      min: 8,
      max: 48,
      integer: true,
    }),
  };
}

function parseFiles(value: unknown): FilesSettings {
  const raw = readRecord(value, "app.files");
  return {hidden: readBoolean(raw.hidden, "app.files.hidden", false)};
}

function parseMaskingDetectors(value: unknown): MaskingDetector[] {
  if (value === undefined || value === null) return ["secrets", "email", "phone"];
  if (!Array.isArray(value)) {
    throw new ConfigError("ожидается список детекторов", "app.assistant.masking.detectors");
  }
  const detectors: MaskingDetector[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !MASKING_DETECTORS.includes(item as MaskingDetector)) {
      throw new ConfigError(
        `неизвестный детектор (${MASKING_DETECTORS.join(", ")})`,
        `app.assistant.masking.detectors[${index}]`,
      );
    }
    if (!detectors.includes(item as MaskingDetector)) detectors.push(item as MaskingDetector);
  }
  return detectors;
}

function parseAssistant(value: unknown): AssistantSettings {
  const raw = readRecord(value, "app.assistant");
  const context = readRecord(raw.context, "app.assistant.context");
  const writes = readRecord(raw.writes, "app.assistant.writes");
  const masking = readRecord(raw.masking, "app.assistant.masking");
  const audit = readRecord(raw.audit, "app.assistant.audit");

  return {
    enabled: readBoolean(raw.enabled, "app.assistant.enabled", true),
    context: {
      includeDocument: readBoolean(
        context.include_document,
        "app.assistant.context.include_document",
        true,
      ),
      includeSelection: readBoolean(
        context.include_selection,
        "app.assistant.context.include_selection",
        true,
      ),
      maxChars: readNumber(context.max_chars, "app.assistant.context.max_chars", {
        fallback: 120000,
        min: 1000,
        max: 2_000_000,
        integer: true,
      }),
      chunking: readEnum(
        context.chunking,
        "app.assistant.context.chunking",
        ["headings", "none"] as const,
        "headings",
      ),
    },
    writes: {
      requireConfirmation: readBoolean(
        writes.require_confirmation,
        "app.assistant.writes.require_confirmation",
        true,
      ),
    },
    masking: {
      mode: readEnum(masking.mode, "app.assistant.masking.mode", MASKING_MODES, "preview"),
      detectors: parseMaskingDetectors(masking.detectors),
    },
    audit: {
      enabled: readBoolean(audit.enabled, "app.assistant.audit.enabled", true),
      retainRuns: readNumber(audit.retain_runs, "app.assistant.audit.retain_runs", {
        fallback: 50,
        min: 1,
        max: 10000,
        integer: true,
      }),
    },
  };
}

function parseApp(value: unknown): AppSettings {
  const raw = readRecord(value, "app");
  return {
    editor: parseEditor(raw.editor),
    files: parseFiles(raw.files),
    assistant: parseAssistant(raw.assistant),
  };
}

function configFromRaw(raw: unknown): VasyavigConfig {
  if (raw === undefined || raw === null) return createDefaultConfig();
  if (!isRecord(raw)) throw new ConfigError("корень конфига должен быть объектом");

  if (raw.version !== undefined && raw.version !== CONFIG_VERSION) {
    throw new ConfigError(`поддерживается version: ${CONFIG_VERSION}`, "version");
  }

  return {
    version: CONFIG_VERSION,
    llm: parseLlm(raw.llm),
    app: parseApp(raw.app),
  };
}

/**
 * Разбор текста конфига. Пустой документ — defaults.
 * Любое несоответствие схеме — ConfigError (файл не трогаем).
 */
export function parseConfig(text: string): VasyavigConfig {
  const doc = parseDocument(text, {uniqueKeys: true});
  if (doc.errors.length > 0) {
    throw new ConfigError(`невалидный YAML: ${doc.errors[0].message}`);
  }
  return configFromRaw(doc.toJS());
}

function modelToRaw(model: LlmModelConfig): Record<string, unknown> {
  return {
    label: model.label,
    base_url: model.baseUrl,
    model: model.model,
    api_key: model.apiKey,
    temperature: model.temperature,
    max_tokens: model.maxTokens,
    context_limit: model.contextLimit,
    timeout_ms: model.timeoutMs,
    capabilities: {
      streaming: model.capabilities.streaming,
      json_mode: model.capabilities.jsonMode,
      tools: model.capabilities.tools,
    },
    data_scope: model.dataScope,
  };
}

/** Типизированный конфиг → snake_case-объект для YAML. */
export function configToRaw(config: VasyavigConfig): Record<string, unknown> {
  const models: Record<string, unknown> = {};
  for (const [id, model] of Object.entries(config.llm.models)) {
    models[id] = modelToRaw(model);
  }
  return {
    version: config.version,
    llm: {
      default_model: config.llm.defaultModel,
      request: {
        timeout_ms: config.llm.request.timeoutMs,
        retries: config.llm.request.retries,
        retry_backoff_ms: config.llm.request.retryBackoffMs,
      },
      models,
    },
    app: {
      editor: {
        spellcheck: config.app.editor.spellcheck,
        default_mode: config.app.editor.defaultMode,
        font_size: config.app.editor.fontSize,
      },
      files: {hidden: config.app.files.hidden},
      assistant: {
        enabled: config.app.assistant.enabled,
        context: {
          include_document: config.app.assistant.context.includeDocument,
          include_selection: config.app.assistant.context.includeSelection,
          max_chars: config.app.assistant.context.maxChars,
          chunking: config.app.assistant.context.chunking,
        },
        writes: {
          require_confirmation: config.app.assistant.writes.requireConfirmation,
        },
        masking: {
          mode: config.app.assistant.masking.mode,
          detectors: [...config.app.assistant.masking.detectors],
        },
        audit: {
          enabled: config.app.assistant.audit.enabled,
          retain_runs: config.app.assistant.audit.retainRuns,
        },
      },
    },
  };
}

/** Валидация типизированного конфига (для формы и стора). Бросает ConfigError. */
export function validateConfig(config: VasyavigConfig): void {
  configFromRaw(configToRaw(config));
}

/** Валидация одной модели — для формы настроек. Бросает ConfigError. */
export function validateModelConfig(id: string, model: LlmModelConfig): void {
  if (id.trim() === "") throw new ConfigError("id модели не может быть пустым", "llm.models");
  parseModel(id.trim(), modelToRaw(model));
}

function mergeRecord(existing: unknown, known: Record<string, unknown>): Record<string, unknown> {
  return isRecord(existing) ? {...existing, ...known} : known;
}

/**
 * Сериализация конфига. Если передан baseText — меняются только известные
 * ключи в исходном YAML Document: неизвестные секции/ключи и порядок сохраняются.
 */
export function serializeConfig(config: VasyavigConfig, baseText?: string | null): string {
  validateConfig(config);

  const doc =
    baseText && baseText.trim() !== "" ? parseDocument(baseText, {uniqueKeys: true}) : new Document({});
  if (doc.errors.length > 0) {
    throw new ConfigError(`невалидный YAML: ${doc.errors[0].message}`);
  }

  const existing = doc.toJS();
  if (existing !== undefined && existing !== null && !isRecord(existing)) {
    throw new ConfigError("корень конфига должен быть объектом");
  }
  const root = isRecord(existing) ? existing : {};
  const raw = configToRaw(config);
  const rawLlm = raw.llm as Record<string, unknown>;
  const rawApp = raw.app as Record<string, unknown>;

  const existingLlm = isRecord(root.llm) ? root.llm : {};
  const existingRequest = existingLlm.request;
  const existingModels = isRecord(existingLlm.models) ? existingLlm.models : {};

  try {
    doc.set("version", config.version);
    doc.setIn(["llm", "default_model"], rawLlm.default_model);
    doc.setIn(["llm", "request"], mergeRecord(existingRequest, rawLlm.request as Record<string, unknown>));

    // Удалённые в UI модели убираем; остальным сохраняем неизвестные поля.
    for (const id of Object.keys(existingModels)) {
      if (!(id in config.llm.models)) doc.deleteIn(["llm", "models", id]);
    }
    for (const [id, modelRaw] of Object.entries(
      rawLlm.models as Record<string, Record<string, unknown>>,
    )) {
      doc.setIn(["llm", "models", id], mergeRecord(existingModels[id], modelRaw));
    }

    const existingApp = isRecord(root.app) ? root.app : {};
    const existingAssistant = isRecord(existingApp.assistant) ? existingApp.assistant : {};
    const rawAssistant = rawApp.assistant as Record<string, unknown>;

    doc.setIn(["app", "editor"], mergeRecord(existingApp.editor, rawApp.editor as Record<string, unknown>));
    doc.setIn(["app", "files"], mergeRecord(existingApp.files, rawApp.files as Record<string, unknown>));
    doc.setIn(["app", "assistant", "enabled"], rawAssistant.enabled);
    for (const section of ["context", "writes", "masking", "audit"] as const) {
      doc.setIn(
        ["app", "assistant", section],
        mergeRecord(existingAssistant[section], rawAssistant[section] as Record<string, unknown>),
      );
    }
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(`не удалось обновить YAML: ${String(e)}`);
  }

  // lineWidth: 0 — не переносить длинные crypto-токены; indentSeq: false — как в образце.
  return doc.toString({indentSeq: false, lineWidth: 0});
}
