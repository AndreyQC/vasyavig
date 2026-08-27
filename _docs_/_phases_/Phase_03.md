# Phase 3: Конвертация офисных документов в Markdown (anydoc)

> Дата: 2026-08-27
> Статус: завершён (реализовано и проверено в dev; PR в main — за пользователем)
> План: `_docs_/_tasks_/2026-08-27/20260827_002_phase3_anydoc_conversion_plan.md`

## Цель фазы

Открытие офисных документов (Word/PowerPoint/Excel/OpenDocument/RTF/EPUB/CSV/PDF) в
Vasyavig: при выборе файла показывается модалка «Создать Markdown-версию», anydoc
конвертирует документ в `.md`, извлекает изображения в соседнюю папку и проставляет
на них ссылки в markdown.

## Что сделано

### Rust (`src-tauri\src`)

| Файл | Что изменилось |
|---|---|
| `commands\convert.rs` | команда `convert_to_markdown` (anydoc + извлечение ассетов) |
| `Cargo.toml` | `anydoc` подключён path-зависимостью (локальный форк) |

### anydoc (форк `C:\repos\github\anydoc`)

| Файл | Что изменилось |
|---|---|
| `src\lib.rs` | публичная `to_markdown_with_assets` (пишет ассеты + собирает ссылки) |
| `src\render\markdown\mod.rs` | `Ctx.asset_links`, `document_to_markdown_with_assets` |
| `src\render\markdown\inline.rs` | встроенные изображения рендерятся как `![alt](...)` |

### Frontend (`src\`)

| Файл | Что изменилось |
|---|---|
| `lib\constants.ts` | `OFFICE_EXTENSIONS` |
| `lib\utils.ts` | `FileKind` + `"office"`, `getFileKind` |
| `hooks\useTauriFS.ts` | `convertToMarkdown`, фильтр Office в диалоге открытия |
| `store\fileStore.ts` | `openFile` → модалка; `convertOfficeToMarkdown` |
| `components\Modals\ConvertModal.tsx` | подтверждение конвертации |

## Ключевые архитектурные решения

- anydoc подключён локально (path), а не из crates.io: в 0.2.3 встроенные изображения
  рендерятся только alt-текстом; для «файлы + ссылки» добавлена `to_markdown_with_assets`.
- Исходник (бинарный) никогда не перезаписывается — конвертация всегда создаёт `.md` рядом.
- Изображения пишутся в `<имя>_assets/`, ссылки в markdown — `![...](<имя>_assets/<имя>-<id>.<ext>)`.

## Проверки

- `pnpm test` — 29/29 (vitest: `getFileKind` office).
- `cargo test --manifest-path src-tauri/Cargo.toml` — 8/8 (anydoc собран из path).
- `npx tsc --noEmit` — чисто.

## Известные ограничения / NOT done

- OCR для сканированных PDF не поддерживается (ограничение anydoc).
- Не-изображенческие embedded-объекты сохраняются как `.bin` без рендера.
- path-зависимость anydoc машинозависима (абсолютный путь) — для CI/релиза нужен git/published форк.

## Где читать дальше

1. `_docs_/_tasks_/2026-08-27/20260827_002_phase3_anydoc_conversion_plan.md` — план.
2. `C:\repos\github\anydoc\README.md` — API anydoc.
3. `_docs_/_phases_/Phase_02.md` — предыдущая фаза.
