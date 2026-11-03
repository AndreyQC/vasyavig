# 20261102_002 — Анализ подхода «ассистент по документам» (result)

> Контекст:
> - `harness_docs/harness_tasks/2026-11-02/20261102_002_ai_document_agent_analysis_task.md` — постановка и решения
> - `harness_docs/harness_tasks/2026-11-02/20261102_001_ai_document_agent_idea.md` — исходная идея
> - `harness_docs/roadmap.md` — фазы и беклог
> - `harness_docs/harness_checkpoints/20261028_003_checkpoint.md` — состояние проекта
> - `C:\repos\personal\GITHUB\transcript-optimizer` — опорная реализация LLM-настроек и стриминга

Дата: 2026-11-02 | Ветка: dev, `547ebd1` | Статус: анализ завершён, к реализации
Фаза: **Phase 8 — Ассистент по документам** (старт 2026-11-02)

## 1. Вывод

Делать. Реализацию не откладывать: стартовать Phase 8 сразу, параллельно с
остатком Phase 7. MVP-1 ассистента не зависит от задачи 7 Phase 7
(write-path в `documents.jsonl`): создание документа и правка markdown
работают через редактор и существующий file-flow, а запись в реестр — это
отдельный слой для harness-черновиков.

Первый объём — небольшой и проверяемый: конфиг с моделями, панель справа,
read/propose-инструменты, две кнопки («Проверка документа», «Письмо HTML»),
diff-подтверждение и псевдонимизация секретов. Свободный чат, NER,
эскалация и запись в реестр — после MVP.

Почему это стоит делать именно в Vasyavig:

- уже есть реестр, граф, ULID-ссылки, конверты, задачи и TOC — ассистент
  получает уникальный контекст, которого нет у обычного чата;
- уже есть write-путь в редактор (`editor.replace`, dirty, undo), его можно
  переиспользовать без нового механизма сохранения;
- конфиг и crypto-подход уже проверены в `transcript-optimizer`;
- сценарии «проверить документ» и «сделать письмо» дают ценность даже без
  сильной модели.

## 2. Принятые решения

| # | Решение |
|---|---|
| D1 | Модель — в периметре, доступ по OpenAI-совместимому протоколу; локального рантайма и бандлинга весов нет |
| D2 | Конфиг — отдельный `vasyavig.yaml` рядом с `.vasyavig-workspace` |
| D3 | В конфиге несколько моделей; переключение во время работы обновляет `default_model` |
| D4 | Секреты — только `crypto__<ENV>__<ciphertext>` (Fernet), ключ из env; plain-ключей нет |
| D5 | Настройки — UI-форма; `vasyavig.yaml` открывается read-only |
| D6 | В конфиге `llm` + `assistant` + `editor` + `files`; тема и язык — глобально в localStorage |
| D7 | Ассистент — сворачиваемая панель справа |
| D8 | MVP-1 — quick actions + рецепты, без свободного чата |
| D9 | Quick actions MVP-1: «Проверка документа» и «Письмо HTML» |
| D10 | Фокус MVP — harness-документация + общие markdown-фиксы |
| D11 | Запись — в буфер редактора (dirty); на диск сохраняет пользователь |
| D12 | MVP-объём записи: правка открытых + создание нового документа; rename/move/delete — нет |
| D13 | Write-инструменты — только `propose_*`; применяет приложение после diff-подтверждения |
| D14 | Каждая write-операция — отдельный diff + «Применить»; auto-apply нет |
| D15 | Контекст по умолчанию — весь активный документ + выделение + findings, с лимитом и чанкованием |
| D16 | Псевдонимизация: MVP — детерминированные детекторы + плейсхолдеры + ручное подтверждение; NER позже |
| D17 | Ошибка модели — короткий retry, затем выбор другой модели; авто-fallback нет |
| D18 | Audit — локально, только метаданные |
| D19 | Старт — сразу MVP-1 с моделью, без отдельного MVP-0 |
| D20 | Нет shell, произвольных команд, сети и generic-FS |
| D21 | Автоматической эскалации в MVP нет; несколько моделей и ручное переключение допустимы |
| D22 | Фаза реализации — Phase 8; старт параллельно остатку Phase 7 |

