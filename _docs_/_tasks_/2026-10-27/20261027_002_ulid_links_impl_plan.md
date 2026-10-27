# Реализация `harness-ulid:`-ссылок в превью и WYSIWYG — план (Phase 7, задача 3.1)

> Контекст:
> - `_docs_/_tasks_/2026-10-27/20261027_001_ulid_body_links_result.md` — решение по формату C
> - `_docs_/_tasks_/2026-10-27/20261027_001_ulid_body_links_plan.md` — протокол прототипа
> - `_docs_/_tasks_/2026-10-27/20261027_003_ulid_scheme_harness_ulid.md` — финальная схема
> - `_docs_/roadmap.md` — Phase 7, задачи 3-4
> - `LESSONS_LEARNED.md` §3, §10-§15

**Дата:** 2026-10-27
**Статус:** реализовано и принято; схема финализирована (`harness-ulid:`)
**Фаза:** Phase 7 — Harness, задача 3.1 (следствие задачи 3)
**Формат:** `[<имя файла>](harness-ulid:<ULID>)`, ссылка на якорь —
`harness-ulid:<docULID>#<anchorULID>`; legacy `harness_ulid:`/`ulid:` читаются.

## 1. Цель и границы

**Цель.** Ссылки `[имя файла](harness-ulid:…)` в превью и WYSIWYG: кликабельные,
открывают документ; при наведении — плашечка с метаданными из реестра.
Существующие голые ULID продолжают работать без миграции.

**Не входит:**

- Markup-режим — задача 4 (реализована, `c928a20`).
- Автодополнение и UI-вставка ссылки — отдельная задача (Q2/Q8).
- Переход к якорю `#<anchorULID>` — только открытие документа, фрагмент
  игнорируется до реализации якорей (Q9).
- Write-path, граф, дашборд (задачи 5-7).

## 2. Изменения по файлам

| Файл | Изменение |
|---|---|
| `src/lib/harnessUlidLink.ts` (новый) | `parseUlidHref`, `buildUlidHref`, `isUlidHref`: `harness-ulid:<ULID>[#<ULID>]` + legacy-схемы, валидация Crockford и окна таймстемпа |
| `src/lib/previewLinks.ts` (новый) | `PREVIEW_ALLOWED_SCHEMES`, `PREVIEW_SAFE_URI_RE`; DOM-проход `linkifyUlidLinksInElement` (`href` -> `data-ulid`, класс, снятие href) — тестируемо без React |
| `src/components/EditorArea/SplitPreview.tsx` | transform с `sanitizeOptions.allowedSchemes`; DOMPurify с `PREVIEW_SAFE_URI_RE`; вызов `linkifyUlidLinksInElement` до sanitize; две линкификации; клик с `data-anchor` |
| `src/lib/harnessUlidExtension.ts` | декорации по `link`-маркам с `href^="harness-ulid:"` (и legacy); пропуск сырых ULID внутри ссылок и код-блоков; клик через `handleDOMEvents` |
| `src/components/HarnessUlidPopover.tsx` (новый) | плашечка: поля реестра, связи, позиционирование, Esc/scroll, задержка появления |
| `src/components/EditorArea/EditorArea.css` | стили `.ulid-link`, `.ulid-unknown`, `.ulid-popover` |
| `src/locales/ru/translation.json`, `src/locales/en/translation.json` | строки плашечки, «якорь — позже», неизвестный ULID |

## 3. Детали реализации

### 3.1. Разбор href

- `harness-ulid:<26>` -> `{ulid}`, `harness-ulid:<26>#<26>` -> `{ulid, anchor}`.
- Legacy `harness_ulid:` и `ulid:` читаются тем же парсером; `buildUlidHref`
  пишет только `harness-ulid:`.
- Валидация: алфавит Crockford, окно таймстемпа 2020-2100.
- Некорректный href -> `null`: ссылка остаётся обычной `<a>` с `href`, не
  трогаем (не ломаем чужие схемы).

### 3.2. Превью

1. `transform`: `harness-ulid` в `sanitizeOptions.allowedSchemes` (валидная
   схема иначе вырезается `sanitize-html`); legacy-схемы тоже разрешены.
