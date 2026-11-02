import type {LlmModelConfig, LlmRequestConfig} from "./config";

/**
 * OpenAI-совместимый провайдер (Phase 8.1).
 *
 * HTTP/SSE выполняет Rust (`stream_chat`): вебвью не ходит в сеть напрямую,
 * секреты не покидают Rust. Здесь — построение запроса, толерантный разбор
 * SSE/JSON, retry (D17: 1–2 попытки, без авто-fallback), capabilities и
 * отмена по runId.
 *
 * Транспорт инъектируется (`ChatTransport`) — тесты гоняют тот же `runChat`
 * против локального mock-сервера, без Tauri.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatTransportRequest {
  runId: string;
  /** Может быть crypto-токеном — расшифрует Rust. */
  baseUrl: string;
  /** Может быть crypto-токеном или пустой строкой. */
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  /** Вернуть false — транспорт прекращает чтение (отмена). */
  onBytes: (bytes: Uint8Array) => boolean;
  isCancelled: () => boolean;
}

export interface ChatTransport {
  send: (request: ChatTransportRequest) => Promise<void>;
}

/** Типизированная ошибка транспорта: статус/повторяемость/отмена. */
export class ChatTransportError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly cancelled: boolean;

  constructor(
    message: string,
    opts: {status?: number; retryable?: boolean; cancelled?: boolean} = {},
  ) {
    super(message);
    this.name = "ChatTransportError";
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.cancelled = opts.cancelled ?? false;
  }
}

export interface ChatOptions {
  model: LlmModelConfig;
  requestConfig: LlmRequestConfig;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** По умолчанию — true, если модель поддерживает streaming. */
  stream?: boolean;
  /** Попросить JSON mode; применяется только при capability json_mode. */
  jsonMode?: boolean;
  runId?: string;
  onDelta?: (delta: string) => void;
  onRetry?: (attempt: number, error: string) => void;
  /** Только для тестов/альтернативного транспорта. */
  transport?: ChatTransport;
}

export interface ChatResult {
  ok: boolean;
  text: string;
  error?: string;
  status?: number;
  cancelled: boolean;
  attempts: number;
  streaming: boolean;
  /** Был ли реально отправлен response_format (capability json_mode). */
  jsonMode: boolean;
}

interface RunState {
  cancelled: boolean;
}

const activeRuns = new Map<string, RunState>();

/** Сгенерировать id запуска для отмены. */
export function createRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Отменить запуск: локальный флаг + Rust cancel_run (если доступен).
 * Безопасно вызывать для неизвестного/уже завершённого id.
 */
export function cancelChatRun(runId: string): void {
  const state = activeRuns.get(runId);
  if (state) state.cancelled = true;
  void cancelRustRun(runId);
}

async function cancelRustRun(runId: string): Promise<void> {
  try {
    const {invoke} = await import("@tauri-apps/api/core");
    await invoke("cancel_run", {runId});
  } catch {
    // Не Tauri-окружение или запуск уже завершён — не ошибка отмены.
  }
}

/** Тело запроса OpenAI chat completions. */
export function buildChatBody(
  opts: Pick<ChatOptions, "model" | "messages" | "maxTokens" | "temperature">,
  streaming: boolean,
  jsonMode: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model.model,
    messages: opts.messages,
    temperature: opts.temperature ?? opts.model.temperature,
    max_tokens: opts.maxTokens ?? opts.model.maxTokens,
    stream: streaming,
  };
  if (jsonMode) body.response_format = {type: "json_object"};
  return body;
}

interface AttemptState {
  text: string;
  sawDelta: boolean;
  done: boolean;
  errorMessage: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `{error: {message}}` / `{error: "text"}` -> сообщение. */
export function extractErrorMessage(value: unknown): string | null {
  if (!isRecord(value) || !("error" in value)) return null;
  const error = value.error;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    return asString(error.message) ?? asString(error.type) ?? "Ошибка модели";
  }
  return "Ошибка модели";
}

