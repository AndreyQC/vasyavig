# Phase 3: Конвертация офисных документов в Markdown (anydoc) — plan

> Контекст:
> - `_docs_/_checkpoints_/20260827_001_checkpoint.md` — структура фаз
> - `_docs_/_phases_/Phase_01.md` — архитектура MVP (FS-команды, табы, типы файлов)
> - `LESSONS_LEARNED.md` — §3 (dirty/контент в store)
> - anydoc: crate `anydoc` v0.2.3, локальный репозиторий `C:\repos\github\anydoc`
>   (Rust, конвертация Word/PowerPoint/Excel/ODF/RTF/EPUB/CSV/PDF в GFM Markdown)
> - Дата: 2026-08-27

## Цель фазы

Открытие офисных документов в Vasyavig: файл конвертируется в Markdown библиотекой
anydoc и открывается как markdown-документ, который можно отредактировать и сохранить
как `.md`. Исходный (бинарный) файл при этом никогда не перезаписывается.

## Объём и границы

**Входит:**
- Rust-зависимость `anydoc` и Tauri-команда `convert_to_markdown(path)`.
- Распознавание офисных расширений на фронтенде (новый `FileKind = "office"`).
- Открытие офисного файла: конвертация → новая вкладка с markdown-контентом.
- Редактирование результата и «Сохранить как» в `.md`.
- Обработка ошибок конвертации (encrypted / unsupported / malformed → toast).

**Не входит (Phase 4+/беклог):**
- Извлечение встроенных изображений/объектов в файлы (anydoc хранит их в модели
  документа, а в markdown-строку пишет только alt-text).
- OCR для сканированных PDF (anydoc этого не делает).
- Батч-конвертация папки; draw.io и остальной беклог §11.

## Архитектура

| Слой | Путь | Что меняется |
|---|---|---|
| Зависимость | `src-tauri\Cargo.toml` | добавить `anydoc = "0.2.3"` |
| Команда | `src-tauri\src\commands\convert.rs` (новый) | `convert_to_markdown(path) -> Result<String, String>` |
| Регистрация | `src-tauri\src\lib.rs` | добавить в `generate_handler!` |
| Обёртка invoke | `src\hooks\useTauriFS.ts` | `convertToMarkdown(path)`; расширить фильтры диалога открытия |
| Константы | `src\lib\constants.ts` | `OFFICE_EXTENSIONS` |
| Типы | `src\lib\utils.ts` | `FileKind` + `"office"`; `getFileKind` |
| Открытие файла | `src\store\fileStore.ts` | ветка office → convert → openTab |
| Вкладки/save | `src\store\editorStore.ts` | saveActiveAs для office; kind после Save As |
| Рендер | `src\App.tsx` | office рендерится как markdown-редактор |

## Разбивка на шаги

### Шаг 1. Подключить anydoc

- `src-tauri\Cargo.toml`: добавить зависимость.
  - Рекомендация: `anydoc = "0.2.3"` (crates.io — воспроизводимо, это опубликованный крейт).
  - Альтернатива для параллельной доработки anydoc: `anydoc = { path = "C:/repos/github/anydoc" }`
    (абсолютный путь машинозависим; для CI/репозитория лучше crates.io или git-ревью).
- Toolchain: anydoc требует Rust ≥ 1.88 (edition 2024); Vasyavig — 1.90+ (README) — ок.
- Совместимость: anydoc тянет `zip`, `quick-xml`, `pdf-inspector`, `cfb`, `csv`,
  `flate2`, `encoding_rs`, `log` — конфликтов с текущими зависимостями нет.

### Шаг 2. Rust-команда

- Новый `src-tauri\src\commands\convert.rs`:
  - `convert_to_markdown(path: String) -> Result<String, String>` —
    `anydoc::to_markdown(Path::new(&path)).map_err(|e| e.to_string())`.
  - `ConvertError` покрывает `Unsupported`, `Malformed`, `Encrypted`, `ResourceLimit`,
    `MissingPart`, `Io`.
