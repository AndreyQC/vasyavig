# Phase 1: Vasyavig — работающий MVP редактора Markdown/YFM

> Дата: 2026-07-27
> Статус: завершён (этапы 1–9 из идеи реализованы и проверены в dev; PR в main — за пользователем)
> План: `-=docs=-/-=tasks=-/2026-07-27/20260727_001_WYSIWYG_Editor_idea.md` (§12)

## Цель фазы

- Desktop-приложение на Tauri v2 + React для редактирования Markdown/YFM.
- Файловое дерево с автообновлением, табы, WYSIWYG/Markup/Split режимы.
- Сохранение с защитой смены формата md↔yfm, статус-бар с бейджем расширения.
- Monaco read-only viewer для текстовых файлов.
- Проверка орфографии (ru/en) с live-подчёркиваниями в WYSIWYG.
- i18n (ru/en), темы light/dark/system с персистом настроек.

## Что сделано

### Rust (`src-tauri\src`)

| Файл | Что изменилось |
|---|---|
| `commands\fs.rs` | `list_directory` (рекурсивно, лимит 8), `read_file` (UTF-8, отсев бинарных), `write_file` (атомарная), `get_file_metadata` |
| `commands\watcher.rs` | `watch_folder` на notify, дебаунс 300 мс, событие `fs-change` |
| `commands\spellcheck.rs` | `check_spelling_blocks`, `suggest_word`, `add_word_to_dictionary`, `load_user_dictionary` |
| `services\file_service.rs` | обход дерева, чтение UTF-8, атомарная запись (temp+rename) |
| `services\spell_service.rs` | zspell (ru_RU + en_US из `include_str!`), пользовательский словарь, токенизатор с офсетами в символах |
| `resources\dictionaries\` | словари ru_RU/en_US (.aff/.dic, wooorm/dictionaries), LF через `.gitattributes` |

### Frontend (`src\`)

| Файл | Что изменилось |
|---|---|
| `store\fileStore.ts` | дерево, открытие папки/файла (в т.ч. Ctrl+O), подсветка активного |
| `store\editorStore.ts` | табы (content/savedContent/dirty/mode), save/saveAs с защитой md↔yfm |
| `store\spellStore.ts` | состояние spellcheck (enabled/lang/blocks/version) |
| `store\uiStore.ts` | theme/lang, персист в localStorage (`vasyavig.settings`) |
| `components\EditorArea\` | MarkdownEditor (Gravity UI), MonacoViewer, SplitView/SplitPreview (diplodoc transform + DOMPurify + mermaid), EditorTabs, EmptyState |
| `components\Sidebar\` | FileTree/FileTreeNode (рекурсивно, скрытые файлы), SidebarHeader |
| `components\Toolbar\` | MainToolbar (Save/SaveAs), ModeSwitcher (WYSIWYG/Markup/Split) |
| `components\StatusBar\` | StatusBar, FileTypeBadge, SpellcheckToggle, LanguageSelector, ThemeToggle |
| `components\Modals\SaveConfirmModal.tsx` | защита смены формата md↔yfm |
| `lib\spellcheckExtension.ts` | ProseMirror-плагин live-подчёркиваний (debounce 500 мс) |
| `lib\monacoSetup.ts` | локальный бандл Monaco (воркеры через `?worker`, без CDN) |
| `lib\i18n.ts` + `locales\` | i18next, ru/en, синхронизация с Gravity UI |
| `hooks\` | useTauriFS, useFileWatcher, useHotkeys (Ctrl+S/Shift+S/O), useDragDrop, useSaveActions |

## Ключевые архитектурные решения

- **zspell вместо hunspell-rs** — чистый Rust, без FFI (решение №8 из §16 идеи); словари зашиты в бинарь через `include_str!` (нет проблем с resource paths), пользовательские слова — в `app_data_dir/user_words.txt`.
- **Spellcheck — ProseMirror-плагин** с декорациями; проверка по textblock'ам, офсеты в символах; `version` в spellStore бампается только при реальном изменении — защита от цикла перепроверок. Только WYSIWYG (решение №6).
- **Monaco бандлится локально** (без CDN): в monaco-editor 0.56 exports-мапа без `esm/vs` префикса — см. LESSONS_LEARNED §7.
- **ToasterProvider обязателен** для MarkdownEditorView — см. LESSONS_LEARNED §6 (белый экран при первом открытии .md).
- **Состояние редактора (content, dirty) — в Zustand store**, не в useState (урок §5); превью через `useDeferredValue`.
- Vite: `host: "127.0.0.1"`, strictPort 1420; `pnpm-workspace.yaml` с валидным `onlyBuiltDependencies` (уроки §1–2).

## Проверки

- `pnpm test` (vitest): **19/19** — `lib/utils` (расширения, md↔yfm), `editorStore` (табы, dirty).
- `cargo test` (в `src-tauri`): **5/5** — токенизатор (кириллица, офсеты), проверки ru/en/both, пользовательский словарь.
- `npx tsc --noEmit` — чисто.
- Ручные проверки в dev (пользователь): открытие папки/файлов, WYSIWYG/Markup/Split, сохранение + модалка md↔yfm, Monaco, подчёркивания орфографии, переключение языка и темы.

## Известные ограничения / NOT done

- Spellcheck: нет контекстного меню с вариантами замены и «добавить в словарь» по клику (команды `suggest_word`/`add_word_to_dictionary` готовы); нет F7-панели; только WYSIWYG.
- Нет виртуализации дерева при >1000 файлов.
- Нет Undo/Redo кнопок в тулбаре (есть встроенные хоткеи редактора).
- Нет синхронизации скролла editor↔preview (беклог P4).
- Production-сборка (`pnpm tauri build`) не проверялась.
- Беклог из идеи §11: draw.io, редактирование текстовых файлов, коллаборация, экспорт PDF/HTML, git-интеграция.

## Где читать дальше

1. `LESSONS_LEARNED.md` — 8 уроков (обязательно перед новой сессией).
2. `-=docs=-/-=tasks=-/2026-07-27/20260727_001_WYSIWYG_Editor_idea.md` — идея + ответы §16.
3. `-=docs=-/-=CHECKPOINTS=-/20260727_001_checkpoint.md` — снапшот состояния.