/** Контент из choice: delta.content (стрим), message.content / text (non-stream). */
function extractChoiceContent(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0];
  if (!isRecord(choice)) return null;

  const delta = isRecord(choice.delta) ? choice.delta : null;
  const message = isRecord(choice.message) ? choice.message : null;
  const raw = delta?.content ?? message?.content ?? choice.text;
  if (typeof raw === "string") return raw;
  // OpenAI content может быть массивом частей [{type:"text", text:"..."}].
  if (Array.isArray(raw)) {
    const parts = raw
      .map((part) => (isRecord(part) ? asString(part.text) : null))
      .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join("") : null;
  }
  return null;
}

/** Обработать одну SSE-строку; нестандартные строки игнорируются. */
function processSseLine(line: string, onPayload: (payload: string) => void): void {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith(":")) return;
  if (!trimmed.startsWith("data:")) return;
  const payload = trimmed.slice("data:".length).trim();
  if (payload !== "") onPayload(payload);
}

function createResponseProcessor(
  streaming: boolean,
  onDelta: ((delta: string) => void) | undefined,
  state: AttemptState,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";

  const emit = (text: string) => {
    if (!text) return;
    state.text += text;
    state.sawDelta = true;
    onDelta?.(text);
  };

  const handlePayload = (payload: string) => {
    if (payload === "[DONE]") {
      state.done = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Неполный/нестандартный JSON — не роняем стрим.
      return;
    }
    const error = extractErrorMessage(parsed);
    if (error) {
      state.errorMessage = error;
      return;
    }
    const content = extractChoiceContent(parsed);
    if (content) emit(content);
  };

  const handleWholeJson = (text: string) => {
    if (text.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      state.errorMessage = "Ответ модели не является JSON";
      return;
    }
    const error = extractErrorMessage(parsed);
    if (error) {
      state.errorMessage = error;
      return;
    }
    const content = extractChoiceContent(parsed);
    if (content) emit(content);
  };

  return {
    push(bytes: Uint8Array): void {
      if (!streaming) {
        raw += decoder.decode(bytes, {stream: true});
        return;
      }
      buffer += decoder.decode(bytes, {stream: true});
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (state.done) break;
        processSseLine(line, handlePayload);
      }
    },
    finish(): void {
      if (!streaming) {
        raw += decoder.decode();
        handleWholeJson(raw);
        return;
      }
      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail === "") return;
      // Endpoint мог проигнорировать stream и вернуть один JSON.
      if (tail.startsWith("{")) handleWholeJson(tail);
      else processSseLine(tail, handlePayload);
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Строка ошибки Rust/Tauri -> типизированная ошибка. */
export function toTransportError(error: unknown): ChatTransportError {
  if (error instanceof ChatTransportError) return error;
  const message = String(error);
  const lower = message.toLowerCase();
  if (lower.includes("cancelled") || lower.includes("отмен")) {
    return new ChatTransportError(message, {cancelled: true});
  }
  const statusMatch = message.match(/HTTP\s+(\d{3})/i);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return new ChatTransportError(message, {
      status,
      retryable: status >= 500 || status === 429,
    });
  }
  // Сетевые/таймауты Rust — повторяемы; остальное (конфиг/crypto) — нет.
  const retryable =
    lower.includes("таймаут") ||
    lower.includes("подключиться") ||
    lower.includes("чтение стрима") ||
    lower.includes("http-запрос упал");
  return new ChatTransportError(message, {retryable});
}

/** Транспорт через Tauri-команду `stream_chat` (боевой путь). */
export function createTauriTransport(): ChatTransport {
  return {
    async send(req: ChatTransportRequest): Promise<void> {
      const {Channel, invoke} = await import("@tauri-apps/api/core");
      const channel = new Channel<{data: number[]}>();
      let stopped = false;
      channel.onmessage = (message) => {
        if (stopped) return;
        const keepGoing = req.onBytes(new Uint8Array(message.data));
        if (!keepGoing) {
          stopped = true;
          void cancelRustRun(req.runId);
        }
      };

      try {
        await invoke("stream_chat", {
          runId: req.runId,
          baseUrl: req.baseUrl,
          apiKey: req.apiKey,
          body: req.body,
          timeoutMs: req.timeoutMs,
          onEvent: channel,
        });
      } catch (e) {
        throw toTransportError(e);
      }
    },
  };
}

