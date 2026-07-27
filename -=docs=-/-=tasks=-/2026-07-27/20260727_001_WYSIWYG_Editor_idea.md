# WYSIWYG_Editor_idea.md

> **Русское название:** Васявиг (дружеское, в README и документации).  
> **Репозиторий / бренд:** Vasyavig.


## Проект: Vasyavig Desktop

**Цель:** Создать лёгкое desktop-приложение на базе Tauri v2 для редактирования Markdown/YFM с двойным режимом (WYSIWYG + разметка), файловым деревом, предпросмотром и проверкой орфографии.

**Целевая платформа:** Windows, macOS, Linux (кроссплатформенно через Tauri v2).

---

## 1. Технологический стек

### 1.1. Frontend
- **Framework:** React 18 + Vite + TypeScript
- **UI Kit & Editor:** `@gravity-ui/markdown-editor`, `@gravity-ui/uikit`, `@gravity-ui/components`
- **Text Viewer (read-only):** `@monaco-editor/react` (Monaco Editor) для `.txt`, `.json`, `.py`, `.sql`, `.js`, `.ts`, `.yaml`, `.xml`, `.log` и т.д.
- **Icons:** `@gravity-ui/icons`
- **State Management:** Zustand (лёгкий, без boilerplate)
- **Routing (внутри приложения):** не требуется, достаточно условного рендеринга
- **i18n:** `i18next` + `react-i18next` (языки: ru, en)
- **Spellcheck API:** кастомный хук, дергающий Tauri command `check_spelling`

### 1.2. Backend (Rust / Tauri v2)
- **Tauri v2** с плагинами:
  - `tauri-plugin-dialog` (открытие/сохранение файлов)
  - `tauri-plugin-fs` (чтение/запись, обход директорий)
  - `tauri-plugin-os` (инфо об ОС)
  - `tauri-plugin-shell` (опционально, для открытия внешних ссылок)
- **Spellcheck:** `hunspell-rs` (или `zspell` как fallback) + встроенные словари `.dic`/`.aff` (ru_RU, en_US) в ресурсах приложения
- **File Watching:** `notify` crate (Rust) для отслеживания изменений файлов в открытой папке

### 1.3. Рендеринг / Preview
- Для Markdown/YFM preview использовать встроенный рендерер из `@gravity-ui/markdown-editor` (компонент `Preview` или `HtmlRenderer`) либо `@diplodoc/transform` для серверного рендеринга в HTML.
- Mermaid-диаграммы рендерятся клиентски через `mermaid` (встроено в Gravity UI).

---

## 2. Архитектура приложения

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri v2 Window                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  React App (Vite)                                     │  │
│  │  ┌──────────────┐  ┌──────────────────────────────┐  │  │
│  │  │   Sidebar    │  │         Main Area            │  │  │
│  │  │  (File Tree) │  │  ┌────────────────────────┐│  │  │
│  │  │              │  │  │   Toolbar / Tabs       ││  │  │
│  │  │              │  │  ├────────────────────────┤│  │  │
│  │  │              │  │  │   Editor / Viewer      ││  │  │
│  │  │              │  │  │  (Gravity UI or Monaco)││  │  │
│  │  │              │  │  ├────────────────────────┤│  │  │
│  │  │              │  │  │   Status Bar           ││  │  │
│  │  │              │  │  │  (Ext indicator, Lang)   ││  │  │
│  │  └──────────────┘  └──────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ invoke()
┌──────────────────────▼──────────────────────────────────────┐
│  Rust Backend                                               │
│  • Commands: open_file, save_file, list_dir, read_file      │
│  • Commands: check_spelling, get_dictionary_list            │
│  • File Watcher (notify) → emit events to frontend          │
│  • Resource Manager (dictionaries, icons)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Структура проекта