2. `PREVIEW_SAFE_URI_RE`: `asset|harness-ulid|harness_ulid|ulid`.
3. До `DOMPurify.sanitize` пройти `a[href^="harness-ulid:"]` (и legacy):
   - валидный ULID: `data-ulid`, класс `ulid-link`, `href` **снять** (чтобы
     WebView не пытался открыть схему), текст не менять;
   - неизвестный: класс `ulid-unknown`, `data-ulid-unknown`, href снять.
4. Клик — делегирование `a[data-ulid], [data-ulid-unknown]` в `SplitPreview.tsx`;
   для `data-anchor` — открыть документ и показать toast.
5. Hover — общая плашечка (`HarnessUlidPopover`) по `data-ulid-dir`.

### 3.3. WYSIWYG

1. `buildUlidDecorations`: два прохода.
   - сырые ULID в тексте — как раньше, но **пропускать диапазоны внутри
     `link`-марок** (иначе двойная подсветка);
   - текст с `link`-маркой и `href^="harness-ulid:"` — декорация
     `ulid-link`/`ulid-unknown` с `data-ulid` (и `data-anchor`, если есть).
2. Клик: `handleDOMEvents.click` — `closest("a[href^='harness-ulid:']")` или
   `[data-ulid]`; `preventDefault()` + резолв + `openFile`.
3. Hover — общая плашечка (декорации несут `data-ulid-dir`).
4. Пересборка — по `tr.docChanged` и `version` реестра.

### 3.4. Плашечка

- Содержимое: `title`, бейдж `type`, `project`, путь от корня, `created`,
  `updated`, `related`/`based_on` (именами), действий «Открыть» + чипы связей.
- Неизвестный ULID: «нет в реестре» + подсказка `doc-index`; без действий.
- Появление через 350 мс, закрытие по уходу мыши/Esc/скроллу; портал в `body`;
  переворот при нехватке места.
- Данные — `resolveFor(dir, ulid)` из `harnessStore` (синхронно, кэш);
  подписка на `version` — примитив (урок §3).

## 4. Тесты и проверки

- `src/lib/harnessUlidLink.test.ts`: новая схема, legacy `harness_ulid:`/`ulid:`,
  `#anchor`, невалидные/чужие схемы -> `null`, `buildUlidHref`.
- `src/lib/previewLinks.test.ts`: transform с allow-list сохраняет
  `harness-ulid:`; без конфигурации — режет; legacy `harness_ulid:` проходит
  как относительный путь, `ulid:` — нет; DOMPurify сохраняет, `javascript:`
  режет; постпроцесс ставит `data-ulid` и снимает `href`.
- `src/lib/harnessUlidExtension.test.ts`: декорации по `link`-марке, пропуск
  сырых ULID внутри ссылки, код-блоки, инлайн-код закладки.
- `src/lib/harnessRoundTrip.test.ts`: `[имя](harness-ulid:…)` и якорь — контракт
  формата не должен регрессировать.
- `pnpm test` — **270 passed / 25 файлов** (на конец 2026-10-27, с задачей 4);
  на момент 3.1 было 259/24.
- `npx tsc --noEmit` — чисто; `npx vite build` — ок.
- Ручная GUI-приёмка пройдена (см. result 20261027_002).

## 5. Риски

| Риск | Митигация |
|---|---|
| Ослабление санитайза | Разрешены только `harness-ulid` + legacy; `javascript:`/`data:` запрещены — тест |
| Клик по `<a href="harness-ulid:…">` в WYSIWYG уводит WebView | `preventDefault` + снятие href в превью; тест GUI |
| Двойная подсветка (сырой ULID + ссылка) | Пропуск диапазонов внутри `link`-марок; тест |
| Плашечка ломает layout/скролл | Портал в `body`, fixed-позиционирование, закрытие по скроллу |
| Gravity переэкранирует текст ссылки при правке | Round-trip тест, включая пробелы/кириллицу |
| `data-ulid` конфликтует с `linkifyUlidsInElement` | Проход по ссылкам — до линкификации сырых ULID; `a` уже пропускается |

## 6. Коммиты

- `5b39af9` — `feat(harness): кликабельные ulid:-ссылки…` (историческая схема).
- `2ec3c54` — `fix(harness): не затирать классы ulid-ссылки`.
- `cd071dc` — переход на `harness_ulid:`.
- `989ca86` — финальная валидная схема `harness-ulid:`.
- Документы и код не смешивались (TASK_CONVENTIONS §6).
