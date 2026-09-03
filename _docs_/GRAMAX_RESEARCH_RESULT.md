# Исследование gramax — находки для заимствования в vasyavig

> Дата: 2026-08-28
> Репозиторий: `C:\repos\github\gramax` (клон, ветка по состоянию на 2026-08-28)
> Цель: проанализировать, как gramax решает задачи, запланированные в vasyavig —
> отображение локальных изображений (Phase 5), рендеринг mermaid, Notion-подобные таблицы.

## 0. Краткая справка о gramax

Desktop-редактор документации (GQiQ Gramax): Tauri **2.11.5** + React, редактор на
**tiptap 3.27 / prosemirror**, парсинг через markdown-it. Монорепозиторий:
`app/` + `core/` (общий фронт), `apps/tauri` (desktop, Rust-плагины в
`apps/tauri/plugins/`), `apps/web` (web-версия на том же коде), `crates/` (Rust FS),
`core/extensions/markdown/` — все markdown-расширения.

### ВАЖНО: лицензия GPL-3.0

`LICENSE` — GNU GPL v3. Копировать код gramax буквально в vasyavig нельзя
(сделает производный код GPL). Заимствуем **идеи, архитектурные приёмы и названия
библиотек**, реализацию пишем свою.

---

## 1. Локальные изображения в Markdown

### 1.1 Механизм целиком

Gramax **не использует** встроенный asset protocol Tauri и `tauri-plugin-fs`.
Зарегистрирован **собственный URI-scheme `gx-fs://`** в Rust-плагине:

```rust
// apps/tauri/plugins/plugin-gramax-core/src/lib.rs
#[cfg(not(target_os = "linux"))]
let builder = builder.register_asynchronous_uri_scheme_protocol("gx-fs", |_, req, responder|
    responder.respond(handle_req(req)));
```

Хендлер `handle_req`:
- декодирует %-encoding пути из `req.uri().path()[1..]`;
- требует заголовок `x-fs-ctx` — URL-encoded JSON scope (`{kind:"disk", root}` или
  `{kind:"git", repo, scope}`); без него — 400;
- `GET` → чтение файла → 200 `application/octet-stream`; `POST` → запись;
- CORS-заголовки `access-control-allow-origin: *`, ответы на `OPTIONS` — чтобы
  `fetch` из WebView работал.

Песочница — не через Tauri runtime scope, а своя проверка на каждый запрос
(`crates/fs/src/backend/mod.rs`):

```rust
pub fn sandbox_resolve(root: &Path, path: &Path) -> Result<PathBuf> {
    let joined = if path.is_absolute() { path.to_path_buf() } else { root.join(path) };
    let normalized = lexically_normalize(&joined);
    if !normalized.starts_with(&lexically_normalize(root)) { /* err: would_escape */ }
    Ok(normalized)
}
```

Фронтенд читает байты единственным местом с `convertFileSrc`
(`app/resolveModule/rustcall/tauri.ts`):

```ts
const readRes = await fetch(convertFileSrc(relPath, "gx-fs"), {
    headers: { "x-fs-ctx": encodeURIComponent(JSON.stringify(scope)) },
});
if (readRes.ok) return await readRes.arrayBuffer();
```

Дальше байты → `new Blob([buffer], {type: resolveFileKind(buffer)})` →
`URL.createObjectURL(blob)` → `<img src="blob:...">`
(`core/extensions/markdown/elements/image/render/components/ImageRenderer.tsx`).
В WebView файл никогда не грузится по прямому пути — только blob-URL.

### 1.2 Ключевой приём: src не переписывается

В prosemirror-ноду картинки кладутся **два атрибута**
(`core/extensions/markdown/elements/image/edit/model/imageToken.ts`):

- `src` — сырой путь из markdown, как был; именно он сериализуется обратно в файл;
- `renderSrc` — URL для показа (в desktop-редакторе вообще `undefined`,
  т.к. показ идёт через blob); при сохранении отбрасывается
  (`imageNodeFormatter.ts` пишет только `node.attrs.src`).

Резолвинг относительного пути — **против каталога самого документа**, не корня
проекта (`ResourceManager.getAbsolutePath`: `rootPath.join(articleDir).join(src)`),
`./`, `../` и корневой префикс `...` нормализуются своим `Path`
(`core/logic/FileProvider/Path/Path.ts`).