## 3. Архитектура

```
┌──────────────────────────── Vasyavig ─────────────────────────────┐
│ AssistantPanel (справа)                                          │
│  model selector | quick actions | findings | proposal diffs      │
├───────────────────────────────────────────────────────────────────┤
│ agentStore / configStore                                         │
│   ├─ recipes/ (checkDocument, emailHtml)                         │
│   ├─ tools/ (read, propose) → policy → stores/lib               │
│   ├─ context builder → masking → context pack                    │
│   ├─ proposals/ (diff, apply, stale check)                       │
│   └─ provider (OpenAI-compatible)                                │
├───────────────────────────────────────────────────────────────────┤
│ Rust: agent_service (HTTP/SSE, cancel, limits), crypto (Fernet)  │
│       commands: stream_chat, cancel, encrypt/decrypt, models     │
└───────────────────────────────────────────────────────────────────┘
```

### 3.1. Frontend

| Модуль | Путь (предложение) | Роль |
|---|---|---|
| Config | `src/lib/agent/config.ts` | Разбор/сериализация `vasyavig.yaml`, defaults, валидация, сохранение неизвестных ключей |
| Config store | `src/store/configStore.ts` | Загрузка конфига, список моделей, выбранная модель, app-настройки |
| Provider | `src/lib/agent/provider.ts` | OpenAI-совместимый вызов через Rust, SSE, retry, capabilities |
| Context | `src/lib/agent/context.ts` | Активный документ, выделение, findings, лимиты, чанкование |
| Policy | `src/lib/agent/policy.ts` | Allowlist инструментов по тиру, валидация аргументов, бюджеты |
| Tools | `src/lib/agent/tools/` | Реестр read/propose-инструментов и исполнитель |
| Proposals | `src/lib/agent/proposals.ts` | Diff, apply, проверка hash и уникальности |
| Masking | `src/lib/agent/masking.ts` | Детекторы, плейсхолдеры, mask/unmask |
| Audit | `src/lib/agent/audit.ts` | Локальный журнал метаданных |
| Recipes | `src/lib/agent/recipes/` | `checkDocument`, `emailHtml` |
| Store | `src/store/agentStore.ts` | Прогоны, предложения, состояние панели, выбранная модель |
| UI | `src/components/Assistant/` | Панель, контекст-чипы, findings, diff-карточки, настройки, маскирование |

### 3.2. Rust

| Модуль | Путь (предложение) | Роль |
|---|---|---|
| Agent service | `src-tauri/src/services/agent_service.rs` | `reqwest` с `default-tls`, SSE, таймауты, отмена, лимиты ответа |
| Crypto | `src-tauri/src/services/crypto.rs` | Fernet: AES-128-CBC + HMAC-SHA256, `crypto__<ENV>__<ct>`, ключ из env |
| Commands | `src-tauri/src/commands/agent.rs` | `stream_chat`, `cancel_run`, `generate_fernet_key`, `encrypt_text`, `resolve_crypto_token` |
| Регистрация | `src-tauri/src/lib.rs` | Добавить команды в `invoke_handler` и capabilities |

Зависимости: `reqwest` с `default-tls` (schannel; без `ring`/`aws-lc` — не
тащим C-сборку), `futures-util`; crypto-крейты `aes`, `cbc`, `hmac`,
`sha2`, `base64`, `rand`. `serde`/`serde_json` уже есть. Для YAML на
фронтенде — пакет `yaml` (eemeli/yaml, чистый JS, сохраняет комментарии и
порядок ключей).

### 3.3. Интеграция с существующим кодом

