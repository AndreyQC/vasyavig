# 20261028_004 — UX-квик-вины: хоткеи, табы, дерево, пустое состояние, статус-бар, сохранить всё, Ctrl+P, недавние workspace (plan)

> Контекст:
> - `_tasks_/2026-10-28/20261028_003_analysis_ux_review.md` — обзор, выбор
>   пользователя: мелкие № 1–6 + быстрое открытие № 7 + недавние workspace № 9
> - `openspec/specs/workspace-file/spec.md`, `LESSONS_LEARNED.md`

Дата: 2026-10-28 | Ветка: dev | Статус: план

## Цели

Закрыть восемь находок обзора одним заходом: горячие клавиши вкладок, средний
клик и меню вкладки, «Новая папка»/«Копировать путь» в дереве, кнопки в
пустом состоянии, позиция курсора и путь в статус-баре, «Сохранить всё» +
маркер dirty в заголовке окна, быстрое открытие Ctrl+P, недавние workspace.

## Решения

- **D1. Хоткеи** (`useHotkeys.ts`): Ctrl+W — закрыть активную вкладку (через
  `requestCloseTab` — dirty-промпт сохраняется); Ctrl+Tab / Ctrl+Shift+Tab —
  следующая/предыдущая вкладка по массиву `tabs`. Риск: WebView2 browser
  accelerator keys могут перехватить Ctrl+W/Ctrl+P до страницы — проверить
  приёмкой; fallback (исследование additionalBrowserArgs) — отдельным шагом,
  не блокер. Ctrl+S/Shift+S/O не трогаем.

- **D2. Табы** (`EditorTabs.tsx`): `onAuxClick` средней кнопкой = закрыть;
  контекст-меню вкладки: Закрыть / Закрыть другие / Закрыть справа / Закрыть
  все — поштучно через `requestCloseTab` (каждая dirty-вкладка промптит).

- **D3. Дерево** (`FileTreeNode.tsx`): «Новая папка» и «Копировать путь»
  (пункт виден у файлов и папок). Папка: новая Rust-команда `create_dir`
  (`services/file_service.rs`: `fs::create_dir`, ошибка если существует) +
  обёртка `useTauriFS.createDir` + `fileStore.createDir` (создать + refresh).
  Модалка — `CreateFileModal` в двух режимах (uiStore `pendingCreateKind`:
  "file" | "dir"). Копирование — `navigator.clipboard.writeText` + notice-тост.

- **D4. Пустое состояние** (`EmptyState.tsx`): кнопки «Открыть файл»
  (`openFileDialog`) и «Открыть папку» (`addFolder`) под подсказкой.

- **D5. Статус-бар**: позиция курсора «строка:столбец» для активной вкладки.
  WYSIWYG — PM-плагин в новом `lib/cursorPosExtension.ts` (view/update →
  selection → line/col → uiStore); Markup — CM `updateListener` в том же
  модуле (подключение через `markupConfig.extensions`). uiStore `cursorPos`,
  сброс при `setActiveTab`. Полный путь файла — `title` у `FileTypeBadge`.

- **D6. Сохранить всё**: `useSaveActions.saveAll` = `editorStore.saveAllDirty()`
  (уже существует) → ошибка в fileStore. Кнопка в правой группе тулбара,
  disabled без dirty-вкладок. Заголовок окна: `App.tsx` — префикс «● » при
  любой dirty-вкладке.

- **D7. Быстрое открытие (Ctrl+P)**: `lib/quickOpen.ts` — чистая модель:
  `flattenFiles(trees)` (файлы с поддерживаемым типом), `filterQuickOpen`
  (fuzzy-подпоследовательность по имени, бонус за подряд/начало, limit 50).
  Компонент `src/components/QuickOpen.tsx` (оверлей: ввод + список, Up/Down/
  Enter/Esc, клик), монтируется в `App.tsx`; uiStore `quickOpenOpen`.
  Enter/клик — `openFile` (закреплённая вкладка).

- **D8. Недавние workspace**: uiStore `recentWorkspaces: string[]` (persist,
  максимум 5, дедуп, наполнение в `setLastWorkspacePath`). `useFileActions`:
  извлечь `openWorkspaceAt(path)` (dirty-проверка → модалка/применение),
  `requestOpenWorkspace` переиспользует; меню workspace (`SidebarHeader`)
  получает список недавних (basename, полный путь в title).

## Скоуп кода

| Файл | Изменение |
|---|---|
| `src-tauri/src/services/file_service.rs`, `commands/fs.rs`, `lib.rs` | `create_dir` + регистрация команды |
| `src/hooks/useTauriFS.ts` | обёртка `createDir` |
| `src/lib/quickOpen.ts` (новый) | flatten + fuzzy-фильтр |
| `src/lib/cursorPosExtension.ts` (новый) | PM-плагин + CM updateListener позиции курсора |
| `src/store/uiStore.ts` | `quickOpenOpen`, `cursorPos`, `recentWorkspaces`, `pendingCreateKind` |
| `src/store/fileStore.ts` | `createDir` |
| `src/store/editorStore.ts` | сброс `cursorPos` в `setActiveTab` |
| `src/hooks/useFileActions.ts` | `openWorkspaceAt` + `requestRecentWorkspace`, createDir-флоу |
| `src/hooks/useSaveActions.ts` | `saveAll` |
| `src/hooks/useHotkeys.ts` | Ctrl+W / Ctrl+Tab / Ctrl+P |
| `src/App.tsx` | маркер dirty в title, монтаж QuickOpen |
| `src/components/EditorArea/EditorTabs.tsx` | middle-click, контекст-меню вкладки |
| `src/components/Sidebar/FileTreeNode.tsx` | «Новая папка», «Копировать путь» |
| `src/components/Sidebar/SidebarHeader.tsx` | недавние workspace в меню |
| `src/components/EditorArea/EmptyState.tsx`, `StatusBar/*`, `Toolbar/MainToolbar.tsx`, `EditorArea.css` | кнопки, курсор, путь, «Сохранить всё» |
| `src/components/Modals/CreateFileModal.tsx` | режим file/dir |
| `src/components/QuickOpen.tsx` (новый) | палитра быстрого открытия |
| `src/components/EditorArea/MarkdownEditor.tsx` | подключение cursorPosExtension |
| `src/locales/{ru,en}/translation.json` | новые ключи |
| `src/lib/quickOpen.test.ts`, `src/store/fileStore.test.ts`, `src/store/uiStore` (recents) | тесты |

## Проверки

- `pnpm test`, `npx tsc --noEmit`, `npx vite build`, `cargo check`
  (src-tauri).
- Приёмка (чек-лист в result): хоткеи не перехвачены WebView2 (Ctrl+W,
  Ctrl+P — палитра, не печать), middle-click и меню вкладок, новая папка
  появляется в дереве, копирование пути, пустое состояние, курсор в обоих
  режимах редактора, «Сохранить всё», маркер в заголовке, Ctrl+P фильтрует и
  открывает, недавние workspace открываются с dirty-промптом.

## Риски

- WebView2 accelerator keys (D1/D7) — приёмка покажет; fallback отдельным
  шагом.
- Новая Rust-команда требует перезапуска `tauri dev` (урок 11).
- `navigator.clipboard` в WebView2 — требует user gesture; кнопки меню им
  являются.
