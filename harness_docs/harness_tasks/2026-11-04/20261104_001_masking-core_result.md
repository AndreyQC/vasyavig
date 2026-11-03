# Маскирование — ядро (T1) — результат (Phase 8.5)

> Контекст:
> - план: `harness_docs/harness_tasks/2026-11-04/20261104_001_masking-core_plan.md` — решения R1–R11
> - диалог: `harness_docs/harness_tasks/2026-11-03/20261103_002_pseudonymization_dialog.md` — В1–В10, D1–D11 (P1, чип-ссылка, re-markup, ручная разметка)
> - `harness_docs/harness_tasks/2026-11-02/20261102_002_ai_document_agent_analysis_task.md` §3.9 — пайплайн

**Дата:** 2026-11-04
**Статус:** выполнено (`fff8e6c` T1a, `6378303` T1c); GUI-приёмка — за пользователем
**Фаза:** Phase 8.5, задача T1

---

## Что сделано

### T1a — ядро (`src/lib/agent/masking/`, `fff8e6c`)

| Файл | Что |
|---|---|
| `types.ts` | `EntityType` (PERSON/ORG/LOC/SECRET/EMAIL/PHONE/URL_CRED), `DetectorId`, `DetectorSpan`, `EntityRecord` |
| `ulid.ts` | генератор ULID: 48 бит времени + 80 бит случайности, Crockford base32, монотонный в прогоне, rng инъектируется для тестов; формат совпадает с harness-ULID (`isPlausibleUlid` валидирует) |
| `detectors.ts` | 4 детектора по `masking.detectors`: secrets (PEM-блоки, JWT, `ghp_`, AKIA/ASIA, `xox`, `sk-`, `Bearer`, `KEY=value`), email, phone (RU + межд.), url_credentials; только lookaround (`\b` не работает по кириллице); KEY=value — маскируется **только значение** (ключ виден, русские ключи и описания «пароль от стенда: …» ловятся, конечная пунктуация не входит); merge longest-wins детерминированный |
| `registry.ts` | `RunRegistry`: value+type → стабильный ULID прогона; алиас `[[VAS_<TYPE>_<ULID>]]`; коллизия разделителя → альтернативные префиксы `[[VAS_` → `{{VAS_` → `<<VAS_` → `((VAS_` (R9); `aliasPattern()` для валидации ответов |
| `mask.ts` | `maskText` → маскированный текст + счётчики по типам (в audit значений нет); `maskingPromptNote` — правила «сохраняйте плейсхолдеры дословно» + словарь «алиас — тип» (D9) |
| `unmask.ts` | `unmaskText` (восстановление байт-в-байт), `scanUnknownAliases`, `missingAliasIds` |
| `config.ts` | дефолт `masking.mode` `preview` → `off` (R1/D5); вернём `preview` в T1b |

### T1c — интеграция (`agentStore.ts`, `6378303`)

- `runModelStage` (checkDocument): при `mode ≠ off` контент и выделение
  маскируются **до** `buildContextPack`; в промпт — `maskingNote`; таблица
  соответствий только в памяти (D8).
- Валидация ответа (§3.9 п.5): **неизвестный** алиас → все вердикты
  отброшены + notice `assistant.modelStage.maskUnknown` (модель выдумала
  идентификатор — replacements небезопасны); **потерянные** → info
  `maskLost`, apply не блокируется (replacement проверяется oldText/baseHash
  независимо — осознанный выбор, отличие от строгой трактовки §3.9).
- Unmask вердиктов (replacement/rationale) до построения proposals и панели.
- Audit `run`: `masking {mode, confirmation: "none", entities, counts}` —
  sanitizer whitelist расширен счётчиками (R2).
- `emailHtml` — без маскирования (R11/D7).
- i18n ru/en: `assistant.modelStage.maskUnknown/maskLost`.

## Проверки

| Команда | Результат (2026-11-04) |
|---|---|
| `pnpm test` | **589 passed / 50 файлов** (было 556/47): +29 masking-юнитов, +4 интеграционных |
| `npx tsc --noEmit` | чисто |
| `npx vite build` | собрано (1 мин 19 с); прежний warning о чанках |

Интеграционные кейсы (mock модели): round-trip «секрет не в промпте → алиас в
ответе → значение в proposal»; unknown → отброшено + error-notice; lost →
info-notice, apply идёт; off → промпт без изменений, audit без masking.

## Инцидент: GitHub push protection

Фикстура Slack-токена в тесте совпала с паттерном secret-scanning — push
отклонён дважды (второй раз — правдоподобный литерал в самом уроке). Фикстуры
заменены на буквенные; урок — `LESSONS_LEARNED.md` §16.

## Известные ограничения / NOT done

- Режим `preview` маскирует без подтверждения — превью отправки (чипы,
  «Подтвердить и отправить») — **T1b**; до неё дефолт `off`.
- Модель может потерять плейсхолдеры (`maskLost`) — предупреждение, не блок;
  полный remap не гарантирован (§3.9, осознанное ограничение).
- ULID в T1 — per-run генерация; постоянные сущности появятся с разметкой
  `vas-entity:` (T3) — интерфейс реестра готов (R3).
- Доменный словарь брендов (Газпром и т.п. без юр. формы) — открытый вопрос
  диалога §10; механизм `addWords` известен.
- GUI-приёмка не выполнялась.

## Где читать

1. План `20261104_001_masking-core_plan.md` — R1–R11 с обоснованиями.
2. Диалог `20261103_002` — P1, В1–В10, итоговые D4'/D8'/D9–D11.
3. `src/lib/agent/masking/` — фактические контракты.
4. `LESSONS_LEARNED.md` §16 — push protection.
