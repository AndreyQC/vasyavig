# Lessons Learned

> Уроки из предыдущего проекта (Tauri 2 + React + Zustand + Vite). Каждый пункт —
> конкретная ошибка, которая привела к «белому окну» или неработающей сборке.
> Читается каждой новой сессией (см. `-=docs=-/-=tasks=-/HOW_TO_START_NEW_SESSION.md`).

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

## 7. Шпаргалка: быстрые проверки при «белом окне Tauri»

| Симптом | Скорее всего | Проверка |
|---|---|---|
| `pnpm tauri dev` падает до окна | pnpm / build-скрипты | `pnpm install` RC=0? Есть esbuild-бинарь? |
| Окно открывается, но белое, консоль пустая | IPv6/IPv4 или dev-сервер | `127.0.0.1:1420` в Edge |
| Белое окно, в Edge-DevTools `Maximum update depth` | некэшированный Zustand-селектор | аудит всех `useStore(selector)` |
| Окно белое, в консоли Tauri-API TypeError | Tauri-импорт вне try/catch | обернуть в try/catch или `isTauri`-guard |
| Кнопка закрытия не работает | `onCloseRequested` блокирует | try/catch, не звать `preventDefault` при ошибке |

**Методология:** при «белом окне» проверять слои по порядку — не пытаться чинить
всё сразу:

1. Пакетный менеджер (`pnpm install` RC=0)
2. Build-скрипты (esbuild на месте)
3. Dev-сервер (порт, биндинг)
4. Сеть до сервера (Edge по тому же URL)
5. Фронтенд-рантайм (DevTools Console)
6. Tauri-окружение (capabilities, плагины)