```
vasyavig/
├── src/                          # Frontend (React + TS)
│   ├── main.tsx
│   ├── App.tsx
│   ├── store/                    # Zustand stores
│   │   ├── fileStore.ts          # Текущий файл, папка, история
│   │   ├── uiStore.ts            # Тема, язык, layout (split view on/off)
│   │   └── editorStore.ts        # Состояние редактора (mode, content, dirty)
│   ├── components/
│   │   ├── Layout.tsx            # Корневой layout (sidebar + main)
│   │   ├── Sidebar/
│   │   │   ├── FileTree.tsx      # Дерево файлов (рекурсивное)
│   │   │   ├── FileTreeNode.tsx  # Узел дерева (файл/папка)
│   │   │   └── SidebarHeader.tsx # Кнопки "Открыть папку", "Обновить"
│   │   ├── EditorArea/
│   │   │   ├── EditorTabs.tsx    # Табы открытых файлов
│   │   │   ├── MarkdownEditor.tsx # Обертка над Gravity UI Editor
│   │   │   ├── MonacoViewer.tsx  # Read-only Monaco для текстовых файлов
│   │   │   ├── SplitPreview.tsx  # Правая панель превью (HTML/YFM)
│   │   │   └── EmptyState.tsx    # Пустое состояние (ни один файл не открыт)
│   │   ├── Toolbar/
│   │   │   ├── MainToolbar.tsx   # Кнопки: Открыть, Сохранить, Сохранить как, Undo/Redo
│   │   │   ├── ModeSwitcher.tsx  # Переключение WYSIWYG / Markup / Split
│   │   │   └── SpellcheckToggle.tsx # Вкл/выкл live spellcheck
│   │   ├── StatusBar/
│   │   │   ├── StatusBar.tsx     # Нижняя панель
│   │   │   ├── FileTypeBadge.tsx # Яркий значок .md / .yfm / .txt и т.д.
│   │   │   ├── LanguageSelector.tsx # Переключатель ru/en
│   │   │   └── ThemeToggle.tsx   # Переключатель темы
│   │   └── Modals/
│   │       ├── SaveConfirmModal.tsx # Предупреждение при смене расширения md↔yfm
│   │       └── SettingsModal.tsx    # Настройки (тема, язык, словари)
│   ├── hooks/
│   │   ├── useTauriFS.ts         # Хуки для работы с Tauri FS API
│   │   ├── useSpellcheck.ts      # Хук live spellcheck (debounced)
│   │   └── useFileWatcher.ts     # Подписка на события файловой системы
│   ├── lib/
│   │   ├── i18n.ts               # Конфиг i18next
│   │   ├── constants.ts          # Константы (поддерживаемые расширения)
│   │   └── utils.ts              # Утилиты (определение типа файла, path utils)
│   └── types/
│       └── index.ts              # Глобальные TypeScript типы
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs               # Точка входа, регистрация команд
│   │   ├── commands/
│   │   │   ├── fs.rs             # Команды файловой системы
│   │   │   ├── spellcheck.rs     # Команды проверки орфографии
│   │   │   └── window.rs         # Команды управления окном
│   │   ├── services/
│   │   │   ├── file_service.rs   # Логика чтения/записи/обхода
│   │   │   └── spell_service.rs  # Инициализация Hunspell, проверка слов
│   │   └── utils/
│   │       └── paths.rs          # Работа с путями
│   └── resources/                # Встроенные ресурсы
│       ├── dictionaries/
│       │   ├── ru_RU.aff
│       │   ├── ru_RU.dic
│       │   ├── en_US.aff
│       │   └── en_US.dic
│       └── icons/
├── public/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## 4. Функциональные требования

### 4.1. Файловая система

#### 4.1.1. Открытие папки
- Пользователь нажимает "Открыть папку" (Ctrl+Shift+O / Cmd+Shift+O).
- Tauri вызывает `dialog::open` с `directory: true`.
- После выбора папки Rust команда `list_directory` рекурсивно (с лимитом глубины) читает структуру и возвращает JSON-дерево.
- Frontend отображает дерево в Sidebar. Скрытые файлы (начинающиеся с `.`) — по умолчанию скрыты, есть toggle.

#### 4.1.2. Открытие файла
- Двойной клик по файлу в дереве или Ctrl+O для отдельного файла.
- Поддерживаемые расширения для редактора:
  - `.md`, `.markdown`, `.yfm`, `.mdx` → Gravity UI Markdown Editor
  - `.txt`, `.json`, `.py`, `.sql`, `.js`, `.ts`, `.jsx`, `.tsx`, `.yaml`, `.yml`, `.xml`, `.log`, `.rs`, `.go`, `.java`, `.cpp`, `.c`, `.h` → Monaco Viewer (read-only)
- Файл открывается в новом табе. Если файл уже открыт — активируется существующий таб.
- Заголовок окна приложения: `{filename} — Vasyavig`.

#### 4.1.3. Сохранение
- **Ctrl+S / Cmd+S:** сохранение текущего файла.
- **Ctrl+Shift+S / Cmd+Shift+S:** "Сохранить как..." (диалог).
- **Логика расширения:**
  - В статус-баре всегда отображается яркий бейдж с текущим расширением файла:
    - `.md` — синий бейдж
    - `.yfm` — оранжевый/фиолетовый бейдж (брендовый цвет YFM)
    - `.txt` и др. — серый бейдж (только просмотр, сохранение недоступно)
  - При попытке "Сохранить как" с изменением расширения между `.md` и `.yfm` показывается модальное окно:
    - Заголовок: "Изменение формата файла"
    - Текст: "Вы пытаетесь сохранить файл с расширением `.yfm`, но текущий формат — `.md`. Продолжить?"
    - Кнопки: "Сохранить как YFM", "Вернуться к MD", "Отмена"
  - При прямом сохранении (Ctrl+S) расширение не меняется никогда.

#### 4.1.4. Файловое дерево (Sidebar)
- Древовидная структура с иконками (Gravity UI icons).
- Функции:
  - Свернуть/развернуть папки
  - Активный файл подсвечивается
  - Контекстное меню (правый клик): "Открыть", "Открыть в папке" (через `shell::open`)
- Автообновление: Rust watcher (`notify` crate) следит за изменениями в открытой папке и шлёт события `fs-change` во frontend для обновления дерева.

### 4.2. Редактор Markdown / YFM

#### 4.2.1. Режимы работы
- **WYSIWYG:** Визуальное редактирование с тулбаром (как в статье).
- **Markup:** Редактирование markdown-разметки с подсветкой синтаксиса (CodeMirror под капотом Gravity UI).
- **Split View:** Слева редактор (WYSIWYG или Markup — переключается отдельно), справа панель предпросмотра.
- Переключение режимов — через сегментированную кнопку в тулбаре.

#### 4.2.2. Поддерживаемые блоки (все из коробки Gravity UI)
- Заголовки H1–H6
- Списки (нумерованные, маркированные, чеклисты)
- Таблицы (с возможностью редактирования)
- Блоки кода с подсветкой
- Цитаты
- Горизонтальные разделители
- Ссылки, изображения
- Mermaid-диаграммы (sequence, flowchart, gantt и др.)
- HTML-блоки (с предпросмотром)
- Якоря (anchors)
- Каты (`{% cut "Заголовок" %}`)
- YFM-специфичные директивы

#### 4.2.3. Monaco Viewer (текстовые файлы)
- Только просмотр (`readOnly: true`).
- Подсветка синтаксиса определяется по расширению.
- Возможность переноса строк (word wrap toggle).
- Поиск по тексту (встроено в Monaco).
- **Беклог:** редактирование текстовых файлов.

### 4.3. Предпросмотр (Split View)

- **Правая панель** рендерит текущий markdown/yfm в HTML в реальном времени.
- Использовать `@diplodoc/transform` или встроенный рендерер из `@gravity-ui/markdown-editor`.
- Для Mermaid: в preview-панели подключить `mermaid` и вызывать `mermaid.run()` после обновления DOM.
- Для HTML-блоков: рендерить в sandboxed iframe или через DOMPurify (если подключать).
- Синхронизация скролла (опционально, беклог): при скролле в редакторе — скроллить preview к соответствующему якорю.

### 4.4. Проверка орфографии (Hunspell)

#### 4.4.1. Архитектура
- **Rust side:** `spell_service.rs` инициализирует Hunspell с загруженными из ресурсов `.aff` и `.dic` файлами.
- **Tauri command:** `check_spelling(text: String, lang: String) -> Vec<MisspelledWord>`
  - Возвращает массив объектов: `{ word: String, start: usize, end: usize, suggestions: Vec<String> }`
- **Frontend:**
  - Live mode: debounce (500ms) после остановки печати. Отправляет текст текущего параграфа/документа в Rust, получает ошибки, отображает подчёркивания (custom decorations через ProseMirror API или CSS overlays).
  - On-demand: кнопка "Проверить орфографию" (F7) — проверка всего документа с выводом панели ошибок.
  - Контекстное меню по клику на ошибочное слово: список вариантов замены + "Добавить в словарь".

#### 4.4.2. Языки
- По умолчанию: русский + английский (en_US).
- В настройках можно выбрать активный словарь (ru / en / both).
- Если выбрано "both" — проверять через оба словаря (слово считается правильным, если есть хотя бы в одном).

#### 4.4.3. Производительность
- Для live-mode проверять только видимую область или текущий абзац (чтобы не гонять весь документ при каждом keystroke).
- Для полной проверки — весь документ, но асинхронно (через Tauri command, не блокируя UI).

### 4.5. Темизация

- **Темы:** Светлая (`light`) / Тёмная (`dark`) / Системная (следует за ОС).
- Реализация: CSS-переменные Gravity UI + класс `g-root` с модификатором темы.
- Переключение — в статус-баре или через настройки.
- Сохранение выбора в `localStorage` (или Tauri store plugin).
- Monaco так же переключает тему (`vs` / `vs-dark`).

### 4.6. Интернационализация (i18n)

- **Языки:** Русский (ru), Английский (en).
- **Реализация:** `i18next` + `react-i18next`.
- **Файлы переводов:** `public/locales/{lang}/translation.json`.
- **Переключение:** селект в статус-баре. Сохраняется в настройках.
- **Скопы переводов:**
  - UI элементы (меню, кнопки, статус-бар)
  - Диалоги и модальные окна
  - Подсказки и empty-states
  - Названия режимов (WYSIWYG, Markup, Split)

---

## 5. UI/UX Спецификация

### 5.1. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [≡] Vasyavig          [WYSIWYG | Markup | Split]  [Save]   │  ← Toolbar
├──────────┬───────────────────────────────────────────────────┤
│          │                                                   │
│  📁 docs │  # Заголовок документа      ┌─────────────────┐   │
│  ├── 📄  │  Текст документа...         │   Preview       │   │
│  │   a.md│  - список                   │   (HTML/YFM)    │   │
│  ├── 📄  │  - список                   │                 │   │
│  │   b.yf│                             │   [Diagram]     │   │
│  └── 📂  │                             │                 │   │
│      └── │                             └─────────────────┘   │
│  [Open Folder]                                               │
├──────────┴───────────────────────────────────────────────────┤
│  [● .md]  [RU ▼]  [☀/🌙]  [Spellcheck: ON]  [Ln 12, Col 5]  │  ← Status Bar
└──────────────────────────────────────────────────────────────┘
```

