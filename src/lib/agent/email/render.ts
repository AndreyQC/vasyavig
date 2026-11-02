import transform from "@diplodoc/transform";
import DOMPurify from "dompurify";
import {stripHiddenEnvelopes} from "../../harnessEnvelope";
import {resolveLocalImagePath} from "../../resolveImageSrc";
import {EMAIL_IMAGE_LIMIT_BYTES, embedImage, type ReadImageBytes} from "./images";

/**
 * Детерминированный render тела письма (Phase 8.4, §6.2).
 *
 * Модель тело не генерирует: markdown/YFM -> @diplodoc/transform
 * (supportGithubAnchors) -> чистка служебной разметки transform -> YFM
 * подмножество (notes -> цветной table-блок, cut -> развёрнутый блок) ->
 * снятие декоративных атрибутов -> встраивание картинок (data URI с
 * суммарным лимитом) -> DOMPurify (email-безопасные URI) -> inline CSS.
 * Всё, что не входит в подмножество (табы, видео, ULID-ссылки), — warning,
 * письмо не ломается.
 *
 * Функции чистые: сторы и FS сюда не ходят, чтение картинок инъекцией.
 */

export interface EmailWarning {
  /** Ключ i18n в assistant.email.warning.*; params переводит UI. */
  key: string;
  params?: Record<string, unknown>;
}

export interface RenderEmailBodyInput {
  markdown: string;
  /** Каталог документа — база относительных src картинок. */
  basePath: string;
  /** Корень открытой папки — база root-relative src. */
  rootPath?: string | null;
  readImageBytes: ReadImageBytes;
  /** По умолчанию EMAIL_IMAGE_LIMIT_BYTES (2 MB суммарно). */
  imageLimitBytes?: number;
}

export interface EmailBody {
  /** Готовый HTML содержимого письма (внутрь 600px-ячейки шаблона). */
  html: string;
  warnings: EmailWarning[];
}

type TransformOptions = NonNullable<Parameters<typeof transform>[1]>;

/** ВАЖНО: sanitizeOptions не передаём — частичные опции перетирают дефолты
 *  санитайзера transform (классы yfm-note, id заголовков, img пропадают).
 *  Дефолтные схемы и так режут asset/harness-ulid/ulid; data: убирается там же,
 *  а финальный гейт — DOMPurify ниже. */
const EMAIL_TRANSFORM_OPTIONS = {
  supportGithubAnchors: true,
} as unknown as TransformOptions;

/** Финальный гейт DOMPurify: http(s)/mailto/tel, растровые data:image base64,
 *  якоря и относительные пути (fallback — как в дефолтном регекспе DOMPurify:
 *  файл рядом с картинками открывается из браузера; в письме невстроенные
 *  картинки остаются с исходным src — это warning). Схемы workspace
 *  (harness-ulid/asset) и data:text/html — мимо. */
const EMAIL_SAFE_URI_RE =
  /^(?:(?:https?|mailto|tel):|data:image\/(?:png|gif|jpe?g|webp);base64,|#|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** {tab}/{tabs} в исходнике: transform деградирует их в последовательный текст. */
const TABS_RE = /\{%\s*tabs\b/i;
/** ULID-ссылки в исходнике: в письме схемы workspace не работают. */
const ULID_LINK_RE = /\]\(\s*(?:harness[-_]ulid|ulid):[^)]*\)/gi;

/** Акценты YFM-notes -> цвета email-блока. */
const NOTE_ACCENTS: Record<string, {border: string; bg: string}> = {
  info: {border: "#2f86eb", bg: "#e9f2fe"},
  tip: {border: "#3f9f6f", bg: "#e8f6ee"},
  warning: {border: "#d6a13a", bg: "#fdf5e2"},
  alert: {border: "#e0443f", bg: "#fdeceb"},
};

const BASE_FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO_FONT = "Consolas,'Courier New',monospace";

