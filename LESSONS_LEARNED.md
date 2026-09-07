# Lessons Learned

> Уроки из предыдущего проекта (Tauri 2 + React + Zustand + Vite). Каждый пункт —
> конкретная ошибка, которая привела к «белому окну» или неработающей сборке.
> Читается каждой новой сессией (см. `_docs_/REFRESH_CONTEXT.md`).

## 1. pnpm-workspace.yaml — шаблонные плейсхолдеры ломают сборку

**Что произошло.** `pnpm create tauri-app` оставляет в `pnpm-workspace.yaml` плейсхолдер:

```yaml
allowBuilds:
  esbuild: set this to true or false   # НЕ валидное значение
```

pnpm 10/11.x блокирует ВСЕ build-скрипты, esbuild не устанавливается, Vite падает с `RC=127`.

**Правило.** После `create-*` скаффолда ревьюить конфиги целиком. Удалить шаблонные ключи.
Оставить только валидный `allowBuilds` или `onlyBuiltDependencies` — но не оба.
После `pnpm install` проверить, что платформенный бинарь esbuild на месте
(`node_modules/.pnpm/@esbuild/*/esbuild.exe` или аналог).

## 2. Vite `host: false` — белое окно на Windows

**Что произошло.** WebView2 иногда резолвит `localhost` в IPv6 (`::1`), а Vite с
`host: false` слушает на IPv4 — соединение молча падает. Окно белое, DevTools пустые,
ошибок нет.

**Правило.** В `vite.config.ts` явно зафиксировать:

```ts
server: {
  port: 1420,
  strictPort: true,
  host: "127.0.0.1",   // явно IPv4, не false
}
```

**Диагностика белого окна:** открыть `http://127.0.0.1:1420` в системном Edge
(тот же движок, что WebView2).

- UI есть в Edge, но нет в Tauri — проблема WebView2/окружения.
- Пусто и в Edge — проблема во фронтенде (Vite/React/модули).
- Страница не грузится в Edge — проблема в dev-сервере (порт/биндинг).

## 3. Zustand: некэшированные селекторы = бесконечный ре-рендер

**Что произошло.** Селектор, возвращающий `new Set()` / `new Array()` / `{...spread}`
при каждом вызове, вызывает `Maximum update depth exceeded` в React 18+
(`useSyncExternalStore` сравнивает через `Object.is`). Главная причина белого окна
в предыдущем проекте.

**Правило.** Zustand-селекторы возвращают только примитивы или стабильные ссылки.
Производные коллекции — через `useMemo` в компоненте или `useShallow`.

| Тип возврата | Безопасно? |
|---|---|
| примитив (`string`, `number`, `boolean`) | да |
| стабильная ссылка (поле store) | да |
| `new Object()` / `{ ...spread }` | нет |
| `new Array()` / `.filter()` / `.map()` | нет |
| `new Set()` / `new Map()` | нет |

**Пример безопасного паттерна:**

```ts
// ОПАСНО: новый Set каждый раз
const cats = useStore((s) => new Set(extractCategories(s.entries)));

// БЕЗОПАСНО: подписка на стабильную ссылку + useMemo
const entries = useStore((s) => s.entries);
const cats = useMemo(() => new Set(extractCategories(entries)), [entries]);
```

**Важно:** `dirty`-флаг и состояние текста редактора хранить внутри объекта store,
не вычислять селектором-функцией. Иначе переключение режимов/вкладок потеряет правки.

## 4. Tauri `onCloseRequested` + async = мёртвая кнопка закрытия

**Что произошло.** Обработчик закрытия вызывал `ask()`, и при выбросе исключения
`preventDefault()` оставался «висящим» — окно не закрывалось.

**Правило.** Окно обязано закрываться всегда, кроме явного подтверждения. Асинхронные
операции в close-handler — в `try/catch`. При ошибке НЕ вызывать `preventDefault()`:

```ts
win.onCloseRequested(async (event) => {
  try {
    if (!hasUnsavedChanges()) return;
    const ok = await ask("Закрыть без сохранения?");
    if (!ok) event.preventDefault();
  } catch (e) {
    console.error("close handler failed, allowing close:", e);
    // НЕ вызываем preventDefault — даём окну закрыться
  }
});
```

## 5. Split-view markdown — `useDeferredValue` и единый стор

**Что произошло.** `ReactMarkdown` ре-рендерился на каждый keystroke в Monaco — на
файлах >5 КБ лагало. Также состояние текста жило в `useState` компонента и терялось
при переключении вкладок.

**Правило.**

