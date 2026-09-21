# Proposal

## Why

Проект не собирается ни на одной машине, кроме машины автора: `src-tauri/Cargo.toml`
подключает anydoc по абсолютному пути `C:/repos/github/anydoc` — локальному клону
`firecrawl/anydoc` с приватной веткой `feat/to-markdown-with-assets` (функция
`to_markdown_with_assets`, ~135 строк поверх v0.2.3). Любой другой разработчик,
клонировавший репозиторий, получает нерабочую сборку, а будущий CI окажется в той
же ловушке.

## What Changes

- Вендорим крейт anydoc внутрь репозитория: каталог `vendor/anydoc/` с `src/`
  (76 файлов, ~1.1 МБ), `Cargo.toml`, `LICENSE` (MIT), `README.md` и новым
  `PROVENANCE.md` (происхождение, базовый коммит, дельта форка, процедура
  обновления).
- Из вендоренной копии `Cargo.toml` удалена секция `[workspace]` (её members
  `node`/`python`/`wasm` не вендорятся).
- `src-tauri/Cargo.toml`: зависимость переключена с абсолютного пути на
  относительный `path = "../vendor/anydoc"`; `Cargo.lock` перегенерирован.
- `README.md`: примечание «для сборки нужен репозиторий по пути
  C:/repos/github/anydoc» удалено — сборка теперь самодостаточна.
- Тесты и фикстуры anydoc (2.1 МБ) в репозиторий не входят: разработка и
  прогон тестов форка остаются в локальном клоне `C:/repos/github/anydoc`.
- Поведение приложения не меняется: код конвертации байт-в-байт тот же,
  `src-tauri/src/commands/convert.rs` не трогается.

## Capabilities

### New Capabilities

- `build-self-containment`: репозиторий собирается из чистого клона без
  внешних локальных путей; вендоренные крейты документированы (provenance,
  лицензия) и обновляются по явной процедуре.

### Modified Capabilities

(нет: конвертация документов как capability ранее не специфицировалась, её
поведение в этом change не меняется)

## Impact

- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` — источник зависимости anydoc.
- Новый каталог `vendor/anydoc/` в git (~1.1 МБ рабочего дерева, ~0.5 МБ в паке).
- `README.md` — раздел «Как запустить».
- Побочный эффект для автора: правки форка anydoc теперь синхронизируются в
  `vendor/` вручную (процедура в `vendor/anydoc/PROVENANCE.md`).
- Возможный будущий трек (вне скоупа): PR `to_markdown_with_assets` в апстрим
  `firecrawl/anydoc` — после релиза вендор можно удалить и вернуться на crates.io.
