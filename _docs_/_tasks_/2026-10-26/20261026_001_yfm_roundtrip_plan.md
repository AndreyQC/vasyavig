# YFM round-trip тесты harness-конверта — план

> Дата: 2026-10-26 | Ветка: dev | Статус: план утверждён к реализации
> Фаза: Phase 7 — Harness (задача 2)

> Контекст:
> - `_docs_/roadmap.md` — Phase 7, задача 2 «YFM round-trip тесты»
> - `_docs_/_tasks_/2026-10-25/20261025_001_harness_repos_result.md` —
>   ограничение: автотест покрывает только commonmark-слой пресета full
> - `_docs_/_tasks_/2026-10-25/20261025_001_harness_repos_plan.md` —
>   решения D2 (сохранность конверта) и задача 4 (round-trip регресс)
> - `LESSONS_LEARNED.md` §15 — тесты Gravity-редактора через сабпути пакета

## Задача

Расширить автотест round-trip harness-конверта на YFM-слой пресета `full`:
убедиться, что типовые YFM-блоки (`note`, `cut`, `tabs`, YFM-таблица, deflist,
checkbox, размер картинки) переживают разбор WYSIWYG -> сериализацию вместе с
конвертом harness-yaml, task-yaml и закладкой.

Это страховочный шаг перед задачами 3-7 Phase 7: граф, дашборд и write-path
будут опираться на разбор и генерацию markdown, и регресс в YFM-слое должен
ловиться автотестом, а не GUI-приёмкой.

## Исходное состояние

- `src/lib/harnessRoundTrip.test.ts` — 5 тестов: `WysiwygEditor` c
  `BaseSchemaSpecs` + markdown-спеками (Html, Bold, Italic, Code, Link, Lists,
  Blockquote, HorizontalRule, Breaks, CodeBlock, Image, Heading). Тело
  фикстуры — заголовок, абзац, список, ссылка. YFM-блоков нет.
- Приложение (`MarkdownEditor.tsx`) использует `preset: "full"`:
  `FullSpecsPreset` -> `YfmSpecsPreset` -> `DefaultSpecsPreset` ->
  `CommonMarkSpecsPreset` + `MarkSpecs`, `ColorSpecs`.
- Полный бандл (`useMarkdownEditor`) в vitest не поднимается из-за
  bundler-only ESM `@gravity-ui/icons`; чистые сабпути
  `@gravity-ui/markdown-editor/extensions/specs.js` и
  `.../extensions/yfm/specs.js` доступны и не тянут node views.

## Цели

- **G1**: фикстура с YFM-блоками проходит WYSIWYG parse -> serialize;
  YFM-синтаксис в выводе распознаётся повторно (маркеры `{% note`, `{% cut`,
  `{% tabs`, `#|`, `term :: definition`, `[ ]`/`[x]`, `=100x50`).
- **G2**: конверт harness-yaml, task-yaml и закладка сохраняются дословно;
  конверт остаётся в окне первых 5 строк (иначе harness-репо его не найдёт).
- **G3**: повторный parse вывода идемпотентен: второй `getValue()` равен
  первому, `parseHarnessEnvelope` совпадает с исходным.
- **G4**: тест остаётся быстрым и не тянет полный бандл редактора
  (без `@gravity-ui/icons`, `uikit`, node views).

## Не-цели

- Полный паритет с `preset full`: behavior-плагины, node views, модалки
  (mermaid/картинки) — остаются за GUI-приёмкой.
- Переключение WYSIWYG -> Markup -> WYSIWYG внутри теста: `WysiwygEditor` из
  `core` не имеет режимов; этот путь проверяется GUI-приёмкой.
- YFM-таблицы с `colwidth` (`{% colwidth=[N] %}`) — не поддерживаются
  текущими версиями, вынесены в беклог «Notion-подобные таблицы».
- Визуальный рендер YFM в превью — не относится к сериализации.

## Решения

- **D1 — отдельный файл** `src/lib/harnessRoundTripYfm.test.ts`, а не
  расширение существующего теста: YFM-спеки меняют разбор обычного markdown
  (директивы, `#|`), и текущий commonmark-тест должен остаться базовой линией
  без YFM-слоя.
