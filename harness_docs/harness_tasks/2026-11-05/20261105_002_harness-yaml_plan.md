# harness.yaml — единственный якорь harness-репо + справочник сущностей (T3c) — план (Phase 8.5)

> Контекст:
> - решение пользователя 2026-11-05: «сделать harness.yaml сейчас; посмотреть, как
>   используется harness_manifest.json, и переделать на harness.yaml — чтобы был
>   только один якорный признак такого вида директории»
> - образец: `C:\repos\reksoft\locomoko\lm_hrdo_2\harness.yaml` (per-repo конфиг),
>   `harness_manifest.json` (паттерн справочника: label {ru,en}, color, aliases)
> - диалог `20261103_002` §10 — открытый вопрос «доменный словарь: где хранится»
> - T3: `harness_docs/harness_tasks/2026-11-05/20261105_001_vas-entity-markup_result.md`

**Дата:** 2026-11-05
**Фаза:** Phase 8.5, задача **T3c** (вклинивается до T3b по решению пользователя)
**Статус:** план
**Объём:** ~300–400 строк + тесты

---

## 1. Цель

1. **Один якорь**: `harness.yaml` в корне репо — единственный признак «это
   harness-репозиторий». `harness_manifest.json` перестаёт читаться вовсе;
   `documents.jsonl` — не якорь, а внутренность (реестр документов).
2. **Справочник сущностей** — секция `entities:` в harness.yaml: флаг
   `masking` у системных типов, кастомные типы без маскирования (проекты,
   репозитории — разметка для графов), подписи ru/en, доменный словарь NER.

## 2. Решения

- **HY-1. Якорь.** `HARNESS_YAML_REL = "harness.yaml"` (корень репо).
  Валидность — читаемый YAML-объект (`isHarnessYamlShape`, пакет `yaml` уже
  в зависимостях). `isHarnessRepoDir` — только harness.yaml;
  `treeContainsHarnessRepo` — только `/harness.yaml`; `findHarnessIndex`
  использует новый `findHarnessRoot(dir)` (подъём до якоря), реестр
  `harness_docs/harness_index/documents.jsonl` — под корнем, может
  отсутствовать (репо распознан, ULID-функции отключены).
- **HY-2. Манифест удаляется.** `HARNESS_MANIFEST_REL`, `isManifestShape`
  и чтения манифеста убираются; миграционный ранбук (перенести
  `vocabularies` в harness.yaml, удалить манифест) — в result-документе.
  До переноса секции дашборд задач живёт на дефолтном словаре.
- **HY-3. Словарь задач.** `loadTaskVocabulary` читает `vocabularies.task`
  из harness.yaml (схема та же, что была в манифесте: types/kinds/statuses
  с label {ru,en}, color, aliases). Нет секции/битая — встроенный дефолт
  (как сейчас).
- **HY-4. Справочник сущностей** (`entities:`):

  ```yaml
  entities:
    person:   {masking: true}          # системные: флаг можно снять (loc — если
    org:      {masking: true}          #  локации не считаются чувствительными)
    loc:      {masking: true}
    secret:   {masking: true}
    email:    {masking: true}
    phone:    {masking: true}
    url_cred: {masking: true}
    project:                                # кастомные: без masking → для графов
      label: {ru: Проект, en: Project}
    repo:
      label: {ru: Репозиторий, en: Repository}
    dictionary:                             # NER addWords: бренды без юр. формы
      Газпром: org
  ```

  Токены типов: `[a-z_]+`; кастомные никогда не маскируются (флаг только у
  системных); дефолт без секции — системные 7 с `masking: true` (нынешнее
  поведение, нулевой конфиг).
