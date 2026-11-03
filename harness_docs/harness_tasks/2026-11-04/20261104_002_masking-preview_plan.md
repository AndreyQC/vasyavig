# Маскирование — превью отправки (T1b) — план (Phase 8.5)

> Контекст:
> - диалог: `harness_docs/harness_tasks/2026-11-03/20261103_002_pseudonymization_dialog.md` — §7 T1b, D5/D6, D8', D9
> - `harness_docs/harness_tasks/2026-11-04/20261104_001_masking-core_result.md` — ядро T1
> - `harness_docs/harness_checkpoints/20261104_001_checkpoint.md` — состояние
> - `LESSONS_LEARNED.md` §3 (селекторы), §8 (скролл), §16 (фикстуры секретов)

**Дата:** 2026-11-04
**Фаза:** Phase 8.5, задача **T1b**
**Статус:** план
**Объём:** ~250–350 строк кода + CSS, i18n ru/en

---

## 1. Цель

Закрыть компромисс D5/R1: до T1b маскирование по умолчанию `off`, а режим
`preview` маскировал без подтверждения. После T1b:

- `masking.mode: preview` — **дефолт**;
- в модельную стадию `checkDocument` ничего не уходит без явного
  «Подтвердить и отправить»;
- пользователь видит, **что именно уйдёт**: чипы сущностей (тип + алиас),
  исходное значение по клику, маскированный текст, счётчики.

Критерий приёмки диалога §8 для T1b: «превью показывает, что уйдёт; без
подтверждения отправка не идёт; по клику на чип — исходное значение».

## 2. Решения

- **T1b-1. Превью всегда.** В режиме `preview` каждая отправка в модельную
  стадию проходит через превью и подтверждение — в том числе когда детекторы
  ничего не нашли (ответ пользователя, 2026-11-04). Скрытой ветки «отправить
  без подтверждения» в режиме `preview` нет. В режиме `off` модельная стадия
  работает как раньше, превью не показывается.
- **T1b-2. Двухфазная модельная стадия.** `runModelStage` делится на
  `prepareModelStage` (findings → маскирование → контекст-пак → сообщения) и
  `sendModelStage` (модель → валидация → unmask → proposals → notices).
  Превью показывает результат prepare, confirm отправляет **уже собранные**
  сообщения: что показано — то и уйдёт, повторного маскирования нет.
- **T1b-3. Что показывает превью.**
  - чипы: `type` + хвост ULID; клик — раскрыть исходное значение (monospace),
    повторный клик — скрыть; значения живут только в памяти (D8);
  - маскированный текст контекст-пака — ровно то, что попадает в промпт
    (после `max_chars`), в скроллируемом блоке; отображение капается
    `MASK_PREVIEW_CHARS = 4000` с пометкой «показано N из M»;
  - счётчики по типам, подсказка «значения остаются локально»;
  - кнопки «Подтвердить и отправить» (action) и «Отмена» (flat).
- **T1b-4. Защита от устаревания.** Превью фиксирует `contentHash` и путь
  вкладки. На confirm: вкладка исчезла/переключилась или хэш изменился →
  отправка не идёт, превью снимается, error-notice
  `assistant.modelStage.previewStale` («документ изменился — проверьте ещё
  раз»). Приём тот же, что stale у proposals.
- **T1b-5. Audit.** `masking.confirmation` расширяется до
  `"none" | "confirmed"` (сейчас жёстко `"none"`, audit.ts:140). Отправка
  после превью пишет `"confirmed"`; отмена превью audit-записи не создаёт —
  модель не вызывалась (в audit идут только реальные прогоны).
- **T1b-6. Дефолт `preview`.** `createDefaultConfig()` и fallback
  `parseAssistant` дают `mode: "preview"`. Явно записанный `off` в
  существующем `vasyavig.yaml` остаётся `off` — миграции нет.
- **T1b-7. `emailHtml` без изменений** (D7/R11): письмо не маскируется и
  превью не показывает.
- **T1b-8. Состояние — в `agentStore`** (как и весь `modelStage`):
  `maskPreview: ModelStagePreview | null` для UI и модульная переменная
  `pendingStage` (готовые сообщения, реестр, аудит-метаданные) — тяжёлое
  состояние не гоняем через React-рендеры и не кладём в audit.
