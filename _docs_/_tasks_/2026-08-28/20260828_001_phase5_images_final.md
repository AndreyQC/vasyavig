# Phase 5: отображение локальных изображений (final)

> Дата: 2026-08-28
> Контекст:
> - `20260828_001_phase5_images_draft.md` — проработка (USER_INPUT закрыты, см. §7)
> - `_docs_/GRAMAX_RESEARCH_RESULT.md` — исследование gramax (§1 изображения, §4 сводка)
> - `_docs_/roadmap.md` — Phase 5
> - Проверка форка anydoc (`C:/repos/github/anydoc`, сессия 2026-08-28) — см. §1

## 1. Контекст проблемы

У WebView нет доступа к файлам рядом с документом: относительный `src` картинки
резолвится против origin приложения и даёт 404 (`USER_IDEA.md` п. 4). Главный
сценарий — документы после конвертации anydoc: картинки в `<имя>_assets/`
подключаются относительными путями.

Текущее состояние: `tauri.conf.json` → `security.csp: null`, `assetProtocol`
отсутствует; FS — свои команды в `src-tauri/src/commands/fs.rs`; `convertFileSrc`
из `@tauri-apps/api` не используется.

**Проверка anydoc (ответ на вопрос из draft):** текущий форк НЕ порождает
`\_-артефакты в путях. Destination картинок/ссылок пишется через `format_url`
(`anydoc/src/render/markdown/escape.rs:265`), который экранирует только `<`, `>`,
`|`, контролы и берёт URL с пробелами в `<...>`; `\` перед `_` не ставится.
Экранирование `\_` есть только в `escape_text` (текст документа, защита от
emphasis) — это корректный markdown. Вывод: артефакты в существующих файлах —
от старых сборок конвертера; **править anydoc не нужно**. Существующие файлы
лечит расширенная кнопка (3.6); в anydoc добавим только регрессионный тест
(5.1), страхующий `format_url` от возврата `\`-экранирования.

Из gramax (GPL-3.0 — только идеи) переносим главный приём: **сырой `src`
хранится в документе, переписанный URL существует только на уровне отображения**.

## 2. Цели фазы

1. Картинки с относительными `src` отображаются в WYSIWYG и в Split-превью.
2. Отображение не меняет файл: raw `src` сериализуется как есть, вкладка не
   dirty от простого открытия.
3. Пути: латиница, кириллица (raw и %-encoded), пробелы, `./`/`../`,
   root-relative `/x` от корня открытой папки; внешние `http(s):`/`data:` и
   `#`-якоря не трогаем.
4. Кнопка «Восстановить ссылки» чинит существующие файлы: %-кириллица (как в
   Phase 4.2) + `\_-escape` в destinations.
5. `\_-escape` не мешает отображению (чистка на лету).

## 3. Решения

### 3.1 Транспорт — встроенный asset protocol

`tauri.conf.json`:

```json
"security": {
  "csp": null,
  "assetProtocol": {"enable": true, "scope": []}
}
```

Статический scope пуст — доступ выдаётся в рантайме (3.2). Не кастомный
протокол как в gramax: asset protocol — ядро Tauri, ноль нового транспорта;
`convertFileSrc(path)` уже в зависимостях. Формы URL: Windows
`http://asset.localhost/<encoded>`, macOS/Linux `asset://<encoded>` →
требование к DOMPurify (3.4).

### 3.2 Scope — runtime-грант открытых папок (USER_INPUT #1: вариант a)

Новая команда в `src-tauri/src/commands/fs.rs`:

```rust
#[tauri::command]
pub fn grant_asset_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(&path, true)   // рекурсивно
        .map_err(|e| e.to_string())
}
```

Вызовы: открытие папки (`fileStore.ts` → `openFolderPathNow`, грант корня)
и открытие одиночного файла (Ctrl+O / drag-and-drop — грант dirname).
Повторные гранты идемпотентны. Ограничение (осознанное): `../` выше открытой
папки не отобразится — картинка останется битой; безопасность важнее.

### 3.3 Резолвинг — чистая утилита `src/lib/resolveImageSrc.ts`

```ts
export function isExternalSrc(src: string): boolean;
export function resolveLocalImagePath(src: string, baseDir: string, rootPath?: string | null): string | null;
export function toAssetUrl(path: string): string;
```

