# Design: mermaid-диаграммы в редакторе WYSIWYG

> Дата: 2026-09-04. Мотивация — `proposal.md`; требования —
> `specs/mermaid-wysiwyg/spec.md`. Решения пользователя: скоуп «рендер +
> модалка», тема — следовать приложению. Наработки gramax —
> `_docs_/GRAMAX_RESEARCH_RESULT.md` §2.

## Context

WYSIWYG работает на `@gravity-ui/markdown-editor` (preset `full`,
`MarkdownEditor.tsx`). Код-фенс — нода `code_block` с атрибутом
`data-language` (`CodeBlockSpecs`); рендерит её `CodeBlockNodeView`
(плагин CodeBlockHighlight, `@internal`, из public API не экспортируется),
подсветка — отдельными lowlight-декорациями, не nodeView. Наш паттерн
nodeView-переопределения с приоритетом Highest — `imageSrcExtension.ts`
(урок §10: при одноимённых записях выигрывает первый источник; порядок
плагинов — по убыванию priority). Mermaid 11.16 уже в зависимостях;
`SplitPreview` рендерит диаграммы пост-обработкой HTML и не меняется.

## Goals / Non-Goals

**Goals:**

- SVG-рендер ```` ```mermaid ```` фенсов в WYSIWYG без изменения markdown.
- Модалка правки исходника: Monaco + живое превью, сохранение в документ
  через editor API (undo работает).
- Ошибки — в код-блоке, не молча; тема приложения; ленивая загрузка mermaid.

**Non-Goals:**

- Drag-ресайз, экспорт диаграмм, plantuml, lazy-рендер по viewport
  (кандидаты в беклог).
- Изменение рендера превью (SplitPreview) и Markup-режима.
- Язык-подсветка исходника mermaid в модалке (Monaco — plaintext; в
  беклог при необходимости).

## Decisions

### D1. Модуль рендеринга `src/lib/mermaidRenderer.ts`

Обёртка над mermaid для WYSIWYG и модалки (SplitPreview остаётся на своей
пост-обработке — скоуп):

- ленивый `await import("mermaid")` при первом рендере (~1 МБ, gramax §2.1).
  Поправка по итогам имплементации: `SplitPreview` импортирует mermaid
  статически, поэтому код-сплит сегодня не активируется (модуль в главном
  чанке). Наш импорт ленив по построению и начнёт давать эффект после
  миграции превью на общий рендерер — кандидат в беклог;
- `setTheme(dark: boolean)` — `mermaid.initialize({theme: dark ? "dark" :
  "default"})`; initialize идемпотентен и глобален: в split-режиме превью
  инициализирует ту же тему — конфликта нет;
- `renderDiagram(source): Promise<{svg} | {error: string}>` — уникальный id
  `mmd-wys-{Date.now()}-{счётчик}`, offscreen-контейнер, `finally remove()`;
  ошибки mermaid нормализуются в читаемый текст (невалидный синтаксис vs
  прочее), исключений наружу не отдаёт;
- SVG инжектится как есть (securityLevel strict у mermaid по умолчанию —
  то же доверительное решение, что в SplitPreview, комментарий там же).

### D2. NodeView-плагин `src/lib/mermaidWysiwygExtension.ts`

Плагин (Priority.Highest, урок §10 — перекрывает `CodeBlockNodeView`
гравитас) с `props.nodeViews.code_block`:

- `data-language === "mermaid"` → наш `MermaidNodeView`: карточка
  `div.mermaid-wysiwyg` (SVG + skeleton пока рендер), `contentDOM` НЕ
  создаётся (исходник в DOM не отображается), dblclick → модалка (D3);
  `update(node)` — перерендер при изменении текста/языка (отмена правки,
  смена языка → немедленно вернуть fallback-вид);
- прочие языки → `FallbackCodeNodeView`: реплика минимального
  `CodeBlockNodeView` для нашей конфигурации — `pre[data-language] >
  code.hljs.<lang> > contentDIV`, `update` при смене языка. Подсветка
  сохраняется: lowlight-декорации живут в отдельном плагине и в
  `contentDOM` попадают независимо от nodeView. lineWrapping в нашем
  редакторе выключен, lineNumbers не отображаются (showByDefault=false и
  требуют wrapping) — реплицировать нечего. Риск рассинхрона с внутренностями
  гравитас — изолирован одним файлом + sanity-тест
  (паттерн `pluginNodeViews.sanity.test.ts`).

Имя ноды и атрибут не экспортируются из пакета (проверено по exports-карте) —
константы `"code_block"` / `"data-language"` локально, с комментарием (как
`IMAGE_NODE_NAME` в imageSrcExtension).

### D3. Модалка редактора диаграммы

Коммуникация «DOM-nodeView → React-модалка» через `uiStore` (паттерн
pendingX): `pendingMermaidEdit = {source: string, onApply(newSource) | null}`.
nodeView по dblclick кладёт source и колбэк; модалка
(`src/components/Modals/MermaidModal.tsx`, паттерн соседних модалок) —
Gravity `Modal`: слева Monaco (`MonacoViewer` с `editable`, plaintext),
справа превью (`renderDiagram`, debounce 300 мс, ошибка — сообщением).
«Сохранить» → `onApply(newSource)`; в nodeView: `view.dispatch(tr.replaceWith(
pos, pos + node.nodeSize, node.type.create(node.attrs,
schema.text(newSource))))` — обычная транзакция редактора: change-event →
`updateContent` → dirty, undo работает (спека). Отмена — просто закрыть.
Пока модалка открыта, `onApply` валиден: редактор per-file жив (key=path);
вкладку с диаграммой нельзя закрыть, не закрыв модалку? Закрытие вкладки
размонтирует редактор — модалка закрывается вместе с ним
(unmount-cleanup в MarkdownEditor).

### D4. Тема

`MarkdownEditor` (или сам рендерер) слушает `useThemeValue()` → `setTheme`.
Переключение темы: renderer хранит подписчиков-перерисовок? Проще: тема
меняется глобально через `mermaid.initialize` (D1), а перерисовка открытых
диаграмм — по смене пропа/маунта: `MermaidNodeView` перерисовывается через
ре-регистрацию расширения не нужна — nodeView прикладной перерендер
организуем событием renderer'а (tiny emitter `onThemeChange`), на который
nodeView подписан. Альтернатива (форс-перерендер документа транзакцией) —
грязные хаки, отвергнута.

### D5. Стили

`EditorArea.css`: `.mermaid-wysiwyg` — карточка (border, скругление, паддинг,
фон), skeleton (pulse), вписывание SVG по ширине (`max-width: 100%`),
кликабельный cursor для dblclick; ошибка — текст поверх код-блока.

## Risks / Trade-offs

- [Замена nodeView для ВСЕХ code_block: регрессия подсветки/поведения
  обычных код-блоков] → fallback-реплика минимальна (lineWrapping выключен),
  sanity-тест + ручная проверка обычных блоков (js/json/yaml) в чек-листе.
- [Внутренности CodeBlockNodeView меняются при апгрейде гравитас] → код
  изолирован, sanity-тест зафиксирует контракт (`pre>code.hljs>contentDOM`).
- [Конкурентные рендеры mermaid (модалка + документ + превью)] →
  уникальные id, рендеры асинхронны и независимы; мерцание приемлемо.
- [Диспатч replaceWith при закрытой модалке/мёртвом view] → колбэк живёт
  со вкладкой; проверка `view.isDestroyed` перед dispatch.
- [Большие диаграммы рендерятся синхронно с печатью в модалке] → debounce
  300 мс (как watcher); рендер в документе — по факту изменения ноды.

## Migration Plan

Только аддитивное поведение; markdown-формат не меняется (фенс остаётся
фенсом). Откат — revert коммита. Rust не затрагивается.

## Open Questions

Нет: скоуп и тема подтверждены пользователем 2026-09-04.
