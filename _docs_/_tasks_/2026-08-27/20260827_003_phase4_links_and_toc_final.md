# Phase 4: кириллица в ссылках и авто-оглавление (final)

> Дата: 2026-08-27
> Контекст:
> - `_docs_/_tasks_/2026-08-27/20260827_003_phase4_links_and_toc_draft.md` — draft с проработкой
> - `_docs_/roadmap.md` — Phase 4
> - `_docs_/USER_IDEA.md` — пункты 3 и 5

Статус: **final** — все `USER_INPUT` закрыты (§1). Техническая база — draft §1–3;
здесь только решения, отличия от draft и дополнения по итогам изучения кода.

## 1. Решения пользователя (закрытые USER_INPUT)

| # | Вопрос | Решение |
|---|---|---|
| 1 | Уровни заголовков в TOC | **H1–H4** (все) |
| 2 | Существующий блок оглавления | **Модалка «заменить/вставить»**: если блок «Оглавление» найден — спросить; если не найден — сразу вставить новый блок в начало файла |
| 3 | Размещение кнопок | **Панель app-уровня над редактором** — реализуем как кнопки в существующем `MainToolbar` (он и есть эта панель; отдельный ряд не нужен) |

Горячие клавиши: не добавляем.

## 2. Дополнения по итогам изучения кода (отличия от draft)

### 2.1 Якоря превью — транслит, а не github-стиль (важная находка)

Эмпирическая проверка `@diplodoc/transform`:

- дефолтные id заголовков — транслитерация через `slugify`:
  `1. Введение` -> `id="1-vvedenie"`;
- github-стиль с сохранением кириллицы (`id="1-введение"`) появляется только с
  опцией `supportGithubAnchors: true` (добавляет `<a id="...">` внутрь заголовка,
  транслит-id на h-теге сохраняется).

Решение:

- `SplitPreview.tsx`: `transform(content, {supportGithubAnchors: true})` —
  заголовки получают оба якоря; существующие кириллические оглавления в файлах
  пользователя становятся кликабельными в превью.
- `generateToc` использует `github-slugger@1.5.0` — тот же пакет и та же схема
  питания слаггера (один инстанс на документ, заголовки по порядку), что и у
  transform для gh-якорей. Совместимость гарантируется тестом-сверкой против
  `transform(..., {supportGithubAnchors: true})`.

### 2.2 Совместимость слагов с transform — правила репликации

- Текст заголовка = конкатенация `text`/`text_special` inline-токенов (разметка
  не входит), fallback — `inline.content` (как `headingInfo` у transform).
- Custom id `{#id}` (regex transform `/\[?{ ?#(\S+) ?}]?/g`, исключение `[{#T}]`):
  если найден — href TOC = custom id, из заголовка он исключается; иначе —
  `slugger.slug(title)`.
- Слаггер питается **всеми** заголовками (H1–H6) по порядку — чтобы счётчики
  дублей совпали с transform; в список TOC попадают только H1–H4.
- Известное ограничение: заголовки с `{#custom-id}` не потребляют слаг у
  transform — реплицируем (не кормим слаггер).

### 2.3 Кнопки — в `MainToolbar`

Новые кнопки «Восстановить кириллицу» и «Оглавление» в левую часть
`MainToolbar.tsx` (видны только для markdown-вкладок). Логика — в hook
`src/hooks/useMarkdownTools.ts`.

### 2.4 Модалка TOC

- `uiStore`: транзитный `pendingTocPath: string | null` (не в `partialize`).
- `TocModal.tsx` по паттерну `ConvertModal`: кнопки «Заменить блок» /
  «Вставить новый в начало» / «Отмена».
- Если блок «Оглавление»/«Contents» (H1–H2) не найден — модалка не показывается,
  блок `## Оглавление` + список вставляется в начало файла.

### 2.5 Реестр редакторов

`src/lib/editorRegistry.ts`: `Map<path, MarkdownEditorInstance>`,
регистрация в `MarkdownEditor.tsx` (mount/unmount). Кнопки применяют правки
через `editor.replace()` -> `change` -> store -> dirty. Undo: работает в markup,
сбрасывается в wysiwyg (ограничение из draft §3.2).

## 3. Состав изменений (файлы)

| Файл | Изменение |
|---|---|
| `src/lib/preserveUrlsExtension.ts` | новый — extension, `normalizeLink` = identity |
| `src/lib/editorRegistry.ts` | новый — реестр editor-instances по path |
| `src/lib/restoreCyrillicUrls.ts` | новый — декодер %-кириллицы в URL (сканер `](`..`)` с балансом скобок + link reference definitions) |
| `src/lib/generateToc.ts` | новый — TOC из заголовков H1–H4 (github-slugger, custom-id, поиск блока «Оглавление») |
| `src/hooks/useMarkdownTools.ts` | новый — обработчики кнопок |
| `src/components/Modals/TocModal.tsx` | новый — модалка «заменить/вставить» |
| `src/components/Toolbar/MainToolbar.tsx` | + 2 кнопки |
| `src/components/EditorArea/MarkdownEditor.tsx` | + preserveUrlsExtension, регистрация в реестре |
| `src/components/EditorArea/SplitPreview.tsx` | `supportGithubAnchors: true` |
| `src/store/uiStore.ts` | + `pendingTocPath` |
| `src/locales/{ru,en}/translation.json` | строки кнопок/модалки |
| `package.json` | прямые зависимости `markdown-it@13`, `github-slugger@1.5` |
| тесты | `restoreCyrillicUrls.test.ts`, `generateToc.test.ts` (сверка с `transform()`) |

## 4. Проверки

Как в draft §6, дополнительно:

- тест-сверка слагов TOC с `transform(..., {supportGithubAnchors: true})` на
  кириллических заголовках с пунктуацией и дублями;
- тест custom-id (`{#my-id}`) и исключения `[{#T}]`;
- тест модалки не нужен (UI-слой), ручная проверка.

## 5. Риски и ограничения

Из draft §7, без изменений + новые:

- транслит-id на h-тегах остаётся (менять нельзя — обратная совместимость
  ссылок вида `#1-vvedenie`), кириллические якоря добавляются рядом;
- если в документе два одинаковых заголовка разного уровня, счётчики дублей
  могут отличаться от transform, когда между ними заголовок с custom-id
  (реплицировано — считаем одинаково).
