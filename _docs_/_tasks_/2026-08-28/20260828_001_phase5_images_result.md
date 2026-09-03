# Phase 5: отображение локальных изображений (result)

> Дата: 2026-08-31 (реализация 2026-08-28–31)
> Контекст:
> - `_tasks_/2026-08-28/20260828_001_phase5_images_final.md` — план фазы
> - `_docs_/GRAMAX_RESEARCH_RESULT.md` — исследование gramax (идея src/renderSrc)
> - Коммиты: `3cd4bcf` (asset protocol + резолвер + nodeView + превью),
>   `528189c` (кнопка «Восстановить ссылки»), `3e283c6` (сериализация angle-форма),
>   `bece0ff` (приоритет nodeView), anydoc `00bc713` (регрессионный тест)

## Что сделано

По плану фазы (final §3), всё реализовано; в ходе приёмки добавились два
фикса, не предусмотренных планом (см. «Находки приёмки»).

| Область | Файл | Что |
|---|---|---|
| Конфиг | `src-tauri/tauri.conf.json`, `Cargo.toml` | `assetProtocol` + feature `protocol-asset` |
| Rust | `src-tauri/src/commands/fs.rs`, `lib.rs` | команда `grant_asset_scope` (runtime-грант, рекурсивно) |
| Гранты | `src/store/fileStore.ts`, `src/hooks/useTauriFS.ts` | грант при открытии папки / одиночного файла / переименовании корня |
| Резолвер | `src/lib/resolveImageSrc.ts` | чистая утилита: относительные, `../`, root-relative, %-decode, `\_`-чистка, внешние skip; `toAssetUrl` (convertFileSrc, isTauri-guard) |
| WYSIWYG | `src/lib/imageSrcExtension.ts` | nodeView image-ноды (приоритет Highest) + override сериализатора (angle-форма) |
| Превью | `src/components/EditorArea/SplitPreview.tsx`, `SplitView.tsx` | `basePath`/`rootPath`, DOM-проход `img[src]`, DOMPurify `ALLOWED_URI_REGEXP` + `asset:` |
| Кнопка | `src/lib/restoreCyrillicUrls.ts`, локали | «Восстановить ссылки»: %-кириллица + `\_-escape` в destinations |

## Находки приёмки (важно для следующих сессий)

1. **Сериализатор Gravity ломал пути** (`3e283c6`): штатный `imageToMarkdown`
   пишет src через `state.esc()` (`V2\_ТЗ`) и голым текстом — путь с пробелами
   перестаёт быть валидной ссылкой при WYSIWYG→Markup. Переопределено через
   `overrideNodeSerializerSpec`: пробелы/скобки → `![](<...>)`.
2. **Конфликт nodeViews** (`bece0ff`): preset `'full'` включает Yfm ImgSize, чей
   плагин регистрирует свой nodeView на ту же ноду `image` раньше
   extraExtensions; при одноимённых записях prosemirror-view берёт первый
   источник. Лечение: `addPlugin(cb, builder.Priority.Highest)`. Урок записан
   в `LESSONS_LEARNED.md` §10.
3. «Призрачный провал» на первой проверке пользователя: приложение работало
   на старом бинарнике (порт 1420 держал dev-сервер, запущенный до правок).
   Диагностика таких случаев — `netstat -ano | findstr :1420` + `tasklist`.

## Проверки

- vitest: **76/76** (новые: resolveImageSrc 14, imageSrcExtension-сериализатор 4,
  sanity plugin-nodeViews 1, расширение restoreCyrillicUrls +4).
- `npx tsc --noEmit` — чисто; `cargo test` vasyavig — 8/8; anydoc — 2 новых
  регрессионных теста зелёные.
- Ручная проверка пользователя (2026-08-31, dev-режим, Windows): ТЗ после
  конвертации anydoc — 36 картинок отображаются в WYSIWYG
  (`http://asset.localhost/...`, loaded). Файл конвертера подтверждён: anydoc
  пишет корректную angle-форму `![](<...>)`.

## Известные ограничения

- Наш nodeView заменяет React-view ImgSize — ручки ресайза картинок в WYSIWYG
  недоступны (осознанно; при необходимости — композиция view отдельной задачей).
- `../` выше открытой папки не отображается (ограничение scope).
- `#`/`?` в именах файлов в markdown-URL принципиально ненадёжны.
- Production build (`pnpm tauri build`) после Phase 5 не проверялся (dev — да).
- Split-превью и Markup-форма проверены попутно, без отдельного протокола.

## Где читать дальше

- `_docs_/_phases_/Phase_05.md` — свод фазы.
- `LESSONS_LEARNED.md` §10 — конфликт nodeViews.
- `_docs_/GRAMAX_RESEARCH_RESULT.md` — источник идеи src/renderSrc и задел
  на mermaid/таблицы.
