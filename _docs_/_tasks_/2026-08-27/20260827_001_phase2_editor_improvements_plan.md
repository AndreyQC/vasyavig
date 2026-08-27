# Phase 2: Вкладки и операции с файлами (plan)

> Контекст:
> - `_docs_/_tasks_/2026-08-26/20260826_001_editor_improvements_final.md` — спецификация работ (4 пункта)
> - `_docs_/_tasks_/2026-08-26/20260826_001_editor_improvements_draft.md` — обсуждение (3 вопроса закрыты, решения вшиты в final)
> - `_docs_/_phases_/Phase_01.md` — реализованный MVP (табы, save/saveAs, дерево, watcher)
> - `LESSONS_LEARNED.md` — §3 (dirty/контент в store), §4 (закрытие окна), §5 (useDeferredValue)
> - Дата: 2026-08-27

## Цель фазы

Закрыть четыре замечания из эксплуатации (см. final-документ):

1. Потеря правок при закрытии вкладки (P0).
2. «Открыть папку» закрывает открытые вкладки (P1).
3. Создание нового файла из дерева (P2).
4. Удаление файлов и папок (P2).

## Объём и границы

**Входит:** диалог закрытия dirty-вкладки («Сохранить / Не сохранять / Отмена»);
закрытие вкладок при открытии новой папки с диалогом «Сохранить все / Сбросить /
Отмена»; создание файла в активной папке дерева; удаление файла/папки (рекурсивно,
безвозвратно, с обязательным подтверждением).

**Не входит (Phase 3+):** конвертация офисных документов в Markdown (anydoc, Phase 3),
draw.io, контекстное меню spellcheck, F7-панель, виртуализация дерева, редактирование
текстовых файлов, undo/redo в тулбаре, production build.

## Разбивка на шаги

### Шаг 1. Rust: команды `create_file` / `delete_path`

- `src-tauri\src\services\file_service.rs`:
  - `create_file(path: &Path) -> Result<(), String>` — пустой файл через
    `OpenOptions::new().write(true).create_new(true)`; ошибка, если файл уже существует.
  - `delete_path(path: &Path) -> Result<(), String>` — `fs::remove_file` для файла,
    `fs::remove_dir_all` для папки.
- `src-tauri\src\commands\fs.rs`: тонкие обёртки-команды `create_file(path)`,
  `delete_path(path)`.
- `src-tauri\src\lib.rs`: зарегистрировать обе команды в `generate_handler!`.
- Права не требуются: команды работают через `std::fs` (не tauri-plugin-fs),
  диалоги уже разрешены (`capabilities\default.json`).

### Шаг 2. Frontend: обёртки `invoke`

- `src\hooks\useTauriFS.ts`: добавить `createFile(path)`, `deletePath(path)`.

### Шаг 3. editorStore: сохранение произвольной вкладки и закрытие всех

- `src\store\editorStore.ts`:
  - Вынести `saveTab(path)` — сохранение конкретной вкладки (сейчас логика зашита
    в `saveActive` и привязана к `activePath`). Нужна для диалога закрытия вкладки
    и «Сохранить все».
  - `closeAllTabs()` — очистить `tabs` (после разрешения промпта «открыть папку»).
  - `closeTab(path)` оставить «чистым» удалением без промпта — промпт строится в UI
    ДО вызова (разделение ответственности).
- Грязные вкладки брать как `tabs.filter(t => t.dirty)` — примитивный список,
  безопасный для Zustand-селекторов (LESSONS_LEARNED §3).

### Шаг 4. Модалки: транзитное состояние + компоненты

- `src\store\uiStore.ts`: транзитные поля (не попадают в `partialize`, как уже
  `pendingSaveAsPath`):
  - `pendingClosePath: string | null` — вкладка, ожидающая подтверждения закрытия.
  - `pendingOpenFolder: string | null` — целевой путь папки, открытие отложено до
    разрешения промпта.
  - `pendingDeletePath: string | null` — путь к удалению.
