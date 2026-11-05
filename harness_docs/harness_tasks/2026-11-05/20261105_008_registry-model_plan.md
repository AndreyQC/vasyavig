# Модель справочника и связей (T6-1) — план

> Контекст:
> - сводный план T6: `20261105_007_registry-first_plan.md` (шаги T6-1…T6-9)
> - решение пользователя 2026-11-05: «справочник-first», связи между сущностями
> - текущий код: `src/lib/entitiesIndex.ts`, `src/lib/entityScan.ts`
> - `LESSONS_LEARNED.md` §16 (фикстуры)

**Дата:** 2026-11-05
**Статус:** план
**Фаза:** Phase 8.5, задача **T6-1** — модель данных справочника и связей

---

## Цель

Дать справочнику три недостающих возможности, без которых «связи между
сущностями» не выразить:

1. **Ручные алиасы** отдельно от наблюдаемых форм (`forms`).
2. **Связи между сущностями** (рёбра графа).
3. **Профиль совместных появлений** (`co_occurs`) — основа разрешения
   однофамильцев без ручных связей.

## Форматы

### Сущность (было → стало)

```jsonc
// было
{"ulid": "01J…", "type": "person", "canonical": "Иванов Иван Иваныч", "forms": ["Иванов Иван Иваныч"]}
// стало
{"ulid": "01J…", "type": "person", "canonical": "Иванов Иван Иваныч",
 "forms": ["Иванов Иван Иваныч"],           // наблюдаемые в документах
 "aliases": ["John Smith", "Иванов И. И."]} // ручные (в т.ч. кросс-языковые)
```

- `aliases` — **не теряются** при merge/пересборке индекса (сейчас `mergeEntitiesIndex`
  сливает только `forms` — это и ломало бы кросс-языковую связку).
- Старые записи без `aliases` читаются как `aliases: []`; перезапись файла
  происходит только при явном действии (миграция не «сбрасывает» поле молча).

### Связи (новый файл)

`harness_docs/harness_index/relations.jsonl` — рядом с `entities.jsonl`.

```jsonc
{"from": "01J…", "to": "01K…", "kind": "works_at", "confidence": "explicit",
 "source": "docs/09_meetings/2026-11-03/SUMMARY.md", "evidence": "ООО Ромашка"}
```

| kind | Смысл |
|---|---|
| `works_at` | персона → организация |
| `member_of` | персона/объект → проект |
| `role_in` | персона → роль в проекте |
| `alias_of` | тождество двух записей |
| `co_occurs` | выведенная: совместные появления (confidence `inferred`) |

### Профиль совместных появлений (производный)

`harness_docs/harness_index/cooccurrence.json` — кэш, пересобирается сканом:

```jsonc
{"byEntity": {"01J…": {"01K…": {"count": 12, "docs": ["a.md", "b.md"]}}}}
```

- Хранится top-N соседей на сущность (N = 20) — иначе файл растёт как квадрат.
- Считается из разметки и из форм справочника (совпадения по тексту).

## Функции (API)

`src/lib/entitiesIndex.ts`:
- `parseEntitiesJsonl` — понимает `aliases` (бэкомпат).
- `mergeEntitiesIndex` — сохраняет `aliases` существующих записей, добавляет
  новые из `incoming.aliases`.
- `serializeEntitiesJsonl` — пишет `aliases` (пустой массив не пишем — чище diff).
- `matchEntityEntry` — учитывает `aliases` при точном совпадении (форма или алиас).

`src/lib/entityRelations.ts` (новый):
- `parseRelationsJsonl` / `serializeRelationsJsonl`.
- `ensureRelationsIndex(dir)` — кэш в памяти, как у сущностей; путь — рядом с
  `entities.jsonl` (harness-репо) или в каталоге workspace.
- `mergeRelations` — по паре `(from,to,kind)`.
- `relationsFor(ulid)` — все рёбра сущности (входящие и исходящие).
- `resolveByRelations(candidates, contextUlids)` — по входящим/исходящим рёбрам
  выбрать кандидата, связанного с контекстом (см. T6-5; здесь — базовый движок).
- `computeCoOccurrences(docs)` — профиль совместных появлений.

## Что НЕ входит

- Панель UI (T6-2), runtime-подсветка (T6-3), разрешение конфликтов в UI (T6-5).
- Семантический вывод связей из текста (NER-предложения «связать с…» — T6-4).

## Проверки

| Команда | Ожидание |
|---|---|
| `pnpm test` | ≥ 670 passed (+тесты: aliases round-trip, merge не теряет aliases, relations parse/merge, co-occurrence) |
| `npx tsc --noEmit` | чисто |

## Риски

1. Рост `entities.jsonl` из-за `aliases` — приемлемо (единицы байт на запись).
2. `cooccurrence.json` может разрастись при большом репо → top-N и дедуп по docs.
3. Разные пути к `relations.jsonl` для harness-репо и обычной папки — как у
   `entities.jsonl` (якорь `harness.yaml`).