### 5.2. Компоненты

#### Toolbar
- **Left:** App icon / Hamburger (меню: Открыть папку, Настройки, О программе)
- **Center:** Mode switcher (segmented control): `WYSIWYG` | `Markup` | `Split`
- **Right:**
  - Undo / Redo (если доступно)
  - Save (Ctrl+S)
  - Save As (Ctrl+Shift+S)

#### Sidebar
- **Header:** Кнопка "Открыть папку", кнопка "Свернуть все", фильтр по имени (поиск).
- **Tree:** Иконки файлов по типу (md/yfm — фиолетовые/синие, txt — серые, json — жёлтые и т.д.).
- **Footer:** Путь к открытой папке (truncated).

#### Editor Area
- **Tabs:** горизонтальные табы с крестиком закрытия. Если таб "грязный" (есть несохранённые изменения) — показывать точку `●`.
- **Content:**
  - Markdown → Gravity UI Editor
  - Text → Monaco Viewer
- **Split Panel:** Resizable (drag divider). Минимальная ширина preview — 300px.

#### Status Bar
- **FileTypeBadge:** Яркий бейдж с расширением (`.md` — синий, `.yfm` — оранжевый/фиолетовый, `.txt` — серый).
- **LanguageSelector:** `RU | EN` (текущий подчёркнут).
- **ThemeToggle:** Иконка солнца/луны.
- **SpellcheckIndicator:** `✓` (вкл) или `✗` (выкл).
- **CursorPosition:** Строка, колонка (для Monaco; для WYSIWYG — опционально).

