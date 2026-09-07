/**
 * Обёртка рендеринга mermaid для WYSIWYG и модалки (design D1).
 * SplitPreview остаётся на своей пост-обработке HTML — этот модуль её не
 * заменяет. Библиотека (~1 МБ) грузится лениво при первом рендере диаграммы
 * или после загрузки — при смене темы (наработки gramax §2.1).
 */

type Mermaid = typeof import("mermaid")["default"];

let mermaidPromise: Promise<Mermaid> | null = null;
let themeDark: boolean | null = null;
let renderCounter = 0;
const themeListeners = new Set<() => void>();

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) mermaidPromise = import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

function applyTheme(mermaid: Mermaid, dark: boolean) {
  mermaid.initialize({startOnLoad: false, theme: dark ? "dark" : "default"});
}

/**
 * Тема диаграмм следует теме приложения (спека). Пока библиотека не
 * загружена — только запоминаем: примится при первом рендере (ленивость:
 * документ без диаграмм библиотеку не грузит).
 */
export function setMermaidTheme(dark: boolean): void {
  if (themeDark === dark) return;
  themeDark = dark;
  if (mermaidPromise) {
    void mermaidPromise.then((m) => applyTheme(m, dark));
    for (const fn of themeListeners) fn();
  }
}

/** Подписка на смену темы (nodeView перерисовывают диаграммы). Возвращает отписку. */
export function onMermaidThemeChange(fn: () => void): () => void {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

/** Уникальный id рендера — чистая функция для теста (design D1). */
export function nextDiagramId(now: number, counter: number): string {
  return `mmd-wys-${now}-${counter}`;
}

export type DiagramRenderResult = {svg: string} | {error: string};

/**
 * Рендер исходника в SVG. Offscreen-контейнер удаляется в finally; ошибки
 * нормализуются в текст — исключений наружу нет (спека: невалидный синтаксис
 * показывается сообщением, приложение не падает).
 */
export async function renderMermaidDiagram(source: string): Promise<DiagramRenderResult> {
  try {
    const mermaid = await loadMermaid();
    const dark = themeDark ?? false;
    if (themeDark === null) {
      themeDark = dark;
      applyTheme(mermaid, dark);
    }
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-99999px";
    container.style.top = "0";
    document.body.appendChild(container);
    try {
      const {svg} = await mermaid.render(nextDiagramId(Date.now(), renderCounter++), source, container);
      return {svg};
    } finally {
      container.remove();
    }
  } catch (e) {
    return {error: normalizeMermaidError(e)};
  }
}

/** Читаемый текст ошибки рендера (чистая функция для теста). */
export function normalizeMermaidError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "diagram render failed";
}
