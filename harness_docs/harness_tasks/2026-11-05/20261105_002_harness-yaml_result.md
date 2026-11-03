# harness.yaml — единственный якорь + справочник сущностей (T3c) — результат (Phase 8.5)

> Контекст:
> - план: `harness_docs/harness_tasks/2026-11-05/20261105_002_harness-yaml_plan.md` — HY-1…HY-7
> - решение пользователя 2026-11-05: один якорный признак harness-директории — `harness.yaml`;
>   справочник сущностей — в нём (образцы: `lm_hrdo_2/harness.yaml`, `harness_manifest.json`)
> - T3: `harness_docs/harness_tasks/2026-11-05/20261105_001_vas-entity-markup_result.md`

**Дата:** 2026-11-05
**Статус:** выполнено (`383637a` план, `8596ff1` код); GUI-приёмка — за пользователем
**Фаза:** Phase 8.5, задача T3c (вклинилась до T3b)

---

## Что сделано

### Якорь (HY-1/HY-2)

| Было | Стало |
|---|---|
| `isHarnessRepoDir`: манифест **или** реестр | `harness.yaml` в корне, читаемый YAML-объект (`isHarnessYamlShape`) — **единственный** признак |
| `treeContainsHarnessRepo`: манифест или реестр в дереве | только `/harness.yaml` |
| `collectHarnessRepoRoots`: корень над реестром | корень над `harness.yaml` |
| `findHarnessIndex`: поиск реестра снизу вверх | `findHarnessRoot` (подъём до якоря) → реестр под ним; якорь есть, реестра нет → null (репо распознан, ULID-функции отключены) |
| `HARNESS_MANIFEST_REL`, `isManifestShape` | **удалены**; манифест нигде не читается |

`entitiesIndex.ts` переведён на `findHarnessRoot` (путь словаря не зависит от
наличия реестра документов).

### Словарь задач (HY-3)

`loadTaskVocabulary` читает `vocabularies.task` из harness.yaml (схема
прежняя: types/kinds/statuses с `label {ru,en}`, `color`, `aliases`);
нет секции/битая — встроенный дефолт. `parseTaskVocabulary` теперь YAML
(`parseDocument`), битые поля по-прежнему замещаются дефолтом по отдельности.

### Справочник сущностей (HY-4/HY-5)

`src/lib/entityTypes.ts` (новый): разбор секции `entities:` harness.yaml.

```yaml
entities:
  person: {masking: true}   # системные: флаг можно снять
  loc: {masking: false}     # пример: локации не считаем чувствительными
  project:                  # кастомные: без маскирования — для графов
    label: {ru: Проект, en: Project}
  dictionary:               # доменный словарь NER
    Газпром: org
```

- Дефолт без секции — системные 7 с `masking: true` (нулевая конфигурация =
  поведение T3); битый yaml — тоже дефолт.
- `parseVasEntityHref` валидирует токен против системы ∪ кастомных
  (href с неизвестным типом — обычная ссылка).
- `maskText` отбрасывает спаны немаскируемых типов: кастомная ссылка уходит
  в промпт как есть (href несёт только тип+ULID).
- `EntityMarkButton` — типы из справочника, подписи: кастомные — `label`,
  системные — i18n; `VasEntityPopover` показывает алиас только у маскируемых.
- `ner.ts` + `applyDomainDictionary()`: слова словаря → `ru-compromise
  addWords` (Organization/Person/City), спайк §6 подтверждён; «Газпром»
  ловится без юр. формы. Идемпотентно (Set выученных слов).
- `NerButton`-предложения: токен типа — из известной записи словаря
  identities (идентичность важнее догадки NER).
- `useNerSpans`/`prepareModelStage` перед сканом подтягивают
  `ensureEntityTypes` + доменный словарь.

### Тип как токен

`EntityLinkSpan.type`/`MarkedEntityRecord.type`/`EntityIndexEntry.type` —
lowercase-токен (`person`, `project`); `systemTypeOfToken(token)` даёт
EntityType для алиасов/статистики маскирования. Формат `entities.jsonl`
не изменился (type и был строкой).

## Проверки

| Команда | Результат (2026-11-05) |
|---|---|
| `pnpm test` | **641 passed / 53 файла** (было 627/52): +13 `entityTypes.test.ts` (разбор, флаги, кастомные, словарь NER, фильтр maskText), якорные тесты переписаны на yaml-семантику |
| `npx tsc --noEmit` | чисто |
| `npx vite build` | собрано (1 мин 10 с) |
| Rust | не менялся |

Ключевые новые кейсы: репо только с реестром (без yaml) — **не** распознан;
битый yaml — не якорь; `masking: false` у `loc` — локации проходят в промпт;
кастомный тип в href валиден, в маскирование не попадает; `Газпром: org` →
ORG-спан; «Газпром» без словаря не ловится.

## Ранбук миграции (для harness-репо)

1. **lm_hrdo_2**: `harness.yaml` уже есть — добавить секцию `vocabularies`
   (перенести `vocabularies` из `harness_manifest.json`) и, при желании,
   `entities:` (кастомные типы проектов/систем + доменный словарь).
2. **Другие harness-репо**: создать harness.yaml (минимум
   `project:\n  id: <id>`); иначе Vasyavig перестанет распознавать репо
   (связи/ULID-чипы/дашборд задач отключатся — реестр без якоря не читается).
3. `harness_manifest.json` удалить после переноса (приложение его больше
   не читает; файл остаётся просто мусором в корне).

## Известные ограничения / NOT done

- Репо с реестром, но без harness.yaml, выпадает из распознавания —
  осознанное следствие «одного якоря» (решение пользователя); ранбук выше.
- Кастомные типы не участвуют в алиасах/маскировании — по дизайну; если
  понадобится маскировать кастомные — расширение HY-4 (отдельное решение).
- Бейджи чипов используют `attr(data-vas-type)` (токен); человекочитаемые
  label кастомных типов видны в кнопке и поповере, но не на чипе — cosmetic,
  по замечанию GUI-приёмки.
- Панель re-markup (T3b) — следующая задача, уже на справочнике.
- GUI-приёмка не выполнялась — вместе с пользователем (`pnpm tauri dev`,
  живой репо lm_hrdo_2).

## Где читать

1. План `20261105_002_harness-yaml_plan.md` — HY-1…HY-7.
2. `src/lib/entityTypes.ts` — справочник (load/parse/API).
3. `src/lib/harnessIndex.ts` — якорь и findHarnessRoot.
4. Диалог `20261103_002` §7 — дальше T3b (re-markup).