| Что | Где | Использование |
|---|---|---|
| Активные вкладки и dirty | `src/store/editorStore.ts` | Контекст, proposal apply, dirty/undo |
| Замена текста | `src/hooks/useMarkdownTools.ts` → `editor.replace()` | Применение proposal |
| Файлы и корни | `src/store/fileStore.ts`, `src/hooks/useTauriFS.ts` | Создание документа, чтение, пути |
| Harness-реестр | `src/store/harnessStore.ts` | ULID, метаданные, граф |
| Граф | `src/lib/harnessGraph.ts` | Соседи, сироты, `based_on`/`related` |
| Конверт | `src/lib/harnessEnvelope.ts` | Проверка/черновик harness-документа |
| Ссылки и якоря | `restoreCyrillicUrls`, `anchorMatcher`, `harnessUlidLink` | Findings и детерминированные фиксы |
| TOC | `src/lib/generateToc.ts` | Проверка/вставка/замена оглавления |
| Рендер | `@diplodoc/transform`, `src/lib/htmlCsp.ts`, `HtmlViewer` | HTML-письмо и превью |
| Офис | `vendor/anydoc` | Вход для сценариев «разобрать документ» |

## 4. Конфиг `vasyavig.yaml`

Расположение: рядом с `.vasyavig-workspace` (D2). Файл открывается
read-only, изменения — через UI-форму (D5). Секреты — crypto.

```yaml
version: 1

llm:
  default_model: perimeter-fast
  request:
    timeout_ms: 60000
    retries: 2
    retry_backoff_ms: 500
  models:
    perimeter-fast:
      label: "Быстрая"
      base_url: "https://llm.perimeter.example/v1"
      model: "qwen2.5-7b-instruct"
      api_key: "crypto__VASYAVIG_LLM_KEY__gAAAA..."
      temperature: 0.2
      max_tokens: 4096
      context_limit: 32000
      capabilities:
        streaming: true
        json_mode: true
        tools: false
      data_scope: perimeter
    perimeter-strong:
      label: "Сильная"
      base_url: "https://llm.perimeter.example/v1"
      model: "qwen2.5-72b-instruct"
      api_key: "crypto__VASYAVIG_LLM_KEY__gAAAA..."
      temperature: 0.1
      max_tokens: 8192
      context_limit: 128000
      capabilities:
        streaming: true
        json_mode: true
        tools: false
      data_scope: perimeter

app:
  editor:
    spellcheck: "ru+en"       # off | ru | en | ru+en
    default_mode: wysiwyg     # wysiwyg | markup | split
    font_size: 14
  files:
    hidden: false
  assistant:
    enabled: true
    context:
      include_document: true
      include_selection: true
      max_chars: 120000
      chunking: headings
    writes:
      require_confirmation: true
    masking:
      mode: preview           # off | preview; auto — позже
      detectors: [secrets, email, phone]
    audit:
      enabled: true
      retain_runs: 50
```

Поведение:

- Нет файла — defaults в памяти; первый save из UI создаёт файл.
- Невалидный YAML/схема — понятная ошибка, работа на последнем валидном
  конфиге или defaults; исходный файл не перезаписывается.
- Неизвестные секции/ключи сохраняются при записи.
- Переключение модели в шапке панели обновляет `default_model` и
  перезаписывает файл атомарно; при ошибке записи выбор остаётся в памяти,
  пользователь видит ошибку.
- `api_key` принимается только как crypto-токен; UI шифрует ввод через Rust
  с ключом из указанной env-переменной. Без env-ключа файл бесполезен —
  это ожидаемое свойство.
- `request.retries` — короткий retry (D17); автоматического переключения
  модели нет.
- Внешние правки файла: watcher по пути конфига + валидация; при ошибке —
  уведомление и последний валидный конфиг. Резервный вариант — «Перечитать»
  в настройках.

## 5. Инструменты

### 5.1. Read

| Tool | Аргументы | Возврат | Лимит |
|---|---|---|---|
| `get_active_document` | — | `docId`, текст, режим, dirty, ULID | размер документа |
| `get_selection` | — | текст, from/to | — |
| `list_open_documents` | — | `docId`, имя, dirty, вид | 50 |
| `list_workspace_roots` | — | `rootId`, alias/name, `isHarness` | 20 |
| `get_document` | `ulid` | путь от корня, title, content, open | только реестр |
| `search_documents` | `query`, `rootId?`, `limit?` | `docId`/путь, сниппет | 20, сниппет 200 |
| `get_related_documents` | `ulid` | соседи и направление | 50 |
| `list_tasks` | `status?`, `assignee?`, `project?` | задачи | 100 |
| `check_document` | `docId`, `rules?` | findings | — |

### 5.2. Propose

