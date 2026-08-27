import MarkdownIt from "markdown-it";
import GithubSlugger from "github-slugger";
import type Token from "markdown-it/lib/token";

export interface TocHeading {
  level: number;
  title: string;
  href: string;
}

export interface TocPlan {
  /** Готовый markdown-список оглавления (без заголовка «Оглавление»). */
  list: string;
  /** Заголовки H1–H4, из которых собран список. */
  headings: TocHeading[];
  /** Индекс строки заголовка существующего блока «Оглавление» (H1–H2) или null. */
  tocHeadingLine: number | null;
  /** Диапазон строк существующего списка под заголовком (to — исключительно) или null. */
  listRange: {from: number; to: number} | null;
}

const md = new MarkdownIt({html: true});

// Кастомные id заголовков — те же правила, что у @diplodoc/transform (anchors)
const CUSTOM_ID_RE = /\[?{ ?#(\S+) ?}]?/g;
const CUSTOM_ID_EXCEPTION = "[{#T}]";
const TOC_TITLES = new Set(["оглавление", "toc", "contents", "содержание"]);
const TOC_MIN_LEVEL = 1;
const TOC_MAX_LEVEL = 4;

function getCustomIds(content: string): string[] | null {
  const ids: string[] = [];
  content.replace(CUSTOM_ID_RE, (match, id: string) => {
    if (match !== CUSTOM_ID_EXCEPTION) ids.push(id);
    return "";
  });
  return ids.length ? ids : null;
}

function removeCustomId(content: string): string {
  return content
    .replace(CUSTOM_ID_RE, (match) => (match === CUSTOM_ID_EXCEPTION ? match : ""))
    .trim();
}

/** Текст заголовка без разметки — как headingInfo у @diplodoc/transform. */
function headingTitle(inline: Token): string {
  let title = "";
  for (const token of inline.children ?? []) {
    if (token.type === "text" || token.type === "text_special") title += token.content;
  }
  return title || inline.content;
}

/**
 * Заголовки документа. Слаги совместимы с превью: тот же github-slugger и тот же
 * порядок питания (все заголовки без custom-id по порядку), что у transform с
 * supportGithubAnchors: true. Сам заголовок «Оглавление» в список не входит,
 * но слаггером питается (паритет счётчиков дублей с transform).
 */
export function collectHeadings(src: string): TocHeading[] {
  const tokens = md.parse(src, {});
  const slugger = new GithubSlugger();
  const headings: TocHeading[] = [];
  let tocHeadingSeen = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    const level = Number.parseInt(token.tag.slice(1), 10);
    const inline = tokens[i + 1];
    if (!inline) continue;

    const rawTitle = headingTitle(inline);
    const customIds = getCustomIds(inline.content);
    const title = removeCustomId(rawTitle);
    const isTocHeading =
      !tocHeadingSeen && level <= 2 && TOC_TITLES.has(title.trim().toLowerCase());
    if (isTocHeading) tocHeadingSeen = true;

    let href: string;
    if (customIds) {
      href = `#${customIds[0]}`; // слаггер не питается custom-id — как у transform
    } else {
      href = `#${slugger.slug(title)}`;
    }
    if (level >= TOC_MIN_LEVEL && level <= TOC_MAX_LEVEL && !isTocHeading) {
      headings.push({level, title, href});
    }
  }
  return headings;
}

/** Собирает markdown-список с вложенностью 2 пробела на уровень. */
export function buildTocList(headings: TocHeading[]): string {
  if (headings.length === 0) return "";
  const minLevel = Math.min(...headings.map((h) => h.level));
  return headings
    .map(({level, title, href}) => `${"  ".repeat(level - minLevel)}- [${title}](${href})`)
    .join("\n");
}

/**
 * План применения оглавления: список + расположение существующего блока
 * «Оглавление» (заголовок H1–H2 + список под ним до следующего заголовка).
 */
export function buildTocPlan(src: string): TocPlan {
  const headings = collectHeadings(src);
  const list = buildTocList(headings);
  const lines = src.split("\n");

  const tokens = md.parse(src, {});
  let tocHeadingLine: number | null = null;
  let listRange: {from: number; to: number} | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open" || !token.map) continue;
    const level = Number.parseInt(token.tag.slice(1), 10);
    const inline = tokens[i + 1];
    if (!inline) continue;

    const title = removeCustomId(headingTitle(inline)).trim().toLowerCase();
    if (level > 2 || !TOC_TITLES.has(title)) continue;

    tocHeadingLine = token.map[1] - 1; // последняя строка заголовка
    // список под заголовком — до следующего heading_open любого уровня
    let from: number | null = null;
    let to: number | null = null;
    for (let j = i + 2; j < tokens.length; j++) {
      if (tokens[j].type === "heading_open") break;
      const map = tokens[j].map;
      if (!map) continue;
      if (from === null) from = map[0];
      to = Math.max(to ?? 0, map[1]);
    }
    // хвостовые пустые строки не входят в заменяемый блок
    if (from !== null && to !== null && to > from) {
      while (to > from && lines[to - 1].trim() === "") to--;
      if (to > from) listRange = {from, to};
    }
    break;
  }

  return {list, headings, tocHeadingLine, listRange};
}

/** Текст после замены существующего блока оглавления новым списком. */
export function applyTocReplace(src: string): string {
  const plan = buildTocPlan(src);
  const lines = src.split("\n");
  if (plan.tocHeadingLine === null || !plan.list) return src;

  if (plan.listRange) {
    lines.splice(plan.listRange.from, plan.listRange.to - plan.listRange.from, ...plan.list.split("\n"));
  } else {
    lines.splice(plan.tocHeadingLine + 1, 0, "", ...plan.list.split("\n"));
  }
  return lines.join("\n");
}

/** Текст после вставки нового блока оглавления в начало документа. */
export function applyTocInsert(src: string): string {
  const plan = buildTocPlan(src);
  if (!plan.list) return src;
  return `## Оглавление\n\n${plan.list}\n\n${src}`;
}
