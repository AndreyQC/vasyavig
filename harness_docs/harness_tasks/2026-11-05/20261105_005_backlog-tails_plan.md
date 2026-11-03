# Хвосты бэклога: конфликты типов, «показать все», audit viewer (T3e) — план (Phase 8.5)

> Контекст:
> - бэклог чекпоинта `20261105_001` (обсуждение 2026-11-05): конфликт типов ULID
>   собирается, но не выводится; unknownKnown — лимит 20 строк; audit viewer нет
> - T3b: `entityScan.ts` / `entityScanStore.ts` / секция «Репозиторий» в NerButton
> - `src/lib/agent/audit.ts` — AuditLog (`vasyavig.agent.audit`, localStorage),
>   записи с masking {mode, confirmation, entities, counts}
> - `LESSONS_LEARNED.md` §3 (селекторы)

**Дата:** 2026-11-05
**Фаза:** Phase 8.5, задача **T3e** (бэклог до приёмки)
**Статус:** план
**Объём:** ~300–350 строк + тесты

---

## 1. Цель

1. **Конфликт типов ULID** — скан находит «один ULID — разные type в href»
   (флаг T3), панель re-markup показывает конфликт, пользователь выбирает
   правильный тип; href в открытых вкладках переписывается, индекс — обновляется.
2. **unknown-known без лимита** — кнопка «Показать все (N)» вместо молчаливого
   slice(0, 20).
3. **Audit viewer** — модалка в панели ассистента: последние записи прогона
   (время, операция, результат, модель, путь, findings, masking-счётчики).

## 2. Решения

- **T3e-1. Сбор конфликтов.** `scanMarkdownContents` собирает
  `collectMarkedEntities(...).typeConflicts` по документам →
  `EntitiesDiff.typeConflicts: Array<{ulid, types: string[]}>` (merged по
  ULID). Не-конфликтные ULID — как раньше.
- **T3e-2. Решение конфликта.** `entityScanStore.resolveTypeConflict(root,
  conflict, chosenType)`:
  - запись индекса → `type = chosenType`;
  - href в **открытых вкладках**: замена `vas-entity:<wrong>:<ULID>` →
    `vas-entity:<chosenType>:<ULID>` (editor.replace, dirty, сохранение за
    пользователем) — для закрытых файлов тост/подсказка, как в «Новая» (B-6);
  - повторный скан.
  Действие пользователя явное — автоматической правки нет.
- **T3e-3. Панель.** Секция конфликтов в «Репозитории»: строка «ULID · типы
  (person/org) · значения» + кнопка на тип. unknownKnown: локальный стейт
  `showAllKnown`, по умолчанию 20, кнопка «Показать все (N)».
- **T3e-4. Audit viewer.** `AuditViewerModal` (`assistant.auditOpen` в
  assistantStore, кнопка-иконка в header панели рядом с настройками):
  Gravity Modal, список `auditLog.list()` в обратном порядке (свежие сверху),
  колонки: время (locale), operation, result, model, path, findings;
  masking — компактная строка `preview/confirmed · entities=N · EMAIL:1…`.
  Read-only, без фильтров v1; максимум записей и так ограничен retain_runs.
- **T3e-5.** i18n ru/en; тесты: сбор конфликтов сканом, resolveTypeConflict
  (индекс + правка открытой вкладки), sanitize audit уже покрыт.

## 3. Файлы

| Файл | Что |
|---|---|
| `src/lib/entityScan.ts` | +`typeConflicts` в EntitiesDiff, сбор по документам |
| `src/store/entityScanStore.ts` | +`resolveTypeConflict` |
| `src/components/Toolbar/NerButton.tsx` | секция конфликтов, showAllKnown |
| `src/components/Assistant/AuditViewerModal.tsx` | новый |
| `src/store/assistantStore.ts` | +`auditOpen/openAudit/closeAudit` |
| `src/components/Assistant/AssistantPanel.tsx` | кнопка-иконка + монтирование модалки |
| `src/components/Assistant/Assistant.css` | стили таблицы audit |
| i18n ru/en | `entity.repoConflicts`, `audit.*` |
| тесты | `entityScan.test.ts` (+конфликты), `entityScanStore.test.ts` (решение) |

## 4. Проверки

1. Скан: один ULID с `person:` и `org:` в разных документах →
   `typeConflicts` = [{ulid, types: [person, org]}]; без конфликта — пусто.
2. `resolveTypeConflict`: индекс type обновлён; открытая вкладка с href
   неверного типа переписана (dirty); повторный скан — конфликт исчез.
3. unknownKnown > 20 → кнопка «Показать все», после клика — весь список.
4. Audit viewer: записи в обратном порядке, masking компактно; пустой лог —
   empty-state.
5. `pnpm test`, `npx tsc --noEmit`, `npx vite build`.

## 5. Риски / ограничения

- Решение конфликта правит только открытые вкладки — закрытые документы с
  неверным href останутся до открытия/правки (осознанно: не пишем в
  нередактируемые файлы); повторный скан будет снова показывать конфликт по
  этим документам.
- Audit viewer — read-only таблица без фильтров/экспорта (v1).
- Нет автоматического слияния типов (auto-first) — решение всегда за
  пользователем (D11-принцип).
