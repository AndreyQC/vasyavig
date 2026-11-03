# vas-entity: инлайн-разметка сущностей (T3) — результат (Phase 8.5)

> Контекст:
> - план: `harness_docs/harness_tasks/2026-11-05/20261105_001_vas-entity-markup_plan.md` — T3-1…T3-12
> - диалог: `harness_docs/harness_tasks/2026-11-03/20261103_002_pseudonymization_dialog.md` — В6–В10, D4'/D8'/D9/D11
> - решения сессии 2026-11-05: тип в href; строка jsonl `{ulid,type,canonical,forms}`; предложения+кнопка

**Дата:** 2026-11-05
**Статус:** выполнено (`a25850c` план, `c2abafc` код); GUI-приёмка — за пользователем
**Фаза:** Phase 8.5, задача T3

---

## Что сделано

### Носитель и парсер

| Файл | Что |
|---|---|
| `src/lib/agent/masking/vasEntityLink.ts` | разбор/сборка `vas-entity:<type>:<ULID>`; тип lowercase→EntityType (валидация), ULID через `isPlausibleUlid` |
| `src/lib/agent/masking/vasEntityMarkup.ts` | `parseEntityLinks(md)` — спаны всей конструкции `[…](…)` (fenced-код пропускается); `collectMarkedEntities` — записи по ULID: canonical = первое вхождение (T3-2), forms, конфликт типов |

### Маскирование (T3-5)

- `registry.ts`: `registerExisting(ulid, type, value)` — постоянная запись (первая форма = canonical); конструктор принимает `ExistingResolver` — `createOrGet` до генерации per-run ULID спрашивает резолвер.
- `mask.ts`: `maskText(…, entitySpans)` — спаны разметки первичны (постоянные ULID), детекторы — fallback; merge longest-wins (разметка длиннее значения детектора внутри неё).
- `agentStore.prepareModelStage`: разметка документа → `registerExisting`; резолвер из `entities.jsonl` — неразмеченное известное значение получает постоянный ULID (связность между документами без физической разметки); выборка маскируется с собственными спанами разметки.

### Словарь идентичности (T3-3)

`src/lib/entitiesIndex.ts`: строка `{"ulid","type","canonical","forms[]}` (решение
пользователя); parse/serialize/merge (canonical/type существующей неизменны,
forms — объединение), точный матчинг `matchEntityEntry` (тип-фильтр
опционален); путь — harness-репо `harness_docs/harness_index/entities.jsonl`
(подъём как documents.jsonl), иначе рядом с workspace; кэш в памяти.
`editorStore.saveTab` — инкремент при сохранении markdown-вкладки (сбой
глотается: индекс — кэш). `docs`/`occurrences` не храним — считаются на лету.

### Чипы и редактор (T3-6/7/8/9)

| Файл | Что |
|---|---|
| `src/lib/vasEntityExtension.ts` | WYSIWYG: декорации над link-марками `vas-entity:` (класс + data-атрибуты, паттерн harnessUlid); PM-view-регистрация; `markPmSelectionAsEntity` (addMark, запрет пересечения с любой ссылкой), `unmarkPmEntityAtDom` (removeMark по posAtDOM); фасад `markSelectionAsEntity`/`unmarkEntityAtDom` по текущему режиму |
| `src/lib/vasEntityMarkupExtension.ts` | Markup: CM-декорации на всю конструкцию; `markCmSelectionAsEntity` (обёртка транзакцией, запрет вложенных ссылок/пересечений), `unmarkCmEntityAtDom` (спан → текст) |
| `src/components/VasEntityPopover.tsx` | поповер чипа (наведение, паттерн HarnessUlidPopover): тип, алиас `[[VAS_<TYPE>_<ULID>]]`, эталон из словаря, «Снять разметку» |
| `src/components/Toolbar/EntityMarkButton.tsx` | кнопка «Сущность»: выделение → тип (7 кнопок) → ULID (известное из словаря — реюз с тостом «эталон: …», новое — `generateUlid`); пересечение — тост-ошибка |
| `src/components/Toolbar/NerButton.tsx` | секции «Размечено» (тип·значение·строка, «Снять», клик — переход) и «Предложения» (NER-спаны вне разметки; известные — бейдж эталона, реюз ULID; «Разметить все известные» — bulk); правки через `editor.replace` (паттерн restoreUrls) |
| `src/lib/previewLinks.ts`, `SplitPreview.tsx` | `vas-entity` в allowedSchemes + DOMPurify RE; DOM-проход: href снимается, чип-класс + data-атрибуты (превью read-only — поповер не нужен) |
| CSS, i18n ru/en | чипы (фон + бейдж типа `attr(data-vas-type)`), поповер, панели; ключи `tools.entity*`, `entity.*` |

## Проверки

| Команда | Результат (2026-11-05) |
|---|---|
| `pnpm test` | **627 passed / 52 файла** (было 612/51): +14 `vasEntity.test.ts` (parse/build, склонения, canonical, jsonl merge/match, постоянные ULID, longest-wins, resolver), +1 agentStore T3 |
| `npx tsc --noEmit` | чисто |
| `npx vite build` | собрано (1 мин 28 с) |
| Rust | не менялся |

Интеграционный кейс: размеченные склонения («Иванову/Ивановым И. И.», один
ULID) → в превью один алиас `[[VAS_PERSON_<ULID>]]` ×2, href не утекает,
unmask → canonical; audit — счётчики без значений.

## Известные ограничения / NOT done

- Матчинг склонений — только по известным `forms` (обратная склонялка
  lvovich — бэклог); незнакомая форма → per-run ULID.
- Предложения применяются через `editor.replace` (полная замена контента —
  паттерн restoreUrls): курсор прыгает в начало; ручная разметка выделением
  работает точечно (марка/транзакция) без прыжка.
- Разметка ссылок с `]` в тексте парсером не покрывается (экзотика;
  правится руками в Markup).
- Поповер в превью не показывается (read-only, чип — только бейдж).
- Полный скан-пересборка индекса, changed/исчезнувшие, панель re-markup —
  **T3b**; конфликт типов ULID собирается, но панели ещё нет.
- GUI-приёмка не выполнялась — `pnpm tauri dev` вместе с пользователем:
  разметка выделением в обоих режимах, чипы WYSIWYG/Markup/превью, поповер +
  снятие, предложения с реюзом ULID, словарь в jsonl после сохранения.

## Где читать

1. План `20261105_001_vas-entity-markup_plan.md` — T3-1…T3-12.
2. `src/lib/agent/masking/vasEntityMarkup.ts` — парсер и правила canonical.
3. `src/lib/entitiesIndex.ts` — формат словаря идентичности.
4. Диалог `20261103_002` §7 — дальше T3b (re-markup, полный скан).
