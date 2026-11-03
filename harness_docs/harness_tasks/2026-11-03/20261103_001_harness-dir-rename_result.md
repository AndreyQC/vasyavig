# Переименование каталогов харнеса: `_docs_` → `harness_docs` — результат (задача 20261103_001)

> Контекст:
> - план: `harness_docs/harness_tasks/2026-11-03/20261103_001_harness-dir-rename_plan.md`
> - эталон: `lm_hrdo_2`, задача 20261102_940 — коммиты `78467a17` (feat), `06dac8f8` (docs), `3ace7bc8` (merge)
> - `harness_docs/harness_checkpoints/20261102_004_checkpoint.md` — состояние Phase 8.3 на старте
> - `harness_docs/roadmap.md` — Phase 7 (harness) и Phase 8 (ассистент)

**Дата:** 2026-11-03
**Статус:** выполнено (`f566b9e`, `1d459f7`, `cd9c22a`); GUI-приёмка дашборда на `lm_hrdo_2` — за пользователем
**Фаза:** вне Phase 7/8 — сквозная миграция путей harness-конвенции

---

## Что сделано

### 1. Перенос собственного дерева (`git mv`)

| Было | Стало |
|---|---|
| `_docs_/_checkpoints_/` | `harness_docs/harness_checkpoints/` |
| `_docs_/_phases_/` | `harness_docs/harness_phases/` |
| `_docs_/_tasks_/` | `harness_docs/harness_tasks/` |
| `_docs_/` (корень) | `harness_docs/` |

Файлы верхнего уровня (`REFRESH_CONTEXT.md`, `roadmap.md`, `USER_IDEA.md`,
`GRAMAX_RESEARCH_RESULT.md`) переехали внутрь `harness_docs/` без переименования.
В коммите `cd9c22a` git детектирует **81 переименование** (R072–R100), ни одного
чистого добавления/удаления.

### 2. Правка скрипта перезаписи (`misc/harness_dir_rename.py`)

Скрипт скопирован из `lm_hrdo_2` и доработан под этот репозиторий:

| Правка | Зачем |
|---|---|
| `SKIP_DIRS`: убран `src`, добавлен `src-tauri` | TS-код Vasyavig обязан переписаться (в `lm_hrdo_2` `src` пропускался); Rust не трогаем |
| Разделители путей: `/`, `\`, `\\` | в Vasyavig есть экранированные TS-литералы (`"C:\\repos\\lm\\_docs_\\_tasks_"`) и windows-пути в markdown — эталонная карта покрывала только `/` |
| `SKIP_GLOBS`: ранбук переименования + `misc/rename_docs_dirs.py` | в ранбуке старые пути — **объект** переименования (`git mv _docs_ …`, `git grep "_docs_"`); переписывание испортило бы команды. Исторический скрипт v1 — артефакт прошлой миграции |
| Сам скрипт (self-skip) | таблица соответствий хранит старые имена как данные |

Итог прогона: **282 замены в 99 файлах** (`--apply`); preview по умолчанию.

### 3. Перезапись ссылок — что покрыто

| Область | Файлов | Пример |
|---|---|---|
| `src/` (код + тесты) | 15 | `HARNESS_INDEX_REL` → `harness_docs/harness_index/documents.jsonl` |
| `src/locales/{ru,en}` | 2 | тексты про реестр документов |
| `README.md`, `LESSONS_LEARNED.md` | 2 | ссылки на разделы документации |
| `harness_docs/**` (чекпоинты, фазы, задачи) | 81 | пути внутри документов |
| `openspec/changes/archive/**` | 7 | старые change-документы |
| `.zcode/plans/**` | 1 | план сессии |

### 4. Хвосты — оставлены намеренно

`git grep "_docs_\|_archives_"` даёт ровно три файла:

1. `harness_docs/harness_tasks/2026-11-03/20261103_001_harness-dir-rename_plan.md`
   — ранбук (исторические описания + исполняемые команды).
2. `misc/harness_dir_rename.py` — таблица соответствий (self-skip).
3. `misc/rename_docs_dirs.py` — исторический скрипт миграции v1.

**Короткие формы не переписаны** (`_tasks_/`, `_checkpoints_/`, `_phases_/` — 196
вхождений в прозе). Это совпадает с эталоном: в `lm_hrdo_2` после миграции
(`06dac8f8`) осталось 1544 таких упоминания. Форма `_tasks_/` там — прозаическое
имя категории, а не путь.

## Проверки

| Команда | Результат (2026-11-03) |
|---|---|
| `pnpm test` | 556 passed / 47 файлов |
| `npx tsc --noEmit` | чисто |
| `npx vite build` | собрано за 1 мин 18 с; прежний warning о размере чанков |
| `cd src-tauri && cargo test --lib` | не запускался — `src-tauri` не менялся (в skip) |

Программная проверка приёмки (без GUI): реестр эталона
`lm_hrdo_2/harness_docs/harness_index/documents.jsonl` — **1940 записей, 0 со
старыми именами каталогов, 0 отсутствующих на диске файлов**. Значит цепочка
«клик по ULID → `HARNESS_INDEX_REL` → файл» валидна; `harness_manifest.json`
эталона ссылок на пути не содержит и перезаписи не потребовал.

## Известные ограничения / NOT done

- **GUI-приёмка дашборда** на `lm_hrdo_2` (клик по ULID → файл открывается по
  новому пути, дерево/фильтры) — вручную, за пользователем.
- **Эталон `lm_hrdo_2` содержит хвосты старой раскладки**: после мержа `3ace7bc8`
  в HEAD вернулись `_docs_/_tasks_/2026-11-02/20261102_992_pg-e2e-sql.md` (одна
  задача) и `_archives/` (каталога `harness_archives` в HEAD нет). Репозиторий
  другой, задача не наша — но на приёмку дашборда влияет: одна задача вне реестра.
- Короткие формы `_tasks_/` в прозе остались (совпадает с эталоном).
- `misc/rename_docs_dirs.py` и ранбук содержат старые имена намеренно.

## Что изменилось в коде (влияет на Phase 7/8)

- `src/lib/harnessIndex.ts`: `HARNESS_INDEX_REL = "harness_docs/harness_index/documents.jsonl"` —
  единственный кодовый путь к реестру; поиск репозитория идёт подъёмом от каталога.
- `src/store/harnessStore.ts`: watcher реестра — путь выводится из константы.
- Локали `ru/en`: подсказка «откройте каталог harness-репозитория» — новый путь реестра.
- Логика дашборда задач (`src/lib/harnessTasks.ts`) путей не хардкодит: кандидаты
  берутся из реестра, словарь — из `harness_manifest.json` в корне репозитория.

## Где читать дальше

1. `harness_docs/harness_tasks/2026-11-03/20261103_001_harness-dir-rename_plan.md` — план и критерии приёмки.
2. `harness_docs/harness_checkpoints/20261103_001_checkpoint.md` — состояние проекта после миграции и Phase 8.4.
3. `harness_docs/roadmap.md` — Phase 7/8, очередь фаз.
4. `LESSONS_LEARNED.md` — среда, Zustand, Tauri dev.