### 1.3 Особые случаи

| Случай | Как обработано |
|---|---|
| внешние ссылки | regex `isExternalLink`: `^[#?]`, `^\w+:` (http, data, mailto…), `/api` — пропускаются без резолвинга; в Tauri качаются Rust-хттп-клиентом в обход CORS |
| %-encoding / кириллица | `encodeURIComponent` в query, `decodeURIComponent` с try/catch (одиночные `%` не роняют); gx-fs-хендлер декодирует путь повторно |
| MIME/SVG | content-sniffing по magic bytes: SVG = первый байт `0x3c` или BOM → `image/svg+xml` (`core/ui-logic/utils/resolveFileKind.ts`) |
| GIF | отдельный компонент с play/pause, грузится без lazy |
| битые картинки | `ResourceError` → компонент ошибки; проверка git-LFS-pointer (`isLikelyLfsPointer`) |
| lazy loading | IntersectionObserver, `rootMargin: 600px` (`useElementInViewport`), latched |
| вставка из буфера | файл пишется рядом со статьёй (`createImages.ts` → `/api/article/resource/set`), в markdown — относительный `src`; src с пробелом оборачивается в `<...>` |

### 1.4 Вывод для vasyavig (Phase 5)

Брать **идеи**, не транспорт:

- разделение «сырой `src` в файл» / «переписанный URL только для показа» —
  главное заимствование; в vasyavig это nodeView в WYSIWYG + DOM-проход в
  `SplitPreview.tsx`, но НЕ `normalizeLink` (кругооборот в сохраняемый markup —
  урок Phase 4);
- база резолвинга = каталог открытого файла (уже так в `_docs_/roadmap.md`);
- regex-фильтр внешних ссылок (`^\w+:` и т.п.) — не трогаем http/data;
- аккуратность с %-encoding кириллицы (стыкуется с `restoreCyrillicUrls`);
- в беклог: вставка картинки из буфера (write path), lazy loading, индикатор
  битых изображений.

Не брать: кастомный `gx-fs`-протокол + blob-URL + in-process API-слой. Это нужно
gramax из-за мультиплатформенности (web на WASM-FS, Next-рендер, git-fs, LFS).
Vasyavig достаточно встроенного asset protocol: конфиг
`app.security.assetProtocol` + runtime-грант scope (~20 строк Rust) +
`convertFileSrc` из уже установленной `@tauri-apps/api`.

---

## 2. Mermaid

### 2.1 Механизм

Расширение: `core/extensions/markdown/elements/diagrams/` (общее для mermaid и
plant-uml). Библиотека: **`mermaid ^11.10` (11.12.3)**, рендеринг **100%
client-side**, библиотека грузится лениво (`await import("mermaid")` — ~1 МБ
code-split).

Ядро — `diagrams/mermaid/getMermaidDiagram.ts` (файл целиком короткий):

```ts
const mermaid = await import("mermaid");
const diagramId = `mermaidGraph-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const container = document.createElement("div");
document.body.appendChild(container);        // offscreen temp container
try {
    const {svg} = await mermaid.default.render(diagramId, diagramContent, container);
    return svg;
} catch (error) {
    // динамический импорт не скачался -> "нет интернета"
    // иначе -> "невалидный синтаксис", error.cause = текст ошибки mermaid
} finally {
    container.remove();
}
```

- **Темизация без `mermaid.initialize`**: мермейд всегда дефолтная светлая тема,
  а тёмный режим решается CSS — карточка диаграммы остаётся светлой
  (`--color-diagram-bg: #ffffff` / `#f6f8fa`, `.diagram-background`).
- Ошибки → `AlertError` с локализованным заголовком «(mermaid)», текст ошибки
  мермейда — в `error.cause`.

### 2.2 Пайплайн markdown → показ

- ``` ```mermaid ``` фенс парсится как обычный code_block, затем node-transformer
  (`diagrams/logic/transformer/diagramsNodeTransformer.ts`) превращает его в ноду
  `diagrams` с attrs `{content, diagramName, title, width, height}`; язык может
  нести заголовок: ` ```mermaid:Title `.
- **Два способа хранения**: inline (`attrs.content`) или файл-ресурс
  (`attrs.src` → XML-тег `<mermaid path="..." title="..." width height/>`).