---

## 6. Tauri Commands (Rust API)

### 6.1. Файловая система

```rust
#[tauri::command]
async fn open_folder_dialog(app: AppHandle) -> Result<Option<String>, String>;
// Открывает нативный диалог выбора папки. Возвращает абсолютный путь.

#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<FileNode>, String>;
// Возвращает дерево файлов/папок (1 уровень). FileNode: { name, path, is_dir, children: Option<Vec<FileNode>> }

#[tauri::command]
async fn read_file(path: String) -> Result<String, String>;
// Читает файл как UTF-8 текст. Ошибка, если бинарный.

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String>;
// Атомарная запись (через temp file + rename).

#[tauri::command]
async fn save_file_dialog(default_name: String, filters: Vec<FileFilter>) -> Result<Option<String>, String>;
// Диалог "Сохранить как". filters: [{ name: "Markdown", extensions: ["md"] }, { name: "YFM", extensions: ["yfm"] }]

#[tauri::command]
async fn get_file_metadata(path: String) -> Result<FileMeta, String>;
// Возвращает { name, extension, size, modified_at }
```

### 6.2. Проверка орфографии

```rust
#[derive(Debug, Serialize)]
struct MisspelledWord {
    word: String,
    start: usize,
    end: usize,
    suggestions: Vec<String>,
}

#[tauri::command]
fn check_spelling(text: String, lang: String) -> Result<Vec<MisspelledWord>, String>;
// lang: "ru", "en", "both"

#[tauri::command]
fn add_word_to_dictionary(word: String, lang: String) -> Result<(), String>;
// Добавляет слово в пользовательский словарь (файл в app_data_dir).
```

### 6.3. Системные

```rust
#[tauri::command]
fn get_app_version() -> String;

#[tauri::command]
fn show_in_folder(path: String);
// Открывает Finder/Explorer с выделенным файлом.
```

---

## 7. Интеграция Gravity UI Markdown Editor

### 7.1. Установка
```bash
pnpm install @gravity-ui/markdown-editor @gravity-ui/uikit @gravity-ui/components @gravity-ui/icons
```

### 7.2. Базовая обёртка

