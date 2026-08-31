# Phase 6: Текущая директория в шапке сайдбара + ревизия беклога

> Дата: 2026-08-31 | Статус: завершена
> Результат: `_tasks_/2026-08-31/20260831_001_sidebar_current_dir_final.md`

## Цель фазы

- Явно показывать название открытой директории в UI (вместо полного пути
  внизу панели).
- Актуализировать беклог roadmap: git-интеграция, Notion-таблицы, вставка
  картинок, ресайз картинок, mermaid.

## Что сделано

| Файл | Что изменилось |
|---|---|
| `src\components\Sidebar\SidebarHeader.tsx` | над кнопкой — label «Текущая директория» + имя папки bold (ellipsis, tooltip с полным путём); показ при открытой папке |
| `src\components\Sidebar\Sidebar.css` | `.sidebar-header__current-dir{,-name}`; `.sidebar-footer` удалён |
| `src\App.tsx` | удалён sidebar-footer с полным путём, почищены импорты |
| `src\locales\{ru,en}\translation.json` | `sidebar.currentDirectory`; `sidebar.openFolder` -> «Открыть директорию»/«Open directory» |
| `_docs_\roadmap.md` | беклог: новый пункт «Работа с git»; Notion-таблицы переформулированы под формат YFM `{% table %}` + `{% colwidth %}` (не поддержан текущими версиями Gravity/diplodoc); уточнены вставка картинок и ресайз |

## Ключевые решения

- Имя берётся `getFileName(rootPath)` из `src\lib\utils.ts` — без новых
  полей в store; полный путь доступен в тултипе.
- Notion-таблицы отложены в беклог: формат хранения `{% table %}` не
  поддерживается `@gravity-ui/markdown-editor` 15.44 и `@diplodoc/transform`
  4.77 (только `#|`-синтаксис, без colwidth) — требуется собственный
  парсер/сериализатор/превью-плагин (крупная фаза).

## Проверки

- `npx tsc --noEmit` — чисто.
- `npx pnpm@11.24.0 test` — 76/76.

## Известные ограничения / NOT done

- Переименование корневой папки извне приложения не отражается в шапке
  (обновится при повторном открытии).
- Notion-таблицы, git-интеграция — беклог.

## Где читать дальше

- `_tasks_/2026-08-31/20260831_001_sidebar_current_dir_final.md` — детали.
- `_docs_/roadmap.md` — беклог и кандидаты следующих фаз.
- `_checkpoints_/20260831_002_checkpoint.md` — снапшот после фазы.