- WYSIWYG: ReactNodeView `DiagramsComponent.tsx` — вокруг SVG-рендера
  `BlockActionPanel` (hover-действия: edit, comment, float) +
  `ArticleComponentResizer` (драг-скейл). SVG инжектится
  `dangerouslySetInnerHTML` (`DiagramRender.tsx`). Skeleton на время загрузки.
- **Редактор исходника**: модалка `DiagramsEditor.tsx` — Monaco слева
  (language="mermaid", темы light/dark), живое превью справа (тот же
  `getMermaidDiagram`), debounce 1 c (plant-uml) / сразу (mermaid); при
  сохранении обновляются width/height ноды.
- Lazy: `useElementInViewport(rootMargin: 600px)` — вне вьюпорта диаграмма не
  рендерится вовсе.
- Экспорт PDF/Word: SVG → base64-растр; в headless-средах (next/cli) —
  деградация в текстовый блок с исходником.

### 2.3 Вывод для vasyavig

Vasyavig уже рендерит mermaid в превью (`SplitPreview.tsx` — diplodoc transform +
mermaid). Из gramax стоит взять позже:

- **рендер mermaid прямо в WYSIWYG** (nodeView на code-block с language=mermaid:
  SVG + skeleton + hover-действия) — сейчас в WYSIWYG диаграмма, вероятно, только
  код;
- **модалка-редактор исходника с Monaco + живым превью** — у нас Monaco уже
  подключён (`MonacoViewer.tsx`);
- приёмы: ленивый `import("mermaid")`, offscreen-контейнер с `finally remove()`,
  уникальный id `Date.now()+random`, CSS-темизация вместо mermaid-theming,
  дружелюбные ошибки («нет интернета» vs «невалидный синтаксис»).

---

## 3. Таблицы «в стиле Notion»

### 3.1 Что имеется

Всё в `core/extensions/markdown/elements/table/`. UX: hover-полоски управления у
строк/столбцов, кнопки «+» для вставки строки/столбца, меню «…» (удалить,
выравнивание, header row/column, агрегация sum/avg), угловая кнопка
«выделить всю таблицу», ресайз колонок драгом, merged cells, сортировка/фильтры
в шапке. Перетаскивания строк/столбцов НЕТ — только ресайз колонок.

### 3.2 Стек и архитектура

- **`prosemirror-tables ^1.8` (1.8.5)** + **`@tiptap/extension-table ^3.27`** —
  базовые ноды `table`/`tableRow`/`tableCell` расширяются кастомом
  (`edit/model/nodes/customTable.ts` и др.).
- Ноды: `table` (attrs `header: row|column|both|none`, `sortingOrder`),
  `tableCell` (`colspan, rowspan, colwidth, align, aggregation, filter, sort`);
  контент ячейки — `block+` (в ячейках любой блочный контент).
- Вся Notion-подобная обвязка — **кастомный React** поверх nodeView:
  - `edit/components/TableComponent.tsx` — сама таблица (contentDOM = tbody);
  - `Helpers/TableHelper.tsx` — hover-механика (mousemove + rAF, показ/скрытие
    полосок через CSS-класс `!hidden`);
  - `Helpers/TablePlusActions.tsx` — оверлей-сетка контролов (CSS grid на
    `--table-grid-template-columns/rows`), прячется во время драга ресайза;
  - `Helpers/PlusMenu.tsx` — меню строки/столбца: удаление с hover-подсветкой
    через prosemirror-декорации, align, header-флаги, агрегация;
  - `Helpers/ColGroup.tsx` — `<colgroup>` из attrs, ResizeObserver, CSS-var
    `--table-width` для Safari.
- **Ресайз колонок** — своя копия плагина columnResizing из prosemirror-tables
  (`edit/model/columnResizing/columnResizing.ts`): при драге читает текущие
  ширины из DOM `<colgroup>`, пишет целочисленные `colwidth` в attrs ячеек
  через `tr.setNodeMarkup` (с учётом colspan-распределения). Min width 48px.

### 3.3 Хранение и round-trip

Три формата сериализации (`edit/logic/formatters/`):

1. **GFM pipe-таблица** — если таблица «простая» (`tableIsSimple`: header=row,
   каждая ячейка = один инлайн-абзац, нет colspan/rowspan/align/colwidth);
2. **XML `<table><tr><td colspan rowspan align ...>`** — полная точность
   (`<colgroup><col width>` при наличии colwidth);