```tsx
import {MarkdownEditor, MarkdownEditorView, useMarkdownEditor} from '@gravity-ui/markdown-editor';
import {useEffect} from 'react';

interface Props {
  initialContent: string;
  mode: 'wysiwyg' | 'markup' | 'split';
  onChange: (content: string) => void;
}

export function GravityEditor({initialContent, mode, onChange}: Props) {
  const editor = useMarkdownEditor({
    initial: {content: initialContent, mode: 'markdown'},
    handlers: {
      // Обработка загрузки файлов (drag-and-drop / paste)
      fileUploadHandler: async (file) => {
        // В Tauri: сохранить в папку проекта, вернуть относительный путь
        return {url: `./images/${file.name}`};
      },
    },
  });

  useEffect(() => {
    const unsubscribe = editor.on('change', () => {
      onChange(editor.getValue());
    });
    return () => unsubscribe();
  }, [editor, onChange]);

  return (
    <MarkdownEditorView
      editor={editor}
      mode={mode === 'markup' ? 'source' : 'wysiwyg'}
      // split view управляется отдельно через CSS grid
    />
  );
}
```

### 7.3. Расширения (все включены)
- `Mermaid` — встроено, требует `mermaid` как peer dependency.
- `Html` — встроено.
- `YfmCut` — встроено.
- `YfmTabs` — встроено.
- `YfmTable` — встроено.
- `Checkbox` — встроено.
- `Anchor` — встроено.

---

## 8. Интеграция Monaco Viewer

```tsx
import Editor from '@monaco-editor/react';

interface Props {
  content: string;
  language: string; // 'json', 'python', 'sql', 'plaintext'...
  theme: 'vs' | 'vs-dark';
}

export function MonacoViewer({content, language, theme}: Props) {
  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      theme={theme}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
      }}
    />
  );
}
```

**Определение языка по расширению:**
```ts
const langMap: Record<string, string> = {
  json: 'json', py: 'python', sql: 'sql', js: 'javascript',
  ts: 'typescript', yaml: 'yaml', xml: 'xml', rs: 'rust',
  // ...
};
```

---

## 9. Интеграция Hunspell (Rust)

### 9.1. Зависимости (Cargo.toml)
```toml
[dependencies]
tauri = { version = "2.0", features = [] }
hunspell-rs = "0.4"
# или zspell = "0.5" (чистый Rust, без FFI)
serde = { version = "1.0", features = ["derive"] }
```

### 9.2. Инициализация словарей
- Словари `.aff` и `.dic` кладутся в `src-tauri/resources/dictionaries/`.
- При старте приложения копируются (если не существуют) в `app_data_dir/dictionaries/` (чтобы пользователь мог добавлять слова).
- `SpellService` инициализирует Hunspell с этими путями.

### 9.3. Пользовательский словарь
- Файл `user.dic` в `app_data_dir`.
- Команда `add_word_to_dictionary` дописывает слово в этот файл и добавляет в runtime Hunspell instance.

---

## 10. Логика работы с .md и .yfm

### 10.1. Определение формата
- По расширению файла:
  - `.md`, `.markdown` → формат `markdown`
  - `.yfm` → формат `yfm`
- Внутри Gravity UI Editor оба формата редактируются одинаково (YFM — расширение Markdown).

### 10.2. Индикатор формата (StatusBar)
```tsx
<FileTypeBadge extension={ext} />
// .md → bg: --g-color-base-info-medium, text: "MD"
// .yfm → bg: --g-color-base-warning-medium, text: "YFM"
// .txt → bg: --g-color-base-neutral-medium, text: "TXT"
```

### 10.3. Защита от случайной смены формата
- При `Save As` с другим расширением:
  1. Перехватить путь из диалога.
  2. Сравнить `oldExt` и `newExt`.
  3. Если `(oldExt === 'md' && newExt === 'yfm') || (oldExt === 'yfm' && newExt === 'md')`:
     - Показать `SaveConfirmModal`.
     - Если пользователь подтверждает — записать файл, обновить `fileStore` (новый путь/расширение).
     - Если отменяет — вернуться в диалог.

---

## 11. Беклог (Backlog)

| Приоритет | Фича | Описание |
|-----------|------|----------|
| P1 | Draw.io интеграция | Встраивание draw.io диаграмм как отдельный блок (iframe/embed) |
| P2 | Редактирование текстовых файлов | Перевод Monaco Viewer из `readOnly` в редактируемый режим с сохранением |
| P3 | Коллаборативное редактирование | CRDT (Yjs) + WebSocket для совместной работы |
| P4 | Синхронизация скролла | Scroll-sync между редактором и preview-панелью |
| P5 | Плагинная система | API для сторонних расширений |
| P6 | Экспорт в PDF/HTML | Конвертация документа в статические форматы |
| P7 | Git-интеграция | Индикация изменённых файлов, базовые git-команды |

---

## 12. Пошаговый план разработки (для Kimi Code)

