import type {Finding} from "../findings";
import {MODEL_FIXABLE_RULES, validateModelReplacement, type ModelFixTarget} from "../fixes";
import type {ChatMessage} from "../provider";

/**
 * Рецепт «Проверка документа» (Phase 8.3, §6.1): findings -> контекст-пак ->
 * модель -> строгий JSON-вердикт. Здесь чистые функции: построение сообщений,
 * разбор и валидация вердиктов, repair-retry. Оркестрация и доступ к сторам —
 * в agentStore; запись — только через propose_* путь.
 *
 * Схема ответа модели:
 * `{"verdicts": [{"findingId", "action": "keep|fix|explain", "replacement?", "rationale?"}]}`
 * — replacement относится к точному фрагменту-target из findings, oldText
 * модель не выбирает.
 */

export type VerdictAction = "keep" | "fix" | "explain";

export interface ModelVerdict {
  findingId: string;
  action: VerdictAction;
  replacement?: string;
  rationale?: string;
}

export type ParseVerdictsResult =
  | {ok: true; verdicts: ModelVerdict[]}
  | {ok: false; errors: string[]};

function isVerdictAction(value: unknown): value is VerdictAction {
  return typeof value === "string" && (VERDICT_ACTIONS as readonly string[]).includes(value);
}

const MAX_VERDICTS = 100;
const MAX_REPLACEMENT_CHARS = 20000;
const MAX_RATIONALE_CHARS = 2000;

export const VERDICT_ACTIONS: readonly VerdictAction[] = ["keep", "fix", "explain"];

/** Элемент findings в промпте: без путей, с target для fixable. */
export interface FindingPromptItem {
  id: string;
  rule: string;
  severity: string;
  line?: number;
  snippet?: string;
  /** true — модель может вернуть action "fix". */
  fixable: boolean;
  /** Детерминированная правка уже предложена приложением. */
  proposed: boolean;
  /** Точный фрагмент для замены (только fixable и не proposed). */
  target?: string;
  /** Что означает replacement для этого правила. */
  replacementFormat?: string;
}

const REPLACEMENT_FORMATS: Record<string, string> = {
  anchors: "новый якорь фрагментом без '#', пробелов и скобок",
  images: "новый относительный путь картинки внутри workspace",
};

/**
 * Элементы промпта по findings. `proposedIds` — finding'и, для которых уже
 * есть детерминированная правка; для них модель только объясняет.
 */
export function buildFindingItems(
  findings: readonly Finding[],
  targets: ReadonlyMap<string, ModelFixTarget>,
  proposedIds: ReadonlySet<string>,
): FindingPromptItem[] {
  return findings.map((finding) => {
    const fixable = MODEL_FIXABLE_RULES.includes(finding.rule) && targets.has(finding.id);
    return {
      id: finding.id,
      rule: finding.rule,
      severity: finding.severity,
      ...(finding.line !== undefined ? {line: finding.line} : {}),
      ...(finding.snippet !== undefined ? {snippet: finding.snippet} : {}),
      fixable,
      proposed: proposedIds.has(finding.id),
      ...(fixable && !proposedIds.has(finding.id)
        ? {target: targets.get(finding.id)?.oldText, replacementFormat: REPLACEMENT_FORMATS[finding.rule]}
        : {}),
    };
  });
}

const SYSTEM_PROMPT = [
  "Ты — ассистент по документации в редакторе Vasyavig (markdown/YFM).",
  "Тебе дан текст документа (возможно, усечённый), выделение и список findings детерминированной проверки.",
  "Для каждого finding верни один вердикт. Ответ — ТОЛЬКО валидный JSON без markdown-обёртки, вида:",
  '{"verdicts": [{"findingId": "...", "action": "keep|fix|explain", "replacement": "...", "rationale": "..."}]}',
  "",
  "Правила:",
  '- findingId — только id из списка findings; выдумывать id нельзя.',
  '- action "fix" — только для findings с "fixable": true. replacement — полный новый текст для поля target: target заменяется на replacement целиком.',
  '- Для findings с "proposed": true правка уже предложена приложением — верни "explain" с кратким пояснением, если нужно.',
  '- action "explain" — объясни по-русски, что означает finding и стоит ли править вручную.',
  '- action "keep" — finding верен, но правка не нужна.',
  '- rationale — 1-2 предложения по-русски, обязателен для explain, желателен для fix и keep.',
  '- Замены применяет приложение через diff-подтверждение; других действий у тебя нет.',
].join("\n");

export interface CheckMessagesInput {
  docName: string;
  /** Текст документа из контекст-пака (уже с лимитом/обрезкой). */
  document: string;
  /** Выделение или пустая строка. */
  selection?: string;
  items: readonly FindingPromptItem[];
  /** Правила и словарь плейсхолдеров маскирования (T1c); пусто — без маскирования. */
  maskingNote?: string;
}

