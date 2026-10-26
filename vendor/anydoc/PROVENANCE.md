# PROVENANCE — vendored anydoc

## Что это

Вендоренная копия крейта [anydoc](https://github.com/firecrawl/anydoc) —
конвертер документов (doc/docx/odt/rtf/epub/pdf/презентации/таблицы/csv) в
GitHub-Flavored Markdown. Приложение использует единственную публичную
функцию `to_markdown_with_assets` (`src-tauri/src/commands/convert.rs`),
которая отсутствует в апстриме и live в локальном форке.

## Происхождение

| Параметр | Значение |
|---|---|
| Апстрим | https://github.com/firecrawl/anydoc (MIT) |
| База вендоринга | `bf3d33e` — upstream `main`, релиз v0.2.3 |
| Ветка форка | `feat/to-markdown-with-assets` |
| HEAD вендоренной копии | `00bc713` |
| Дельта форка | `0896108` feat(markdown): to_markdown_with_assets — встроенные изображения в файлы + ссылки; `00bc713` test(markdown): image destinations keep underscores unescaped (~135 строк) |
| Дата вендоринга | 2026-09-21 |
| Локальный форк для разработки | `C:/repos/github/anydoc` (не нужен для сборки) |

## Состав копии

Только то, что крейт считает пакетом (поле `include` его Cargo.toml):
`src/`, `examples/convert.rs`, `README.md`, `LICENSE`, `Cargo.toml`,
плюс этот файл. НЕ вендорятся: `tests/` (2.1 МБ фикстур и снапшотов),
`node/`, `python/`, `wasm/`, `bench/`, `fuzz/`, `scripts/`.

Единственное отличие `Cargo.toml` от апстрима: удалена секция `[workspace]`
(её members не вендорятся). Всё остальное — как в апстриме.

## Процедура обновления

Сборка ВСЕГДА идёт из этой копии (`src-tauri/Cargo.toml`:
`anydoc = { path = "../vendor/anydoc" }`), даже на машине автора.

1. Правки anydoc вести в локальном форке (там тесты и фикстуры;
   `cargo test` в корне форка).
2. Перенести изменения: скопировать `src/` (и при необходимости
   `examples/convert.rs`, `README.md`) из форка в `vendor/anydoc/`.
3. Восстановить правку `vendor/anydoc/Cargo.toml`: секции `[workspace]`
   быть не должно.
4. Обновить таблицу выше (база, HEAD, дельта, дата).
5. Если менялись зависимости крейта — перегенерировать
   `src-tauri/Cargo.lock` (`cargo update -p anydoc`).
6. Прогнать `cargo test` в `vendor/anydoc` и в `src-tauri`.

Долгосрочная альтернатива: предложить `to_markdown_with_assets` в апстрим;
после релиза в crates.io вендор можно удалить и вернуться к версионной
зависимости.
