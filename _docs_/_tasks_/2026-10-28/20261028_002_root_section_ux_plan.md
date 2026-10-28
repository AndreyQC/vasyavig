# 20261028_002 — Удобство плашек открытых директорий (plan)

> Контекст:
> - `_docs_/_checkpoints_/20261028_002_checkpoint.md` — текущий снапшот проекта
> - `openspec/specs/workspace-file/spec.md` — формат файла workspace (v1)
> - `openspec/specs/folder-colors/spec.md` — цвета корней
> - `LESSONS_LEARNED.md` §3 — правила Zustand-селекторов

Дата: 2026-10-28 | Ветка: dev | Статус: план (реализация не начата)

## Проблема

Плашки открытых директорий — заголовки секций корней workspace в дереве
(`src/components/Sidebar/RootSection.tsx`). Сейчас:

- секцию корня нельзя свернуть — дерево всегда развёрнуто, при нескольких
  корнях сайдбар переполнен;
- в плашке виден только basename; полный путь — только в тултипе; при похожих
  именах непонятно, что открыто;
- порядок секций = порядок добавления корней, поменять нельзя;
- имя нельзя заменить псевдонимом.

Слово пользователя (объём приёмки): сворачивание секции; видимый путь; смена
порядка плашек с сохранением в JSON; псевдонимы; в свёрнутой плашке виден один
псевдоним. Плюс после реализации — обзор UX агентом (часть 2, отдельный шаг).

Задача маленькая, вне фаз; очередь Phase 7 (приёмка задачи 5, задача 7
write-path) не отменяется.

## Цели

1. Сворачивание секции корня в одну строку-плашку и обратно.
2. Путь виден в развёрнутой плашке (вторая строка).
3. Псевдоним корня вместо имени; сохраняется в workspace-файле.
4. Перестановка плашек; сохраняется в workspace-файле (это уже порядок
   массива `folders` — спека workspace-file).

## Решения

- **D1. Сворачивание секции.** Клик по строке заголовка (кроме кнопок) и по
  chevron сворачивает/разворачивает секцию. Свёрнуто — секция занимает одну
  строку: chip, chevron, harness-значок, псевдоним/имя; дерево и loader
  скрыты. Состояние — `collapsedRoots` в `fileStore`, **session-only** (в
  workspace-файл не пишем) — по прецеденту `expandedPaths`; сброс при
  удалении корня и смене workspace.

- **D2. Псевдоним.** `alias?: string` в `RootInfo` и `WorkspaceFolder`.
  Валидация: опционально, непустая строка после trim, до 100 символов.
  Отображение: `alias ?? getFileName(path)`. Тултип плашки всегда показывает
  реальное имя и полный путь, даже при псевдониме. Редактирование: пункт
  контекст-меню плашки «Псевдоним…» -> диалог по образцу `RenameModal`
  (через `uiStore`), с кнопкой «Очистить» (снять псевдоним).

- **D3. Путь в плашке.** Развёрнутая секция — заголовок двухстрочный:
  строка 1 — псевдоним/имя (subheader), строка 2 — полный путь (caption-2,
  secondary, ellipsis). Свёрнутая — одна строка, только псевдоним/имя (как
  просил пользователь). Полный путь по-прежнему в `title`-тултипе.

- **D4. Порядок плашек.** Пункты контекст-меню «Сдвинуть выше»/«Сдвинуть
  ниже» (disabled на краях) -> `moveRoot`. Порядок = порядок массива
  `folders` в workspace-файле (так уже устроено чтение), автозапись.
  Drag-and-drop заголовком НЕ делаем: окно слушает window-level
  `onDragDropEvent` (`src/hooks/useDragDrop.ts`), конфликт внутреннего HTML5
  DnD с перехватом Tauri на WebView2 не проверен — вернуться при запросе.

- **D5. Формат workspace-файла.** `version` остаётся **1**, `alias` —
  опциональное поле записи `folders`. Старые файлы читаются как раньше
  (поля нет); файл с `alias` читается старой версией парсера без ошибок
  (неизвестные поля не отвергаются) — совместимость в обе стороны.
  Состояние свёрнутости в файл не пишется (D1). Автозапись — существующий
  механизм (`autoSaveWorkspace`), вызывается и из `setRootAlias`, и из
  `moveRoot`.

- **D6. Store.** `fileStore`: `setRootAlias(path, alias: string | null)`,
  `moveRoot(path, "up" | "down")`, `collapsedRoots: Record<string, boolean>`,
  `toggleRootCollapsed(path)`. Селекторы — только стабильные ссылки
  (LESSONS_LEARNED §3).

- **D7. i18n.** Новые ключи `sidebar.moveUp`, `sidebar.moveDown`,
  `sidebar.setAlias`, `modal.aliasTitle`, `modal.aliasApply`,
  `modal.aliasClear` и пр. — ru и en.

## Скоуп кода

| Файл | Изменение |
|---|---|
| `src/lib/rootColors.ts` | `RootInfo.alias?: string` |
| `src/lib/workspaceFile.ts` | `WorkspaceFolder.alias?`, parse/serialize с валидацией |
| `src/store/fileStore.ts` | `setRootAlias`, `moveRoot`, `collapsedRoots`, `toggleRootCollapsed`; сброс при removeRoot/смене workspace |
| `src/components/Sidebar/RootSection.tsx` | chevron + toggle, вторая строка пути, пункты меню выше/ниже/псевдоним |
| `src/components/Sidebar/Sidebar.css` | двухстрочный заголовок, chevron, collapsed-состояние |
| `src/components/Modals/AliasModal.tsx` (новый) + `src/store/uiStore.ts` | диалог псевдонима по образцу `RenameModal` |
| `src/locales/{ru,en}/translation.json` | ключи D7 |
| `src/lib/workspaceFile.test.ts`, `src/store/fileStore.test.ts` | alias round-trip, moveRoot, setRootAlias, collapse |

## Проверки

- `pnpm test` — новые юнит-тесты: parse/serialize с `alias` (есть/нет/пустой),
  `moveRoot` на краях и в середине, `setRootAlias` (задать/очистить),
  round-trip файл -> стор -> файл.
- `npx tsc --noEmit`, `npx vite build`.
- Ручная приёмка (чек-лист в result): создать псевдоним, свернуть/развернуть,
  переставить плашки, перезапуск приложения (порядок и псевдонимы
  восстановлены, свёрнутость — нет), старый workspace-файл без `alias`
  читается.

## Риски

- Двухстрочный заголовок съедает высоту сайдбара — компенсируется самой
  фичей сворачивания.
- Псевдоним маскирует реальное имя — тултип с полным путём обязателен (D2).
- Регресс автозаписи workspace — покрыть тестом, что `moveRoot`/`setRootAlias`
  пишут файл.

## Часть 2 — обзор UX (после приёмки части 1)

Агент проходит по приложению (дерево, табы, редактор, статус-бар, диалоги) и
предлагает короткий список UX-улучшений с приоритетами; выбор — за
пользователем; реализация — отдельными задачами. В этой задаче не делаем.

## Где читать

1. `src/components/Sidebar/RootSection.tsx` — текущая плашка.
2. `openspec/specs/workspace-file/spec.md` — формат и автозапись.
3. `src/lib/workspaceFile.ts` — парсер/сериализатор v1.
