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
import {parseVasEntityHref} from "./agent/masking/vasEntityLink";

/** Дефолтные схемы sanitize-html + `asset` (изображения) + `harness-ulid`
 *  (ссылки) + legacy `harness_ulid`/`ulid` + `vas-entity` (сущности, T3). */
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
  "vas-entity",
];

/** Параметры transform — тип взят у функции; `allowedSchemes` есть в
 *  sanitize-html, но отсутствует в его типах, поэтому приведение один раз здесь. */
export type PreviewTransformOptions = NonNullable<Parameters<typeof transform>[1]>;

export const PREVIEW_TRANSFORM_OPTIONS = {
  supportGithubAnchors: true,
  sanitizeOptions: {allowedSchemes: PREVIEW_ALLOWED_SCHEMES},
} as unknown as PreviewTransformOptions;

/** Дефолтный URI-регексп DOMPurify + схемы `asset`, `ulid` и `vas-entity`. */
export const PREVIEW_SAFE_URI_RE =
  /^(?:(?:(?:f|ht)tps?|asset|harness-ulid|harness_ulid|ulid|vas-entity|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

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

/**
 * DOM-проход по ссылкам `vas-entity:<type>:<ULID>` (T3-8): href снимается
 * (мёртвая схема не должна уходить в WebView), чип получает класс и
 * data-атрибуты — как в редакторах, работает и поповер VasEntityPopover.
 */
export function linkifyVasEntityLinksInElement(root: ParentNode): void {
  root.querySelectorAll?.("a[href]").forEach((node) => {
    const link = node as HTMLAnchorElement;
    const href = link.getAttribute("href") ?? "";
    if (!href.toLowerCase().startsWith("vas-entity:")) return;
    const parsed = parseVasEntityHref(href);
    if (!parsed) return;
    link.removeAttribute("href");
    link.classList.add("vas-entity-link");
    link.setAttribute("data-vas-entity", parsed.ulid);
    link.setAttribute("data-vas-type", parsed.type.toLowerCase());
  });
}