- Зарегистрировать в `src-tauri\src\lib.rs` (`generate_handler!`).
- Команда `async` (как fs-команды) — конвертация не блокирует UI; медиана anydoc < 5 мс.

### Шаг 3. Frontend: тип файла

- `src\lib\constants.ts`: `OFFICE_EXTENSIONS` — `doc, docx, docm, ppt, pps, pot, pptx,
  pptm, ppsx, ppsm, xls, xlsx, xlsm, xlsb, odt, ods, odp, rtf, epub, csv, pdf`.
- `src\lib\utils.ts`: `FileKind = "markdown" | "text" | "office" | "unsupported"`;
  в `getFileKind` добавить проверку `OFFICE_EXTENSIONS` перед `"unsupported"`.

### Шаг 4. Открытие и конвертация

- `src\hooks\useTauriFS.ts`:
  - `convertToMarkdown(path): Promise<string>` через `invoke("convert_to_markdown", ...)`.
  - Расширить `openFileDialog` фильтром Office (сейчас только Markdown и Text).
- `src\store\fileStore.ts` (`openFile`): для `kind === "office"` —
  `convertToMarkdown(path)` → `useEditorStore.openTab({path, kind: "office", content})`.
  При ошибке — `setError(...)` (toast). Drag-and-drop офисных файлов наследует поведение
  через тот же `openFile`.

### Шаг 5. Рендер и сохранение

- `src\App.tsx`: `activeTab.kind === "office"` рендерить как markdown-редактор
  (условие `markdown || office` → `MarkdownEditor` / `SplitView`).
- `src\store\editorStore.ts`:
  - `saveActiveAs` — разрешить `kind === "office"`, default-путь диалога
    `replaceExtension(tab.path, "md")` (вместо `.docx`).
  - После подтверждённого Save As (`writeAndMove`) — обновить `kind: "markdown"`.
  - `saveActive` (Ctrl+S) для `office` оставить no-op (уже отсекается `kind !== "markdown"`),
    чтобы случайно не перезаписать бинарный исходник.

### Шаг 6. Ошибки и i18n

- Маппинг ошибок anydoc в понятные сообщения: `Encrypted` → «файл зашифрован»,
  `Unsupported`/`Malformed` → «не удалось извлечь содержимое», `Io` → «не удалось
  прочитать файл».
- Строки переводов в `src\locales\{ru,en}\` для нового типа файла и ошибок конвертации.

## Решения (неочевидные)

- Источник anydoc: crates.io `0.2.3` по умолчанию; локальный `path` — только если
  параллельно дорабатываем anydoc.
- Отдельный `kind: "office"` вместо «markdown с путём `.docx`» — исходник не
  перезаписывается, сохранение только через «Сохранить как» в `.md`.
- Результат редактируемый (не read-only) — соответствует назначению редактора.

## Риски

- Перезапись бинарного исходника по Ctrl+S — закрывается `kind: "office"` и тем, что
  `saveActive` не обрабатывает office.
- Большие PDF/docx: команда async, но на очень крупных файлах возможна задержка —
  при необходимости добавить индикатор загрузки в табе.
- Изображения в markdown будут alt-text без извлечения файлов — явное ограничение Phase 3.
- Не сломать существующие пути markdown/text при расширении `getFileKind`.

## Проверки

- `cd src-tauri && cargo test` — unit для `convert_to_markdown` (фикстуры `.docx`/`.csv`).
- `pnpm test` — vitest для `getFileKind` (офисные расширения) и логики save office → Save As.
- `npx tsc --noEmit` — чисто.
- Ручные: открыть `.docx`/`.xlsx`/`.pdf` → markdown в редакторе; Ctrl+S не перезаписывает
  исходник; «Сохранить как» создаёт `.md`; зашифрованный/битый файл → toast.

## Где читать дальше

1. `C:\repos\github\anydoc\README.md` — API anydoc, форматы, ошибки.
2. `_docs_/_phases_/Phase_01.md` — FS-команды и табы, к которым добавляем конвертацию.
3. `LESSONS_LEARNED.md` — §3 (dirty/контент в store) — важно для вкладки office.
