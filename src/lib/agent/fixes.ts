import {buildTocPlan, harnessHeaderEndLine} from "../generateToc";
import type {Finding, FindingRule} from "./findings";

/**
 * Детерминированные фиксы findings (Phase 8.3, §6.1 п. 4).
 *
 * Для части правил правка вычисляется локально, без модели: TOC, %-декодирование
 * ссылок, `\_`, смена legacy-схемы ULID-ссылки. Фикс — это вход для
 * `propose_replace`/`propose_insert`; строит proposal существующий propose-путь.
 * Неоднозначно (oldText/якорь неуникальны) — фикса нет, finding остаётся.
 *
 * Для неоднозначных правил (`anchors`, `images`) здесь вычисляется точный
 * фрагмент-target: модель возвращает только replacement для него, oldText ищет
 * не модель, а рецепт. Так `replacement` проверяется схемой, а proposal
 * строится через `propose_replace` с точным oldText.
 *
 * Регексы ниже повторяют регексы findings.ts — правило и его фикс должны
 * видеть одну и ту же строку.
 */

export type DeterministicFix =
  | {kind: "replace"; oldText: string; newText: string}
  | {kind: "insert"; anchor: string; position: "before" | "after"; text: string};

/** Правила, для которых модель может предложить replacement (fix). */
export const MODEL_FIXABLE_RULES: readonly FindingRule[] = ["anchors", "images"];