- **D2 — состав спеков** повторяет `YfmSpecsPreset`:
  `BaseSchemaSpecs` + markdown-спеки (commonmark, `Strike`, `Table`) + YFM:
  `Deflist`, `Subscript`, `Superscript`, `Underline`, `Checkbox`, `ImgSize`,
  `Monospace`, `Video`, `YfmConfigs`, `YfmCut`, `YfmNote`, `YfmFile`,
  `YfmHeading`, `YfmTable`, `YfmTabs` + `MarkSpecs`, `ColorSpecs`. Опции —
  `{}` (как пресет; урок §15, п. 3).
- **D3 — фикстура одна, смешанная**: harness-шапка (конверт + закладка +
  task-yaml) и тело с YFM-блоками. Отдельные микро-фикстуры не нужны: цель —
  проверить совместную работу, а не каждый блок изолированно.
- **D4 — проверки по слоям**: конверт — строгое равенство распарсенных полей
  и дословные строки маркеров; YFM-тело — наличие маркеров и повторный
  разбор. Байт-равенство всего вывода не требуем: сериализатор вправе
  нормализовать отступы/кавычки; обязательна идемпотентность второго прохода.
- **D5 — fallback при проблемах импорта**: если конкретная YFM-спека не
  грузится в Node-ESM (icons/uikit в цепочке), исключить её из билдера,
  записать в комментарии теста и в result; не добавлять алиасы и
  Vite-хаки (урок §15). Остальные YFM-блоки остаются в тесте.

## План реализации

| # | Шаг | Файлы | Проверка |
|---|---|---|---|
| 1 | Скелет теста и YFM-билдер по D2 | `src/lib/harnessRoundTripYfm.test.ts` | Пустая/простая фикстура проходит parse -> serialize |
| 2 | Смешанная фикстура: note, cut, tabs, YFM-таблица, deflist, checkbox, картинка с размером | тот же файл | Все маркеры присутствуют в `getValue()` |
| 3 | Проверки harness-шапки: поля конверта, task-yaml, закладка, окно 5 строк | тот же файл | `parseHarnessEnvelope(output)` равен исходному |
| 4 | Идемпотентность: повторный `WysiwygEditor` на выводе | тот же файл | `output2 === output1`; конверт равен |
| 5 | Прогоны и result-документ | `_tasks_/2026-10-26/20261026_001_yfm_roundtrip_result.md` | `pnpm test`, `tsc`, `vite build` |

## Проверки

- `pnpm test` — текущие 231 passed + новые тесты файла; регрессий нет.
- `npx tsc --noEmit` — чисто.
- `npx vite build` — ок; тест не входит в бандл, вес сборки не меняется.
- GUI-приёмка не требуется: это автотест; полный паритет с `preset full`
  остаётся закрытым ручной приёмкой задачи 1 Phase 7.

## Риски

- YFM-спеки могут тянуть node views с `@gravity-ui/icons` — сработает D5,
  часть блоков уйдёт в GUI-покрытие; в result зафиксировать список.
- `@diplodoc/tabs-extension` может иметь ESM/CJS-несовместимость в vitest —
  при падении импорта tabs исключить первым (наименее критичный блок).
- Сериализатор может менять формат таблицы (выравнивание, пробелы) —
  проверяем маркеры и повторный разбор, а не байт-равенство тела.
- Ложная уверенность: тест покрывает только сериализацию, не поведение
  редактора (вставка, DnD, модалки) — границы зафиксированы в «Не-целях».

## Критерии готовности

- Новый тест-файл зелёный; конверт/task-yaml/закладка сохраняются дословно,
  YFM-маркеры присутствуют, второй проход идемпотентен.
- `pnpm test`, `npx tsc --noEmit`, `npx vite build` — без регрессий.
- Result-документ содержит число тестов, список исключённых спек (если были)
  и ссылки на коммиты.
- Коммит: `test(harness): YFM round-trip конверта — note/cut/table/tabs`.
