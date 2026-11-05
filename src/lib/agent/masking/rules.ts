/**
 * Движок правил-детекторов (Phase 8.5, T6-9; план 20261105_009).
 *
 * Правила — **данные**, а не код: описание в YAML (`harness.yaml`,
 * `entities.rules`) плюс встроенный набор. Формат взят из
 * `guardrails-llm-filter` (docs/rules-engine), но без его Go-специфики:
 * инлайн `(?i)` → флаг `case_insensitive`.
 *
 * Ключевые отличия от guardrails, взятые как есть:
 * - **fail-open**: сбой правила не ломает разбор — правило пропускается;
 * - **union-span** при пересечении (не longest-wins): пересекающиеся спаны
 *   объединяются, чтобы не оставить «хвост» секрета открытым;
 * - **семантический span** через `capture_groups`;
 * - **keyword-префильтр** — только при явном `prefilter_safe: true`.
 */

import {parseDocument} from "yaml";
import {runValidators, shannonEntropy} from "./validators";

export interface DetectorRule {
  /** Уникальный идентификатор правила. */
  rule_id: string;
  /** Тип сущности: person, org, email, phone, secret, snils, … */
  type: string;
  /** RE2-паттерн (без инлайн-флагов — флаги вынесены в поля). */
  regex: string;
  /** 1-based номера групп, из которых берётся значение (пусто — всё совпадение). */
  capture_groups?: number[];
  /** Минимальная длина значения. */
  min_length?: number;
  /** Ключевые слова для префильтра (используются только при prefilter_safe). */
  keywords?: string[];
  /**
   * Префильтр по ключевым словам безопасен для recall — включается явно.
   * В guardrails это доказывается анализом дерева regexp; в JS аналога нет,
   * поэтому решение за пользователем правила.
   */
  prefilter_safe?: boolean;
  /** Значения, которые не маскировать (сравнение в нижнем регистре). */
  banlist?: string[];
  /** Порог энтропии Шеннона. */
  entropy?: number;
  /** Валидаторы: luhn, snils, inn_person, inn_org, ogrn, ogrnip, iban, email_ascii. */
  validators?: string[];
  /** Регистронезависимое совпадение (в guardrails — инлайн `(?i)`). */
  case_insensitive?: boolean;
}

export interface CompiledRule extends Omit<DetectorRule, "regex"> {
  /** Скомпилированная регулярка (fail-open: при ошибке правило пропускается). */
  regex: RegExp;
  /** Группа, из которой берётся значение (1-based; 0 — всё совпадение). */
  valueGroup: number;
}

/** Совпадение с позициями групп (флаг `d`). */
type MatchWithIndices = RegExpExecArray & {indices?: Array<[number, number] | undefined>};

export interface RuleSpan {
  start: number;
  end: number;
  type: string;
  rule_id: string;
  value: string;
}

/** Скомпилировать правило; при ошибке регулярки — null (правило пропускается). */
export function compileRule(rule: DetectorRule): CompiledRule | null {
  // флаг `d` — точные позиции capture-групп (match.indices).
  const flags = rule.case_insensitive ? "guid" : "gud";
  let regex: RegExp;
  try {
    regex = new RegExp(rule.regex, flags);
  } catch {
    return null;
  }
  const group = rule.capture_groups?.[0];
  return {...rule, regex, valueGroup: group && group > 0 ? group : 0};
}

/** Скомпилировать набор правил; битые правила пропускаются (fail-open). */
export function compileRules(rules: readonly DetectorRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    const result = compileRule(rule);
    if (result) compiled.push(result);
  }
  return compiled;
}