| Tool | Аргументы | Проверки | Результат |
|---|---|---|---|
| `propose_replace` | `docId`, `oldText`, `newText`, `expectedCount?` | `oldText` непустой; ровно N вхождений (по умолчанию 1); hash документа | `Proposal` |
| `propose_insert` | `docId`, `anchor`, `position`, `text` | якорь найден и однозначен; `before/after`; hash | `Proposal` |
| `propose_create` | `rootId`, `relativePath`, `content`, `overwrite?` | корень открыт; путь внутри корня; расширение `.md/.yfm/.txt`; файла нет (или overwrite) | `Proposal` |

`apply_proposal(proposalId)` — **app-only**: проверяет hash, уникальность
`oldText`, якорь, путь; применяет через `editor.replace()` полным текстом;
вкладка становится dirty; undo работает. Модель `apply_proposal` не
вызывает.

Нет и не будет: `run_command`, `shell`, `exec`, `read_file(path)`,
`write_file(path)`, `list_dir`, `delete_document`, `rename_document`,
`move_document`, `open_url`, `http_request`.

### 5.3. Ответы на Q2, Q5, Q6

**Q2 — минимальный набор write-инструментов.** Достаточно трёх
`propose_*` (`replace`, `insert`, `create`) и app-only `apply_proposal`.
`append` отдельным инструментом не нужен: `propose_insert` с `anchor: end`
покрывает добавление в конец. `save_document` модели не даётся.

**Q5 — пути и корни.** Модель не видит абсолютных путей. `docId` — opaque
id открытой вкладки; `rootId` — opaque id корня из `list_workspace_roots`.
Для `propose_create` принимается `rootId` + **относительный** путь:
нормализуются разделители, запрещаются абсолютные пути, `..`, пустые
сегменты и выход за корень после канонизации; проверяется symlink-выход;
разрешены только `.md/.yfm/.txt`; overwrite по умолчанию запрещён.
Корень — запись в `fileStore.roots` (открытый workspace). Если корней
несколько, `rootId` выдаётся приложением и живёт в памяти сессии.

**Q6 — stale-правка.** Оптимистичная блокировка: proposal хранит
`baseHash` содержимого вкладки на момент предложения; `apply_proposal`
пересчитывает hash и отказывает, если документ изменился. Дополнительно
`oldText` должен встречаться ровно `expectedCount` раз. Blocking lock не
нужен: приложение однопользовательское, вкладка одна; при конфликте
пользователь получает «документ изменился, предложение устарело» и может
повторить прогон. Это дешевле и не блокирует редактор.

## 6. Рецепты MVP-1

### 6.1. `checkDocument`

1. **Детерминированные findings** (без модели):
   - legacy-ссылки: `%`-кириллица, `\_`, `harness_ulid:`/`ulid:`, голые
     ULID в тексте;
   - битые якоря (`anchorMatcher`);
   - TOC отсутствует/устарел (`generateToc`/`buildTocPlan`);
   - harness-конверт: отсутствующие/некорректные поля (`harnessEnvelope`);
   - относительные пути изображений, которые не резолвятся;
   - дубли заголовков/коллизии якорей.
2. **Модель** получает документ, выделение (если есть) и список findings;
   возвращает строгий JSON: `{findingId, action: keep|fix|explain,
   replacement?, rationale}`. Никакого свободного HTML и новых
   инструментов.
3. **Валидация ответа**: все `findingId` известны; `replacement` проходит
   схему; при ошибке — один repair-retry, затем ошибка.
4. **Proposals**: детерминированные фиксы предлагаются даже без модели;
   модель объясняет и предлагает правки для неоднозначных случаев.
5. **UI**: список findings + карточки diff; «Применить» по одной.

Модель не является обязательной для базовой ценности: если endpoint
недоступен, показываются findings и детерминированные фиксы.

### 6.2. `emailHtml`

1. Рендер markdown через `@diplodoc/transform` с
   `supportGithubAnchors`, санитизация DOMPurify.
2. Email-шаблон: 600px, табличная вёрстка, inline CSS; YFM-блоки
   notes/cuts — поддерживаемый подмножество или warning.