### Этап 1: Скелет Tauri v2 + React
1. `pnpm create tauri-app@latest` → React + Vite + TypeScript.
2. Настроить `tauri.conf.json` (permissions для `fs:default`, `dialog:default`, `os:default`).
3. Подключить `@gravity-ui/uikit` и настроить темы (light/dark).
4. Создать базовый `Layout` (Sidebar + Main Area).

### Этап 2. Файловое дерево
1. Реализовать Rust commands: `open_folder_dialog`, `list_directory`, `read_file`.
2. Создать `FileTree` компонент (рекурсивный рендер).
3. Добавить `fileStore` (Zustand) для хранения открытой папки и активного файла.
4. Подключить `notify` (Rust) и эмитить события `fs-change` в frontend.

### Этап 3. Редактор Markdown
1. Установить `@gravity-ui/markdown-editor`.
2. Создать `MarkdownEditor` wrapper с поддержкой WYSIWYG/Markup.
3. Реализовать открытие `.md`/`.yfm` файлов в редакторе.
4. Добавить табы (`EditorTabs`).

### Этап 4. Сохранение и индикаторы
1. Реализовать `write_file` и `save_file_dialog` (Rust).
2. Добавить `SaveConfirmModal` для защиты смены md↔yfm.
3. Создать `StatusBar` с `FileTypeBadge`.
4. Горячие клавиши: Ctrl+S, Ctrl+Shift+S.

### Этап 5. Monaco Viewer
1. Установить `@monaco-editor/react`.
2. Создать `MonacoViewer` (read-only).
3. Логика определения языка по расширению.
4. Открытие текстовых файлов в Monaco вместо Gravity Editor.

### Этап 6. Split Preview
1. Создать `SplitPreview` компонент (resizable панель).
2. Рендеринг markdown в HTML (использовать `@diplodoc/transform` или встроенный preview Gravity UI).
3. Подключить `mermaid` для диаграмм в preview.

### Этап 7. Hunspell
1. Добавить словари в `src-tauri/resources/dictionaries/`.
2. Реализовать `SpellService` (Rust) с `hunspell-rs`.
3. Команды: `check_spelling`, `add_word_to_dictionary`.
4. Frontend: `useSpellcheck` hook с debounce, отображение ошибок (CSS underline).

### Этап 8. i18n и Темы
1. Настроить `i18next` с ru/en переводами.
2. Переключатель языка в статус-баре.
3. Темы: интеграция с Gravity UI theme provider + Monaco theme.
4. Сохранение настроек (theme, lang) в Tauri store / localStorage.

### Этап 9. Полировка
1. Обработка ошибок (toast-уведомления через `@gravity-ui/uikit`).
2. Drag-and-drop файлов в окно приложения.
3. Проверка на бинарные файлы (блокировка открытия).
4. Оптимизация производительности (виртуализация дерева при >1000 файлов).

---

## 13. Критические замечания для разработчика

- **Tauri v2 Permissions:** В `tauri.conf.json` или `capabilities/*.json` ОБЯЗАТЕЛЬНО прописать `fs:allow-read`, `fs:allow-write`, `fs:allow-read-dir`, `dialog:allow-open`, `dialog:allow-save`. Без этого команды будут возвращать `forbidden`.
- **Gravity UI SSR:** `@gravity-ui/markdown-editor` использует DOM API. Убедиться, что компонент монтируется только на клиенте (Tauri WebView — это клиент, но при SSR в Vite нужно быть аккуратным; обычно Tauri не делает SSR, но `typeof window !== 'undefined'` — хорошая страховка).
- **Hunspell пути:** В Rust `std::path::PathBuf` для словарей. Использовать `app_handle.path_resolver().resolve_resource()` для доступа к встроенным ресурсам.
- **Кодировка файлов:** Всегда читать/писать UTF-8. При ошибке декодирования — показывать пользователю сообщение "Файл не в UTF-8".
- **Безопасность HTML-блоков:** В preview-панели рендерить HTML-блоки в sandboxed iframe или использовать DOMPurify, чтобы пользовательский HTML не ломал приложение.
- **File Watcher:** `notify` может генерировать много событий. Дебаунс на стороне Rust (или frontend) при обновлении дерева.

---

---

## 15. Уроки из предыдущего проекта (LESSONS_LEARNED)

> Раздел основан на реальном опыте отладки первого запуска Tauri 2 + React + Zustand + Vite. Каждый пункт — конкретная ошибка, которая привела к «белому окну» или неработающей сборке.

### 15.1. pnpm-workspace.yaml — шаблонные плейсхолдеры ломают сборку

**Что произошло.** `pnpm create tauri-app` оставляет в `pnpm-workspace.yaml` плейсхолдер:
```yaml
allowBuilds:
  esbuild: set this to true or false   # НЕ валидное значение
```
pnpm 11.x блокирует ВСЕ build-скрипты, esbuild не устанавливается, Vite падает с `RC=127`.

