# Phase 5: Отображение локальных изображений

> Дата: 2026-08-28 – 2026-08-31 | Статус: завершена (ручная проверка пользователя пройдена)
> План/результат: `_tasks_/2026-08-28/20260828_001_phase5_images_{final,result}.md`
> Предыдущая фаза: `Phase_04.md`

## Цель фазы

1. Картинки с относительными `src` отображаются в WYSIWYG и Split-превью.
2. Отображение не меняет файл: raw `src` сериализуется как есть, вкладка не
   dirty от простого открытия.
3. Пути: латиница, кириллица (raw и %-encoded), пробелы, `./`/`../`,
   root-relative `/x`; внешние `http(s):`/`data:` не трогаем.
4. Кнопка «Восстановить ссылки» чинит существующие файлы (%-кириллица + `\_`).

## Что сделано

| Область | Файл | Что изменилось |
|---|---|---|
| Конфиг | `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` | asset protocol включён (scope пуст) + feature `protocol-asset` |
| Rust | `src-tauri/src/commands/fs.rs`, `src-tauri/src/lib.rs` | команда `grant_asset_scope(path)` — рантайм-грант каталога (рекурсивно) |
| Гранты | `src/store/fileStore.ts`, `src/hooks/useTauriFS.ts` | гранты при открытии папки/файла/переименовании корня (идемпотентно) |
| Резолвер | `src/lib/resolveImageSrc.ts` (+14 тестов) | `resolveLocalImagePath` / `toAssetUrl` / `isExternalSrc`; %-decode, `\_`-чистка, нормализация путей |
| WYSIWYG | `src/lib/imageSrcExtension.ts` (+4 теста сериализатора) | nodeView image-ноды с asset-URL (приоритет Highest); сериализация angle-формой `![](<...>)` |
| Превью | `src/components/EditorArea/SplitPreview.tsx`, `SplitView.tsx` | DOM-проход `img[src]` между transform и sanitize; `ALLOWED_URI_REGEXP` + `asset:` |
| Кнопка | `src/lib/restoreCyrillicUrls.ts`, `src/hooks/useMarkdownTools.ts`, `src/locales/{ru,en}/` | расширена до «Восстановить ссылки»: unescape `\_` в destinations |
| Тесты | `src/lib/pluginNodeViews.sanity.test.ts`, `vitest.config.ts` | sanity plugin-nodeViews; css-stub для vitest; devDep jsdom |
| anydoc (форк) | `anydoc/src/render/markdown/tests.rs` | 2 регрессионных теста: `_` в destinations не экранируется |

Коммиты: `3cd4bcf`, `528189c`, `3e283c6`, `bece0ff`; anydoc `00bc713`.

## Ключевые архитектурные решения

- **Встроенный asset protocol** вместо кастомного протокола (как `gx-fs` в
  gramax): ноль транспорта, `convertFileSrc` из `@tauri-apps/api`. У gramax
  взята только идея разделения сырого `src` (в файл) и переписанного URL
  (только показ) — `GRAMAX_RESEARCH_RESULT.md` §1.4.
- **Runtime-грант scope** (USER_INPUT #1): статический scope пуст, доступ
  выдаётся только открытым пользователем папкам/файлам.
- **НЕ через `normalizeLink`** — он кругооборотит в сохраняемый markup (урок
  Phase 4); переписывание только на уровне отображения.
- **Приоритет плагина Highest** (USER_INPUT-вне): одноимённые nodeViews —
  первый источник побеждает; ImgSize из preset `'full'` надо перекрывать
  явно (`LESSONS_LEARNED.md` §10).
- **anydoc не правился**: текущий `format_url` уже пишет корректные
  destinations (проверено); старые артефакты лечит кнопка.

## Проверки

- vitest 76/76; `npx tsc --noEmit` чисто; `cargo test` 8/8; anydoc — 2 новых
  теста зелёные.
- Ручная проверка (2026-08-31, dev, Windows): конвертированное ТЗ (36 картинок,
  кириллица/пробелы/тройные пробелы в путях) — отображаются в WYSIWYG.

## Известные ограничения / NOT done

- Ручки ресайза картинок ImgSize в WYSIWYG недоступны (наш nodeView заменяет
  React-view ImgSize); вернуть композицией — отдельная задача.
- `../` выше открытой папки — битая иконка (ограничение scope).
- Вставка картинок из буфера/drag-and-drop (write path) — беклог.
- Lazy-loading, индикатор битых картинок — беклог.
- Production build не проверялся (dev — да); PR `dev` -> `main` — по-прежнему
  следующий шаг проекта.

## Где читать дальше

- `_tasks_/2026-08-28/20260828_001_phase5_images_result.md` — детали и коммиты.
- `_docs_/GRAMAX_RESEARCH_RESULT.md` — задел на mermaid в WYSIWYG и
  Notion-подобные таблицы (следующие фазы-кандидаты).
- `LESSONS_LEARNED.md` §10 — конфликт nodeViews в Gravity-редакторе.
