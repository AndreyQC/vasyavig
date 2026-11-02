import type {ChatMessage} from "../provider";

/**
 * Рецепт «Письмо HTML» — модельная стадия (Phase 8.4, §6.2 п. 4).
 *
 * Модель отвечает ТОЛЬКО за тему и preheader: строгий JSON
 * `{"subject": "...", "preheader": "..."}`. Тело письма модель не генерирует
 * — оно детерминированное (renderEmailBody). Здесь чистые функции: промпт,
 * разбор/валидация, repair-retry. Оркестрация — в agentStore; при невалидном
 * ответе после одного repair-retry — fallback «тема = имя документа».
 */

export interface EmailMeta {
  subject: string;
  preheader: string;
}

export type ParseEmailMetaResult =
  | {ok: true; meta: EmailMeta}
  | {ok: false; errors: string[]};

/** Ограничения: тема без переводов строк (RFC 5322), preheader короткий. */
export const MAX_SUBJECT_CHARS = 200;
export const MAX_PREHEADER_CHARS = 300;

const SYSTEM_PROMPT = [
  "Ты — ассистент по документации в редакторе Vasyavig (markdown/YFM).",
  "Тебе дан текст документа (возможно, усечённый). Подбери тему и preheader для HTML-письма, собранного из этого документа.",
  "Ответ — ТОЛЬКО валидный JSON без markdown-обёртки, вида:",
  '{"subject": "...", "preheader": "..."}',
  "",
  "Правила:",
  "- subject — тема письма: по-русски, если документ на русском; 1 предложение, без переводов строк, до 200 символов.",
  "- preheader — короткий текст-анонс (до 300 символов), который клиенты показывают рядом с темой; 1-2 предложения по-русски.",
  "- Тело письма ты не пишешь: оно собирается приложением из документа без тебя.",
  "- Никаких других полей, никакого markdown, только JSON-объект.",
].join("\n");

export interface EmailMetaMessagesInput {
  docName: string;
  /** Текст документа из контекст-пака (уже с лимитом/обрезкой). */
  document: string;
}

export function buildEmailMetaMessages(input: EmailMetaMessagesInput): ChatMessage[] {
  return [
    {role: "system", content: SYSTEM_PROMPT},
    {
      role: "user",
      content: [`Документ: ${input.docName}`, "", input.document].join("\n"),
    },
  ];
}

/** Сообщения для repair-retry: прежний ответ + список ошибок валидации. */
export function buildEmailRepairMessages(
  messages: readonly ChatMessage[],
  previousAnswer: string,
  errors: readonly string[],
): ChatMessage[] {
  return [
    ...messages,
    {role: "assistant", content: previousAnswer},
    {
      role: "user",
      content: [
        "Ответ не прошёл валидацию:",
        ...errors.map((error, index) => `${index + 1}. ${error}`),
        "",
        "Верни исправленный ответ — ТОЛЬКО валидный JSON по той же схеме.",
      ].join("\n"),
    },
  ];
}

/** Снять возможную ```json-обёртку и окружающий текст вокруг JSON-объекта. */
function extractJsonPayload(text: string): string {
  let value = text.trim();
  const fence = value.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fence) value = fence[1].trim();
  const firstObject = value.indexOf("{");
  if (firstObject > 0) value = value.slice(firstObject);
  const lastObject = value.lastIndexOf("}");
  if (lastObject !== -1 && lastObject < value.length - 1) value = value.slice(0, lastObject + 1);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Переводы строк в теме/preheader ломают RFC 5322 и разметку шаблона.
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Разбор и валидация ответа модели (строго): JSON (допускается ```-обёртка и
 * окружающий текст), объект ровно с полями subject (непустая строка) и
 * preheader (опциональная строка). Лишние поля, пустая тема, переводы строк
 * в теме, превышение лимитов — ошибки (уходят в repair-retry).
 */
export function parseEmailMeta(text: string): ParseEmailMetaResult {
  const payload = extractJsonPayload(text);
  if (payload === "") {
    return {ok: false, errors: ["Ответ модели пуст"]};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return {ok: false, errors: ["Ответ модели не является валидным JSON"]};
  }
  if (!isRecord(parsed)) {
    return {ok: false, errors: ["Ожидался JSON-объект {\"subject\": \"...\", \"preheader\": \"...\"}"]};
  }

  const errors: string[] = [];
  const allowedKeys = new Set(["subject", "preheader"]);
  const extra = Object.keys(parsed).filter((key) => !allowedKeys.has(key));
  if (extra.length > 0) {
    errors.push(`лишние поля: ${extra.map((key) => JSON.stringify(key)).join(", ")}`);
  }

  const subject = cleanString(parsed.subject);
  if (subject === null || subject === "") {
    errors.push("subject обязателен и должен быть непустой строкой");
  } else if (subject.length > MAX_SUBJECT_CHARS) {
    errors.push(`subject длиннее ${MAX_SUBJECT_CHARS} символов`);
  }

  let preheader = "";
  if (parsed.preheader !== undefined && parsed.preheader !== null) {
    const cleaned = cleanString(parsed.preheader);
    if (cleaned === null) {
      errors.push("preheader должен быть строкой");
    } else if (cleaned.length > MAX_PREHEADER_CHARS) {
      errors.push(`preheader длиннее ${MAX_PREHEADER_CHARS} символов`);
    } else {
      preheader = cleaned;
    }
  }

  if (errors.length > 0) return {ok: false, errors};
  return {ok: true, meta: {subject: subject as string, preheader}};
}
