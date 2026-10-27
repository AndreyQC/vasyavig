# Реализация `harness-ulid:`-ссылок в превью и WYSIWYG — результат (Phase 7, задача 3.1)

> **Схема (2026-10-27):** финальный формат — валидная `harness-ulid:`; см.
> `_tasks_/2026-10-27/20261027_003_ulid_scheme_harness_ulid.md`.
> Legacy `harness_ulid:` и `ulid:` читаются, миграция не нужна.

> Контекст:
> - `_docs_/_tasks_/2026-10-27/20261027_002_ulid_links_impl_plan.md` — план и чек-лист
> - `_docs_/_tasks_/2026-10-27/20261027_001_ulid_body_links_result.md` — решение по формату C
> - `_docs_/_tasks_/2026-10-27/20261027_004_ulid_markup_result.md` — Markup (задача 4)
> - `_docs_/roadmap.md` — Phase 7

**Дата:** 2026-10-27
**Статус:** реализовано, GUI-приёмка пройдена (пользователь, 2026-10-27)
**Фаза:** Phase 7 — Harness, задача 3.1
**Коммиты:** `5b39af9` (feat), `2ec3c54` (fix), `cd071dc` (промежуточная схема),
`989ca86` (финальная схема `harness-ulid:`)

## 1. Что сделано

| Файл | Изменение |
|---|---|
| `src/lib/harnessUlidLink.ts` (новый) | `parseUlidHref` / `buildUlidHref` / `isUlidHref`: `harness-ulid:<ULID>[#<anchor>]` + legacy, регистр -> верхний, валидация Crockford + окно таймстемпа |
| `src/lib/previewLinks.ts` (новый) | `PREVIEW_ALLOWED_SCHEMES` (sanitize-html), `PREVIEW_SAFE_URI_RE` (DOMPurify), `linkifyUlidLinksInElement`: href -> `data-ulid`, href снимается |
| `src/components/EditorArea/SplitPreview.tsx` | transform с `allowedSchemes`, DOMPurify с `harness-ulid`; две линкификации (ссылки, затем сырые ULID); клик с `data-anchor` |
| `src/lib/harnessUlidExtension.ts` | декорации по `link`-марке с `href^="harness-ulid:"` (+ legacy); пропуск код-блоков и обычных ссылок; инлайн-код закладки остаётся кликабельным; клик через `handleDOMEvents` |
| `src/components/HarnessUlidPopover.tsx` (новый) | плашечка на `document`-делегировании: title/type/project/путь/created/updated, чипы `related`/`based_on`, «Открыть»; задержка 350 мс, Esc, закрытие по скроллу |
| `src/store/harnessStore.ts` | `openUlidTarget(dir, ulid, anchor?)`; якорь -> открытие документа + тост |
| `src/App.tsx` | монтирование плашечки |
| `src/components/EditorArea/EditorArea.css` | стили `.ulid-popover` |
| `src/locales/{ru,en}/translation.json` | строки `harness.link.*` |
| тесты | `harnessUlidLink.test.ts`, `previewLinks.test.ts`, расширены `harnessUlidExtension.test.ts`, `harnessIndex.test.ts`, `harnessRoundTrip.test.ts` |

## 2. Отклонения от плана

- **Схема уточнялась после приёмки:** `ulid:` -> `harness_ulid:` (однозначный
  поиск) -> `harness-ulid:` (валидная URI-схема, fail-closed). Финальная —
  `harness-ulid:`; legacy читаются. Решение: 20261027_003.
- **`aria-label` вместо `title`** в ссылках/декорациях: нативный tooltip
  конфликтовал бы с плашечкой. Тесты обновлены.
- **«Связи» в плашечке — не кнопка, а чипы** `related`/`based_on` с именами из
  реестра; клик открывает документ.
- **Код-блоки исключены** из линкификации в WYSIWYG (`code_block`), как
  предусматривал Q5; инлайн-код закладки остался кликабельным.
- **`#anchor`**: переход к месту не реализован (осознанно), документ
  открывается, показывается тост; якоря — отдельная задача.
- Конфигурация превью вынесена в `previewLinks.ts` (тестируемо без React).

## 3. Приёмка

Пользователь проверил в GUI 2026-10-27: «работает норм». Покрыто ручным
прогоном: клик в превью и WYSIWYG, плашечка, неизвестный ULID, голые ULID,
ссылка внутри note/таблицы.

Не проверялось отдельно: темы светлая/тёмная, en-локаль, клавиатурная
доступность ссылок (у `<a>` без href нет tab-фокуса).

## 4. Проверки

- `pnpm test` — **259 passed / 24 файла** на момент задачи 3.1; после задачи 4
  (Markup) — **270 passed / 25 файлов**.
- `npx tsc --noEmit` — чисто.
- `npx vite build` — ок (прежние предупреждения о размерах чанков).
- Round-trip: `[имя](harness-ulid:…)` и якорь сохраняются дословно,
  повторный проход идемпотентен.

## 5. Известные ограничения

- Переход к якорю `#<anchorULID>` не реализован; маркеры якорей — кандидат Phase 8.
- Автодополнение и UI-вставка ссылок — отдельная задача.
- Ссылки без `href` (после снятия) недоступны с клавиатуры; при необходимости —
  `tabindex` + Enter (не входило в объём).
- Плашечка зависит от реестра: без `documents.jsonl`/`doc-index` ссылка будет
  «неизвестной».
- YFM-таблица сериализуется блоками — прежнее ограничение.

Markup-режим, ранее числившийся ограничением, реализован в задаче 4
(`c928a20`) — см. `20261027_004_ulid_markup_result.md`.

## 6. Где читать дальше

1. `_tasks_/2026-10-27/20261027_002_ulid_links_impl_plan.md` — план, чек-лист, риски.
2. `_tasks_/2026-10-27/20261027_003_ulid_scheme_harness_ulid.md` — финальная схема.
3. `_tasks_/2026-10-27/20261027_004_ulid_markup_result.md` — Markup.
4. `_docs_/roadmap.md` — Phase 7, задачи 5-7.
5. `_checkpoints_/20261027_001_checkpoint.md` — архитектурная карта.

## 7. Следующая задача

Phase 7, задачи 5/6 — граф/дерево документов и дашборд task-yaml (делят
модель реестра); затем задача 7 — write-path конвертов/реестра. Якоря —
отдельная задача (кандидат Phase 8).