**Правило.** После `create-*` скаффолда ревьюить конфиги целиком. Удалить шаблонные ключи. Оставить только валидный `allowBuilds` или `onlyBuiltDependencies` — но не оба. После `pnpm install` проверить, что платформенный бинарь esbuild на месте (`node_modules/.pnpm/@esbuild/*/esbuild.exe` или аналог).

### 15.2. Vite `host: false` → белое окно на Windows

**Что произошло.** WebView2 иногда резолвит `localhost` в IPv6 (`::1`), а Vite с `host: false` слушает на IPv4 — соединение молча падает. Окно белое, DevTools пустые, ошибок нет.

**Правило.** В `vite.config.ts` явно зафиксировать:
```ts
server: {
  port: 1420,
  strictPort: true,
  host: "127.0.0.1",   // явно IPv4, не false
}
```

**Диагностика белого окна:** открыть `http://127.0.0.1:1420` в системном Edge (тот же движок, что WebView2).
- UI есть в Edge, но нет в Tauri → проблема WebView2/окружения.
- Пусто и в Edge → проблема во фронтенде (Vite/React/модули).
- Страница не грузится в Edge → проблема в dev-сервере (порт/биндинг).

### 15.3. Zustand: некэшированные селекторы = бесконечный ре-рендер

**Что произошло.** Селектор, возвращающий `new Set()` / `new Array()` / `{...spread}` при каждом вызове, вызывает `Maximum update depth exceeded` в React 18+ (`useSyncExternalStore` сравнивает через `Object.is`). Это главная причина белого окна в предыдущем проекте.

**Правило.** Zustand-селекторы возвращают только примитивы или стабильные ссылки. Производные коллекции — через `useMemo` в компоненте или `useShallow`.

| Тип возврата | Безопасно? |
|---|---|
| примитив (`string`, `number`, `boolean`) | ✅ |
| стабильная ссылка (поле store) | ✅ |
| `new Object()` / `{ ...spread }` | ❌ |
| `new Array()` / `.filter()` / `.map()` | ❌ |
| `new Set()` / `new Map()` | ❌ |

**Пример безопасного паттерна:**
```ts
// ❌ ОПАСНО: новый Set каждый раз
const cats = useStore((s) => new Set(extractCategories(s.entries)));

// ✅ БЕЗОПАСНО: подписка на стабильную ссылку + useMemo
const entries = useStore((s) => s.entries);
const cats = useMemo(() => new Set(extractCategories(entries)), [entries]);
```

**Важно:** `dirty`-флаг и состояние текста редактора хранить внутри объекта store, не вычислять селектором-функцией. Иначе переключение режимов/вкладок потеряет правки.

### 15.4. Tauri `onCloseRequested` + async = мёртвая кнопка закрытия

**Что произошло.** Обработчик закрытия вызывал `ask()`, и при выбросе исключения `preventDefault()` оставался «висящим» — окно не закрывалось.

**Правило.** Окно обязано закрываться всегда, кроме явного подтверждения. Асинхронные операции в close-handler — в `try/catch`. При ошибке НЕ вызывать `preventDefault()`:
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

### 15.5. Split-view markdown — `useDeferredValue` и единый стор

**Что произошло.** `ReactMarkdown` ре-рендерился на каждый keystroke в Monaco — на файлах >5 КБ лагало. Также состояние текста жило в `useState` компонента и терялось при переключении вкладок.

**Правило.**
1. **Preview рендерится через `useDeferredValue(raw)`** — React сам выбирает момент между кадрами, не блокируя печать. Никаких дополнительных debounce-таймеров.
2. **Markdown-состояние (`value`, `dirty`) — в Zustand store**, не в локальном `useState`. Иначе размонтирование компонента = потеря правок.
3. **В handler `Ctrl+S` читать `editorStore.getState().currentDoc.content`**, а не замыкание из `onMount` — иначе сохранится устаревший текст.

### 15.6. Шпаргалка: быстрые проверки при «белом окне Tauri»

| Симптом | Скорее всего | Проверка |
|---|---|---|
| `pnpm tauri dev` падает до окна | pnpm / build-скрипты | `pnpm install` RC=0? Есть esbuild-бинарь? |
| Окно открывается, но белое, консоль пустая | IPv6/IPv4 или dev-сервер | `127.0.0.1:1420` в Edge |
| Белое окно, в Edge-DevTools `Maximum update depth` | некэшированный Zustand-селектор | аудит всех `useStore(selector)` |
| Окно белое, в консоли Tauri-API TypeError | Tauri-импорт вне try/catch | обернуть в try/catch или `isTauri`-guard |
| Кнопка закрытия не работает | `onCloseRequested` блокирует | try/catch, не звать `preventDefault` при ошибке |