export function buildCheckMessages(input: CheckMessagesInput): ChatMessage[] {
  const parts: string[] = [`Документ: ${input.docName}`, "", input.document];
  if (input.selection && input.selection.trim() !== "") {
    parts.push("", "Выделение в документе:", input.selection);
  }
  if (input.maskingNote) {
    parts.push("", input.maskingNote);
  }
  parts.push(
    "",
    "Findings детерминированной проверки:",
    JSON.stringify(input.items, null, 2),
    "",
    "Верни вердикты по схеме из системного сообщения.",
  );
  return [
    {role: "system", content: SYSTEM_PROMPT},
    {role: "user", content: parts.join("\n")},
  ];
}

/** Сообщения для repair-retry: прежний ответ + список ошибок валидации. */
export function buildRepairMessages(
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
  const firstArray = value.indexOf("[");
  const start =
    firstObject === -1 ? firstArray : firstArray === -1 ? firstObject : Math.min(firstObject, firstArray);
  if (start > 0) value = value.slice(start);
  const lastObject = value.lastIndexOf("}");
  const lastArray = value.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  if (end !== -1 && end < value.length - 1) value = value.slice(0, end + 1);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Разбор и валидация ответа модели (строго):
 * JSON (допускается ```-обёртка и окружающий текст), `{"verdicts": [...]}`
 * или голый массив; все findingId известны; action из enum; fix требует
 * replacement и правило с fixable; дубликаты и лишние поля replacement у
 * keep/explain — ошибка валидации (уходит в repair-retry).
 */
export function parseVerdicts(
  text: string,
  findings: ReadonlyMap<string, Finding>,
): ParseVerdictsResult {
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

  const rawList = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.verdicts)
      ? parsed.verdicts
      : null;
  if (!rawList) {
    return {ok: false, errors: ['Ожидался объект {"verdicts": [...]} или массив вердиктов']};
  }
  if (rawList.length > MAX_VERDICTS) {
    return {ok: false, errors: [`Слишком много вердиктов: ${rawList.length} > ${MAX_VERDICTS}`]};
  }

  const errors: string[] = [];
  const verdicts: ModelVerdict[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawList.length; i++) {
    const label = `verdicts[${i}]`;
    const raw = rawList[i];
    if (!isRecord(raw)) {
      errors.push(`${label}: ожидается объект`);
      continue;
    }
    const findingId = raw.findingId;
    if (typeof findingId !== "string" || !findings.has(findingId)) {
      errors.push(`${label}: неизвестный findingId ${JSON.stringify(findingId)}`);
      continue;
    }
    const finding = findings.get(findingId) as Finding;
    if (seen.has(findingId)) {
      errors.push(`${label}: повторный вердикт для ${findingId}`);
      continue;
    }
    const action = raw.action;
    if (!isVerdictAction(action)) {
      errors.push(`${label} (${findingId}): action должен быть keep|fix|explain`);
      continue;
    }
    const rationale = raw.rationale;
    if (rationale !== undefined && rationale !== null && typeof rationale !== "string") {
      errors.push(`${label} (${findingId}): rationale должен быть строкой`);
      continue;
    }
    const trimmedRationale =
      typeof rationale === "string" ? rationale.trim().slice(0, MAX_RATIONALE_CHARS) : undefined;
    const replacementRaw = raw.replacement;

    if (action === "fix") {
      if (!MODEL_FIXABLE_RULES.includes(finding.rule)) {
        errors.push(`${label} (${findingId}): fix не поддерживается для правила ${finding.rule}`);
        continue;
      }
      if (typeof replacementRaw !== "string" || replacementRaw.trim() === "") {
        errors.push(`${label} (${findingId}): action fix требует непустой replacement`);
        continue;
      }
      if (replacementRaw.length > MAX_REPLACEMENT_CHARS) {
        errors.push(`${label} (${findingId}): replacement больше ${MAX_REPLACEMENT_CHARS} символов`);
        continue;
      }
      const schemaError = validateModelReplacement(finding, replacementRaw);
      if (schemaError) {
        errors.push(`${label} (${findingId}): ${schemaError}`);
        continue;
      }
      seen.add(findingId);
      verdicts.push({
        findingId,
        action,
        replacement: replacementRaw,
        ...(trimmedRationale ? {rationale: trimmedRationale} : {}),
      });
      continue;
    }

    if (replacementRaw !== undefined && replacementRaw !== null) {
      errors.push(
        `${label} (${findingId}): replacement допустим только для action fix`,
      );
      continue;
    }
    seen.add(findingId);
    verdicts.push({
      findingId,
      action,
      ...(trimmedRationale ? {rationale: trimmedRationale} : {}),
    });
  }

  if (errors.length > 0) return {ok: false, errors};
  return {ok: true, verdicts};
}
