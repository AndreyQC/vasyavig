# Phase 5: отображение локальных изображений (draft)

> Дата: 2026-08-28
> Контекст:
> - `_docs_/roadmap.md` — Phase 5, состав фазы
> - `_docs_/GRAMAX_RESEARCH_RESULT.md` — исследование gramax (§1 изображения, §4 сводка)
> - `_docs_/USER_IDEA.md` — п. 4 (картинки не выводятся в редакторе) и п. 5 (escape-символы в ссылках)
> - `_docs_/_checkpoints_/20260827_002_checkpoint.md` — статус проекта

Статус: **draft** — есть открытые `USER_INPUT` (§6). После закрытия —
`20260828_001_phase5_images_final.md`.

## 1. Контекст проблемы

У WebView нет доступа к файлам рядом с документом: относительный `src` картинки
резолвится против origin приложения (`http://localhost:1420` в dev,
`http://tauri.localhost` в build) и даёт 404. Подтверждено пользователем
(`USER_IDEA.md` п. 4: «в Z всё видно, в редакторе нет»). Главный сценарий —
документы после конвертации anydoc: картинки лежат в `<имя>_assets/` рядом с
файлом и подключаются относительными путями.

Текущее состояние конфига: `tauri.conf.json` → `security.csp: null`,
`assetProtocol` отсутствует; capabilities — `core:default`, `opener:default`,
`dialog:*`; FS-операции — свои команды в `src-tauri/src/commands/fs.rs`
(без `tauri-plugin-fs`). `convertFileSrc` из установленной `@tauri-apps/api`
не используется.

Результат исследования gramax (GPL-3.0 — берём только идеи, не код): их
механизм — собственный протокол `gx-fs://` + blob-URL + in-process API, что
обслуживает мультиплатформенный FS-слой (web/WASM, git-fs, LFS). Для vasyavig
это overkill. Переносимая идея — **разделение сырого `src` (в файл) и
переписанного URL (только для показа)**.

## 2. Цели фазы

1. Картинки с относительными `src` отображаются в WYSIWYG и в Split-превью.
2. Отображение не меняет файл: raw `src` сериализуется как есть, вкладка не
   становится dirty от простого открытия/просмотра.
3. Пути покрываются: латиница, кириллица (raw и %-encoded), пробелы, вложенность
   `./`/`../`; внешние `http(s):`/`data:` не трогаем.
4. Escape-артефакты anydoc (`\_`) не мешают отображению.

## 3. Решения (проработка)

### 3.1 Транспорт — встроенный asset protocol

`tauri.conf.json`:

```json
"security": {
  "csp": null,
  "assetProtocol": {"enable": true, "scope": []}
}
```

- Статический scope пуст; доступ выдаётся в рантайме (3.2).
- Почему не кастомный протокол как в gramax: asset protocol — ядро Tauri,
  ноль нового Rust-кода и транспорта; `convertFileSrc(path)` уже в зависимостях.
- Формы URL: Windows `http://asset.localhost/<encoded>`, macOS/Linux
  `asset://<encoded>` — отсюда требование к DOMPurify (3.4).

### 3.2 Scope — runtime-грант открытых папок

Новая команда в `src-tauri/src/commands/fs.rs`:

```rust
#[tauri::command]
pub fn grant_asset_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(&path, true)   // рекурсивно
        .map_err(|e| e.to_string())
}
```

- Вызовы из фронта: открытие папки (`fileStore.ts` → `openFolderPathNow`,
  грант корня) и открытие одиночного файла (Ctrl+O / drag-and-drop — грант
  dirname файла). Повторные гранты идемпотентны.
- Ограничение (осознанное): `src` с `../`, выходящий за открытую папку, не
  отобразится (вне scope) — картинка останется битой. Безопасность важнее.

### 3.3 Резолвинг — чистая утилита `src/lib/resolveImageSrc.ts`

```ts
export function isExternalSrc(src: string): boolean;
export function resolveLocalImagePath(src: string, baseDir: string): string | null;
export function toAssetUrl(path: string): string;
```