3. **legacy `{% table %}`** — выбор по настройке каталога.

Выбор формата при сохранении — `tableFormatter.ts` → `TableUtils.tableIsSimple`.
Обратно GFM-токены переименовываются transformer-ом (`tr`→`tableRow` и т.д.).
Импорт-адаптеры: Confluence-формат и **импорт из Notion**
(`table/notion/*` — это про импорт, не про UX).

### 3.4 Вывод для vasyavig

Самая тяжёлая из трёх тем для портирования: gramax-таблицы — это большой пласт
кастомного React + tiptap-нод + своя копия columnResizing. Vasyavig сидит на
Gravity UI markdown-editor (свой PM-схем YFM-таблиц + `@gravity-ui/table`-подобные
компоненты в wysiwyg). Перенос мыслим двумя путями:

- **минимальный**: доработка отображения существующих YFM-таблиц в WYSIWYG
  (ресайз колонок через prosemirror-tables-подход с `colwidth`-attrs, кнопки
  «+» у строк/столбцов как оверлей) — заметная самостоятельная работа;
- **полный Notion-UX** (hover-меню, агрегация, merged cells, XML-формат
  хранения) — фактически отдельная большая фаза; требует решения о формате
  хранения не-простых таблиц (gramax решает через XML/YFM-расширения).

Заимствуемые приёмы без спора: `colwidth` в attrs ячеек как источник правды для
`<colgroup>`; простая-таблица → GFM / сложная → расширенный синтаксис при
сохранении; подсветка удаляемой строки/столбца через PM-декорации; min width
колонки; скрытие hover-контролов на время драга.

---

## 4. Сводка: что брать в vasyavig

| Тема | Фаза vasyavig | Что заимствуем | Что НЕ берём |
|---|---|---|---|
| Изображения | Phase 5 (текущая) | src/renderSrc-подход; база = каталог файла; regex внешних ссылок; %-encoding-гигиена | gx-fs-протокол, blob-URL, in-process API; используем встроенный asset protocol |
| Mermaid | беклог/будущая фаза | рендер в WYSIWYG через nodeView; модалка Monaco+live preview; lazy import; CSS-темизация; дружелюбные ошибки | XML-тег `<mermaid path>` и хранение диаграмм файлами (пока не нужно) |
| Таблицы Notion | беклог/большая фаза | colwidth-attrs + colgroup; простая→GFM/сложная→XML; PM-декорации для подсветки; hover-контролы как оверлей | тиражировать их кастомный columnResizing и весь UX-слой без адаптации к Gravity-схеме |

Ограничение на всё: **GPL-3.0** — только идеи и паттерны, код пишем свой.

## 5. Индекс ключевых файлов gramax

| Что | Путь |
|---|---|
| Регистрация gx-fs протокола | `apps/tauri/plugins/plugin-gramax-core/src/lib.rs` |
| Песобница FS | `crates/fs/src/backend/mod.rs` (`sandbox_resolve`) |
| Чтение байтов на фронте | `app/resolveModule/rustcall/tauri.ts` |
| Картинка: парс-хук (src/renderSrc) | `core/extensions/markdown/elements/image/edit/model/imageToken.ts` |
| Картинка: рендер + blob | `core/extensions/markdown/elements/image/render/components/ImageRenderer.tsx` |
| Ресурс-лоадер | `core/ui-logic/ContextServices/ResourceService/hooks/useGetResource.ts` |
| Резолв путей | `core/logic/Resource/ResourceManager.ts`, `core/logic/FileProvider/Path/Path.ts` |
| Вставка из буфера | `core/extensions/markdown/elements/image/edit/logic/createImages.ts` |
| Mermaid: рендер-функция | `core/extensions/markdown/elements/diagrams/diagrams/mermaid/getMermaidDiagram.ts` |
| Mermaid: нода WYSIWYG | `core/extensions/markdown/elements/diagrams/edit/{models,components}/` |
| Mermaid: модалка-редактор | `core/extensions/markdown/elements/diagrams/edit/components/DiagramsEditor.tsx` |
| Таблицы: всё | `core/extensions/markdown/elements/table/` |
| Таблицы: UX-компоненты | `core/extensions/markdown/elements/table/edit/components/Helpers/` |
| Таблицы: сериализация | `core/extensions/markdown/elements/table/edit/logic/formatters/` |
