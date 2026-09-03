# Design: просмотр изображений и .eml, редактирование текстовых файлов

> Дата: 2026-09-03. Мотивация и состав — `proposal.md`; требования —
> `specs/{image-viewer,eml-viewer,text-file-editing}/spec.md`.

## Context

Открытие файла идёт через `getFileKind` (`src/lib/utils.ts`): markdown →
Gravity-редактор, text → Monaco read-only, office → конвертация, прочее —
ошибка. Вкладка (`EditorTab` в `src/store/editorStore.ts`) хранит `content`
строкой, `dirty`, `preview`; сохранение (`saveTab`/`saveActiveAs`) сегодня
допускает только `kind: "markdown"`. Asset protocol с runtime-грантами
каталогов уже настроен (Phase 5, `resolveImageSrc.ts`/`toAssetUrl`), watcher
обновляет только деревья. Диалоги Ctrl+O и «Сохранить как»
(`src/hooks/useTauriFS.ts`) имеют жёсткие фильтры расширений.

## Goals / Non-Goals

**Goals:**

- Новые виды вкладок (изображение, письмо) в существующих потоках: табы,
  preview-семантика, переименование, статус-бар, заголовок окна.
- Текстовые вкладки: полный цикл правки и сохранения «как у markdown».
- Нулевые изменения в Rust.

**Non-Goals:**

- HTML-рендер и вложения `.eml` (решение пользователя 2026-09-03).
- Реакция вкладок на внешние изменения файлов — отдельный change, добавлен
  в беклог roadmap.
- Иконки по типам файлов в дереве (остаётся единый `FileText`).
- Ресайз-ручки/метаданные изображений (EXIF и пр.).

## Decisions

### D1. Расширение FileKind и вкладок без чтения бинарного контента

`FileKind` дополняется `"image"` и `"email"`; новые списки `IMAGE_EXTENSIONS`
(png, jpg, jpeg, gif, webp, bmp, svg, ico) и `EML_EXTENSIONS` (eml) в
`src/lib/constants.ts`, `getFileKind` проверяет их до `unsupported`.

`openFile` в `fileStore.ts` ветвится: для `image` файл НЕ читается (бинарный),
вкладка открывается с `content: ""` — URL для отображения вычисляется из
`path` при рендере через `toAssetUrl` (грант каталога уже выдаётся всеми
путями открытия). Для `email` файл читается существующим `readFile` (`.eml` —
текстовый MIME). Альтернатива — отдельная модель вкладки без `content` —
отвергнута: `content: ""` не ломает ни один существующий поток (dirty никогда
не наступает, сериализации вкладок нет).

Защитные guard'ы: `updateContent` игнорирует вкладки `image`/`email`;
`saveTab`/`saveAllDirty`/`saveActiveAs` допускают только `markdown` и `text`.

### D2. Разбор .eml — собственный минимальный MIME-парсер на фронте

Новый модуль `src/lib/emlParser.ts`: `parseEml(raw: string) →
{headers, textBody | null, parseError?}` — заголовки (unfolding продолжений,
RFC 2047 encoded-words B/Q с charset), рекурсивный обход multipart по boundary,
выбор первой `text/plain`-части, декодирование CTE (base64, quoted-printable,
7bit/8bit), декодирование charset через `TextDecoder`.

Выбор между (a) Rust `mailparse` + команда, (b) JS-библиотека (`letterparser`),
(c) собственный парсер. Выбран (c):

- скоуп — заголовки + text/plain: ~150 строк, все нужные ветки покрываются
  fixture-тестами (vitest, в стиле соседних lib-модулей);
- `TextDecoder` в WebView2 нативно поддерживает windows-1251/koi8-r — критично
  для русской почты, библиотеки на iconv-lite тащат данные словари;
- (a) добавляет крейт, команду и DTO без выгоды: файл уже читается как текст.

Компонент `EmlViewer` рендерит заголовки таблицей и тело `pre`-блоком
(white-space: pre-wrap); `textBody === null` → сообщение «текстовая часть
отсутствует» (HTML-only), `parseError` → сообщение об ошибке разбора.

