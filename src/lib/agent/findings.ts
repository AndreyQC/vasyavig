import {matchAnchor} from "../anchorMatcher";
import {buildTocPlan} from "../generateToc";
import {parseHarnessEnvelope} from "../harnessEnvelope";
import {getExtension, getParentDir, normalizeJoin} from "../utils";

/**
 * Детерминированные проверки документа (Phase 8.2, `check_document`).
 *
 * Только локальные правила, без модели: legacy-ссылки, битые якоря, TOC,
 * harness-конверт, неразрешимые картинки, дубли custom-id. Модель в 8.3
 * получает эти findings и предлагает правки; здесь — безопасная база,
 * которая работает даже без endpoint'а.
 */

export type FindingRule = "links" | "anchors" | "toc" | "envelope" | "images" | "headings";

export const FINDING_RULES: readonly FindingRule[] = [
  "links",
  "anchors",
  "toc",
  "envelope",
  "images",
  "headings",
];

export type FindingSeverity = "info" | "warning" | "error";

export interface Finding {
  id: string;
  rule: FindingRule;
  severity: FindingSeverity;
  /** Ключ i18n; UI переводит, модель получает rule. */
  messageKey: string;
  params?: Record<string, string | number>;
  /** 1-базная строка. */
  line?: number;
  snippet?: string;
}

export interface FindingInput {
  content: string;
  /** Абсолютный путь нужен только для резолва картинок; в findings не попадает. */
  path: string;
  rules?: readonly FindingRule[];
  /** Документ лежит в harness-репозитории — проверяем конверт. */
  harness?: boolean;
  /** Проверка существования файла картинки; без неё правило images пропускается. */
  fileExists?: (path: string) => Promise<boolean>;
  maxFindings?: number;
}

