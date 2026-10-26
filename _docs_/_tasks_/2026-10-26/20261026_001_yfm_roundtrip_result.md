# YFM round-trip тесты harness-конверта — результат

> Дата: 2026-10-26 | Ветка: dev | Статус: реализовано, проверки зелёные
> Фаза: Phase 7 — Harness (задача 2)

> Контекст:
> - План: `_tasks_/2026-10-26/20261026_001_yfm_roundtrip_plan.md`
> - `_docs_/roadmap.md` — Phase 7, задача 2
> - `_tasks_/2026-10-25/20261025_001_harness_repos_result.md` — исходное
>   ограничение (покрыт только commonmark-слой)
> - `LESSONS_LEARNED.md` §15 — тесты Gravity-редактора через сабпути пакета

## Что сделано

| Шаг плана | Файл | Итог |
|---|---|---|
| 1. Скелет и YFM-билдер | `src/lib/harnessRoundTripYfm.test.ts` | `WysiwygEditor` собран по образцу `YfmSpecsPreset` + `FullSpecsPreset`: BaseSchema, commonmark-спеки, `Strike`/`Table`, YFM-спеки (Deflist, Subscript, Superscript, Underline, Checkbox, ImgSize, Monospace, Video, YfmConfigs, YfmCut, YfmNote, YfmFile, YfmHeading, YfmTable, YfmTabs), `Mark`/`Color` |
| 2. Смешанная фикстура | тот же файл | harness-конверт + закладка + task-yaml + тело: note, cut, tabs, YFM-таблица, deflist, checkbox, картинка с размером |
| 3. Проверки harness-шапки | тот же файл | поля конверта равны исходным, закладка = ULID, task-yaml дословно, открывающий маркер на строке 0, закрывающий — на строке 7 |
| 4. Идемпотентность | тот же файл | второй `WysiwygEditor` на выводе даёт тот же `getValue()`; конверт равен исходному |
| 5. Прогоны и result | этот документ | `pnpm test`, `tsc --noEmit`, `vite build` — без регрессий |

Файл содержит 7 тестов (было 5 в commonmark-тесте): конверт, закладка,
task-yaml, окно первых строк, YFM-маркеры, сохранность тела, идемпотентность.

## Нормализации сериализатора (зафиксировано тестом)

- `{% note info %}` без заголовка -> `{% note info "Note" %}`; в фикстуре
  используется явный заголовок `{% note info "Заметка" %}`.
- checkbox `- [x]` -> `- [X]` (верхний регистр); проверка — regex `[xX]`.
- deflist `:   Определение` -> `: Определение` (один пробел).
- YFM-таблица при сериализации раскладывается на блоки: ячейки идут с
  пустыми строками между `||`/`|`; повторный разбор стабилен, поэтому
  проверяются маркеры `#|`/`|#`/`||` и содержимое ячеек, а не исходная
  однострочная форма.

## Проверки

- `pnpm test` — **238 passed / 22 files** (было 231/21; +7 тестов, +1 файл).
- `npx tsc --noEmit` — чисто.
- `npx vite build` — ок (1 м 33 с; предупреждения о размерах чанков прежние,
  тест в бандл не входит).
- Исключённых YFM-спек нет: все импорты из
  `@gravity-ui/markdown-editor/extensions/specs.js` загрузились в Node-ESM
  без `@gravity-ui/icons`/`uikit` (fallback D5 не понадобился).

## Известные ограничения

- Проверяется сериализация, а не поведение редактора: node views, модалки,
  вставка и переключение WYSIWYG -> Markup -> WYSIWYG остаются за
  GUI-приёмкой (в `core` нет режимов).
- Полный паритет с `preset full` не гарантируется: behavior-плагины и
  расширения, не входящие в `*Specs`, в тесте не участвуют.
- YFM-таблицы с `colwidth` (`{% colwidth=[N] %}`) не покрыты — формат не
  поддерживается текущими версиями, вынесен в беклог.
- Тест не проверяет рендер YFM в превью (`@diplodoc/transform`) — это зона
  GUI и существующих тестов превью.

## Ссылки

- Коммит теста: `c525607` — `test(harness): YFM round-trip конверта —
  note/cut/tabs/table/checkbox/img`.
- План: `_tasks_/2026-10-26/20261026_001_yfm_roundtrip_plan.md`.
