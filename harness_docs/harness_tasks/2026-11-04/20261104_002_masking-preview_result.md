# Маскирование — превью отправки (T1b) — результат (Phase 8.5)

> Контекст:
> - план: `harness_docs/harness_tasks/2026-11-04/20261104_002_masking-preview_plan.md` — T1b-1…T1b-9
> - диалог: `harness_docs/harness_tasks/2026-11-03/20261103_002_pseudonymization_dialog.md` — §7 T1b, D5/D6, D8'
> - ядро T1: `harness_docs/harness_tasks/2026-11-04/20261104_001_masking-core_result.md`

**Дата:** 2026-11-04
**Статус:** выполнено (`acb515d` план, `42279d1` код); GUI-приёмка — за пользователем
**Фаза:** Phase 8.5, задача T1b

---

## Что сделано

| Файл | Что |
|---|---|
| `src/store/agentStore.ts` | `runModelStage` разделён на `prepareModelStage` (findings → маскирование → контекст-пак → сообщения) и `sendModelStage` (модель → валидация → unmask → proposals). В режиме `preview` prepare останавливается на превью: модель не вызывается, готовые сообщения и реестр лежат в модульном `pendingStage` (только память, D8). Добавлены `maskPreview: ModelStagePreview \| null`, `confirmMaskedSend`, `cancelMaskedSend`; сброс pending в `runCheckDocument`/`clearFindings`/`resetSession` |
| `src/store/agentStore.ts` | stale-защита: превью фиксирует `contentHash` и путь вкладки; confirm при изменённом тексте/закрытой вкладке не отправляет — error-notice `assistant.modelStage.previewStale` |
| `src/lib/agent/audit.ts` | `masking.confirmation: "none" \| "confirmed"`; после превью — `confirmed`, отмена превью audit-записи не создаёт |
| `src/lib/agent/config.ts` | дефолт `masking.mode: "preview"` (defaults + parse fallback); явно записанный `off` сохраняется |
| `src/components/Assistant/MaskingPreview.tsx` | новый компонент: чипы «тип + хвост ULID», по клику — исходное значение (monospace, только в памяти); маскированный текст контекст-пака (кап отображения 4000 симв.), счётчики, «Подтвердить и отправить» / «Отмена», empty-state без сущностей |
| `src/components/Assistant/AssistantPanel.tsx` | врезка превью между действиями и модельной стадией |
| `src/components/Assistant/Assistant.css` | карточка превью (рамка warning), чипы, скроллируемый блок текста 220px с `overscroll-behavior: contain` (§8), действия |
| `src/locales/{ru,en}/translation.json` | `assistant.maskPreview.*`, `assistant.entityType.*` (общий справочник типов для T2/T3), notices `previewCancelled`/`previewStale`/`noModel` |
| `src/lib/agent/config.test.ts` | дефолт — `preview` |
| `src/store/agentStore.test.ts` | `beforeEach` — явный `off` для базовых кейсов; группа маскирования: 8 тестов (preview gate, confirm + audit `confirmed`, unknown, lost, без сущностей, cancel, stale, off) |

## Реализованные решения

- **T1b-1.** Превью в режиме `preview` показывается **всегда** и всегда требует
  подтверждения — в том числе при нуле найденных сущностей (ответ пользователя,
  2026-11-04). В режиме `off` модельная стадия работает как раньше.
- **T1b-2.** Двухфазная стадия: confirm отправляет уже собранные сообщения,
  повторного маскирования нет — что в превью, то и в промпте.
- **T1b-3.** Превью: чипы алиасов с типом и хвостом ULID, раскрытие значения по
  клику, маскированный текст (кап отображения), счётчики.
- **T1b-4.** Stale: правка документа между превью и confirm блокирует отправку.
- **T1b-5.** Audit пишет `confirmation: "confirmed"`; отмена превью не пишет
  `run`-запись (модель не вызывалась).
- **T1b-6.** `preview` — дефолт; `off` — только явно.
- **T1b-7.** `emailHtml` не затронут: письмо не маскируется и превью не показывает.
- **T1b-8.** Тяжёлое состояние (промпт, реестр значений) — в модульной переменной,
  не в React-состоянии и не в audit (D8).
- **T1b-9.** i18n ru/en синхронно.

## Проверки

| Команда | Результат (2026-11-04) |
|---|---|
| `pnpm test` | **593 passed / 50 файлов** (было 589/50): +4 новых кейса T1b, остальные обновлены под confirm |
| `npx tsc --noEmit` | чисто |
| `npx vite build` | собрано (1 мин 11 с); прежний warning о чанках |
| Rust | не менялся |

GUI-приёмка не выполнялась — по договорённости делается вместе с пользователем
(`pnpm tauri dev`, не запускать без него).

## Известные ограничения / NOT done

- Превью показывает документ, но не весь prompt целиком (findings/инструкции не
  рендерятся) — сознательно: цель превью — что уходит из документа.
- `maskLost` по-прежнему не блокирует apply (replacement проверяется по
  `oldText`/`baseHash`); полный remap не гарантирован (§3.9).
- Audit-viewer отсутствует; посмотреть `confirmation` можно только в
  `vasyavig.agent.audit` (localStorage) — панель audit после MVP.
- NER-персоны/организации в превью не появляются до T2; ручная разметка — T3.
- Превью не переживает перезапуск (session-only) — при закрытии документа
  пользователь увидит `previewStale`.

## Где читать

1. План `20261104_002_masking-preview_plan.md` — T1b-1…T1b-9 с обоснованиями.
2. `src/store/agentStore.ts` — `prepareModelStage`, `sendModelStage`,
   `confirmMaskedSend`, `cancelMaskedSend`.
3. `src/components/Assistant/MaskingPreview.tsx` — UI превью.
4. Диалог `20261103_002` — §7 очередь T2 → T3 → T3b.
5. `LESSONS_LEARNED.md` §16 — фикстуры секретов в тестах.