- Новые компоненты `src\components\Modals\` (паттерн как в `SaveConfirmModal.tsx`):
  - `CloseTabModal.tsx` — «Сохранить / Не сохранять / Отмена» для одной вкладки.
  - `OpenFolderModal.tsx` — список dirty-вкладок + «Сохранить все / Сбросить / Отмена».
  - `DeleteConfirmModal.tsx` — подтверждение безвозвратного удаления.
- Подключить модалки рядом с существующей `SaveConfirmModal` в `Layout.tsx`.

### Шаг 5. EditorTabs: промпт при закрытии вкладки

- `src\components\EditorArea\EditorTabs.tsx`: на крестик — если `tab.dirty`,
  вызвать `setPendingClosePath(tab.path)`; иначе `closeTab(tab.path)`.
- «Сохранить» в модалке → `saveTab(path)` затем `closeTab(path)`; «Не сохранять» →
  `closeTab(path)`; «Отмена» → сброс `pendingClosePath`.

### Шаг 6. fileStore: «открыть папку» с промптом

- `src\store\fileStore.ts`:
  - Общая точка входа `openFolderPath(path)` (её зовут и `openFolder`, и drag-and-drop
    папки): перед сменой `rootPath` собрать dirty-вкладки из `editorStore`.
  - Если есть dirty → `setPendingOpenFolder(path)` (модалка), не открывать.
  - Иначе → `closeAllTabs()` и открыть папку.
  - «Сохранить все» → сохранить все dirty-вкладки → `closeAllTabs()` → открыть;
    «Сбросить» → `closeAllTabs()` → открыть; «Отмена» → сброс `pendingOpenFolder`.

### Шаг 7. Создание и удаление в дереве

- `src\components\Sidebar\FileTreeNode.tsx`: контекстное меню (правый клик) →
  «Создать файл», «Удалить».
- `src\components\Sidebar\SidebarHeader.tsx`: кнопки «Создать»/«Удалить»
  (`disabled`, если `rootPath` пуст).
- `src\components\Sidebar\FileTree.tsx`: inline-инпут имени нового файла
  (default `new-file.md`, расширение произвольное — `.yfm`, `.yaml`, `.json`, `.txt` …).
- `src\store\fileStore.ts`: `createFile(path)`, `deletePath(path)` с последующим
  `refreshTree()` (watcher уже эмитит `fs-change`, но ручной refresh надёжнее).
- Удаление: если удаляемый файл открыт — закрыть его вкладку (`editorStore.closeTab`).

## Решения (неочевидные)

- Удаление — безвозвратное (не в Recycle Bin), с обязательным подтверждением
  (закрытый вопрос №1 из draft).
- Файл создаётся в активной (выбранной) папке дерева; если папка не выбрана — в корень
  открытого каталога (вопрос №2).
- Действия доступны и в контекстном меню дерева, и кнопками в заголовке Sidebar
  (вопрос №3); хоткеи — позже, по желанию.
- `create_file` не перезаписывает существующий файл (`create_new(true)`).

## Риски

- Промпты закрытия вкладки/папки не должны терять правки: dirty/контент читать из
  store, не из замыканий (LESSONS_LEARNED §3, §5).
- Рекурсивное удаление папки необратимо — обязательный confirm; запретить удаление
  корня открытого каталога.
- Watcher эмитит события на create/delete — `refreshTree` должен быть идемпотентным
  и не зацикливаться.

## Проверки

- `pnpm test` — vitest: добавить кейсы для `editorStore` (закрытие грязной вкладки,
  `saveTab`, `closeAllTabs`, список dirty).
- `cd src-tauri && cargo test` — unit для `create_file`/`delete_path` (если выносим
  логику в `file_service`).
- `npx tsc --noEmit` — чисто.
- Ручные: закрыть dirty-вкладку → диалог; открыть папку с несохранёнными → список +
  три действия; создать `.md` в активной папке; удалить файл/папку с подтверждением;
  дерево обновляется.

## Где читать дальше

1. `_docs_/_tasks_/2026-08-26/20260826_001_editor_improvements_final.md` — спецификация.
2. `_docs_/_phases_/Phase_01.md` — архитектура MVP, к которой добавляем код.
3. `LESSONS_LEARNED.md` — §3, §4, §5 (обязательно перед правками store/закрытия).
