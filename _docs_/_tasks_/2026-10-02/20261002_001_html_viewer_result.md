# Просмотр HTML-файлов (письма-черновики) — результат

> Дата: 2026-10-02 | Ветка: dev | Коммиты: `bdf268b` (код), `8711628` (артефакты change)

> Контекст:
> - План: `_docs_/_tasks_/2026-10-02/20261002_001_html_viewer_plan.md`
> - Артефакты: `openspec/changes/20261002-html-viewer/` (proposal, спека, design, tasks)

## Что сделано

OpenSpec-change `20261002-html-viewer`: 7/8 задач, спека валидна.

| Файл | Что изменилось |
|---|---|
| `src/lib/constants.ts` | `HTML_EXTENSIONS = ["html", "htm"]` |
| `src/lib/utils.ts` | `FileKind "+html"`, ветка в `getFileKind`, `html/htm → html` в `MONACO_LANG_MAP` |
| `src/lib/htmlCsp.ts` | новый: `injectCspMeta(html)` — CSP-мета после `<head>`/`<html>`/пролога, идемпотентно (design D2) |
| `src/components/EditorArea/HtmlViewer.tsx` | новый: тоггл «Просмотр / Исходник»; iframe `srcdoc + sandbox=""`; Monaco read-only |
| `src/App.tsx` | маршрутизация `kind === "html"` → `HtmlViewer` |
| `src/hooks/useTauriFS.ts` | HTML-фильтр в диалоге Ctrl+O |
| `src/locales/{ru,en}/translation.json` | ключи `html.viewRendered` / `html.viewSource` |
| `src/components/EditorArea/EditorArea.css` | `.html-viewer*`: flex-колонка, «лист» с рамкой, белый фон iframe |
| `src/lib/utils.test.ts`, `src/store/fileStore.test.ts`, `src/lib/htmlCsp.test.ts` | +12 тестов |

Store (editorStore/fileStore) не менялся: read-only семантика image/email
покрыла html-вкладку без правок (`isSavableKind` не тронут).

## Проверки

- `pnpm test` — **177/177** (было 165): +3 utils (kind, monaco lang),
  +2 fileStore (readFile-чтение, preview-вкладка), +7 htmlCsp.
- `npx tsc --noEmit` — чисто; `npx vite build` — ок (chunk-warning прежний).
- `openspec validate 20261002-html-viewer` — ok.

## Известные ограничения / NOT done

- **4.2 GUI-приёмка пользователем** — единственная незакрытая задача:
  `pnpm tauri dev`, файл-пример из запроса (рендер, песочница, исходник,
  Ctrl+S, preview-семантика, тёмная тема). До неё change не архивируется.
- Внешние ресурсы документа блокируются CSP (privacy: трекинг-пиксели);
  ослабление — отдельный будущий change.
- Ссылки в документе не открываются вовсе (ни внутри, ни внешним браузером) —
  shell-plugin вне скоупа.
- Не-UTF-8 кодировки и локальные ресурсы рядом с файлом не поддерживаются
  (premise: файлы самодостаточны, utf-8).
- Рендер HTML-части `.eml` по-прежнему отсутствует (спека eml-viewer это
  фиксирует; пересмотр — будущий change).

## Где читать дальше

- Спека: `openspec/changes/20261002-html-viewer/specs/html-viewer/spec.md`
  (5 требований: открытие, рендер, изоляция, исходник, read-only).
- Design-решения: `openspec/changes/20261002-html-viewer/design.md` (D1–D5).