1. **Preview рендерится через `useDeferredValue(raw)`** — React сам выбирает момент
   между кадрами, не блокируя печать. Никаких дополнительных debounce-таймеров.
2. **Markdown-состояние (`value`, `dirty`) — в Zustand store**, не в локальном
   `useState`. Иначе размонтирование компонента = потеря правок.
3. **В handler `Ctrl+S` читать `editorStore.getState().currentDoc.content`**, а не
   замыкание из `onMount` — иначе сохранится устаревший текст.

## 6. Gravity UI `MarkdownEditorView` требует `ToasterProvider`

**Что произошло.** При первом открытии `.md` файла — белый экран. Ошибка:
`Toaster: useToaster hook is used out of context` внутри `MarkdownEditorView`.

**Правило.** При подключении `@gravity-ui/markdown-editor` приложение обязано быть
обёрнуто в `ToasterProvider` + `ToasterComponent` из `@gravity-ui/uikit`
(в uikit v7 `ToasterComponent` без пропов — берёт toaster из контекста):

```tsx
const toaster = new Toaster();

<ThemeProvider theme="system">
  <ToasterProvider toaster={toaster}>
    <App />
    <ToasterComponent />
  </ToasterProvider>
</ThemeProvider>
```

**Дополнительно.** Вокруг редактора полезен `ErrorBoundary`, который рендерит текст
ошибки вместо белого экрана и пишет её в `localStorage` — ускоряет диагностику
внутри WebView, где нет DevTools под рукой.

## 7. monaco-editor 0.56: exports-мапа сломала канонические пути воркеров

**Что произошло.** Документированные для Vite импорты
`monaco-editor/esm/vs/editor/editor.worker?worker` падают с
`Failed to resolve import` — в monaco-editor 0.56 exports-мапа `"./*" -> "./esm/vs/*.js"`,
и префикс `esm/vs` в сабпасе дублируется.

**Правило.** Воркеры импортировать без префикса `esm/vs`:
`monaco-editor/editor/editor.worker?worker`, `monaco-editor/language/json/json.worker?worker`
и т.д. Перед копированием сниппетов из README проверять `exports` в package.json
конкретной установленной версии.

## 8. Скролл в панелях: body margin и scroll chaining

**Что произошло.** В split-режиме колёсико мыши в конце панели сдвигало всю страницу,
под статус-баром появлялась пустота. Корень: дефолтный `margin: 8px` у `<body>`
(раньше скрывался шаблонным CSS, который удалили) — `100vh` layout + 16px маргинов
делали документ прокручиваемым, и scroll chaining из панелей скроллил его.

**Правило.**

1. Глобальный сброс с первого дня проекта:
   `html, body { margin: 0; height: 100%; overflow: hidden }`, `#root { height: 100% }`.
2. Прокручиваемым панелям — `overscroll-behavior: contain`, чтобы колёсико
   не передавалось предку в конце скролла.
3. Страница не скроллится вообще — скроллят только панели (контейнеры `overflow: hidden`,
   высоты ограничены через `min-height: 0` во flex-цепочке).
4. НЕ добавлять `overflow` на корень Gravity-редактора (`.md-editor`) — он скроллит себя
   сам внутри; внешний overflow ломает внутренний layout (теряется preview в split).

## 9. Шпаргалка: быстрые проверки при «белом окне Tauri»

| Симптом | Скорее всего | Проверка |
|---|---|---|
| `pnpm tauri dev` падает до окна | pnpm / build-скрипты | `pnpm install` RC=0? Есть esbuild-бинарь? |
| Окно открывается, но белое, консоль пустая | IPv6/IPv4 или dev-сервер | `127.0.0.1:1420` в Edge |
| Белое окно, в Edge-DevTools `Maximum update depth` | некэшированный Zustand-селектор | аудит всех `useStore(selector)` |
| Окно белое, в консоли Tauri-API TypeError | Tauri-импорт вне try/catch | обернуть в try/catch или `isTauri`-guard |
| Кнопка закрытия не работает | `onCloseRequested` блокирует | try/catch, не звать `preventDefault` при ошибке |
| `beforeDevCommand terminated with non-zero status` | порт 1420 занят старым dev-процессом | `taskkill` старого vasyavig.exe / node, перезапуск |

**Методология:** при «белом окне» проверять слои по порядку — не пытаться чинить
всё сразу:

1. Пакетный менеджер (`pnpm install` RC=0)
2. Build-скрипты (esbuild на месте)
3. Dev-сервер (порт, биндинг)
4. Сеть до сервера (Edge по тому же URL)
5. Фронтенд-рантайм (DevTools Console)
6. Tauri-окружение (capabilities, плагины)