/** Префильтр: правило пропускается, если в тексте нет его ключевых слов. */
export function passesPrefilter(text: string, rule: CompiledRule): boolean {
  if (rule.prefilter_safe !== true) return true;
  if (!rule.keywords || rule.keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return rule.keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

/** Значение по capture-группе (или всё совпадение). */
function extractValue(
  text: string,
  rule: CompiledRule,
  match: MatchWithIndices,
): {start: number; end: number; value: string} | null {
  if (rule.valueGroup > 0) {
    const captured = match[rule.valueGroup];
    if (captured == null) return null;
    // Точные позиции группы: `d`-флаг даёт match.indices.
    const indices = match.indices?.[rule.valueGroup];
    if (indices) {
      const [start, end] = indices;
      return {start, end, value: text.slice(start, end)};
    }
    // Запасной путь (движок без `d`): ищем capture-текст в совпадении.
    const offset = match[0].indexOf(captured);
    if (offset < 0) return null;
    const start = match.index + offset;
    return {start, end: start + captured.length, value: captured};
  }
  const start = match.index;
  const end = match.index + match[0].length;
  return {start, end, value: text.slice(start, end)};
}

/** Проверки правила: длина, banlist, энтропия, валидаторы. */
export function passesChecks(rule: CompiledRule, value: string): boolean {
  if (rule.min_length != null && value.length < rule.min_length) return false;
  if (rule.banlist && rule.banlist.length > 0) {
    const lower = value.toLowerCase();
    if (rule.banlist.some((item) => item.toLowerCase() === lower)) return false;
  }
  if (rule.entropy != null && shannonEntropy(value) < rule.entropy) return false;
  if (rule.validators && rule.validators.length > 0) {
    if (!runValidators(value, rule.validators)) return false;
  }
  return true;
}

/**
 * Применить правила к тексту. Ошибка правила не прерывает разбор (fail-open):
 * правило пропускается, остальные работают.
 */
export function runRules(text: string, rules: readonly CompiledRule[]): RuleSpan[] {
  const spans: RuleSpan[] = [];
  for (const rule of rules) {
    if (!passesPrefilter(text, rule)) continue;
    let matches: RegExpExecArray[];
    try {
      matches = [...text.matchAll(rule.regex)];
    } catch {
      continue; // fail-open: правило не применилось
    }
    for (const match of matches) {
      const extracted = extractValue(text, rule, match);
      if (!extracted) continue;
      if (!passesChecks(rule, extracted.value)) continue;
      spans.push({
        start: extracted.start,
        end: extracted.end,
        type: rule.type,
        rule_id: rule.rule_id,
        value: extracted.value,
      });
    }
  }
  return spans;
}

/**
 * Разрешение пересечений — union-span (guardrails `resolveConflicts`):
 * пересекающиеся спаны объединяются в `[minStart, maxEnd)`, тип и правило
 * берутся у самого длинного составляющего. Так непересекающиеся «хвосты»
 * не остаются открытым текстом.
 */
export function resolveOverlaps(spans: readonly RuleSpan[]): RuleSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || (a.rule_id < b.rule_id ? -1 : 1),
  );
  const out: RuleSpan[] = [];
  let current: RuleSpan | null = null;
  for (const span of sorted) {
    if (current == null) {
      current = {...span};
      continue;
    }
    if (span.start < current.end) {
      // пересечение — объединяем, атрибуция у длиннейшего
      const longest: RuleSpan =
        span.end - span.start > current.end - current.start ? span : current;
      current = {
        start: Math.min(current.start, span.start),
        end: Math.max(current.end, span.end),
        type: longest.type,
        rule_id: longest.rule_id,
        value: longest.value,
      };
      continue;
    }
    out.push(current);
    current = {...span};
  }
  if (current) out.push(current);
  return out;
}

/** Сколько байт текста занимает значение — для отчётов. */
export function spanLength(span: RuleSpan): number {
  return span.end - span.start;
}

/** Пользовательские правила (harness.yaml `entities.rules`). */
let customRules: DetectorRule[] = [];
let compiledAll: CompiledRule[] | null = null;

/** Подключить пользовательские правила (harness.yaml `entities.rules`). */
export function setCustomDetectorRules(rules: readonly DetectorRule[]): void {
  customRules = [...rules];
  compiledAll = null;
}

/** Скомпилированный набор: пользовательские + встроенные. */
export function activeDetectorRules(): CompiledRule[] {
  compiledAll ??= compileRules(customRules);
  return compiledAll;
}

/**
 * Разбор пользовательских правил из `harness.yaml`: секция `entities.rules`.
 * Битые записи пропускаются (fail-open).
 */
export function parseDetectorRules(text: string): DetectorRule[] {
  let raw: unknown;
  try {
    raw = parseDocument(text, {uniqueKeys: true}).toJS();
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null) return [];
  const entities = (raw as {entities?: unknown}).entities;
  if (typeof entities !== "object" || entities === null) return [];
  const list = (entities as {rules?: unknown}).rules;
  if (!Array.isArray(list)) return [];

  const rules: DetectorRule[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.rule_id !== "string" || rec.rule_id === "") continue;
    if (typeof rec.regex !== "string" || rec.regex === "") continue;
    if (typeof rec.type !== "string" || rec.type === "") continue;
    const rule: DetectorRule = {
      rule_id: rec.rule_id,
      type: rec.type,
      regex: rec.regex,
      case_insensitive: rec.case_insensitive === true,
    };
    if (Array.isArray(rec.capture_groups)) {
      rule.capture_groups = rec.capture_groups.filter(
        (group): group is number => typeof group === "number",
      );
    }
    if (typeof rec.min_length === "number") rule.min_length = rec.min_length;
    if (Array.isArray(rec.keywords)) {
      rule.keywords = rec.keywords.filter((word): word is string => typeof word === "string");
    }
    if (rec.prefilter_safe === true) rule.prefilter_safe = true;
    if (Array.isArray(rec.banlist)) {
      rule.banlist = rec.banlist.filter((item): item is string => typeof item === "string");
    }
    if (typeof rec.entropy === "number") rule.entropy = rec.entropy;
    if (Array.isArray(rec.validators)) {
      rule.validators = rec.validators.filter(
        (name): name is string => typeof name === "string",
      );
    }
    rules.push(rule);
  }
  return rules;
}