- `isExternalSrc`: схема `^[a-zA-Z][a-zA-Z0-9+.-]*:` (http, https, data,
  mailto…), а также `#`-якоря — не переписываем (приём gramax).
- `resolveLocalImagePath`:
  - decode %-encoding с try/catch (старые файлы после конвертации могут нести
    закодированную кириллицу; Phase 4.2 чинит файл, но отображение должно
    работать и для незафиксированных);
  - снять markdown-escape в пути: `\_` → `_` (артефакт anydoc; только в памяти,
    файл не меняем);
  - join с `baseDir`, нормализация `./`, `../`, windows-сепараторов;
  - root-relative `/img.png` — резолв от `fileStore.rootPath`, если папка
    открыта, иначе skip (см. USER_INPUT #3);
  - абсолютный путь — как есть;
  - наружу — абсолютный путь или `null` (не переписываем).
- `toAssetUrl`: isTauri-guard (`'__TAURI_INTERNALS__' in window`) →
  `convertFileSrc(path)`; вне Tauri (vitest) — identity. Чистая логика
  тестируется без Tauri.

### 3.4 Превью — `SplitPreview.tsx`

- `SplitView.tsx` передаёт `basePath={getParentDir(tab.path)}` (helper уже есть
  в `src/lib/utils.ts`).
- Между `transform()` и `DOMPurify.sanitize()` — DOM-проход (DOMParser) по
  `img[src]`: `src → toAssetUrl(resolveLocalImagePath(src, basePath)) ?? src`.
  Регекс по строке не используем (кавычки, HTML-блоки) — DOM надёжнее; паттерн
  DOM-обработки в этом файле уже есть (mermaid-effect).
- DOMPurify: дефолтный URI-регексп может вырезать `asset:` (форма macOS/Linux)
  → передать расширенный `ALLOWED_URI_REGEXP` (дефолт + `asset:` схема).
  На Windows форма `http://asset.localhost` проходит и так, конфиг единый.

### 3.5 WYSIWYG — `imageSrcExtension` (nodeView)

Новый файл `src/lib/imageSrcExtension.ts` (паттерн — `anchorNavigationExtension.ts`):
ProseMirror-плагин с `props.nodeViews.image` — рендерит `<img>` с переписанным
`src`, атрибуты документа не трогает:

```ts
export function imageSrcExtension(baseDir: string): Extension {
  return (builder) => {
    builder.addPlugin(() => new Plugin({
      key: new PluginKey("vasyavig-image-src"),
      props: {nodeViews: {image: (node) => makeImageNodeView(node, baseDir)}},
    }));
  };
}
```

- NodeView: `dom = <img>`, `src` = переписанный, `alt/title/loading` — из attrs;
  `update(node)` при изменении attrs. Документ не меняется → сериализация
  честная, вкладка не dirty. **НЕ через `normalizeLink`** — он кругооборотит в
  сохраняемый markup (урок Phase 4 / `preserveUrlsExtension`).
- `baseDir` — в замыкании: редактор уже создаётся per-file (`useMarkdownEditor`
  с deps `[path]`).
- Подключение: `combineExtensions(spellcheckExtension(), preserveUrlsExtension(),
  anchorNavigationExtension(), imageSrcExtension(getParentDir(path)))` в
  `MarkdownEditor.tsx`.
- Проверено по пакету: нода схемы называется `image`, attrs
  `src/alt/title/loading`, дефолтный `toDOM: ['img', node.attrs]` — nodeView
  перехватывает рендер без конфликтов со схемой. `prosemirror-view` уже в
  зависимостях.
- Markup-режим не трогаем (там исходный текст, картинки не рендерятся).

### 3.6 Артефакты anydoc `\_`

Чистим на лету в `resolveLocalImagePath` (3.3): `\_` → `_`. Файл не меняем.
Правка файлов кнопкой — см. USER_INPUT #2.

## 4. NOT done (за рамками фазы)

- Вставка картинок из буфера/drag-and-drop (write path, как `createImages` в
  gramax) — беклог.
- Lazy-loading (IntersectionObserver), индикатор/тултип битых картинок,
  git-LFS — беклог.
- Кастомный uri-протокол и blob-URL — не нужны (решение 3.1).
- `../` выше открытой папки — осознанное ограничение scope.

## 5. Проверки

- vitest, новый `src/lib/__tests__/resolveImageSrc.test.ts`:
  - относительный путь, `./`, `../` (внутри и выше baseDir);
  - кириллица raw и %-encoded; пробелы; `\_`-escape;
  - внешние (`http:`, `data:`) и `#`-якоря → skip;
  - абсолютный windows-путь; root-relative при наличии/отсутствии rootPath.
- `npx tsc --noEmit` — чисто.
- `cargo test --manifest-path src-tauri/Cargo.toml` — задет `lib.rs` (регистрация
  команды); сами тесты не меняются, проверяем сборку.
- Ручной чек-лист на реальной папке (md + `<имя>_assets/` после anydoc, плюс
  подпапки, кириллица, пробелы):
  1. WYSIWYG показывает картинки; Split-превью показывает;
  2. открыть → закрыть без правок: вкладка не dirty; Ctrl+S недоступен/нет изменений;
  3. правка текста → сохранить → в файле `src` байт-в-байт исходные (внешним
     редактором);
  4. внешняя http-картинка работает; битый путь → штатная сломанная иконка;
  5. проверить и в dev (`pnpm tauri dev`), и в build (`pnpm tauri build`) —
     заодно закроет пункт «production build не проверялся» из чекпойнта.

## 6. USER_INPUT — вопросы к пользователю

**USER_INPUT #1 — политика scope asset protocol.**
Варианты: (a) runtime-грант только открытых пользователем папок/файлов
(рекомендация ИИ); (b) статический `"**"` — разрешить всё (проще, но любой
контент в WebView сможет читать любые локальные файлы через `asset:`).
Рекомендация: **(a)** — цена ~20 строк, безопасность предсказуемая.

**USER_INPUT #2 — чистка `\_`-escape в файлах.**
Варианты: (a) только на лету при отображении, файлы не трогаем (рекомендация);
(b) дополнительно расширить кнопку Phase 4.2 «Восстановить кириллицу» до
«Восстановить ссылки» — править и `\_` в файле.
Рекомендация: **(a)** — правка файлов необратима без undo, отображение решает
проблему пользователя; кнопку можно расширить позже отдельной задачей.

**USER_INPUT #3 — root-relative пути (`/img.png` от корня проекта).**
Варианты: (a) поддержать — резолв от `rootPath`, если папка открыта (рекомендация,
несколько строк); (b) MVP — только относительные от каталога файла.
Рекомендация: **(a)**.

## 7. Риски

| Риск | Митигация |
|---|---|
| DOMPurify вырежет `asset:`-ссылки (macOS/Linux) | расширенный `ALLOWED_URI_REGEXP`; юнит-проверка sanitize на строке с `asset://` и `http://asset.localhost` |
| NodeView сломает штатное поведение image-ноды (draggable, выделение) | минимальный nodeView: копировать attrs, вернуть корректный `update()`; ручная проверка перетаскивания/выделения картинки в WYSIWYG |
| Кириллица/пробелы/`#` в путях | `convertFileSrc` кодирует путь; ручной чек-лист; `#`/`?` в имени файла в markdown-URL принципиально ненадёжны — ограничение |
| SVG не отрендерится (content-type) | asset protocol отдаёт MIME по расширению; проверить вручную; при проблеме — сниффинг как в gramax (magic bytes) |
| `../` за пределами открытой папки не отображается | осознанное ограничение scope (3.2), отразить в Phase_05.md |
| Прозрачные PNG в тёмной теме неотличимы | не блокер; CSS-фон под картинками при необходимости позже |

## 8. План коммитов

1. `docs(tasks): phase 5 final — ...` (после закрытия USER_INPUT)
2. `feat(app): phase 5 — asset protocol + локальные изображения в WYSIWYG и превью`
3. `docs(tasks): phase 5 result` + `docs(phase_05): свод фазы` + чекпойнт +
   статус в `_docs_/roadmap.md`.