3. Картинки: MVP — data URI с лимитом (например, 2 MB суммарно); если
   больше — warning и отказ от встраивания. `.eml` с `multipart/related`
   и `cid:` — после MVP.
4. Модель — только тема и preheader (строгий JSON); **тело письма модель
   не генерирует** — оно детерминированное.
5. Вывод: превью в `HtmlViewer`, сохранение `.html` через диалог, копия
   rich HTML в буфер. Это экспорт, а не write-инструмент агента.

## 7. Псевдонимизация

Пайплайн: detect → map → mask → send → validate → unmask → cleanup.
Детали и ограничения — в task-документе §3.9. В MVP:

- детекторы: API-ключи/токены, PEM private keys, e-mail, телефоны,
  `KEY=value` с секретными именами, URL с credentials;
- плейсхолдеры `[[VAS_<TYPE>_<N>]]`, стабильные на прогон, с проверкой
  коллизии с текстом документа;
- маппинг — только в памяти; в audit — счётчики и типы, без значений;
- промпт требует сохранять плейсхолдеры дословно;
- после ответа: неизвестный/пропавший плейсхолдер — warning, авто-применение
  блокируется; в diff и редактор плейсхолдеры не попадают;
- режим `preview`: пользователь видит, что будет отправлено, и решает;
- NER (персоны/организации/локации) — после MVP, сменный детектор.

## 8. Безопасность

| Угроза | Механизм |
|---|---|
| Prompt injection в документе | У модели нет side-effect инструментов; `propose_*` не меняет документ; apply — только пользователь; allowlist в коде |
| Выход за workspace | Opaque `docId`/`rootId`; относительный путь только для create; канонизация, запрет `..`, symlink, абсолютных путей |
| Устаревшая/неоднозначная правка | `baseHash` + точный `oldText` + `expectedCount`; apply перепроверяет |
| Утечка секретов | Псевдонимизация, preview, crypto-конфиг, plain-ключей нет |
| Вредоносный вывод модели | Строгая JSON-схема; HTML в письме не от модели; санитизация превью |
| Расход ресурсов | Лимиты шагов/токенов/времени/размера; отмена |
| Подмена конфига | Валидация схемы, read-only файл, UI-форма, неизвестные ключи сохраняются |
| Shell/команды/сеть | Таких инструментов нет в реестре; сеть — только endpoint модели через Rust |
| Supply chain | `yaml` — чистый JS; Rust crypto — чистые крейты; `reqwest` default-tls |

## 9. UX

- Панель справа, сворачиваемая; на узком окне — overlay.
- Шапка: селектор модели (переключение обновляет `default_model`), статус
  (готово/занято/ошибка), настройки.
- Контекст-чипы: активный документ, выделение, закреплённые документы;
  видно, сколько символов уйдёт.
- Quick actions: «Проверка документа», «Письмо HTML».
- Findings: список с severity, переход к месту, «Предложить правку».
- Proposal card: diff, rationale, «Применить», «Отклонить», «Показать в
  редакторе».
- Псевдонимизация: превью с чипами сущностей и кнопками «вырезать/
  оставить»; маппинг не показывается в audit.
- Ошибки: нет модели, невалидный конфиг, модель недоступна, устаревшее
  предложение — понятные сообщения и следующее действие.
- Настройки: модели (add/edit/remove, проверка endpoint), app-настройки,
  audit, маскирование.

## 10. Phase 8 — план реализации

| Этап | Содержание | Проверки |
|---|---|---|
| 8.1. Конфиг и провайдер | `vasyavig.yaml`, разбор/запись, crypto, UI-форма моделей, `stream_chat` в Rust, селектор модели, retry | Парсинг/round-trip/неизвестные ключи; crypto round-trip; mock SSE; смена модели пишет `default_model` |
| 8.2. Панель, tools, proposals | Панель справа, read-инструменты, policy, `propose_*`, diff/apply, audit, dirty/undo | Allowlist; path traversal; stale hash; apply → dirty; запрещённые инструменты |
| 8.3. `checkDocument` | Findings, контекст, JSON-ответ модели, детерминированные фиксы, карточки | Fixtures ссылок/якорей/TOC/конверта; mock JSON; apply |
| 8.4. `emailHtml` | Рендер, шаблон, inline CSS, превью, экспорт, тема/preheader | Snapshots; санитизация; лимит картинок; YFM-блоки |
| 8.5. Псевдонимизация | Детекторы, плейсхолдеры, preview, remap, блокировка при потере | Round-trip mask/unmask; коллизии; секреты не в промпте; unresolved |
| 8.6. Приёмка | i18n, документация, GUI-чек-лист, обновление roadmap/phase | Ручная приёмка пользователем |

