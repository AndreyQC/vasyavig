# Переименование каталогов харнеса: `_docs_` → `harness_docs` (plan)

> Контекст:
> - lm_hrdo_2, задача 20261102_940 — эталонная миграция выполнена 02.11
>   (коммиты `78467a17` feat(infra), `06dac8f8` docs(harness)); ранбук —
>   `harness_docs/harness_tasks/2026-11-02/20261102_940_harness-dir-rename_plan.md`
>   в репо lm_hrdo_2 (раздел «Приложение · ранбук адаптации»).
> - `misc/harness_dir_rename.py` — скрипт перезаписи, скопирован из lm_hrdo_2
>   (байт-точная замена, self-skip, preview по умолчанию).
> - Причина: агенты путаются в каталогах вида `_{каталог}_`; единая
>   конвенция harness-репозиториев — `harness_{каталог}` без подчёркиваний.

**Дата:** 2026-11-02 (создано) · **Запланировано к работе:** 2026-11-03
**Статус:** выполнено 2026-11-03 (`f566b9e`, `1d459f7`, `cd9c22a`) — результат в
`harness_docs/harness_tasks/2026-11-03/20261103_001_harness-dir-rename_result.md`;
GUI-приёмка дашборда на `lm_hrdo_2` — за пользователем

---

## Контекст

lm_hrdo_2 02.11.2026 переименовал каталоги харнеса (`_docs_` →
`harness_docs` + внутренние, `_archives_` → `harness_archives`; 3227 замен).
Vasyavig читает lm_hrdo_2 как harness-репозиторий: реестр
`documents.jsonl`, body-ссылки `harness-ulid:`, дашборд задач — все
хождения путей в коде зашиты на старые имена `_{…}_` и после миграции
эталона сломаются (клик по ULID, скан задач, дерево репо).

Замер 02.11: **286 ссылок в `src/`** — `src/lib/harnessGraph.ts`,
`harnessIndex.ts`, `harnessTasks.ts` (+ их тесты), `src/store/`
(harnessStore, harnessTasksStore…), `src/locales/{en,ru}/translation.json`.
Собственное дерево `_docs_/` (REFRESH_CONTEXT.md, roadmap.md,
USER_IDEA.md, GRAMAX_RESEARCH_RESULT.md, `_checkpoints_`, `_phases_`,
`_tasks_` + TASK_CONVENTIONS.md) — тоже переименовать (внутри vasyavig
это просто документы). История: vasyavig уже переезжал `-=folder=-` →
`_folder_` (`misc/rename_docs_dirs.py`) — паттерн повторяется.

## Намерение

1. **Правка скрипта** `misc/harness_dir_rename.py`: из `SKIP_DIRS` убрать
   `"src"` (TS-код обязан переписаться) и добавить `"src-tauri"`.
   Итоговый набор: `.git, node_modules, dist, build, vendor, targets,
   src-tauri, .venv, __pycache__, .idea, .vscode, output, logs`.
2. **git mv** собственного дерева:
   ```bash
   git mv _docs_/_checkpoints_ _docs_/harness_checkpoints
   git mv _docs_/_phases_      _docs_/harness_phases
   git mv _docs_/_tasks_       _docs_/harness_tasks
   git mv _docs_               harness_docs
   ```
3. **Перезапись**: `python -I misc/harness_dir_rename.py .` (preview —
   сверить: src/*.ts, locales, тесты, собственные md) → `--apply`.
4. **Хвосты**: `git grep -n "_docs_\|_archives_" -- . ':(exclude)misc/rename_docs_dirs.py'`
   — легитимны только исторический скрипт и слаги.
5. **Проверка**: `pnpm test` (vitest: harnessIndex/harnessTasks тесты
   содержали старые литералы — перезаписываются скриптом), `pnpm build`,
   ручная проверка дашборда: открыть lm_hrdo_2 как harness-репо, клик по
   ULID → файл открывается по новому пути, дерево/фильтры работают.
6. **Коммит**: один `docs(harness)` (или по конвенции репо) — mv +
   перезапись; обновить собственные AGENTS/конвенции при наличии
   упоминаний старых путей.

## Критерии приёмки

- [ ] `harness_docs/` (+3 внутренних) существует, `_docs_` нет
- [ ] 0 ссылок на `_{…}_`-пути в `src/` (кроме легитимных хвостов)
- [ ] `pnpm test` и `pnpm build` зелёные
- [ ] Дашборд: клик по ULID документа lm_hrdo_2 открывает файл в
      `harness_docs/…`
- [ ] Реестр/сканы задач работают по новым путям

## Связанные документы

- lm_hrdo_2 `_docs_…/20261102_940_harness-dir-rename_plan.md` — ранбук и
  эталонный порядок (эталонный репо: `C:/repos/reksoft/locomoko/lm_hrdo_2`).
- `misc/harness_dir_rename.py` — скрипт (уже скопирован в этот репозиторий).
- `misc/rename_docs_dirs.py` — исторический шаблон (v1 переезда).
