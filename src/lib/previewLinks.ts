/**
 * Превью: схемы URI и линкификация ULID-ссылок (task 20261027_001, формат C).
 *
 * Прототип показал: `harness-ulid:` вырезается дважды — `sanitize-html` внутри
 * `@diplodoc/transform` (`allowedSchemes`) и DOMPurify (`ALLOWED_URI_REGEXP`).
 * Здесь обе конфигурации и DOM-проход `a[href^="harness-ulid:"]` -> `data-ulid`.
 * Legacy `harness_ulid:`/`ulid:` читаются наравне.
 */
import type transform from "@diplodoc/transform";
import type {UlidLinkMeta} from "./harnessIndex";
import {parseUlidHref} from "./harnessUlidLink";

/** Дефолтные схемы sanitize-html + `asset` (изображения) + `harness-ulid`
 *  (ссылки) + legacy `harness_ulid`/`ulid`. */
export const PREVIEW_ALLOWED_SCHEMES = [
  "http",
  "https",
  "ftp",
  "mailto",
  "tel",
  "sms",
  "asset",
  "harness-ulid",
  "harness_ulid",
  "ulid",
];

/** Параметры transform — тип взят у функции; `allowedSchemes` есть в
 *  sanitize-html, но отсутствует в его типах, поэтому приведение один раз здесь. */
export type PreviewTransformOptions = NonNullable<Parameters<typeof transform>[1]>;

export const PREVIEW_TRANSFORM_OPTIONS = {
  supportGithubAnchors: true,
  sanitizeOptions: {allowedSchemes: PREVIEW_ALLOWED_SCHEMES},
} as unknown as PreviewTransformOptions;

/** Дефолтный URI-регексп DOMPurify + схемы `asset` и `ulid`. */
export const PREVIEW_SAFE_URI_RE =
  /^(?:(?:(?:f|ht)tps?|asset|harness-ulid|harness_ulid|ulid|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * DOM-проход по ссылкам `harness_ulid:` (и legacy `ulid:`): href снимается
 * (WebView не должен пытаться открыть неизвестную схему), ULID/якорь переезжают
 * в data-атрибуты, класс — `ulid-link` (есть в реестре) или `ulid-unknown`.
 * Обычные ссылки не трогаем.
 */
export function linkifyUlidLinksInElement(
  root: ParentNode,
  lookup: (ulid: string) => UlidLinkMeta | null,
  unknownTitle: string,
  dir?: string,
): void {
  root.querySelectorAll?.("a[href]").forEach((node) => {
    const link = node as HTMLAnchorElement;
    const parsed = parseUlidHref(link.getAttribute("href"));
    if (!parsed) return;
    link.removeAttribute("href");
    const hit = lookup(parsed.ulid);
    if (hit) {
      link.classList.add("ulid-link");
      link.setAttribute("data-ulid", parsed.ulid);
      link.setAttribute("aria-label", `${hit.title} · ${hit.type}`);
    } else {
      link.classList.add("ulid-unknown");
      link.setAttribute("data-ulid-unknown", parsed.ulid);
      link.setAttribute("aria-label", unknownTitle);
    }
    if (parsed.anchor) link.setAttribute("data-anchor", parsed.anchor);
    if (dir) link.setAttribute("data-ulid-dir", dir);
  });
}