/** Inline CSS по тегу (email-клиенты не читают <style>). */
const INLINE_STYLES: Record<string, string> = {
  p: `margin:0 0 12px 0;font-family:${BASE_FONT};font-size:14px;line-height:1.6;color:#222222;`,
  h1: `margin:16px 0 12px 0;font-family:${BASE_FONT};font-size:22px;line-height:1.3;font-weight:600;color:#111111;`,
  h2: `margin:16px 0 10px 0;font-family:${BASE_FONT};font-size:18px;line-height:1.3;font-weight:600;color:#111111;`,
  h3: `margin:14px 0 8px 0;font-family:${BASE_FONT};font-size:16px;line-height:1.3;font-weight:600;color:#111111;`,
  h4: `margin:12px 0 6px 0;font-family:${BASE_FONT};font-size:14px;line-height:1.3;font-weight:600;color:#111111;`,
  h5: `margin:12px 0 6px 0;font-family:${BASE_FONT};font-size:13px;line-height:1.3;font-weight:600;color:#111111;`,
  h6: `margin:12px 0 6px 0;font-family:${BASE_FONT};font-size:12px;line-height:1.3;font-weight:600;color:#555555;`,
  a: "color:#1a6bc4;text-decoration:underline;",
  ul: `margin:0 0 12px 0;padding:0 0 0 24px;font-family:${BASE_FONT};font-size:14px;line-height:1.6;color:#222222;`,
  ol: `margin:0 0 12px 0;padding:0 0 0 24px;font-family:${BASE_FONT};font-size:14px;line-height:1.6;color:#222222;`,
  li: "margin:2px 0;",
  blockquote: "margin:0 0 12px 0;padding:2px 0 2px 12px;border-left:3px solid #dddddd;color:#555555;",
  pre: `margin:0 0 12px 0;padding:12px;background:#f5f5f5;font-family:${MONO_FONT};font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:break-word;color:#222222;`,
  img: "max-width:100%;height:auto;border:0;display:inline-block;vertical-align:middle;",
  hr: "border:none;border-top:1px solid #dddddd;margin:16px 0;",
  table: "border-collapse:collapse;width:100%;margin:0 0 12px 0;",
  th: `border:1px solid #dddddd;padding:6px 10px;text-align:left;background:#f5f5f5;font-family:${BASE_FONT};font-size:13px;color:#222222;`,
  td: `border:1px solid #dddddd;padding:6px 10px;font-family:${BASE_FONT};font-size:13px;color:#222222;`,
  del: "text-decoration:line-through;",
  sup: "font-size:11px;",
  sub: "font-size:11px;",
};

const INLINE_CODE_STYLE = `font-family:${MONO_FONT};background:#f5f5f5;padding:1px 4px;border-radius:3px;font-size:13px;`;

/** Маркер «стиль финальный»: inline-проход и strip не переоформляют. */
const FINAL_MARKER = "data-email-final";

/** Атрибуты контента, которые переживают чистку. */
const KEEP_ATTRS = new Set(["src", "href", "alt", "title", "colspan", "rowspan", "id", "role", "width"]);

function isFinalStyled(el: Element): boolean {
  return el.closest(`[${FINAL_MARKER}]`) !== null;
}

/** Снять style/class/прочие атрибуты оформления; контентные — оставить. */
function stripDecorativeAttrs(root: ParentNode): void {
  root.querySelectorAll("*").forEach((el) => {
    if (isFinalStyled(el)) return;
    for (const attr of [...el.getAttributeNames()]) {
      if (!KEEP_ATTRS.has(attr) && !attr.startsWith("data-email-")) {
        el.removeAttribute(attr);
      }
    }
  });
}

/** Почистить фрагмент HTML от декоративных атрибутов (содержимое notes/cuts). */
function sanitizeFragment(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  stripDecorativeAttrs(template.content);
  return template.innerHTML;
}

