# Реализация `ulid:`-ссылок в превью и WYSIWYG — результат (Phase 7, задача 3.1)

> **Уточнение (2026-10-27):** схема ссылок изменена с `ulid:` на валидную
> `harness-ulid:` — см. `_tasks_/2026-10-27/20261027_003_ulid_scheme_harness_ulid.md`.
> `harness_ulid:` и `ulid:` остаются валидными на чтение (legacy).

> Контекст:
> - `_docs_/_tasks_/2026-10-27/20261027_002_ulid_links_impl_plan.md` — план и чек-лист
> - `_docs_/_tasks_/2026-10-27/20261027_001_ulid_body_links_result.md` — решение по формату C
> - `_docs_/roadmap.md` — Phase 7
> - `_docs_/_checkpoints_/20261027_001_checkpoint.md`

**Дата:** 2026-10-27
**Статус:** реализовано, GUI-приёмка пройдена (пользователь, 2026-10-27)
**Фаза:** Phase 7 — Harness, задача 3.1
**Коммиты:** `5b39af9` (feat), `2ec3c54` (fix)

## 1. Что сделано

| Файл | Изменение |
|---|---|
| `src/lib/harnessUlidLink.ts` (новый) | `parseUlidHref` / `buildUlidHref` / `isUlidHref`: `ulid:<ULID>[#<anchor>]`, регистр -> верхний, валидация Crockford + окно таймстемпа |
| `src/lib/previewLinks.ts` (новый) | `PREVIEW_ALLOWED_SCHEMES` (sanitize-html), `PREVIEW_SAFE_URI_RE` (DOMPurify), `linkifyUlidLinksInElement`: href -> `data-ulid`, href снимается |
| `src/components/EditorArea/SplitPreview.tsx` | transform с `allowedSchemes`, DOMPurify с `ulid`; две линкификации (сначала `ulid:`-ссылки, затем сырые ULID); клик с `data-anchor` |
| `src/lib/harnessUlidExtension.ts` | декорации по `link`-марке с `href^="ulid:"`; пропуск код-блоков и обычных ссылок; инлайн-код закладки остаётся кликабельным; клик через `handleDOMEvents` |
| `src/components/HarnessUlidPopover.tsx` (новый) | плашечка на `document`-делегировании: title/type/project/путь/created/updated, чипы `related`/`based_on`, «Открыть»; задержка 350 мс, Esc, закрытие по скроллу |
| `src/store/harnessStore.ts` | `openUlidTarget(dir, ulid, anchor?)`; якорь -> открытие документа + тост |
| `src/App.tsx` | монтирование плашечки |
| `src/components/EditorArea/EditorArea.css` | стили `.ulid-popover` |
| `src/locales/{ru,en}/translation.json` | строки `harness.link.*` |
| тесты | `harnessUlidLink.test.ts`, `previewLinks.test.ts`, расширены `harnessUlidExtension.test.ts`, `harnessIndex.test.ts`, `harnessRoundTrip.test.ts` |

## 2. Отклонения от плана

- **`aria-label` вместо `title`** в ссылках/декорациях: нативный tooltip
  конфликтовал бы с плашечкой. Тесты обновлены.
- **«Связи» в плашечке — не кнопка, а чипы** `related`/`based_on` с именами из
  реестра; клик открывает документ. Отдельная кнопка «Связи» не понадобилась.
- **Код-блоки исключены** из линкификации в WYSIWYG (`code_block`), как
  предусматривал Q5; инлайн-код закладки остался кликабельным.
- **`#anchor`**: переход к месту не реализован (осознанно), документ
  открывается, показывается тост; якоря — отдельная задача.
- Конфигурация превью вынесена в `previewLinks.ts` (тестируемо без React).

## 3. Приёмка

Пользователь проверил в GUI 2026-10-27: «работает норм». Покрыто ручным
прогоном: клик в превью и WYSIWYG, плашечка, неизвестный ULID, голые ULID,
ссылка внутри note/таблицы. Поштучный протокол по чек-листу не вёлся.

Не проверялось отдельно: темы светлая/тёмная, en-локаль, клавиатурная
доступность ссылок (у `<a>` без href нет tab-фокуса).

## 4. Проверки

- `pnpm test` — **259 passed / 24 файла** (было 238/22).
- `npx tsc --noEmit` — чисто.
- `npx vite build` — ок (прежние предупреждения о размерах чанков).
- Round-trip: `[имя](ulid:…)` и `ulid:…#anchor` сохраняются дословно,
  повторный проход идемпотентен.

## 5. Известные ограничения

- Markup-режим: подсветки/кликов нет — задача 4.
- Переход к якорю `#<anchorULID>` не реализован; маркеры якорей — кандидат Phase 8.
- Автодополнение и UI-вставка ссылок — отдельная задача.
- Ссылки без `href` (после снятия) недоступны с клавиатуры; при необходимости —
  `tabindex` + Enter (не входило в объём).
- Плашечка зависит от реестра: без `documents.jsonl`/`doc-index` ссылка будет
  «неизвестной».
- YFM-таблица сериализуется блоками — прежнее ограничение.

## 6. Где читать дальше

1. `_tasks_/2026-10-27/20261027_002_ulid_links_impl_plan.md` — план, чек-лист, риски.
2. `_tasks_/2026-10-27/20261027_001_ulid_body_links_result.md` — формат и прототип.
3. `_docs_/roadmap.md` — Phase 7, задача 4 (Markup) и далее.
4. `_checkpoints_/20261027_001_checkpoint.md` — снапшот на момент реализации.

## 7. Следующая задача

Phase 7, задача 4: ULID-ссылки в Markup-режиме (CodeMirror) — подсветка,
клик, неизвестный ULID; формат и данные уже готовы (`parseUlidHref`,
`data-ulid-dir`, плашечка).
