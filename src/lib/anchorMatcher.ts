import GithubSlugger from "github-slugger";
import slugify from "slugify";

// Те же правила custom-id, что у @diplodoc/transform и generateToc
const CUSTOM_ID_RE = /\[?{ ?#(\S+) ?}]?/g;
const CUSTOM_ID_EXCEPTION = "[{#T}]";

function getFirstCustomId(raw: string): string | null {
  let first: string | null = null;
  raw.replace(CUSTOM_ID_RE, (match, id: string) => {
    if (first === null && match !== CUSTOM_ID_EXCEPTION) first = id;
    return "";
  });
  return first;
}

function removeCustomId(raw: string): string {
  return raw
    .replace(CUSTOM_ID_RE, (match) => (match === CUSTOM_ID_EXCEPTION ? match : ""))
    .trim();
}

/** Транслит-слаг — как slugify у @diplodoc/transform (anchors plugin). */
function translitSlug(title: string): string {
  return slugify(title, {lower: true, remove: /[^\w\s$_\-,;=/]+/g});
}

/**
 * Кандидаты-якоря для каждого заголовка (по порядку, все уровни):
 * custom-id — [customId]; обычный — [github-слаг, транслит-слаг].
 * Дубли: github — суффикс -1/-2 (slugger), транслит — суффикс 1/2 (как у transform).
 */
export function computeHeadingAnchors(headings: string[]): string[][] {
  const slugger = new GithubSlugger();
  const translitIds = new Map<string, number>();
  const result: string[][] = [];

  for (const raw of headings) {
    const customId = getFirstCustomId(raw);
    if (customId) {
      result.push([customId]);
      continue; // слаггеры не питаются custom-id — как у transform
    }
    const title = removeCustomId(raw);

    const gh = slugger.slug(title);

    let tr = translitSlug(title);
    const seen = translitIds.get(tr);
    if (seen) {
      translitIds.set(tr, seen + 1);
      tr = tr + seen; // x, x1, x2 — стиль transform
    } else {
      translitIds.set(tr, 1);
    }

    result.push([gh, tr]);
  }
  return result;
}

/**
 * Индекс заголовка, соответствующего якорю из ссылки, или null.
 * Фрагмент сравнивается как есть и после percent-декодирования.
 */
export function matchAnchor(headings: string[], fragment: string): number | null {
  const anchors = computeHeadingAnchors(headings);
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // оставляем как есть
  }
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].includes(fragment) || anchors[i].includes(decoded)) return i;
  }
  return null;
}