## 10. Gravity markdown-editor: одноимённые nodeViews — побеждает первый плагин

**Что произошло.** Phase 5: nodeView для картинок через `builder.addPlugin`
молча не применялся — изображения рендерил чужой view с сырым src. Причина:
preset `'full'` включает Yfm-расширение ImgSize, чей плагин тоже регистрирует
`props.nodeViews.image` (React ImageNodeView), и стоит он в списке плагинов
раньше extraExtensions. `buildNodeViews` в prosemirror-view мержит записи
nodeViews по принципу «первый источник выигрывает» (direct props -> плагины
по порядку; порядок плагинов — по убыванию priority из ExtensionBuilder).

**Правило.** Перекрывать чужой nodeView в Gravity-редакторе только через
`builder.addPlugin(cb, builder.Priority.Highest)`. Диагностика: временный
`console.log` в фабрике nodeView — если не печатается, view перекрыт.

**Дополнительно (сериализация).** Штатный сериализатор картинки пишет src через
`state.esc()` и голым текстом: путь с пробелами ломается при WYSIWYG -> Markup.
Лечение: `builder.overrideNodeSerializerSpec(name, ...)` — angle-форма
`![](<путь с пробелами>)`.

## 11. Dev-процессы Tauri: «призрачные» провалы после правок Rust

**Что произошло.** Пользователь проверял новую функцию в приложении, которое
работало на старом бинарнике: порт 1420 держал dev-сервер, запущенный до
правок (HMR обновил фронтенд, но Rust-часть — asset protocol, новые команды —
осталась старой). Симптом: «сделано, но не работает».

**Правило.** После правок в `src-tauri` — перезапуск `tauri dev`. Диагностика:
`netstat -ano | findstr :1420` + `tasklist` — убить старые vite/vasyavig.exe.
Иногда `tauri dev` умирает при автоперезапуске (кривой кавычкинг re-run в
cmd) — просто запустить заново.

## 12. NodeView со своими DOM-записями обязан `ignoreMutation`

**Что произошло.** Change 20260904 (mermaid в WYSIWYG): nodeView асинхронно
инжектил SVG (`card.innerHTML = svg`) без `ignoreMutation`. ProseMirror считал
эти мутации «внешними правками», уничтожал и пересоздавал nodeView — бесконечный
цикл skeleton→SVG→пересоздание, видимый как «дрожание экрана». Диагностический
признак: на скриншоте мерцал кадр загрузки с видимым код-блоком.

**Правило.** NodeView, который пишет в собственный `dom` вне `contentDOM`
(SVG, классы, стили), обязан определить:

```ts
ignoreMutation = (m: ViewMutationRecord) => !this.contentDOM.contains(m.target);
```

Всё вне contentDOM — «наши» записи (PM игнорирует), ввод внутри contentDOM —
читается PM. См. прецедент `imageSrcExtension` (phase 5). Дополнительно: если
какой-то элемент скрыт в ЧАСТИ режимов — проверяйте ВСЕ классы состояний
(код скрывался только в `--diagram`, но не в `--loading` — кадры загрузки
моргали кодом).

## 13. Публичный insert() Gravity разворачивает одиночный текст-блок

**Что произошло.** Кнопка «Диаграмма» через `editor.insert("```mermaid…```")`
в WYSIWYG вставляла БЕЗ фенса: insert() кладёт разметку «открытым срезом»
(`getSliceFromMarkupFragment`: firstChild.isTextblock → openStart=1) —
одиночный код-блок разворачивается в текущий абзац, `-->` экранируется
сериализатором в `--\>`. В markup-режиме insert() — это `replaceSelection`
в CodeMirror: фенс склеивается со строкой курсора и не распознаётся.
А при курсоре внутри кода insert() вообще вставляет разметку литеральным
текстом (штатная ветка «вставка в код»).

**Правило.** Для вставки конкретной ноды в WYSIWYG — строить её напрямую
через PM-view (`schema.nodes[name].create` + `tr.insert/replaceWith`),
позиции блока брать `$from.before(1)`/`$from.node(1)` (позиция БЛОКА;
`pos - parentOffset` — это позиция КОНТЕНТА блока, off-by-one, ловится
только тестом на реальной схеме). Для markup — `append()` (штатно отделяет
блоки переводами строк), не insert(). PM-view пробрасывается из своего
плагина (`view(view) { register(path, view); return {destroy} }`).
