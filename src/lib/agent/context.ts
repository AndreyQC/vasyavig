import type {AssistantContextSettings} from "./config";

/**
 * Контекст-пак ассистента (Phase 8.2, D15): активный документ + выделение,
 * лимит `app.assistant.context.max_chars`, обрезка по границам строк/заголовков.
 *
 * Содержимое документа модели пока не отправляется — module строит пак для
 * панели (объём контекста) и будущих рецептов 8.3. Никаких путей наружу.
 */

export interface ContextSelectionInput {
  text: string;
  from: number;
  to: number;
}

export interface ContextDocument {
  docId: string;
  name: string;
  content: string;
  originalChars: number;
  truncated: boolean;
}

export interface ContextSelection {
  text: string;
  originalChars: number;
  truncated: boolean;
  from: number;
  to: number;
}

export interface ContextPack {
  document: ContextDocument | null;
  selection: ContextSelection | null;
  /** Символы, которые реально уйдут в модель (документ + выделение). */
  totalChars: number;
  maxChars: number;
}

export interface ContextPackInput {
  docId: string;
  name: string;
  content: string;
  selection?: ContextSelectionInput | null;
  settings: AssistantContextSettings;
}

/** Резерв под служебную пометку об обрезке. */
const TRUNCATION_RESERVE = 120;

/**
 * Обрезка до maxChars по целым строкам (границы заголовков/абзацев), с
 * пометкой о потерянных символах. Если не влезает даже первая строка —
 * жёсткий срез.
 */
export function truncateByHeadings(
  text: string,
  maxChars: number,
): {text: string; truncated: boolean} {
  if (maxChars <= 0) return {text: "", truncated: text.length > 0};
  if (text.length <= maxChars) return {text, truncated: false};

  const budget = Math.max(0, maxChars - TRUNCATION_RESERVE);
  let out = "";
  for (const line of text.split("\n")) {
    const next = out === "" ? line : `${out}\n${line}`;
    if (next.length > budget) break;
    out = next;
  }
  if (out === "") out = text.slice(0, budget);

  const omitted = text.length - out.length;
  return {
    text: `${out}\n\n[context truncated: ${omitted} chars omitted]`,
    truncated: true,
  };
}

/** Собрать контекст-пак по настройкам `app.assistant.context`. */
export function buildContextPack(input: ContextPackInput): ContextPack {
  const {settings} = input;
  let document: ContextDocument | null = null;
  let used = 0;

  if (settings.includeDocument) {
    const result = truncateByHeadings(input.content, settings.maxChars);
    document = {
      docId: input.docId,
      name: input.name,
      content: result.text,
      originalChars: input.content.length,
      truncated: result.truncated,
    };
    used += result.text.length;
  }

  let selection: ContextSelection | null = null;
  const selectionText = input.selection?.text ?? "";
  if (settings.includeSelection && selectionText !== "") {
    const remaining = Math.max(0, settings.maxChars - used);
    const result = truncateByHeadings(selectionText, remaining);
    selection = {
      text: result.text,
      originalChars: selectionText.length,
      truncated: result.truncated,
      from: input.selection?.from ?? 0,
      to: input.selection?.to ?? 0,
    };
    used += result.text.length;
  }

  return {
    document,
    selection,
    totalChars: used,
    maxChars: settings.maxChars,
  };
}
