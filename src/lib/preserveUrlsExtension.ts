import type {Extension} from "@gravity-ui/markdown-editor";

/**
 * markdown-it применяет normalizeLink при парсинге ссылок: не-ASCII (кириллица)
 * кодируется в %-вид, и сериализатор WYSIWYG записывает перекодированный href
 * обратно в markup. Identity-нормализация сохраняет URL как есть при любом
 * round-trip (phase 4, задача 3.1 плана).
 */
export function preserveUrlsExtension(): Extension {
  return (builder) => {
    builder.configureMd((md) => {
      md.normalizeLink = (url) => url;
      md.normalizeLinkText = (url) => url;
      return md;
    });
  };
}
