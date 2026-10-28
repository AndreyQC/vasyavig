# 20261028_002 — Удобство плашек открытых директорий (result)

> Контекст:
> - `_tasks_/2026-10-28/20261028_002_root_section_ux_plan.md` — план, D1–D7
> - `_docs_/_checkpoints_/20261028_002_checkpoint.md`

Дата: 2026-10-28 | Ветка: dev | Код: `523c1d1` | Статус: реализовано, ручная
приёмка пользователем ожидается

## Что сделано

| Файл | Изменение |
|---|---|
| `src/lib/rootColors.ts` | `RootInfo.alias?: string` — псевдоним корня |
| `src/lib/workspaceFile.ts` | `WorkspaceFolder.alias?`, `ALIAS_MAX_LENGTH=100`, `normalizeAlias` (trim/пустой=отсутствие/нестроковый=ошибка формата), serialize пишет alias только непустой |
| `src/store/fileStore.ts` | `collapsedRoots` (session-only), `setRootAlias` (trim+лимит, пустое=снять), `moveRoot("up"\|"down")`, `toggleRootCollapsed`; сброс `collapsedRoots` в removeRoot/newWorkspaceFile/replaceRoots; ремап свёрнутости при renameEntry корня; alias читается при openWorkspaceFile |
| `src/store/uiStore.ts` | `pendingAliasPath` + сеттер (диалог псевдонима) |
| `src/components/Sidebar/RootSection.tsx` | клик по заголовку и chevron сворачивают секцию (одна строка: chip+chevron+harness+имя); в развёрнутой — вторая строка с полным путём (caption-2, ellipsis); тултип заголовка всегда реальное имя+путь; меню: Псевдоним…/Выше/Ниже/Цвет/Убрать (края disabled) |
| `src/components/Sidebar/Sidebar.css` | cursor:pointer+user-select на заголовке, `.root-section__chevron`, `.root-section__path`, модификатор `--collapsed` |
| `src/components/Modals/AliasModal.tsx` (новый) | диалог псевдонима по образцу RenameModal: Сохранить/Очистить/Отмена, лимит 100 через controlProps; зарегистрирован в `App.tsx` |
| `src/locales/{ru,en}/translation.json` | `sidebar.setAlias/moveUp/moveDown`, `modal.aliasTitle/aliasText/aliasApply/aliasClear` |

Решения — по плану D1–D7 без отклонений. Drag-and-drop плашек не делался
(D4: window-level `onDragDropEvent` в `useDragDrop.ts`, конфликт с внутренним
HTML5 DnD на WebView2 не проверен).

## Проверки

- `pnpm test` — **338 passed / 29 файлов** (было 323): parse/serialize alias
  (есть/пробельный/trim/нестроковый/обрезка/roundtrip), `openWorkspaceFile`
  восстанавливает alias, `setRootAlias` (задать/снять/no-op), `moveRoot`
  (вверх/вниз/края + порядок в файле), `toggleRootCollapsed` (не пишет в
  файл), removeRoot/renameEntry и свёрнутость.
- `npx tsc --noEmit` — чисто.
- `npx vite build` — ок.

## Известные ограничения

- Свёрнутость секций session-only — после рестарта все секции развёрнуты
  (осознанно, D1).
- `moveRoot` по одному шагу за клик — при большом числе корней неудобно;
  DnD остаётся кандидатом (см. D4).
- В свёрнутой секции путь не виден (только тултип) — по требованию «одна
  строка с псевдонимом».

## Чек-лист ручной приёмки (dev-сборка `pnpm tauri dev`)

1. Плашка корня: клик по строке заголовка сворачивает секцию в одну строку,
   повторный клик разворачивает; chevron отражает состояние.
2. В развёрнутой секции под именем виден полный путь (обрезается многоточием,
   в тултипе полный).
3. Кнопки «цвет» и «убрать» в заголовке НЕ сворачивают секцию.
4. Контекст-меню по правому клику на плашке: «Псевдоним…» открывает диалог с
   именем папки; введённый псевдоним показывается в плашке; «Очистить»
   возвращает имя папки.
5. Тултип плашки при псевдониме показывает `псевдоним — путь`.
6. «Сдвинуть выше/ниже» переставляют секции; на первом/последнем корне пункт
   задизейблен.
7. После перестановки и псевдонима: в workspace-файле на диске порядок
   `folders` новый, у записи есть `alias` (JSON, version 1).
8. Перезапуск приложения: порядок и псевдонимы восстановлены, свёрнутость —
   нет (все секции развёрнуты).
9. Старый workspace-файл без `alias` читается без ошибок.
10. Плашки в редакторе (табы) и дашборд задач работают как раньше.

## Где читать

1. `_tasks_/2026-10-28/20261028_002_root_section_ux_plan.md` — решения D1–D7.
2. `openspec/specs/workspace-file/spec.md` — формат v1 (alias — опциональное
   поле, спека не менялась).
