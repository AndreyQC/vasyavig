# Phase 2: Вкладки и файловые операции

> Дата: 2026-08-27
> Статус: завершён (реализовано и проверено в dev; PR в main — за пользователем)
> План: `_docs_/_tasks_/2026-08-27/20260827_001_phase2_editor_improvements_plan.md`
> Спецификация: `_docs_/_tasks_/2026-08-26/20260826_001_editor_improvements_final.md`

## Цель фазы

Закрыть замечания из эксплуатации по работе с вкладками и файлами:

- потеря правок при закрытии вкладки с несохранёнными изменениями;
- закрытие открытых вкладок при открытии новой папки;
- создание, удаление и переименование файлов/папок из дерева;
- (доп.) ресайзбл-сайдбар.

## Что сделано

### Rust (`src-tauri\src`)

| Файл | Что изменилось |
|---|---|
| `services\file_service.rs` | `create_file` (create_new, не перезаписывает), `delete_path` (рекурсивно), `rename_path` + тесты |
| `commands\fs.rs` | команды `create_file`, `delete_path`, `rename_path` |
| `lib.rs` | регистрация новых команд |

### Frontend (`src\`)

| Файл | Что изменилось |
|---|---|
| `store\editorStore.ts` | `saveTab`, `saveAllDirty`, `closeAllTabs`, `remapPath` |
| `store\fileStore.ts` | guard в `openFolderPath`, `openFolderPathNow`, `createFile`, `deleteEntry`, `renameEntry`, `selectDir`/`activeDirPath` |
| `store\uiStore.ts` | транзитные модальные состояния (close/openFolder/delete/create/rename) |
| `hooks\useFileActions.ts` | оркестрация модалок |
| `hooks\useTauriFS.ts` | обёртки `createFile`, `deletePath`, `renamePath` |
| `components\Modals\` | CloseTabModal, OpenFolderModal, DeleteConfirmModal, CreateFileModal, RenameModal |
| `components\EditorArea\EditorTabs.tsx` | промпт при закрытии dirty-вкладки |
| `components\Sidebar\FileTreeNode.tsx` | контекстное меню (создать/переименовать/удалить), выбор папки |
| `components\Sidebar\SidebarHeader.tsx` | кнопки «Создать»/«Удалить» |
| `components\Layout.tsx` + `Layout.css` | resizable sidebar (сплиттер 180–600 px) |
| `lib\utils.ts` | `getParentDir`, `joinPath`, `remapPath` |

## Ключевые архитектурные решения

- Закрытие вкладки: `closeTab` остаётся «чистым» удалением без промпта; промпт строится
  в UI ДО вызова (разделение ответственности).
- При ошибке сохранения вкладка/папка НЕ закрывается — правки не теряются.
- Переименование папки пересчитывает пути всех открытых вкладок внутри неё (`remapPath`)
  и переподписывает watcher при переименовании корня.
- Создание файла не перезаписывает существующий (`create_new(true)`).
- Транзитное модальное состояние в `uiStore` не попадает в `partialize` (персистятся
  только theme/lang).

## Проверки

- `pnpm test` — 29/29 (vitest: `lib/utils`, `editorStore`).
- `cargo test --manifest-path src-tauri/Cargo.toml` — 8/8 (file_service create/delete/rename
  + spell_service).
- `npx tsc --noEmit` — чисто.

## Известные ограничения / NOT done

- Удаление корня открытого каталога не запрещено (безвозвратное удаление — осознанный риск).
- Виртуализация дерева при >1000 файлов не сделана.

## Где читать дальше

1. `_docs_/_tasks_/2026-08-26/20260826_001_editor_improvements_final.md` — спецификация.
2. `_docs_/_tasks_/2026-08-27/20260827_001_phase2_editor_improvements_plan.md` — план.
3. `_docs_/_phases_/Phase_01.md` — предыдущая фаза.
4. `LESSONS_LEARNED.md` — §3, §4, §5.
