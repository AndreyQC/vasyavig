# Хвосты бэклога (T3e) — результат (Phase 8.5)

> Контекст:
> - план: `harness_docs/harness_tasks/2026-11-05/20261105_005_backlog-tails_plan.md` — T3e-1…T3e-5
> - бэклог чекпоинта `20261105_001`; пользователь: «бэклог до делаем, UI принять не могу»

**Дата:** 2026-11-05
**Статус:** выполнено (`2c11d59` план, `6a16da8` код)
**Фаза:** Phase 8.5, задача T3e — **кодовый бэклог Phase 8.5 исчерпан**

---

## Что сделано

### 1. Конфликты типов ULID в панель re-markup (T3e-1/2/3)

- `entityScan.scanMarkdownContents` собирает
  `collectMarkedEntities(...).typeConflicts` по всем документам →
  `EntitiesDiff.typeConflicts` (merged по ULID, types sorted).
- `entityScanStore.resolveTypeConflict(root, ulid, chosenType)`: (1) href в
  открытых вкладках — `vas-entity:<wrong>:<ULID>` → выбранный тип
  (editor.replace; фолбэк updateContent, если editor ещё не зарегистрирован);
  (2) type записи индекса обновляется; (3) повторный скан — конфликт исчез.
- Секция «Конфликты типов» в «Репозитории»: «ULID · типы» + кнопка на тип.
  Закрытые документы не правятся (B-6) — конфликт по ним останется до
  открытия (осознанно).

### 2. unknown-known без лимита (T3e-3)

`NerButton`: `showAllKnown` — по умолчанию 20 строк, кнопка
«Показать все ({{count}})» разворачивает весь список.

### 3. Audit viewer (T3e-4)

- `src/components/Assistant/AuditViewerModal.tsx`: Gravity Modal, записи
  `auditLog.list()` свежими сверху: время, operation, result (Label
  success/danger/normal), model, path, findings, masking компактно
  (`preview/confirmed · entities=N · EMAIL:1 …`). Пустой лог — empty-state.
  Read-only; значений сущностей в audit нет (D8).
- Открытие — кнопка-иконка (ListCheck) в header панели ассистента рядом с
  настройками; флаг `auditOpen` в `assistantStore` (закрытие панели закрывает
  модалку; модалки взаимоисключающие).

## Проверки

| Команда | Результат (2026-11-05) |
|---|---|
| `pnpm test` | **665 passed / 56 файлов** (было 661/55): +2 конфликтных кейса скана, +2 `entityScanStore.test.ts` |
| `npx tsc --noEmit` | чисто |
| `npx vite build` | собрано (1 мин 09 с) |

Кейсы: конфликт собран (person/org у одного ULID), одинаковый тип в разных
документах — не конфликт; решение: href открытой вкладки переписан (dirty),
type записи индекса обновлён, повторный скан без конфликтов.

## Известные ограничения / NOT done

- Решение конфликта правит только открытые вкладки; закрытые — после
  открытия/правки (пишем только в редактируемые файлы).
- Audit viewer — read-only без фильтров/экспорта (v1); запись audit
  ограничена `retain_runs` (50 по умолчанию).
- Стили таблицы audit — простые flex-строки; по замечанию GUI-приёмки
  можно перевести на Gravity Table.
- GUI-приёмка не выполнялась — вместе с пользователем (T4).

## Где читать

1. План `20261105_005_backlog-tails_plan.md` — T3e-1…T3e-5.
2. `src/components/Assistant/AuditViewerModal.tsx` — просмотр лога.
3. Чекпоинт `20261105_001` — состояние Phase 8.5.
