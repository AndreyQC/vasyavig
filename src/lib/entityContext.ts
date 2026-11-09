/**
 * Markdown-блоки как контекст разрешения сущностей (Phase 8.5, T6-5; план
 * 20261105_012): однофамильцы различаются по «соседям» в блоке — абзаце,
 * строке таблицы, пункте списка, заголовке. Fallback — весь документ.
 * Эвристика по строкам, как в parseEntityLinks (fenced-код — не контекст).
 */

export interface ContextBlock {
  /** Смещение начала в raw markdown. */
  start: number;
  /** Смещение конца (без \n). */
  end: number;
  text: string;
}

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^#{1,6}\s/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Разбить markdown на блоки-контексты (fenced-код пропускается). */
export function markdownBlocks(markdown: string): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let paraStart = -1;
  let paraEnd = -1;
  let inCode = false;

  const flushPara = () => {
    if (paraStart >= 0) {
      blocks.push({start: paraStart, end: paraEnd, text: markdown.slice(paraStart, paraEnd)});
      paraStart = -1;
      paraEnd = -1;
    }
  };

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;

    if (FENCE_RE.test(line)) {
      if (inCode) {
        inCode = false;
        paraStart = -1;
      } else {
        flushPara();
        inCode = true;
      }
      continue;
    }
    if (inCode) continue;

    const trimmed = line.trim();
    if (trimmed === "") {
      flushPara();
      continue;
    }
    if (HEADING_RE.test(trimmed) || trimmed.startsWith("|") || LIST_ITEM_RE.test(line)) {
      flushPara();
      blocks.push({start: lineStart, end: lineEnd, text: line});
      continue;
    }
    if (paraStart < 0) paraStart = lineStart;
    paraEnd = lineEnd;
  }
  flushPara();
  return blocks;
}

/**
 * Блок, содержащий смещение (для контекста вхождения). Блок не найден
 * (вхождение в коде/между блоками) — весь документ (fallback плана).
 */
export function blockAt(markdown: string, offset: number): ContextBlock {
  for (const block of markdownBlocks(markdown)) {
    if (offset >= block.start && offset <= block.end) return block;
  }
  return {start: 0, end: markdown.length, text: markdown};
}

/**
 * Зачистка fenced-кода перед сущностным матчингом (D-8/D-10/D-19): символы
 * fenced-блоков (включая строки-маркеры ```/~~~) заменяются пробелами с
 * сохранением длины и переводов строк — смещения вхождений ВНЕ фенсов
 * остаются валидными, вхождения внутри фенсов физически не матчатся. Тот же
 * FENCE_RE toggle, что у `markdownBlocks`/`parseEntityLinks` (эвристика по
 * строкам; `~~~` и ``` считаются одинаково, вложенность не поддерживается).
 *
 * Назначение — контуры «матчинг как навигация/разметка» (скан конфликтов,
 * авто-якоря, репо-скан, NER-предложения/bulk). МАСКИРОВАНИЕ (privacy) этот
 * хелпер НЕ использует: секрет в код-блоке всё равно уходит в промпт.
 */
export function maskFencedCode(markdown: string): string {
  const lines = markdown.split("\n");
  let inCode = false;
  let changed = false;
  const out: string[] = [];
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inCode = !inCode;
      out.push(" ".repeat(line.length));
      changed = true;
      continue;
    }
    if (inCode) {
      out.push(" ".repeat(line.length));
      changed = true;
      continue;
    }
    out.push(line);
  }
  return changed ? out.join("\n") : markdown;
}