const LINK_TARGET_RE = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const ANCHOR_LINK_RE = /\]\(#([^)\s]+)\)/g;
const IMAGE_RE = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const EXTERNAL_TARGET_RE = /^(?:[a-z][a-z0-9+.-]*:|[/\\]|[a-z]:)/i;
const LEGACY_ULID_TARGET_RE = /^(harness_ulid|ulid):(.*)$/i;

function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Заменить первое вхождение `needle` в `source` на `next` (needle входит в source). */
function spliceFirst(source: string, needle: string, next: string): string {
  const index = source.indexOf(needle);
  if (index < 0) return source;
  return source.slice(0, index) + next + source.slice(index + needle.length);
}

/** Первый target на строке, подпадающий под предикат (регексы findings). */
function findLinkTarget(
  line: string,
  predicate: (target: string) => boolean,
): {match: string; target: string} | null {
  LINK_TARGET_RE.lastIndex = 0;
  for (let match = LINK_TARGET_RE.exec(line); match; match = LINK_TARGET_RE.exec(line)) {
    const target = match[1];
    // зеркало findings.ts: внешние/абсолютные цели — не workspace-пути
    if (EXTERNAL_TARGET_RE.test(target)) continue;
    if (predicate(target)) return {match: match[0], target};
  }
  return null;
}

/** TOC устарел: старый блок списка -> новый список из buildTocPlan. */
function tocStaleFix(content: string): DeterministicFix | null {
  const plan = buildTocPlan(content);
  if (plan.tocHeadingLine === null || !plan.listRange || !plan.list) return null;
  const lines = content.split("\n");
  const oldText = lines.slice(plan.listRange.from, plan.listRange.to).join("\n");
  if (oldText.trim() === plan.list.trim()) return null; // уже актуален
  return {kind: "replace", oldText, newText: plan.list};
}

/** TOC отсутствует: блок «## Оглавление» после harness-шапки (как applyTocInsert). */
function tocMissingFix(content: string): DeterministicFix | null {
  const plan = buildTocPlan(content);
  if (plan.tocHeadingLine !== null || !plan.list) return null;
  const lines = content.split("\n");
  const at = harnessHeaderEndLine(content);
  const block = ["## Оглавление", "", ...plan.list.split("\n")].join("\n");
  // якорь — первая непустая строка после шапки; пустая строка была бы
  // невалидным якорем и часто неуникальна
  for (let i = at; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    // хвостовые "\n\n" — пустая строка-разделитель перед якорем (как в applyTocInsert)
    return {kind: "insert", anchor: lines[i], position: "before", text: `${block}\n\n`};
  }
  return {kind: "insert", anchor: "end", position: "after", text: `\n${block}\n\n`};
}

function linkFix(
  finding: Finding,
  content: string,
  predicate: (target: string) => boolean,
  buildTarget: (target: string) => string,
): DeterministicFix | null {
  if (finding.line === undefined) return null;
  const line = content.split(/\r?\n/)[finding.line - 1];
  if (line === undefined) return null;
  const found = findLinkTarget(line, predicate);
  if (!found) return null;
  return {
    kind: "replace",
    oldText: found.match,
    newText: spliceFirst(found.match, found.target, buildTarget(found.target)),
  };
}

/**
 * Фикс по правилу finding'а. `null` — правило не детерминированное или
 * правка неоднозначна (неуникальный oldText отсечёт propose_replace).
 */
export function deterministicFixFor(finding: Finding, content: string): DeterministicFix | null {
  switch (finding.rule) {
    case "toc":
      return finding.messageKey === "assistant.finding.tocStale"
        ? tocStaleFix(content)
        : tocMissingFix(content);
    case "links": {
      if (finding.messageKey === "assistant.finding.percentCyrillic") {
        return linkFix(
          finding,
          content,
          (target) => {
            const decoded = decodeMaybe(target);
            return /%[0-9A-Fa-f]{2}/.test(target) && /[\u0400-\u04FF]/.test(decoded);
          },
          (target) => {
            try {
              return decodeURIComponent(target);
            } catch {
              return target;
            }
          },
        );
      }
      if (finding.messageKey === "assistant.finding.escapedUnderscore") {
        return linkFix(finding, content, (target) => target.includes("\\_"), (target) =>
          target.replace(/\\_/g, "_"),
        );
      }
      if (finding.messageKey === "assistant.finding.legacyUlid") {
        return linkFix(finding, content, (target) => LEGACY_ULID_TARGET_RE.test(target), (target) =>
          target.replace(LEGACY_ULID_TARGET_RE, (_all, _scheme: string, rest: string) => `harness-ulid:${rest}`),
        );
      }
      return null;
    }
    default:
      return null;
  }
}

/** Фрагмент, который модель заменяет целиком (для fix-вердиктов). */
export interface ModelFixTarget {
  oldText: string;
  newTextFor: (replacement: string) => string;
}

/**
 * Target для fix-вердикта модели: точный oldText на строке finding'а.
 * `null` — строка не найдена или фрагмент из params не совпал с документом.
 */
export function fixTargetFor(finding: Finding, content: string): ModelFixTarget | null {
  if (!MODEL_FIXABLE_RULES.includes(finding.rule) || finding.line === undefined) return null;
  const lines = content.split(/\r?\n/);
  const line = lines[finding.line - 1];
  if (line === undefined) return null;

  if (finding.rule === "anchors") {
    const fragment = finding.params?.fragment;
    if (typeof fragment !== "string") return null;
    ANCHOR_LINK_RE.lastIndex = 0;
    for (let match = ANCHOR_LINK_RE.exec(line); match; match = ANCHOR_LINK_RE.exec(line)) {
      if (decodeMaybe(match[1]) !== fragment) continue;
      const oldText = match[0];
      return {oldText, newTextFor: (replacement) => `](#${replacement.trim()})`};
    }
    return null;
  }

  const wanted = finding.params?.target;
  if (typeof wanted !== "string") return null;
  IMAGE_RE.lastIndex = 0;
  for (let match = IMAGE_RE.exec(line); match; match = IMAGE_RE.exec(line)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (target.split(/[?#]/)[0] !== wanted) continue;
    const oldText = match[0];
    const rawTarget = match[1];
    return {
      oldText,
      newTextFor: (replacement) => spliceFirst(oldText, rawTarget, replacement.trim()),
    };
  }
  return null;
}

/**
 * Схема replacement для fix-вердикта: якорь — без `#`, пробелов и скобок;
 * путь картинки — относительный путь внутри workspace.
 * `null` — валиден; строка — понятная ошибка (уходит в repair-retry).
 */
export function validateModelReplacement(finding: Finding, replacement: string): string | null {
  const value = replacement.trim();
  if (value === "" || value.length > 500) {
    return `replacement: ожидается непустая строка до 500 символов, правило ${finding.rule}`;
  }
  if (finding.rule === "anchors") {
    if (/[\s()#]/.test(value)) {
      return "replacement: якорь не должен содержать пробелы, скобки или '#'";
    }
    return null;
  }
  // images
  if (/[\s()]/.test(value)) {
    return "replacement: путь картинки не должен содержать пробелы или скобки";
  }
  if (EXTERNAL_TARGET_RE.test(value)) {
    return "replacement: путь картинки должен быть относительным (без схемы, '/' и 'C:\\')";
  }
  if (/(^|\/)\.\.(\/|$)/.test(value)) {
    return "replacement: '..' в пути картинки запрещён";
  }
  return null;
}
