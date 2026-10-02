# Tasks

## 1. Расширение и маршрутизация kind

- [x] 1.1 В `src/lib/constants.ts` добавить `HTML_EXTENSIONS = ["html",
  "htm"]`; в `src/lib/utils.ts` расширить `FileKind` значением `"html"`,
  добавить ветку в `getFileKind` и маппинг `html`/`htm` → `html` в
  `getMonacoLanguage`. Проверка: юнит-тесты `utils.test.ts` —
  `getFileKind("a/index.html") === "html"`, `getMonacoLanguage` для html и
  htm; тест на «unsupported» для прочих расширений не ломается.
- [x] 1.2 Убедиться, что read-only семантика работает без правок store:
  `isSavableKind("html") === false` (ветка не добавляется), `fileStore`
  читает файл штатным `readFile` (utf-8) — отдельная ветка не нужна.
  Проверка: тест `fileStore.test.ts` на открытие `.html` (kind, content),
  сохранение/Ctrl+S недоступны (кроется юнит-тестом editorStore не
  добавляем — семантика уже покрыта существующими тестами email/image).

## 2. CSP-инъекция для изоляции рендера

- [x] 2.1 Создать `src/lib/htmlCsp.ts`: `injectCspMeta(html)` — вставка
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none';
  style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src
  data:">` после `<head...>` / после `<html...>` / prepend (design D2).
  Проверка: юнит-тесты `htmlCsp.test.ts` — полный документ, документ без
  head, фрагмент без html/head, XHTML-пролог `<?xml ...?>` перед
  `<!DOCTYPE>`, idempotent-вызов (повторная инъекция не дублирует meta).

## 3. Компонент HtmlViewer

- [x] 3.1 Создать `src/components/EditorArea/HtmlViewer.tsx`: переключатель
  «Просмотр / Исходник» (Gravity Button, паттерн EmlViewer), режим
  «Просмотр» — `<iframe srcdoc={injectCspMeta(content)} sandbox=""
  title={name}>`, «Исходник» — `MonacoViewer` с `editable={false}`.
  Проверка: `npx tsc --noEmit` чисто; компонент не тянет новых зависимостей.
- [x] 3.2 Подключить в `src/App.tsx` ветку `kind === "html"` →
  `HtmlViewer`; добавить строки i18n (`html.viewRendered`, `html.viewSource`)
  в `src/lib/i18n.ts` (ru/en); стили в `EditorArea.css`: фон-подложка,
  рамка «листа», скролл внутри iframe (design D5). Проверка: `npx tsc
    --noEmit` чисто; greп отсутствия hardcoded-русских строк в компоненте.

## 4. Проверки

- [x] 4.1 Автотесты и сборка: `pnpm test` (все юнит-тесты, включая новые
  1.1/2.1), `npx tsc --noEmit`, `npx vite build`. Проверка: прогон без
  ошибок/регрессий (базовое число тестов фиксируется в отчёте).
- [ ] 4.2 Ручная проверка в `pnpm tauri dev` на примере письма-черновика
  (файл из запроса пользователя): рендер с инлайн-стилями (таблица, SQL-блок,
  шапка To/Cc/Тема); `<script>` не исполняется; внешняя картинка не
  загружается; клик по ссылке не ведёт навигацию; «Исходник» показывает весь файл
  с подсветкой; Ctrl+S ничего не пишет; одиночный клик — preview-вкладка,
  двойной — закрепление; тёмная тема — лист письма читаем.
  (Автоматически покрыто: юнит-тесты маршрутизации kind/чтения файла
  (utils, fileStore), CSP-инъекции на формах документов, включая полный
  документ вида файла-примера; изоляция скриптов/навигации обеспечивается
  атрибутом `sandbox=""` платформенно. GUI-проход в WebView остаётся
  пользовательской приёмкой.)
- [x] 4.3 Валидация OpenSpec: `openspec validate 20261002-html-viewer`
  проходит; спека `html-viewer` согласована с реализацией.
