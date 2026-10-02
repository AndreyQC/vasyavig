/**
 * CSP-изоляция рендера HTML-вкладки (design D2 change 20261002-html-viewer).
 *
 * `sandbox=""` у iframe запрещает скрипты/формы/навигацию, но НЕ сетевые
 * загрузки статики (трекинг-пиксели, внешние картинки). Мета-CSP в начале
 * документа закрывает и их: допустимы только инлайн-стили и data:/blob:.
 */
const CSP_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">`;

/** Пролог документа (XML-декларация + doctype) — мету вставляем ПОСЛЕ него,
 * иначе браузер уйдёт в quirks mode. */
const DOCUMENT_PROLOGUE = /^(?:\s*(?:<\?xml[^>]*\?>\s*)?(?:<!doctype[^>]*>\s*)?)/i;

/**
 * Вставляет CSP-мету в HTML-документ: сразу после `<head...>`; если head нет —
 * как новый `<head>` после `<html...>`; если нет и его — после пролога
 * (xml/doctype) в начале строки. Идемпотентна: повторный вызов не дублирует мету.
 */
export function injectCspMeta(html: string): string {
  if (html.includes(CSP_POLICY)) return html;

  const headOpen = /<head[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + CSP_META + html.slice(at);
  }

  const htmlOpen = /<html[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, at) + `<head>${CSP_META}</head>` + html.slice(at);
  }

  const prologue = DOCUMENT_PROLOGUE.exec(html);
  const at = prologue ? prologue[0].length : 0;
  return html.slice(0, at) + CSP_META + html.slice(at);
}