- `isExternalSrc`: схема `^[a-zA-Z][a-zA-Z0-9+.-]*:` (http, https, data,
  mailto…) или `#`-якорь → не переписываем.
- `resolveLocalImagePath`:
  - decode %-encoding с try/catch (старые файлы с закодированной кириллицей);
  - снять markdown-escape `\_` → `_` (только в памяти);
  - root-relative `/img.png` → резолв от `rootPath` (USER_INPUT #3: вариант a);
    без открытой папки — skip;
  - относительный → join с `baseDir` (нормализация `./`, `../`,
    windows-сепараторов);
  - абсолютный → как есть;
  - наружу — абсолютный путь либо `null` (не переписываем).
- `toAssetUrl`: isTauri-guard (`'__TAURI_INTERNALS__' in window`) →
  `convertFileSrc(path)`; вне Tauri (vitest) — identity. Чистая логика
  тестируется без Tauri.

### 3.4 Превью — `SplitPreview.tsx`

- `SplitView.tsx` передаёт `basePath={getParentDir(tab.path)}` (helper есть в
  `src/lib/utils.ts`); `rootPath` — из `fileStore`.
- Между `transform()` и `DOMPurify.sanitize()` — DOM-проход (DOMParser) по
  `img[src]`: `src → toAssetUrl(resolveLocalImagePath(src, basePath, rootPath)) ?? src`.
  Паттерн DOM-обработки в файле уже есть (mermaid-effect).
- DOMPurify: расширить `ALLOWED_URI_REGEXP` схемой `asset:` (форма macOS/Linux;
  на Windows `http://asset.localhost` проходит и так — конфиг единый).

### 3.5 WYSIWYG — `imageSrcExtension` (nodeView)

Новый `src/lib/imageSrcExtension.ts` (паттерн — `anchorNavigationExtension.ts`):

```ts
export function imageSrcExtension(baseDir: string, rootPath?: string | null): Extension {
  return (builder) => {
    builder.addPlugin(() => new Plugin({
      key: new PluginKey("vasyavig-image-src"),
      props: {nodeViews: {image: (node) => makeImageNodeView(node, baseDir, rootPath)}},
    }));
  };
}
```

- NodeView рендерит `<img>` с переписанным `src`; `alt/title/loading` — из
  attrs; `update(node)` при изменении attrs. Документ не меняется →
  сериализация честная, вкладка не dirty. **НЕ через `normalizeLink`** — он
  кругооборотит в сохраняемый markup (урок Phase 4).
- `baseDir`/`rootPath` — в замыкании; редактор уже per-file (deps `[path]`).
- Подключение: `combineExtensions(spellcheckExtension(), preserveUrlsExtension(),
  anchorNavigationExtension(), imageSrcExtension(getParentDir(path), rootPath))`
  в `MarkdownEditor.tsx`.
- Проверено по пакету: нода схемы — `image`, attrs `src/alt/title/loading`,
  дефолтный `toDOM: ['img', node.attrs]` — nodeView перехватывает рендер без
  конфликтов; `prosemirror-view` в зависимостях.
- Markup-режим не трогаем (там исходный текст).

### 3.6 Кнопка «Восстановить ссылки» (расширение Phase 4.2; USER_INPUT #2)

Расширить `src/lib/restoreCyrillicUrls.ts`: в destinations inline-ссылок и
картинок (механизм поиска destinations уже есть) дополнительно снимать
`\_` → `_`. Только внутри destinations — прозу со штатным экранированием
`\_` не трогаем. Semantics: `_` в destination линеен, unescape безопасен.

- Кнопка переименовывается: «Восстановить кириллицу» → «Восстановить ссылки»
  (ru/en локали, `src/locales/{ru,en}/`).
- Механика прежняя: `restoreCyrillicUrls(content)` → `editor.replace()` →
  dirty → сохранение за пользователем. Undo — как в Phase 4 (ограничение то же).
- Отображение чистит `\_` и на лету (3.3) — защита для незафиксированных файлов.

### 3.7 Регрессионный тест в anydoc (маленький, отдельный репозиторий)

В `anydoc/src/render/markdown/tests.rs`: тест, что картинка с `_` в пути не
получает `\` в destination (`![alt](a_b.png)` на выходе, не `a\_b.png`).
Страхует `format_url` от регрессии. Отдельный коммит в форке anydoc.

## 4. NOT done (за рамками фазы)

- Вставка картинок из буфера/drag-and-drop (write path) — беклог.
- Lazy-loading, индикатор/тултип битых картинок, git-LFS — беклог.
- Правка anydoc — не требуется (установлено проверкой, §1); только тест 3.7.
- `../` выше открытой папки — осознанное ограничение scope.

## 5. Проверки

1. anydoc: `cargo test` в `C:/repos/github/anydoc` — новый регрессионный тест
   проходит (3.7).
2. vasyavig vitest, `src/lib/__tests__/resolveImageSrc.test.ts`:
   - относительный путь, `./`, `../` (внутри/выше baseDir);
   - кириллица raw и %-encoded; пробелы; `\_`-escape;
   - внешние (`http:`, `data:`) и `#` → skip;
   - абсолютный windows-путь; root-relative при наличии/отсутствии rootPath.
3. vasyavig vitest, расширение `restoreCyrillicUrls.test.ts`:
   - `![alt](assets\_img.png)` → `assets_img.png` (destination);
   - проза `файл a\_b` — не меняется;
   - прежние кейсы %-кириллицы не регрессируют.
4. `npx tsc --noEmit` — чисто.
5. `cargo test --manifest-path src-tauri/Cargo.toml` — задета регистрация
   команды `grant_asset_scope`; сборка проходит.
6. Ручной чек-лист на реальной папке (md + `<имя>_assets/`, подпапки,
   кириллица, пробелы):
   1. WYSIWYG и Split показывают картинки;
   2. открыть → закрыть без правок: вкладка не dirty;
   3. правка → сохранить → `src` в файле байт-в-байт исходные;
   4. кнопка «Восстановить ссылки» на старом файле: `%D0...` и `\_` чинятся,
      prose-escape остаётся;
   5. внешняя http-картинка работает; битый путь → штатная сломанная иконка;
   6. проверить в dev (`pnpm tauri dev`) и build (`pnpm tauri build`) — заодно
      закрывает «production build не проверялся» из чекпойнта 20260827_002.

## 6. Риски

| Риск | Митигация |
|---|---|
| DOMPurify вырежет `asset:`-ссылки (macOS/Linux) | расширенный `ALLOWED_URI_REGEXP`; юнит-проверка sanitize на `asset://` и `http://asset.localhost` |
| NodeView сломает поведение image-ноды (draggable, выделение) | минимальный nodeView: attrs копируются, корректный `update()`; ручная проверка перетаскивания/выделения |
| Кириллица/пробелы/`#` в путях | `convertFileSrc` кодирует путь; ручной чек-лист; `#`/`?` в имени файла в markdown-URL принципиально ненадёжны — ограничение |
| SVG не отрендерится (content-type) | asset protocol отдаёт MIME по расширению; проверить вручную; при проблеме — сниффинг magic bytes (как gramax) |
| `../` за пределами открытой папки не отображается | осознанное ограничение scope (3.2); отразить в `Phase_05.md` |
| Unescape `\_-в-destinations` заденет валидные случаи | `\_` в destination — всегда интерпретируется как `_` (CommonMark), unescape семантически нейтрален; тесты 3 |

## 7. Закрытые USER_INPUT (из draft §6)

| # | Вопрос | Решение |
|---|---|---|
| 1 | Политика scope | runtime-грант открытых папок/файлов (3.2) |
| 2 | `\_-escape`: чинить anydoc или файлы | anydoc уже чист (проверка §1, тест 3.7); кнопка расширяется до «Восстановить ссылки» (3.6) + чистка на лету (3.3) |
| 3 | root-relative `/x` | поддержать от `rootPath` (3.3) |

## 8. План коммитов

1. anydoc (форк, отдельный репозиторий): `test(markdown): image destinations keep underscores unescaped`
2. vasyavig: `feat(app): phase 5 — asset protocol + локальные изображения в WYSIWYG и превью`
3. vasyavig: `feat(app): кнопка «Восстановить ссылки» — unescape \_ в destinations`
   (можно объединить с п.2, если работа идёт одной сессией)
4. `docs(tasks): phase 5 result` + `docs(phase_05): свод фазы` + чекпойнт +
   статус в `_docs_/roadmap.md`.
