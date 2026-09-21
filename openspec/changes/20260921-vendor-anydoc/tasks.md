# Tasks

## 1. Вендоринг крейта anydoc

- [x] 1.1 Скопировать из локального форка (ветка `feat/to-markdown-with-assets`,
  HEAD `00bc713`) в `vendor/anydoc/`: `src/`, `examples/convert.rs`, `README.md`,
  `LICENSE`. Проверка: `diff -r` с источником по этим каталогам пуст.
- [x] 1.2 В `vendor/anydoc/Cargo.toml` удалить секцию `[workspace]` (members
  `node`/`python`/`wasm` не вендорятся); остальное не трогать. Проверка:
  `cargo metadata --no-deps` в `vendor/anydoc` выполняется без ошибок.
- [x] 1.3 Создать `vendor/anydoc/PROVENANCE.md`: апстрим
  `https://github.com/firecrawl/anydoc`, база `bf3d33e` (v0.2.3), дельта форка
  (`0896108` feat to_markdown_with_assets, `00bc713` test underscores), дата
  вендоринга, процедура обновления по design.md D4. Проверка: файл содержит
  все пункты из требования спеки о provenance.

## 2. Переключение зависимости

- [x] 2.1 В `src-tauri/Cargo.toml` заменить зависимость на
  `anydoc = { path = "../vendor/anydoc" }`; выполнить `cargo update -p anydoc`
  (перепривязка `Cargo.lock` на path-источник). Проверка: в `Cargo.lock` у
  anydoc нет записи о старом источнике; `cargo check` в `src-tauri` проходит.

## 3. Проверки

- [x] 3.1 Имитация чистого клона (design.md D5): временно переименовать
  `C:/repos/github/anydoc`, выполнить `cargo build` в `src-tauri`, вернуть имя.
  Проверка: сборка успешна при отсутствующем внешнем каталоге.
- [x] 3.2 Прогнать inline-тесты вендоренной копии: `cd vendor/anydoc &&
  cargo test`. Проверка: тесты, включая добавленные форком
  (to_markdown_with_assets, underscores), проходят.
- [x] 3.3 Прогнать тесты приложения: `cd src-tauri && cargo test`
  (file_service, spellcheck). Проверка: результаты не хуже исходных.
- [ ] 3.4 Ручная проверка конвертации (сценарий спеки): `pnpm tauri dev`,
  конвертировать .docx со встроенным изображением. Проверка: создаётся
  markdown, картинка в `<имя>_assets/`, ссылка `![...](<имя>_assets/...)`
  корректна.
  (Headless-эквивалент 2026-09-21 выполнен: `to_markdown_with_assets` на
  `handmade-rich.docx` из фикстур форка — markdown + `richsample-0.png` /
  `richsample-1.bin` в `richsample_assets/`, ссылки корректны. GUI-проход
  остаётся как пользовательская приёмка.)

## 4. Документация и валидация

- [x] 4.1 Обновить `README.md`: удалить примечание о необходимости
  репозитория `C:/repos/github/anydoc` для сборки; кратко упомянуть
  `vendor/anydoc` и PROVENANCE.md. Проверка: `grep -i "C:/repos" README.md`
  пуст.
- [x] 4.2 Валидация OpenSpec: `openspec validate` для change проходит;
  спека `build-self-containment` согласована с артефактами.