const LINK_TARGET_RE = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const ANCHOR_LINK_RE = /\]\(#([^)\s]+)\)/g;
const IMAGE_RE = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const CUSTOM_ID_RE = /\[?{ ?#(\S+) ?}]?/g;

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "yfm", "mdx"]);
const EXTERNAL_TARGET_RE = /^(?:[a-z][a-z0-9+.-]*:|[/\\]|[a-z]:)/i;

function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function lineText(lines: readonly string[], line: number): string {
  return (lines[line - 1] ?? "").trim().slice(0, 200);
}

function headingsOf(content: string): string[] {
  const headings: string[] = [];
  HEADING_RE.lastIndex = 0;
  for (let match = HEADING_RE.exec(content); match; match = HEADING_RE.exec(content)) {
    headings.push(match[2].trim());
  }
  return headings;
}

/** Собрать findings по включённым правилам (детерминированно, лимит 100). */
export async function collectFindings(input: FindingInput): Promise<Finding[]> {
  const rules = new Set<FindingRule>(input.rules ?? FINDING_RULES);
  const maxFindings = input.maxFindings ?? 100;
  const lines = input.content.split(/\r?\n/);
  const findings: Finding[] = [];
  let seq = 0;

  const add = (
    rule: FindingRule,
    severity: FindingSeverity,
    messageKey: string,
    opts: {line?: number; params?: Record<string, string | number>} = {},
  ) => {
    if (!rules.has(rule) || findings.length >= maxFindings) return;
    const id = `${rule}-${opts.line ?? 0}-${++seq}`;
    findings.push({
      id,
      rule,
      severity,
      messageKey,
      params: opts.params,
      line: opts.line,
      snippet: opts.line ? lineText(lines, opts.line) : undefined,
    });
  };

  if (rules.has("links")) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let encoded = 0;
      let escaped = 0;
      let legacy = 0;
      LINK_TARGET_RE.lastIndex = 0;
      for (let match = LINK_TARGET_RE.exec(line); match; match = LINK_TARGET_RE.exec(line)) {
        const target = match[1];
        // внешние/абсолютные ссылки — не legacy-пути workspace
        if (EXTERNAL_TARGET_RE.test(target)) continue;
        if (/%[0-9A-Fa-f]{2}/.test(target) && /[\u0400-\u04FF]/.test(decodeMaybe(target))) {
          encoded++;
        }
        if (target.includes("\\_")) escaped++;
        if (/^(?:harness_ulid|ulid):/i.test(target)) legacy++;
      }
      if (encoded > 0) {
        add("links", "warning", "assistant.finding.percentCyrillic", {
          line: i + 1,
          params: {count: encoded},
        });
      }
      if (escaped > 0) {
        add("links", "warning", "assistant.finding.escapedUnderscore", {
          line: i + 1,
          params: {count: escaped},
        });
      }
      if (legacy > 0) {
        add("links", "warning", "assistant.finding.legacyUlid", {
          line: i + 1,
          params: {count: legacy},
        });
      }
    }
  }

  if (rules.has("anchors")) {
    const headings = headingsOf(input.content);
    for (let i = 0; i < lines.length; i++) {
      ANCHOR_LINK_RE.lastIndex = 0;
      for (let match = ANCHOR_LINK_RE.exec(lines[i]); match; match = ANCHOR_LINK_RE.exec(lines[i])) {
        const fragment = decodeMaybe(match[1]);
        if (matchAnchor(headings, fragment) === null) {
          add("anchors", "warning", "assistant.finding.brokenAnchor", {
            line: i + 1,
            params: {fragment},
          });
        }
      }
    }
  }

  if (rules.has("toc")) {
    const plan = buildTocPlan(input.content);
    if (plan.headings.length > 0) {
      if (plan.tocHeadingLine === null) {
        add("toc", "info", "assistant.finding.tocMissing");
      } else {
        const existing = plan.listRange
          ? lines.slice(plan.listRange.from, plan.listRange.to).join("\n")
          : "";
        if (existing.trim() !== plan.list.trim()) {
          add("toc", "warning", "assistant.finding.tocStale", {
            line: (plan.listRange?.from ?? plan.tocHeadingLine) + 1,
          });
        }
      }
    }
  }

  if (rules.has("envelope") && input.harness && MARKDOWN_EXTENSIONS.has(getExtension(input.path))) {
    const envelope = parseHarnessEnvelope(input.content);
    if (!envelope) {
      const header = lines.slice(0, 5).join("\n");
      const broken = header.includes("[<[harness-yaml]]");
      add(
        "envelope",
        broken ? "error" : "warning",
        broken ? "assistant.finding.envelopeBroken" : "assistant.finding.envelopeMissing",
        {line: 1},
      );
    }
  }

  if (rules.has("images") && input.fileExists) {
    const baseDir = getParentDir(input.path);
    let checked = 0;
    for (let i = 0; i < lines.length && checked < 20; i++) {
      IMAGE_RE.lastIndex = 0;
      for (let match = IMAGE_RE.exec(lines[i]); match; match = IMAGE_RE.exec(lines[i])) {
        let target = match[1].trim();
        if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
        if (target === "" || EXTERNAL_TARGET_RE.test(target)) continue;
        const clean = target.split(/[?#]/)[0];
        if (clean === "") continue;
        checked++;
        const resolved = normalizeJoin(baseDir, decodeMaybe(clean));
        let exists = true;
        try {
          exists = await input.fileExists(resolved);
        } catch {
          exists = true; // не смогли проверить — не шумим ложным finding'ом
        }
        if (!exists) {
          add("images", "warning", "assistant.finding.imageUnresolved", {
            line: i + 1,
            params: {target: clean.slice(0, 200)},
          });
        }
        if (checked >= 20) break;
      }
    }
  }

  if (rules.has("headings")) {
    const counts = new Map<string, number>();
    CUSTOM_ID_RE.lastIndex = 0;
    for (let match = CUSTOM_ID_RE.exec(input.content); match; match = CUSTOM_ID_RE.exec(input.content)) {
      const id = match[1];
      if (match[0] === "[{#T}]") continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      if (count > 1) {
        add("headings", "warning", "assistant.finding.duplicateCustomId", {
          params: {id, count},
        });
      }
    }
  }

  return findings;
}