- **HY-5. Применение справочника.**
  - `src/lib/entityTypes.ts` (новый): загрузка/кэш по harness-корню
    (`ensureEntityTypes(dir)`), API: `knownEntityType(token)`,
    `isMaskingType(token)`, `entityTypeLabel(token)` (кастом — из yaml,
    системный — i18n), `listMarkButtonTypes()`, `domainWords()`;
  - `vasEntityLink.parseVasEntityHref` валидирует тип против системных ∪
    кастомных (реестр типов модульный, в тестах сброс);
  - `maskText` отбрасывает спаны немаскируемых типов: ссылка уходит в промпт
    как есть (href содержит только ULID+тип, не чувствителен);
  - `EntityMarkButton`/чипы/NER-панель — типы и подписи из справочника;
  - `ner.ts`: `domainWords()` подключается через `ru-compromise` `addWords`
    (org→`#Organization`, person→`#Person`, loc→`#City`; спайк §6) —
    «Газпром» ловится без юр. формы.
- **HY-6. Графовая перспектива** (не код в этой задаче): кастомная разметка
  `[DBPM](vas-entity:project:01J…)` + `entities.jsonl` (type уже строка) —
  готовые узлы/рёбра «документ ↔ сущность» для Phase 7 (остаток задачи 5).
- **HY-7. entities.jsonl не меняется** — формат `{ulid,type,canonical,forms}`
  принимает произвольный type уже сейчас.

## 3. Файлы

| Файл | Что |
|---|---|
| `src/lib/harnessIndex.ts` | `HARNESS_YAML_REL`, `isHarnessYamlShape`, `findHarnessRoot`; `isHarnessRepoDir`/`treeContainsHarnessRepo` — только yaml; манифест удалён |
| `src/lib/harnessTasks.ts` | `loadTaskVocabulary` → harness.yaml `vocabularies.task` |
| `src/lib/entityTypes.ts` | новый: справочник entities (load/cache/API, defaults) |
| `src/lib/agent/masking/vasEntityLink.ts` | валидация типа — реестр типов (система ∪ кастом) |
| `src/lib/agent/masking/mask.ts` | фильтр спанов по `isMaskingType` |
| `src/lib/agent/masking/ner.ts` | доменный словарь → addWords (+`#Organization` в сбор спанов) |
| `src/components/Toolbar/EntityMarkButton.tsx`, `NerButton.tsx` | типы/подписи из справочника |
| `src/lib/entitiesIndex.ts` | путь через `findHarnessRoot` |
| `src/lib/rootColors.ts` | комментарий: проба harness.yaml |
| тесты: `harnessIndex.test.ts`, `harnessTasks.test.ts`, `entityTypes.test.ts`, `vasEntity.test.ts` | якорь/словарь/справочник/маскирование кастомных |

## 4. Проверки

1. Якорь: harness.yaml валидный → репо распознан; битый YAML/JSON/отсутствие
   — нет; репо только с documents.jsonl (без yaml) — **не распознан**
   (осознанное следствие «одного якоря», ранбук — перенести/создать yaml).
2. Словарь задач: `vocabularies.task` из yaml читается; нет секции — дефолт.
3. Справочник: дефолт без секции = система 7 masking; кастомный тип в кнопке
   «Сущность» и href; `masking: false` у loc → локации не маскируются;
   кастомный тип не маскируется, ссылка проходит в промпт как есть.
4. Словарь NER: `Газпром: org` → ORG-спан в detectNer.
5. `pnpm test`, `npx tsc --noEmit`, `npx vite build`. GUI-приёмка — с
   пользователем (lm_hrdo_2 — живой репо с harness.yaml).

## 5. Риски / NOT done

- Старые harness-репо без harness.yaml перестают распознаваться — ранбук в
  result-документе (у lm_hrdo_2 yaml уже есть; vocabularies нужно перенести).
- `findHarnessIndex` меняет семантику (якорь yaml, реестр опционален) —
  прогрессия harnessStore проверяется тестами.
- Кастомные типы в алиасах не участвуют (маскирование системное) — при
  необходимости расширять позже.
- Панель re-markup (T3b) — следующая задача, уже на новом справочнике.