/** Убрать служебную разметку transform: clipboard-якоря и кнопки кода. */
function cleanTransformChrome(root: ParentNode): void {
  root.querySelectorAll("a.yfm-anchor").forEach((node) => node.remove());
  root.querySelectorAll("div.yfm-code-floating-container").forEach((container) => {
    const pre = container.querySelector("pre");
    if (pre) container.replaceWith(pre);
    else container.remove();
  });
  // inline-code плагин: id генерируется случайно (ломает snapshot) и нужен
  // только его кнопкам копирования; в письме не нужен
  root.querySelectorAll("code[role]").forEach((el) => el.removeAttribute("role"));
  root.querySelectorAll("[id]").forEach((el) => {
    if ((el.getAttribute("id") ?? "").startsWith("inline-code-id-")) el.removeAttribute("id");
  });
  // пустые абзацы от пустых строк
  root.querySelectorAll("p").forEach((p) => {
    if (p.textContent?.trim() === "" && !p.querySelector("img")) p.remove();
  });
}

function createNoteTitle(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.setAttribute(FINAL_MARKER, "");
  p.setAttribute(
    "style",
    `margin:0 0 6px 0;font-weight:600;font-family:${BASE_FONT};font-size:14px;color:#111111;`,
  );
  p.textContent = text;
  return p;
}

/**
 * YFM-подмножество: notes -> table-блок с цветной плашкой (email-клиенты
 * надёжно красят таблицы), cuts -> развёрнутый блок (<details> в почтовых
 * клиентах не работает). Содержимое — уже HTML от transform, дополнительно
 * почищенный от декоративных атрибутов.
 */
function convertYfmNotes(root: ParentNode): void {
  root.querySelectorAll("div.yfm-note").forEach((node) => {
    const type = (node.getAttribute("note-type") ?? "info").toLowerCase();
    const accent = NOTE_ACCENTS[type] ?? NOTE_ACCENTS.info;
    const title = node.querySelector(".yfm-note-title")?.textContent?.trim() ?? "";
    const contentHtml = sanitizeFragment(
      node.querySelector(".yfm-note-content")?.innerHTML ?? node.innerHTML,
    );

    const table = document.createElement("table");
    table.setAttribute("role", "presentation");
    table.setAttribute("width", "100%");
    table.setAttribute(FINAL_MARKER, "");
    table.setAttribute(
      "style",
      `border-collapse:collapse;width:100%;margin:0 0 12px 0;background:${accent.bg};`,
    );
    const body = document.createElement("tbody");
    const row = document.createElement("tr");
    const td = document.createElement("td");
    td.setAttribute(FINAL_MARKER, "");
    td.setAttribute(
      "style",
      `border-left:4px solid ${accent.border};background:${accent.bg};padding:10px 14px;font-family:${BASE_FONT};font-size:14px;line-height:1.6;color:#222222;`,
    );
    if (title !== "") td.appendChild(createNoteTitle(title));
    const content = document.createElement("div");
    content.innerHTML = contentHtml;
    td.appendChild(content);
    row.appendChild(td);
    body.appendChild(row);
    table.appendChild(body);
    node.replaceWith(table);
  });
}

function convertYfmCuts(root: ParentNode): void {
  root.querySelectorAll("details.yfm-cut").forEach((node) => {
    const title = node.querySelector("summary.yfm-cut-title")?.textContent?.trim() ?? "";
    const contentHtml = sanitizeFragment(
      node.querySelector(".yfm-cut-content")?.innerHTML ?? node.innerHTML,
    );
    const wrap = document.createElement("div");
    wrap.setAttribute(FINAL_MARKER, "");
    if (title !== "") wrap.appendChild(createNoteTitle(title));
    const content = document.createElement("div");
    content.setAttribute("style", "margin:0 0 12px 0;padding:0 0 0 12px;border-left:3px solid #dddddd;");
    content.innerHTML = contentHtml;
    wrap.appendChild(content);
    node.replaceWith(wrap);
  });
}