Поправка по ходу имплементации: существующий `read_file` в Rust — строго
UTF-8 (`String::from_utf8`), т.е. письмо с 8bit-телом в windows-1251 не
читалось бы вовсе. Добавлена минимальная команда `read_file_latin1`
(байт → символ U+00XX, валидная UTF-8 строка через IPC): `openFile` читает
`.eml` только ею, парсер восстанавливает байты по `charCodeAt` и сам
декодирует все кодировки — в том числе utf-8 (8bit utf-8-письмо читается
корректно, latin-1 транспорт прозрачен). Спеке CTE «8bit + charset» это
соответствует; «Rust не затрагивается» из Context относилось к asset
protocol и осталось верным для изображений.

### D3. Отображение изображений — только `<img>` + asset protocol

`ImageViewer` рендерит `<img src={toAssetUrl(path)}>` и ничего больше.
В контексте `<img>` браузер не выполняет скрипты SVG и не грузит внешние
ресурсы SVG — отдельная санитизация (DOMPurify) не нужна; инлайн SVG в DOM
не используется. URL строится только из локального пути открытого файла —
сетевых запросов просмотрщик не порождает. Ошибки загрузки (`onError`)
перехватываются заглушкой с сообщением (битый файл / нет гранта) — по уроку
§6 (ErrorBoundary) белого экрана не допускаем.

### D4. Зум ImageViewer

Локальный `useState`: режим `fit | percent`, значение 10–1000%, шаг ×1.25.
Управление: кнопки Gravity UI («+», «−», «fit/100%») и Ctrl+колесо ( listener
`wheel` с `{passive: false}` + `preventDefault()`, иначе WebView скроллит).
Контейнер скролла — `overscroll-behavior: contain` (урок §8). Fit считается
CSS (`max-width/max-height: 100%`), процентный режим — явным `width`/`height`
со скроллом контейнера. Натуральный размер для «100%» — собственные размеры
картинки (`naturalWidth/Height`), не файла.

### D5. Monaco: снятие read-only и сохранение text-вкладок

`MonacoViewer` получает проп `editable` (для `kind: "text"`): `readOnly:
!editable`, `onChange` → `editorStore.updateContent(path, value)`. Подсветка,
wordWrap, тема — без изменений. Модель Monaco привязана к `path` — как сейчас.

`editorStore`: условие сохранения `tab.kind !== "markdown"` заменяется на
`tab.kind !== "markdown" && tab.kind !== "text"` (в `saveTab`, `saveAllDirty`,
`saveActiveAs`). `isMdYfmSwap`-проверка остаётся только для markdown — для text
не применяется (спека). Класс вкладки при «Сохранить как» не пересчитывается
(как и у markdown сегодня).

Диалоги: `saveFileDialog` получает фильтры по расширению активной вкладки
(md/yfm — как сейчас; для text — текущее расширение + общий фильтр);
`openFileDialog` (Ctrl+O) дополняется фильтрами Image и EML.

### D6. Маршрутизация вкладок в App.tsx

`activeTab.kind === "image"` → `ImageViewer`, `"email"` → `EmlViewer`,
`"markdown"` → без изменений, `"text"` → Monaco с `editable`. Компоненты
монтируются с `key={activeTab.path}` — как существующие.

## Risks / Trade-offs

- [Экзотические .eml: битые boundary, 8bit-бинарные части, нестандартные
  заголовки] → парсер отвечает деградацией (parseError/`textBody: null`),
  не исключением; fixture-тесты: cp1251+QP, utf-8+base64, html-only,
  multipart/mixed с вложением, пустой файл.
- [Большой .eml с base64-вложениями: readFile тянет весь файл в строку] →
  принято для plain-text-скоупа (вложения не декодируются); при жалобах на
  производительность — выносить чтение в Rust отдельным change.
- [Ctrl+колесо может конфликтовать со скроллом/зумом WebView] → passive:
  false + preventDefault только при зажатом Ctrl; fallback — кнопки зума.
- [SVG как `<img>` не даёт интерактивности (CSS-анимации SMIL остаются)]
  → осознанный trade-off безопасности; инлайн-SVG вне скоупа.
- [Сохранение text-вкладки перезаписывает файл с нормализацией концов строк
  Monaco (LF)] → поведение фиксируется как есть (как у markdown-вкладок);
  при необходимости EOL-сохранения — отдельный пункт беклога.

## Migration Plan

Новые kinds только добавляются; для неподдерживаемых расширений поведение
не меняется. Откат — revert коммита, состояние вкладок не персистентно.
Внешних интерфейсов (формат workspace, Rust-команды) change не меняет.

## Open Questions

Нет — состав .eml подтверждён пользователем, поведение внешних изменений
явно вынесено в беклог.
