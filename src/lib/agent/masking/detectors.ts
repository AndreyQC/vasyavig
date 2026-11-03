/**
 * Детерминированные детекторы чувствительных значений (Phase 8.5, T1; план
 * 20261104_001, R5–R8). Чистые функции: текст → спаны. Идентификаторы —
 * значения `app.assistant.masking.detectors` конфига.
 *
 * R7: в regex только lookaround `(?<![…])…(?![…])` — `\b`/`\w` не работают по
 * кириллице (проверено: `/(\bИван)/.test("Иван Иванов") === false`).
 * R5: в `KEY=value` маскируется только значение, имя ключа остаётся видимым.
 */

import {detectNer} from "./ner";
import type {DetectorId, DetectorSpan, EntityType} from "./types";

interface Rule {
  detector: DetectorId;
  type: EntityType;
  /** Глобальный regex; спан = всё совпадение либо группа valueGroup (R5). */
  re: RegExp;
  valueGroup?: number;
}

/**
 * Порядок важен для пересечений (R8, longest-wins при равном начале решает
 * стабильность sort): url_credentials раньше KEY=value, чтобы `token:
 * https://u:p@host` детектировался как URL_CRED.
 */
const RULES: readonly Rule[] = [
  {
    detector: "url_credentials",
    type: "URL_CRED",
    re: /[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/[^\s:@/"'<>]{1,64}:[^\s@/"'<>]{1,128}@[^\s<>"']{1,256}/g,
  },
  {
    detector: "email",
    type: "EMAIL",
    re:
      /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+(?![A-Za-z0-9.@-])/g,
  },
  {
    detector: "phone",
    type: "PHONE",
    re: /(?<![\dА-Яа-яЁёA-Za-z])(?:\+7|8)[ \t(-]*\d{3}[ \t)-]*\d{3}[ \t-]*\d{2}[ \t-]*\d{2}(?!\d)/g,
  },
  {
    detector: "phone",
    type: "PHONE",
    re: /(?<![\dA-Za-z])\+\d{1,3}[ \t(-]*\d{2,4}[ \t)-]*\d{2,4}[ \t-]*\d{2,4}(?:[ \t-]*\d{2})?(?!\d)/g,
  },
  {
    detector: "secrets",
    type: "SECRET",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    detector: "secrets",
    type: "SECRET",
    re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}(?![A-Za-z0-9_-])/g,
  },
  {
    detector: "secrets",
    type: "SECRET",
    re: /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])/g,
  },
  {
    detector: "secrets",
    type: "SECRET",
    re: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/g,
  },
  {
    detector: "secrets",
    type: "SECRET",
    re: /(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])/g,
  },
  {
    detector: "secrets",
    type: "SECRET",
    re: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
  },
  {
    detector: "secrets",
    type: "SECRET",
    re: /(?<![A-Za-z0-9_])(?:Bearer)[ \t]+[A-Za-z0-9._~+/=-]{16,}(?![A-Za-z0-9_.~+/=-])/gi,
  },
  {
    // R5/R6: valueGroup=2 — маскируется только значение; ключ виден, включая
    // словесное описание («пароль от стенда: …» — до 3 слов между ключом и :).
    detector: "secrets",
    type: "SECRET",
    re:
      /((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?key|[_-]?token)?|token|password|passwd|pwd|private[_-]?key|пароль|токен|секрет|ключ)(?:s)?(?:[ \t]+[А-Яа-яЁёA-Za-z0-9_«"-]+){0,3}[ \t]*(?:=|:)[ \t]*)([^\s"'»«]+|"[^"]{4,}"|'[^']{4,}')/gi,
    valueGroup: 2,
  },
];

/**
 * Найти все спаны включённых детекторов. Пересечения разрешаются longest-wins
 * детерминированно (R8); при равных границах побеждает правило, идущее в RULES
 * раньше (стабильный sort).
 */
export function detectText(text: string, detectors: readonly DetectorId[]): DetectorSpan[] {
  if (detectors.length === 0) return [];
  const enabled = new Set(detectors);
  const spans: DetectorSpan[] = [];
  for (const rule of RULES) {
    if (!enabled.has(rule.detector)) continue;
    for (const match of text.matchAll(rule.re)) {
      if (rule.valueGroup != null) {
        const head = match[rule.valueGroup - 1] ?? "";
        let value = match[rule.valueGroup];
        if (value == null || value === "") continue;
        // Конечная пунктуация предложения — не часть значения (для quoted-значений
        // кавычка не в классе обрезки и сохраняется).
        const trimmed = value.replace(/[.,;:!?)\]»]+$/, "");
        if (trimmed === "") continue;
        const start = match.index + head.length;
        const end = start + trimmed.length;
        spans.push({start, end, value: trimmed, type: rule.type, detector: rule.detector});
      } else {
        const value = match[0];
        spans.push({start: match.index, end: match.index + value.length, value, type: rule.type, detector: rule.detector});
      }
    }
  }
  // NER (T2, D3): правила+словари в общем реестре; пересечения — в mergeSpans.
  if (enabled.has("ner")) spans.push(...detectNer(text));
  return mergeSpans(spans);
}

/** Слияние пересекающихся спанов: сортировка по началу, затем по длине по убыванию. */
export function mergeSpans(spans: DetectorSpan[]): DetectorSpan[] {
  const sorted = [...spans].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const out: DetectorSpan[] = [];
  let lastEnd = -1;
  for (const span of sorted) {
    if (span.start >= lastEnd) {
      out.push(span);
      lastEnd = span.end;
    }
  }
  return out;
}