/** Встроить локальные картинки в data URI в рамках суммарного бюджета. */
async function embedLocalImages(
  root: ParentNode,
  input: {basePath: string; rootPath?: string | null; readImageBytes: ReadImageBytes; limit: number},
): Promise<{limitSkipped: number; missing: number}> {
  let used = 0;
  let limitSkipped = 0;
  let missing = 0;
  for (const img of [...root.querySelectorAll("img[src]")]) {
    const trimmed = (img.getAttribute("src") ?? "").trim();
    // Уже встроенная или внешняя (http/mailto/tel) картинка — не трогаем.
    if (trimmed === "" || trimmed.startsWith("data:") || /^(?:https?|mailto|tel):/i.test(trimmed)) {
      continue;
    }
    const absolute = resolveLocalImagePath(trimmed, input.basePath, input.rootPath);
    if (!absolute) {
      missing++;
      continue;
    }
    const result = await embedImage(absolute, input.limit - used, input.readImageBytes);
    if (result.dataUri) {
      img.setAttribute("src", result.dataUri);
      used += result.bytes;
    } else if (result.reason === "limit") {
      limitSkipped++;
    } else {
      missing++;
    }
  }
  return {limitSkipped, missing};
}

/** Inline CSS по тегам; блоки с финальным стилем (notes/cuts) не трогаем. */
function applyInlineStyles(root: ParentNode): void {
  for (const [tag, style] of Object.entries(INLINE_STYLES)) {
    root.querySelectorAll(tag).forEach((el) => {
      if (isFinalStyled(el)) return;
      const existing = el.getAttribute("style");
      el.setAttribute("style", existing ? `${existing};${style}` : style);
    });
  }
  // inline-code: code вне pre и вне YFM-блоков
  root.querySelectorAll("code").forEach((el) => {
    if (el.closest("pre") || isFinalStyled(el)) return;
    el.setAttribute("style", INLINE_CODE_STYLE);
  });
}

/**
 * Построить тело письма из markdown/YFM. Бросает исключение, если transform
 * упал (некорректный документ) — вызывающий код показывает notice.
 */
export async function renderEmailBody(input: RenderEmailBodyInput): Promise<EmailBody> {
  const warnings: EmailWarning[] = [];
  const {result} = transform(stripHiddenEnvelopes(input.markdown), EMAIL_TRANSFORM_OPTIONS);

  const doc = new DOMParser().parseFromString(result.html, "text/html");
  const root = doc.body;

  cleanTransformChrome(root);
  convertYfmNotes(root);
  convertYfmCuts(root);
  stripDecorativeAttrs(root);

  // Предупреждения по исходнику/разметке до финальной санитизации.
  if (TABS_RE.test(input.markdown)) warnings.push({key: "assistant.email.warning.tabs"});
  const videoCount = root.querySelectorAll("video, .yfm-video").length;
  if (videoCount > 0) {
    warnings.push({key: "assistant.email.warning.video", params: {count: videoCount}});
  }
  const ulidLinks = input.markdown.match(ULID_LINK_RE)?.length ?? 0;
  if (ulidLinks > 0) {
    warnings.push({key: "assistant.email.warning.ulidLinks", params: {count: ulidLinks}});
  }

  const embedded = await embedLocalImages(root, {
    basePath: input.basePath,
    rootPath: input.rootPath,
    readImageBytes: input.readImageBytes,
    limit: input.imageLimitBytes ?? EMAIL_IMAGE_LIMIT_BYTES,
  });
  if (embedded.limitSkipped > 0) {
    warnings.push({
      key: "assistant.email.warning.imageLimit",
      params: {skipped: embedded.limitSkipped},
    });
  }
  if (embedded.missing > 0) {
    warnings.push({
      key: "assistant.email.warning.imageMissing",
      params: {skipped: embedded.missing},
    });
  }

  const sanitized = DOMPurify.sanitize(root.innerHTML, {
    ALLOWED_URI_REGEXP: EMAIL_SAFE_URI_RE,
    FORBID_TAGS: [
      "script",
      "style",
      "iframe",
      "form",
      "input",
      "button",
      "video",
      "audio",
      "object",
      "embed",
      "template",
      "svg",
      "math",
      "base",
      "meta",
      "link",
      "dialog",
    ],
    FORBID_ATTR: ["srcset", "poster", "background"],
  });

  const out = new DOMParser().parseFromString(sanitized, "text/html");
  applyInlineStyles(out.body);

  return {html: out.body.innerHTML, warnings};
}