- **T1b-9. i18n.** Ключи `assistant.maskPreview.*` (title/hint/entities/
  noEntities/text/truncated/confirm/cancel) и общий справочник типов
  `assistant.entityType.*` (person/org/loc/secret/email/phone/url_cred) —
  переиспользуется в T2/T3. ru/en синхронно.

## 3. Изменения по файлам

| Файл | Что |
|---|---|
| `src/store/agentStore.ts` | `ModelStagePreview`, `maskPreview` в состоянии; `prepareModelStage` (маскирование + контекст-пак + сообщения), `sendModelStage` (текущая модельная часть), `confirmMaskedSend`, `cancelMaskedSend`; сброс pending в `runCheckDocument`/`clearFindings`/`resetSession`; confirm: проверка stale → `modelRunning` → send |
| `src/lib/agent/audit.ts` | `confirmation: "none" \| "confirmed"`; sanitize сохраняет `confirmed`, иначе `none` |
| `src/lib/agent/config.ts` | дефолт `masking.mode: "preview"` (defaults + parse fallback), комментарий R1/D5 снять |
| `src/components/Assistant/MaskingPreview.tsx` | новый: чипы с раскрытием значения, маскированный текст, счётчики, кнопки confirm/cancel |
| `src/components/Assistant/AssistantPanel.tsx` | врезка `<MaskingPreview />` после блока действий, до modelRunning |
| `src/components/Assistant/Assistant.css` | стили превью: карточка, чипы, моноширинный блок (max-height + overflow, overscroll-behavior §8), действия |
| `src/locales/ru/translation.json`, `src/locales/en/translation.json` | `assistant.maskPreview.*`, `assistant.entityType.*`, notices `previewCancelled`/`previewStale` |
| `src/lib/agent/config.test.ts` | ожидание дефолта `preview` |
| `src/store/agentStore.test.ts` | тесты T1b (см. §4); в `beforeEach` — явный `masking.mode: "off"` для прежних кейсов, маскировочная группа включает preview и подтверждает |

## 4. Проверки

Юнит/интеграция (`pnpm test`):

1. **preview gate**: `runCheckDocument` в `preview` не вызывает `runChat`,
   `maskPreview` заполнен (алиасы, типы, значения, маскированный текст без
   секретов), `modelRunning === false`.
2. **confirm**: после `confirmMaskedSend` модель вызвана с маскированным
   промптом, `maskPreview === null`, unmask в proposal/rationale работает,
   audit `masking.confirmation === "confirmed"`, в audit нет значений.
3. **cancel**: `cancelMaskedSend` — модель не вызвана, notice
   `previewCancelled`, audit без `run`.
4. **stale**: правка документа между preview и confirm — модель не вызвана,
   notice `previewStale`, превью снято.
5. **preview без сущностей**: превью показано, confirm отправляет текст как
   есть (алиасов нет, `maskingNote` не добавляется).
6. **off**: прежний тест без изменений — промпт как есть, audit без `masking`.
7. **config**: пустой конфиг → `masking.mode === "preview"`; явный `off`
   сохраняется.

Прочее: `npx tsc --noEmit`, `npx vite build`. GUI-приёмка — отдельно с
пользователем (`pnpm tauri dev`, не запускать без него).

## 5. Риски и ограничения

- **Тесты по умолчанию.** Дефолт `preview` меняет поведение всех тестов
  `checkDocument` с моделью — поэтому в `beforeEach` явный `off`; иначе
  придётся подтверждать в каждом кейсе.
- **Память.** `pendingStage` держит маскированный промпт и реестр значений —
  session-only, очищается на cancel/confirm/reset (D8: не в лог, не в audit,
  не на диск).
- **Не покрыто:** подсветка сущностей в самом редакторе (T3), NER-персоны в
  превью (T2), панель audit (после MVP).
- **Порог объёма:** если подготовка сообщений в превью окажется дорогой на
  больших документах (>500 КБ), confirm пересоберёт контекст-пак — вынести в
  T3b вместе с re-markup.

## 6. Следующие шаги

После T1b: T2 (NER-детектор на правилах) → T3 (`vas-entity:` чипы + ручная
разметка) → T3b (re-markup + `entities.jsonl`) → T4/T5 (GUI-приёмка,
Phase 8.6). Очередь — диалог §7.
