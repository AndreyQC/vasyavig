/**
 * Локальный audit ассистента (Phase 8.2, D18).
 *
 * Только метаданные: время, модель, операция, путь (относительный/имя),
 * hash, результат apply, число findings. Содержимое документов, oldText/
 * newText и значения сущностей сюда не попадают — `record` собирает запись
 * из белого списка полей, а не сохраняет переданный объект целиком.
 */

export type AuditOperation =
  | "check_document"
  | "propose_replace"
  | "propose_insert"
  | "propose_create"
  | "apply_proposal"
  | "run"
  | "email_html";

export type AuditResult =
  | "ok"
  | "error"
  | "proposed"
  | "applied"
  | "rejected"
  | "stale"
  | "cancelled";

export interface AuditEntryInput {
  operation: AuditOperation;
  result: AuditResult;
  /** id модели из конфига (не endpoint и не ключ). */
  model?: string;
  runId?: string;
  docId?: string;
  /** Относительный путь или имя файла; абсолютные пути не нужны. */
  path?: string;
  hash?: string;
  proposalKind?: "replace" | "insert" | "create";
  findings?: number;
  /**
   * Маскирование (Phase 8.5 T1): только метаданные — режим, факт подтверждения
   * и счётчики по типам. Значения сущностей не передаются (D8).
   */
  masking?: {
    mode: "off" | "preview";
    /** До T1b подтверждения нет — "none" (R2 плана 20261104_001). */
    confirmation: "none";
    entities: number;
    counts: Record<string, number>;
  };
}

export interface AuditEntry extends AuditEntryInput {
  id: string;
  /** ISO-время. */
  timestamp: string;
}

export interface AuditStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface AuditOptions {
  enabled?: boolean;
  /** Максимум записей; по умолчанию 50 (`app.assistant.audit.retain_runs`). */
  retainRuns?: number;
}

export const AUDIT_STORAGE_KEY = "vasyavig.agent.audit";
const DEFAULT_RETAIN = 50;

/** Хранилище в памяти — тесты и окружения без localStorage. */
export function createMemoryAuditStorage(initial?: string | null): AuditStorage & {
  value: string | null;
} {
  const box = {value: initial ?? null};
  return {
    get value() {
      return box.value;
    },
    set value(next: string | null) {
      box.value = next;
    },
    getItem: () => box.value,
    setItem: (_key, value) => {
      box.value = value;
    },
    removeItem: () => {
      box.value = null;
    },
  };
}

function safeLocalStorage(): AuditStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function limit(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value === "") return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function sanitize(input: AuditEntryInput, id: string, timestamp: string): AuditEntry {
  const entry: AuditEntry = {
    id,
    timestamp,
    operation: input.operation,
    result: input.result,
  };
  const model = limit(input.model, 100);
  const runId = limit(input.runId, 64);
  const docId = limit(input.docId, 32);
  const path = limit(input.path, 500);
  const hash = limit(input.hash, 64);
  if (model) entry.model = model;
  if (runId) entry.runId = runId;
  if (docId) entry.docId = docId;
  if (path) entry.path = path;
  if (hash) entry.hash = hash;
  if (input.proposalKind) entry.proposalKind = input.proposalKind;
  if (typeof input.findings === "number" && Number.isFinite(input.findings)) {
    entry.findings = Math.max(0, Math.trunc(input.findings));
  }
  if (input.masking) {
    const counts: Record<string, number> = {};
    for (const [type, count] of Object.entries(input.masking.counts)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) {
        counts[type] = Math.trunc(count);
      }
    }
    entry.masking = {
      mode: input.masking.mode === "preview" ? "preview" : "off",
      confirmation: "none",
      entities: Math.max(0, Math.trunc(input.masking.entities) || 0),
      counts,
    };
  }
  return entry;
}

export class AuditLog {
  private readonly storage: AuditStorage | null;
  private readonly clock: () => number;
  private seq = 0;

  constructor(storage: AuditStorage | null = safeLocalStorage(), clock: () => number = Date.now) {
    this.storage = storage;
    this.clock = clock;
  }

  list(): AuditEntry[] {
    if (!this.storage) return [];
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(AUDIT_STORAGE_KEY);
    } catch {
      return [];
    }
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is AuditEntry =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as AuditEntry).id === "string" &&
          typeof (item as AuditEntry).timestamp === "string" &&
          typeof (item as AuditEntry).operation === "string" &&
          typeof (item as AuditEntry).result === "string",
      );
    } catch {
      return [];
    }
  }

  record(input: AuditEntryInput, opts: AuditOptions = {}): AuditEntry | null {
    if (opts.enabled === false || !this.storage) return null;
    const now = this.clock();
    const timestamp = new Date(now).toISOString();
    const entry = sanitize(input, `audit-${now}-${++this.seq}`, timestamp);
    const retain = Math.max(1, Math.trunc(opts.retainRuns ?? DEFAULT_RETAIN));
    const next = [...this.list(), entry].slice(-retain);
    try {
      this.storage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage может быть переполнен/запрещён — audit не должен ронять UI
      return null;
    }
    return entry;
  }

  clear(): void {
    try {
      this.storage?.removeItem(AUDIT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

/** Singleton приложения. */
export const auditLog = new AuditLog();

export function recordAudit(input: AuditEntryInput, opts: AuditOptions = {}): AuditEntry | null {
  return auditLog.record(input, opts);
}
