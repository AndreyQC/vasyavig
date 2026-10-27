# Реализация `ulid:`-ссылок в превью и WYSIWYG — план (Phase 7, задача 3.1)

> Контекст:
> - `_docs_/_tasks_/2026-10-27/20261027_001_ulid_body_links_result.md` — решение по формату C
> - `_docs_/_tasks_/2026-10-27/20261027_001_ulid_body_links_plan.md` — протокол прототипа
> - `_docs_/roadmap.md` — Phase 7, задачи 3-4
> - `_docs_/_checkpoints_/20261026_003_checkpoint.md`
> - `LESSONS_LEARNED.md` §3, §10-§15

**Дата:** 2026-10-27
**Статус:** план
**Фаза:** Phase 7 — Harness, задача 3.1 (следствие задачи 3)
**Формат:** `[<имя файла>](ulid:<ULID>)`, ссылка на якорь — `ulid:<docULID>#<anchorULID>`

## 1. Цель и границы

**Цель.** Ссылки `[имя файла](ulid:…)` в превью и WYSIWYG: кликабельные,
открывают документ; при наведении — плашечка с метаданными из реестра.
Существующие голые ULID продолжают работать без миграции.

**Не входит:**

- Markup-режим (подсветка/клик в CodeMirror) — задача 4.
- Автодополнение и UI-вставка ссылки — отдельная задача (Q2/Q8).
- Переход к якорю `#<anchorULID>` — только открытие документа, фрагмент
  игнорируется до реализации якорей (Q9).
- Write-path, граф, дашборд (задачи 5-7).

## 2. Изменения по файлам

| Файл | Изменение |
|---|---|
| `src/lib/harnessUlidLink.ts` (новый) | `parseUlidHref`, `buildUlidHref`, `isUlidHref`: разбор `ulid:<ULID>[#<ULID>]` с валидацией Crockford и окна таймстемпа (переиспользовать `harnessEnvelope.ts`) |
| `src/lib/previewLinks.ts` (новый) | константы `PREVIEW_ALLOWED_SCHEMES`, `PREVIEW_SAFE_URI_RE`; DOM-проход `linkifyUlidLinksInElement` (из `href` -> `data-ulid`, класс, снятие href) — тестируемо без React |
| `src/components/EditorArea/SplitPreview.tsx` | `transform(..., {sanitizeOptions: {allowedSchemes: PREVIEW_ALLOWED_SCHEMES}})`; DOMPurify с `PREVIEW_SAFE_URI_RE`; вызов `linkifyUlidLinksInElement` до sanitize; hover-делегирование для плашечки |
| `src/lib/harnessUlidExtension.ts` | декорации для `link`-марок с `href^="ulid:"` (второй проход); пропуск сырых ULID внутри ссылок; клик и hover через `handleDOMEvents` |
| `src/components/HarnessUlidPopover.tsx` (новый) | плашечка: поля реестра, действия, позиционирование, Esc/scroll, задержка появления |
| `src/components/EditorArea/EditorArea.css` | стили: `.ulid-link`, `.ulid-unknown` (есть), popover, бейдж «якорь» |
| `src/locales/ru/translation.json`, `src/locales/en/translation.json` | строки плашечки, действий, «якорь — позже», неизвестный ULID |

## 3. Детали реализации

### 3.1. Разбор href

- `ulid:<26>` -> `{ulid}`, `ulid:<26>#<26>` -> `{ulid, anchor}`.
- Валидация: алфавит Crockford, окно таймстемпа 2020-2100 (как `findUlidMatches`).
- Некорректный href -> `null`: ссылка остаётся обычной `<a>` с `href`, не
  трогаем (не ломаем чужие схемы).

### 3.2. Превью

1. `transform`: добавить `ulid` в `sanitizeOptions.allowedSchemes` (иначе
   `sanitize-html` вырезает href — проверено прототипом).
2. `ASSET_SAFE_URI_RE` расширить до `PREVIEW_SAFE_URI_RE` (`asset|ulid`).
3. До `DOMPurify.sanitize` пройти `a[href^="ulid:"]`:
   - валидный ULID: `data-ulid`, класс `ulid-link`, `href` **снять** (чтобы
     WebView не пытался открыть неизвестную схему), текст не менять;
   - неизвестный: класс `ulid-unknown`, `data-ulid-unknown`, href снять.
4. Клик — существующее делегирование `a[data-ulid]` в `SplitPreview.tsx`
   (строка ~119); для `data-anchor` — открыть документ и показать toast
   «переход к якорю появится позже».