Порядок: 8.1 → 8.2 → 8.3/8.4 (можно параллельно) → 8.5 → 8.6.
Псевдонимизация встроена в context builder с 8.2, UI-детекторы — 8.5.
Phase 7 задача 7 не блокирует; после неё можно добавить создание
harness-черновика с записью в реестр.

## 11. Проверки и тесты

- Unit: config parse/serialize/defaults/unknown keys; crypto round-trip и
  Python-совместимость; policy allowlist; схемы инструментов; path
  validation; stale hash; `oldText` count; anchor resolution; mask/unmask;
  findings; email snapshots; audit metadata.
- Integration: mock OpenAI-совместимый сервер (SSE, 4xx/5xx, JSON mode,
  обрыв); без реальной сети. Rust `stream_chat` — локальный mock или
  unit-тест парсинга.
- Frontend: `pnpm test`, `npx tsc --noEmit`, `npx vite build`.
- Rust: `cargo test` (crypto, path validation, commands).
- GUI-приёмка: смена модели, проверка документа, diff/apply, undo, dirty,
  сохранение пользователем, письмо, маска, audit, ошибки модели.

## 12. Риски и ограничения

- Модель в периметре может не поддерживать JSON mode/tools; `capabilities`
  и валидация с одним repair-retry. Тестовый endpoint нужен до старта.
- WYSIWYG: применение полного текста через `editor.replace()` может менять
  форматирование; нужны round-trip тесты на реальной схеме. Для вставок —
  `propose_insert`, для замен — точный `oldText`.
- `propose_create` через существующий file-flow создаёт пустой файл на
  диске; если пользователь закроет вкладку без сохранения, пустой файл
  останется. Untitled-вкладки — отдельная задача.
- Псевдонимизация без NER не ловит имена/организации; это ожидаемо в MVP.
  Remap не гарантирован при перефразировании/переводе — такие правки
  блокируются.
- HTML-письмо: разные клиенты, картинки, YFM-блоки; `.eml`/cid — после MVP.
- Конфиг с несколькими моделями сложнее; ошибки валидации не должны
  ломать приложение.
- Audit только метаданные — для разбора качества модели может не хватить;
  это сознательный выбор.
- Release-сборка на машине разработчика блокируется антивирусом; новые
  Rust-крейты выбирать без C-сборки.

## 13. Открытые вопросы (не блокируют старт)

1. Поддерживает ли конкретный endpoint периметра `/v1/models`, SSE и JSON
   mode? Проверить до 8.3.
2. Runtime/model для NER — после MVP (ONNX/WASM/локальный сервис).
3. Перечитывать ли конфиг по watcher или по кнопке «Перечитать»? В анализе
   предложен watcher с валидацией; финально проверить на практике.
4. Стратегия картинок в письме: data URI в MVP, `.eml`/cid — позже.
5. Нужно ли автоматически открывать неоткрытый документ для proposal?
   В MVP — нет: правим открытые вкладки, остальные открывает пользователь.
6. UI для retention audit — после MVP.

## 14. Где читать

1. `_tasks_/2026-11-02/20261102_002_ai_document_agent_analysis_task.md` —
   постановка, решения, схема конфига, псевдонимизация.
2. `_tasks_/2026-11-02/20261102_001_ai_document_agent_idea.md` — исходная
   идея и корректировка.
3. `harness_docs/roadmap.md` — Phase 8 и очередь фаз.
4. `C:\repos\personal\GITHUB\transcript-optimizer\app\src\lib\llm.ts`,
   `store/llm.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/crypto.rs` —
   опорная реализация.
5. `_checkpoints_/20261028_003_checkpoint.md` — среда и текущее состояние.