**Методология:** при «белом окне» проверять слои по порядку — не пытаться чинить всё сразу:
1. Пакетный менеджер (`pnpm install` RC=0)
2. Build-скрипты (esbuild на месте)
3. Dev-сервер (порт, биндинг)
4. Сеть до сервера (Edge по тому же URL)
5. Фронтенд-рантайм (DevTools Console)
6. Tauri-окружение (capabilities, плагины)

## 14. Пример запуска (после генерации кода)

```bash
cd vasyavig
pnpm install
pnpm run tauri dev        # Dev mode с hot reload
pnpm run tauri build      # Сборка production бинарника
```

---

*Документ составлен для Kimi Code / AI-ассистента. Содержит архитектуру, стек, структуру, API и пошаговый план для реализации desktop-приложения Vasyavig на Tauri v2.*

---

## 16. Вопросы к пользователю (открытые)

> Добавлено агентом при первой сессии (2026-07-27). Ответы — в формате `USER_INPUT` (заменить на решение или удалить вопрос).

1. **Расположение приложения.** Репозиторий уже называется `vasyavig`, а §3 показывает корень проекта как `vasyavig/`. Создавать приложение **в корне репозитория** (src/, src-tauri/ рядом с -=docs=-) или во вложенной папке `app/` (как в предыдущем проекте transcript-optimizer)?
   - *Рекомендация ИИ:* в корне репозитория — проект монолитный, подпапка не нужна.
   - Ответ: в корне репозитория — проект монолитный, подпапка не нужна.

2. **LESSONS_LEARNED.md.** Файла в корне нет — его содержимое уже вшито в §15. Создать отдельный `LESSONS_LEARNED.md` по старой традиции (и оставить §15 как ссылку), или §15 в идее достаточно?
   - *Рекомендация ИИ:* создать отдельный файл — HOW_TO_START_NEW_SESSION.md требует его чтения каждой сессией.
   - - Ответ: Создать отдельный `LESSONS_LEARNED.md`

3. **Тесты.** В идее нет требований к автотестам, но PHASES_CONVENTION требует раздел «Проверки» с командами. Какой минимум принять: только ручные проверки (запуск `pnpm tauri dev`, сценарии открытия/сохранения) или также unit-тесты (Vitest для stores/utils, cargo test для Rust)?
   - *Рекомендация ИИ:* ручные проверки на этапах 1–3, Vitest для `lib/utils.ts` и `store/*` начиная с этапа 4, cargo test для `spell_service.rs` на этапе 7.
   - Ответ: ручные проверки на этапах 1–3, Vitest для `lib/utils.ts` и `store/*` начиная с этапа 4, cargo test для `spell_service.rs` на этапе 7.

4. **Пакетный менеджер.** В идее используется `pnpm` — подтверждаете, что pnpm установлен (учитывая урок §15.1 про pnpm 11.x и build-скрипты)? Или использовать `npm`?
   - *Рекомендация ИИ:* pnpm, но сразу зафиксировать валидный `pnpm-workspace.yaml` без шаблонных плейсхолдеров.
   - Ответ: pnpm, но сразу зафиксировать валидный `pnpm-workspace.yaml` без шаблонных плейсхолдеров.

5. **Ветвление.** Сейчас текущая ветка — `dev`, main branch — `main`. Работаем прямо в `dev` с последующим PR в `main` по завершении фазы, или фиче-ветки `feature/<topic>` → `dev` → `main`?
   - *Рекомендация ИИ:* коммиты по этапам прямо в `dev`, PR в `main` в конце фазы 1 (работающий скелет).
   - Ответ: pnpm, коммиты по этапам прямо в `dev`, PR в `main` выполняет польтзователь 

6. **Spellcheck в режиме Markup.** §4.4 описывает подчёркивания в WYSIWYG (ProseMirror decorations). Нужна ли проверка орфографии также в режиме Markup (CodeMirror) и в Monaco Viewer, или только WYSIWYG?
   - *Рекомендация ИИ:* только WYSIWYG на первом этапе; Markup/Monaco — в беклог (там технически сложнее из-за разметки в тексте).
   - Ответ: только WYSIWYG на первом этапе

7. **Нумерация разделов.** В документе §14 «Пример запуска» идёт после §15 «Уроки» — оставить как есть или переупорядочить?
   - *Рекомендация ИИ:* косметика, не критично; можно исправить при следующей правке документа.
   - Ответ: Косметика, не критично; можно исправить при следующей правке документа.

8. **hunspell-rs vs zspell.** `hunspell-rs` требует системный libhunspell (FFI), что проблемно на Windows-сборке. Разрешаете выбрать `zspell` (чистый Rust) как основной вариант, если `hunspell-rs` не соберётся?
   - *Рекомендация ИИ:* да — начать с `zspell`, `hunspell-rs` только если упрётся в совместимость .aff/.dic.
   - Ответ: да — начать с `zspell`, `hunspell-rs` только если упрётся в совместимость .aff/.dic.