5. Hover — делегирование `mouseover`/`mouseout` на контейнере превью,
   позиция — `getBoundingClientRect` элемента ссылки.

### 3.3. WYSIWYG

1. `buildUlidDecorations`: два прохода.
   - сырые ULID в тексте — как сейчас, но **пропускать диапазоны внутри
     `link`-марок** (иначе двойная подсветка `data-ulid` в ссылке);
   - текст с `link`-маркой, у которой `href^="ulid:"` — декорация
     `ulid-link`/`ulid-unknown` с `data-ulid` (и `data-anchor`, если есть).
2. Клик: `handleDOMEvents.click` — `closest("a[href^='ulid:']")` или
   `[data-ulid]`; `preventDefault()` + резолв + `openFile`.
3. Hover: `mouseover`/`mouseout` на декорациях/`<a>` — показать плашечку.
4. Пересборка — уже есть по `tr.docChanged` и `version` реестра
   (`harnessUlidExtension.ts`), менять не нужно.

### 3.4. Плашечка

- Содержимое: `title`, бейдж `type`, `project`, путь от корня, `created`,
  `updated`, `related`/`based_on` (именами), действия «Открыть», «Связи».
- Неизвестный ULID: «нет в реестре» + подсказка `doc-index`; без действий.
- Появление через 300-500 мс, закрытие по уходу мыши/Esc/скроллу; портал в
  `body`; переворот при нехватке места.
- Данные — `resolveFor(dir, ulid)` из `harnessStore` (синхронно, кэш);
  подписка на `version` — примитив (урок §3), без новых объектов в селекторе.

## 4. Тесты и проверки

- `src/lib/harnessUlidLink.test.ts`: валидные/невалидные/префиксные href,
  `#anchor`, чужие схемы -> `null`.
- `src/lib/previewLinks.test.ts`: `transform` с `allowedSchemes` сохраняет
  `href`; DOMPurify с `PREVIEW_SAFE_URI_RE` сохраняет; постпроцесс ставит
  `data-ulid` и снимает `href`.
- `src/lib/harnessUlidExtension.test.ts`: декорации по `link`-марке, пропуск
  сырых ULID внутри ссылки, известный/неизвестный.
- `src/lib/harnessRoundTrip.test.ts`: добавить кейс `[имя](ulid:…)` — контракт
  формата не должен регрессировать.
- `pnpm test` — 238 + новые, все зелёные.
- `npx tsc --noEmit` — чисто; `npx vite build` — ок.
- Ручная GUI-приёмка (чек-лист ниже).

**GUI-чек-лист:**

- [ ] Превью: клик по `[имя](ulid:…)` открывает документ; наведение — плашечка
      с title/type/project/путём/датами/связями.
- [ ] WYSIWYG: то же; каретка при клике не прыгает; переход не открывает
      системный браузер.
- [ ] Неизвестный ULID: пунктир, плашечка «нет в реестре», перехода нет.
- [ ] Голый ULID в тексте по-прежнему кликабелен (backward compat).
- [ ] `https://`-ссылки и относительные пути работают как раньше.
- [ ] Ссылка внутри YFM-note и таблицы кликабельна и переживает round-trip.
- [ ] Ссылка с `#anchor`: документ открывается, тост про якорь.
- [ ] Тема светлая/тёмная, ru/en.

## 5. Риски

| Риск | Митигация |
|---|---|
| Расширение `allowedSchemes`/`ALLOWED_URI_REGEXP` ослабляет санитайз | Добавляем только `ulid`; `javascript:`/`data:` остаются запрещены — тест |
| Клик по `<a href="ulid:…">` в WYSIWYG уводит WebView | `preventDefault` + снятие href в превью; тест GUI |
| Двойная подсветка (сырой ULID + ссылка) | Пропуск диапазонов внутри `link`-марок; тест |
| Плашечка ломает layout/скролл | Портал в `body`, fixed-позиционирование, закрытие по скроллу |
| Gravity переэкранирует текст ссылки при правке | Round-trip тест `[имя](ulid:…)`, включая пробелы/кириллицу |
| `data-ulid` в ссылке конфликтует с `linkifyUlidsInElement` | Проход по ссылкам — до линкификации сырых ULID; `a` уже пропускается |

## 6. Коммиты

- `feat(harness): кликабельные ulid:-ссылки в превью и WYSIWYG` — код + тесты.
- `docs(tasks): 20261027_002 ... — результат` — отдельно, после приёмки.
- Документы и код не смешивать (TASK_CONVENTIONS §6).
