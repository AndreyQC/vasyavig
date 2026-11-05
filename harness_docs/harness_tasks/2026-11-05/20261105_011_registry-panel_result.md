# Панель «Справочник» (T6-2) — результат

> Контекст:
> - план: `20261105_011_registry-panel_plan.md`
> - сводный план T6: `20261105_007_registry-first_plan.md`

**Дата:** 2026-11-05
**Статус:** выполнено (`ef5617a`)
**Фаза:** Phase 8.5, задача T6-2

---

## Что сделано

| Файл | Что |
|---|---|
| `src/store/entitiesIndexStore.ts` (новый) | правка `entities.jsonl`/`relations.jsonl` из UI: `load`, `updateEntry` (canonical/тип/алиасы), `removeEntry` (+ его связи), `mergeEntries`, `addRelation`/`removeRelation` (дедуп по ключу, explicit вытесняет inferred); подписка на файл индекса (save/watcher → перечитать); `renameCanonical`: «чистая» запись переименовывается, у размеченной старый канон остаётся формой |
| `src/components/Registry/RegistryPanel.tsx` (новый) | список сущностей (фильтр по типу, поиск по канону/формам/алиасам, тип-бейдж, счётчики форм/алиасов), секция возможных дублей (форма → несколько ULID, слияние в выбранную главную), переключение на редактор |
| `src/components/Registry/RegistryEntityEditor.tsx` (новый) | canonical, тип (справочник типов + текущее значение), формы read-only, алиасы (добавление/удаление), удаление в два клика |
| `src/components/Registry/RegistryRelations.tsx` (новый) | явные связи (добавить/убрать, направление from=выбранная), `co_occurs` read-only, цель с фильтром |
| `src/components/Registry/RegistryPanel.css` (новый) | стили по образцу task-dashboard |
| `src/store/uiStore.ts`, `src/App.tsx`, `src/components/Sidebar/SidebarHeader.tsx` | режим сайдбара `registry` + кнопка Books (для всех workspace, не только harness) |
| i18n | namespace `registry` + `sidebar.showRegistry` (ru/en) |

## Ключевые решения

1. **Слияние дублей** (`mergeEntries`): формы+алиасы переезжают в главную
   запись, запись `from` удаляется, связи переписываются (self-loops прочь,
   explicit сильнее — `mergeRelations`), якоря `vas-entity:*:<old>` переписываются
   в открытых вкладках (B-6, паттерн `resolveTypeConflict`).
2. **Правка canonical**: у записи, созданной «В справочник» без разметки,
   старый канон не остаётся формой; у размеченной — остаётся (он был в
   документах). Новый канон всегда входит в forms (инвариант формата).
3. **Кол-во документов в строке списка** не показано — требует скана по репо;
   живёт в секции «Репозиторий» NER-кнопки (T6-6). Отступление от плана.

## Проверки

`pnpm test` — 736 passed / 61 файл (+11: load, rename, aliases, removeEntry,
перепись якорей, merge с дедупом связей, relations) · `npx tsc --noEmit` —
чисто · `npx vite build` — собрано.

## Известные ограничения / NOT done

- Перепись якорей слияния — только открытые вкладки; закрытые документы
  подхватятся при пересборке индекса (T3b) — как у resolveTypeConflict.
- Направление связи фиксировано: выбранная сущность — `from`.

## Где читать

1. `src/store/entitiesIndexStore.ts`; план `20261105_011_registry-panel_plan.md`.
2. Следующий шаг: `20261105_012` (конфликты) — сделан в `d40ae38`.