let defaultTransport: ChatTransport | null = null;

function getDefaultTransport(): ChatTransport {
  defaultTransport ??= createTauriTransport();
  return defaultTransport;
}

/**
 * Выполнить чат-запрос: стрим (если модель умеет и не отключён), парсинг,
 * короткий retry без дублирования уже полученного текста, отмена.
 * Никогда не бросает: результат в `ChatResult`.
 */
export async function runChat(opts: ChatOptions): Promise<ChatResult> {
  const runId = opts.runId ?? createRunId();
  const runState: RunState = {cancelled: false};
  activeRuns.set(runId, runState);

  const transport = opts.transport ?? getDefaultTransport();
  const streaming = opts.stream !== false && opts.model.capabilities.streaming;
  const jsonMode = opts.jsonMode === true && opts.model.capabilities.jsonMode;
  const timeoutMs = opts.model.timeoutMs || opts.requestConfig.timeoutMs;
  const maxAttempts = 1 + Math.max(0, opts.requestConfig.retries);

  let attempts = 0;
  let lastError = "";

  const cancelledResult = (text: string): ChatResult => ({
    ok: false,
    text,
    error: "Запрос отменён",
    cancelled: true,
    attempts,
    streaming,
    jsonMode,
  });

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (runState.cancelled) return cancelledResult("");
      attempts++;
      const state: AttemptState = {text: "", sawDelta: false, done: false, errorMessage: null};
      const processor = createResponseProcessor(streaming, opts.onDelta, state);

      try {
        await transport.send({
          runId,
          baseUrl: opts.model.baseUrl,
          apiKey: opts.model.apiKey,
          body: buildChatBody(opts, streaming, jsonMode),
          timeoutMs,
          onBytes: (bytes) => {
            if (runState.cancelled) return false;
            processor.push(bytes);
            return !runState.cancelled;
          },
          isCancelled: () => runState.cancelled,
        });

        if (runState.cancelled) return cancelledResult(state.text);
        processor.finish();
        if (state.errorMessage) {
          return {
            ok: false,
            text: state.text,
            error: state.errorMessage,
            cancelled: false,
            attempts,
            streaming,
            jsonMode,
          };
        }
        return {
          ok: true,
          text: state.text,
          cancelled: false,
          attempts,
          streaming,
          jsonMode,
        };
      } catch (e) {
        if (runState.cancelled) return cancelledResult(state.text);
        const err = toTransportError(e);
        if (err.cancelled) return cancelledResult(state.text);
        lastError = err.message;

        // Повторяем только если ничего не успели отдать: иначе дубли текста.
        if (err.retryable && !state.sawDelta && attempt + 1 < maxAttempts) {
          opts.onRetry?.(attempt + 1, err.message);
          await delay(opts.requestConfig.retryBackoffMs * (attempt + 1));
          continue;
        }
        return {
          ok: false,
          text: state.text,
          error: err.message,
          status: err.status,
          cancelled: false,
          attempts,
          streaming,
          jsonMode,
        };
      }
    }

    return {
      ok: false,
      text: "",
      error: lastError || "Модель недоступна",
      cancelled: false,
      attempts,
      streaming,
      jsonMode,
    };
  } finally {
    activeRuns.delete(runId);
  }
}

/**
 * Проверка endpoint'а/модели/ключа: минимальный non-stream запрос.
 * Успех = HTTP 2xx и корректный ответ; текст ответа не важен.
 */
export async function checkModel(
  model: LlmModelConfig,
  requestConfig: LlmRequestConfig,
  transport?: ChatTransport,
): Promise<ChatResult> {
  return runChat({
    model,
    requestConfig,
    messages: [{role: "user", content: "ping"}],
    maxTokens: 16,
    temperature: 0,
    stream: false,
    transport,
  });
}
