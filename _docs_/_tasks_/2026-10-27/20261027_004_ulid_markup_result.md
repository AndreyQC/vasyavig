# ULID-ссылки в Markup-режиме — результат (Phase 7, задача 4)

> Контекст:
> - `_docs_/_tasks_/2026-10-27/20261027_004_ulid_markup_plan.md` — план и чек-лист
> - `_docs_/_tasks_/2026-10-27/20261027_003_ulid_scheme_harness_ulid.md` — схема `harness-ulid:`
> - `_docs_/roadmap.md` — Phase 7
> - `_docs_/_checkpoints_/20261027_004_checkpoint.md`

**Дата:** 2026-10-27
**Статус:** реализовано, GUI-приёмка пройдена (пользователь, 2026-10-27)
**Фаза:** Phase 7 — Harness, задача 4
**Коммиты:** `c928a20` (код), `0e4b84b` (план)

## 1. Что сделано

| Файл | Изменение |
|---|---|
| `src/lib/harnessUlidMarkupExtension.ts` (новый) | `findMarkupUlidRanges` (regex `harness-ulid:`/`harness_ulid:`/`ulid:` + валидация + fenced-блоки), `buildMarkupDecorations`, `ViewPlugin`, click-хендлер |
| `src/components/EditorArea/MarkdownEditor.tsx` | `markupConfig.extensions: harnessUlidMarkupExtension(path)` |
| `src/lib/harnessUlidMarkupExtension.test.ts` (новый) | 8 тестов: поиск, legacy, невалидные, fenced, известный/неизвестный, якорь |
| `package.json`, `pnpm-lock.yaml` | прямые `@codemirror/view`, `@codemirror/state` (одна версия с markdown-editor) |

Поведение: ссылки `harness-ulid:…` подсвечены, кликабельны, hover показывает
общую плашечку; неизвестный ULID — `ulid-unknown` + уведомление; `#anchor` —
открытие документа + тост; fenced-блоки не трогаются.

## 2. Решения и отклонения

- **Только href-токены.** Голые ULID в Markup не подсвечиваются осознанно:
  иначе загорались бы `id:`/`related:`/`based_on:` в конвертах и списках.
  В превью/WYSIWYG голые ULID остаются кликабельными.
- **Fenced-блоки** (```/~~~) исключены; инлайн-код не исключается (закладка).
- **Клик** через `EditorView.domEventHandlers.click` + `preventDefault`:
  WebView не уходит на неизвестную схему, каретка не ломается.
- **Плашечка** переиспользована без изменений: декорации несут
  `data-ulid-dir`/`data-ulid`, глобальное делегирование их видит.
- **Обновление** декораций — по `docChanged` и по `version` реестра.

## 3. Приёмка

Пользователь проверил в GUI 2026-10-27: «норм работает». Покрыто: подсветка,
клик, плашечка, неизвестный ULID, legacy-схемы, fenced-блок.

## 4. Проверки

- `pnpm test` — **270 passed / 25 файлов** (было 262/24).
- `npx tsc --noEmit` — чисто.
- `npx vite build` — ок (прежние предупреждения о размерах чанков).

## 5. Ограничения

- Якорь `#<anchorULID>`: переход к месту не реализован (открытие документа +
  тост); якоря-маркеры — кандидат Phase 8.
- Автодополнение/UI-вставка ссылок — отдельная задача.
- Полный скан документа при каждом изменении: линейный regex, для больших
  файлов при необходимости — debounce/visible ranges.
- Голые ULID в Markup не подсвечиваются (см. 2).
- Ссылки без href недоступны с клавиатуры (общее ограничение 3.1).

## 6. Где читать дальше

1. `_tasks_/2026-10-27/20261027_004_ulid_markup_plan.md` — план, чек-лист, риски.
2. `_tasks_/2026-10-27/20261027_002_ulid_links_impl_result.md` — ссылки в превью/WYSIWYG.
3. `_docs_/roadmap.md` — Phase 7, задачи 5-7.
4. `_checkpoints_/20261027_004_checkpoint.md` — снапшот перед задачей 4.

## 7. Следующая задача

Phase 7, задача 5/6: граф/дерево документов и дашборд task-yaml (порядок
уточнить по roadmap); затем задача 7 — write-path конвертов/реестра.
