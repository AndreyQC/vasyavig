# ULID-ссылки в Markup-режиме — план (Phase 7, задача 4)

> Контекст:
> - `_docs_/_tasks_/2026-10-27/20261027_002_ulid_links_impl_result.md` — ссылки в превью/WYSIWYG
> - `_docs_/_tasks_/2026-10-27/20261027_003_ulid_scheme_harness_ulid.md` — схема `harness-ulid:`
> - `_docs_/roadmap.md` — Phase 7, задача 4
> - `_docs_/_checkpoints_/20261027_004_checkpoint.md`

**Дата:** 2026-10-27
**Статус:** реализовано (`c928a20`), ждёт GUI-приёмки
**Фаза:** Phase 7 — Harness, задача 4

## 1. Цель и границы

**Цель.** В Markup-режиме (CodeMirror) подсветить ULID-ссылки и сделать их
кликабельными: известные открывают документ, неизвестные — `ulid-unknown`
без перехода. Формат — `harness-ulid:<ULID>[#<anchor>]` (+ legacy), тот же,
что в превью и WYSIWYG.

**Не входит:** автодополнение, переход к якорю, bare-ULID в Markup,
write-path.

## 2. Решения

- **Точка расширения.** `useMarkdownEditor({markupConfig: {extensions}})` —
  Gravity 15.44 отдаёт массив CodeMirror 6 extensions.
- **Прямые зависимости.** `@codemirror/view`, `@codemirror/state` добавлены в
  `package.json` (нужны для `ViewPlugin`/`Decoration`); версии дедуплицированы
  с `markdown-editor` (по одной копии пакетов).
- **Что подсвечиваем.** Только href-токены `harness-ulid:`/`harness_ulid:`/
  `ulid:` с валидным ULID. Голые ULID в Markup не трогаем: иначе подсветятся
  `id:`/`related:`/`based_on` в конвертах и списках связей.
- **Код-блоки.** Fenced-блоки (``` и ~~~) исключаются: внутри них ссылки не
  подсвечиваются.
- **Клик.** `EditorView.domEventHandlers.click` -> `closest("[data-ulid]…")`
  -> `openUlidTarget(dir, ulid, anchor?)`; `preventDefault`, чтобы WebView не
  уходил по неизвестной схеме.
- **Плашечка.** Переиспользуется общая `HarnessUlidPopover`: декорации несут
  `data-ulid-dir`/`data-ulid`, глобальное делегирование уже умеет их читать.
- **Обновление.** Пересборка декораций по `docChanged` и по `version` реестра
  (подписка в `ViewPlugin`).

## 3. Изменения по файлам

| Файл | Изменение |
|---|---|
| `src/lib/harnessUlidMarkupExtension.ts` (новый) | `findMarkupUlidRanges` (regex + валидация + fenced-блоки), `buildMarkupDecorations`, `ViewPlugin`, `click`-хендлер |
| `src/components/EditorArea/MarkdownEditor.tsx` | `markupConfig.extensions: harnessUlidMarkupExtension(path)` |
| `src/lib/harnessUlidMarkupExtension.test.ts` (новый) | 8 тестов: поиск, legacy, невалидные, fenced, известный/неизвестный, якорь |
| `package.json`, `pnpm-lock.yaml` | `@codemirror/view`, `@codemirror/state` |

## 4. Проверки

- `pnpm test` — **270 passed / 25 файлов** (было 262/24).
- `npx tsc --noEmit` — чисто.
- `npx vite build` — ок (прежние предупреждения о размерах чанков).

**GUI-чек-лист (Markup):**

- [ ] Ссылка `harness-ulid:…` подсвечена как ссылка; наведение — плашечка.
- [ ] Клик открывает документ; каретка/выделение не ломаются.
- [ ] Якорь `#…`: документ открывается, тост про якорь.
- [ ] Неизвестный ULID: пунктир, уведомление, перехода нет.
- [ ] Legacy `harness_ulid:`/`ulid:` подсвечиваются.
- [ ] Внутри ```-блока ссылка не подсвечивается.
- [ ] Обычные `[текст](https://…)` не затронуты.
- [ ] Тема светлая/тёмная.

## 5. Риски

| Риск | Митигация |
|---|---|
| Две копии CodeMirror -> декорации не применяются | Прямые deps; проверено, что в `node_modules/.pnpm` по одной версии |
| Клик мешает выделению текста | `preventDefault` только на ULID-токене; остальное обрабатывает CM |
| Полный скан документа на каждый keystroke | Линейный regex; реестр резолвится только для найденных ULID; при необходимости — debounce |
| `markupConfig.extensions` не применяется | Проверить GUI: markup-режим — отдельный CM-экземпляр; split использует WYSIWYG + превью |
| Подсветка шума из конвертов | Сканируются только href-токены, голые ULID не трогаем |

## 6. Что дальше

После GUI-приёмки — result-документ, обновление roadmap и чекпоинт.
Следующие задачи Phase 7: 5/6 (граф и дашборд), 7 (write-path); якоря — Phase 8.
