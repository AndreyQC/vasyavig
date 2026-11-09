# D-7 (P1): скан конфликтов не видит конфликты по склонениям — план

> Дата: 2026-11-09
> Контекст:
> - `harness_docs/harness_tasks/2026-11-08/20261108_001_gui-acceptance-t6-t4_dialog.md` — журнал приёмки, дефект D-7 (строка D1, 20:4x)
> - `harness_docs/harness_tasks/20261109_001_d17-rules-masking_result.md` — предыдущий P1-фикс дня
> - `harness_docs/harness_checkpoints/20261109_001_checkpoint.md` — «Next planned work»: P1-фиксы D-17 → D-7 → D-9

## Symptom (из приёмки D1)

«Конфликты документа: 0 · разрешимых: 0» — хотя в документе есть немаркированная
форма с 2+ кандидатами. **Flagman-сценарий T6-5 не работал.**

## Корень (подтверждён пробой на реальном движке 2026-11-08)

`collectConflicts` (`entityConflictStore.ts:136-159`) берёт кандидатов из
компилята (`match.ulids`, включает склонённые формы), но резолвер
`resolveRegistryForm` (`entityResolution.ts:61`) заново выводит кандидатов
через `matchesOfForm` — только по **хранимым** canonical/forms/aliases.
Для формы, существующей только как склонение (например «Ивановым И. И.»
генерируется declension-движком из «Иванов Иван Иванович» + «Иванов Иван
Иваныч», но не хранится ни у одной записи), `matchesOfForm` = [] →
`resolution == null` → вхождение молча пропускается.

Stored-конфликты (обе записи хранят форму) работают — проба 2026-11-08 20:5x.

## Фикс (по решению из журнала)

Не перематчинговать: передавать pre-computed кандидатов из компилята
(`entries.filter(e => match.ulids.includes(e.ulid))` — уже считается в
`collectConflicts`) в резолвер как аргумент; `resolveRegistryForm` использует
их вместо повторного `matchesOfForm`. `matchesOfForm` оставить как
экспортируемый хелпер (используется `entityScan.ts:262` — проверить!).

Риски:
- `resolveRegistryForm` вызывается ещё где-то? — grep по коду (один вызов в
  `collectConflicts`, плюс тесты) — ок.
- Порядок/фильтр `match.ulids` vs stored: компилят уже фильтрует по
  `MIN_FORM_LENGTH`; кандидаты из entries сохраняют типы (`candidates[0].type`).

## Шаги

1. Красный регресс-тест в `entityConflictStore.test.ts`: entries с канонами
   без stored-формы «Ивановым И. И.»; текст с этой формой → conflicts 0 (red) →
   после фикса conflicts 1, candidates [P1,P2].
2. Фикс `entityResolution.ts` + `entityConflictStore.ts`.
3. Прогнать существующие тесты (stored-конфликты не должны сломаться).
4. Проверки: pnpm test / tsc / build.
5. Result-док + статус D-7 в сводке; коммиты код/docs раздельно.

## Проверки (после фикса)

`pnpm test` — 764+ passed · `npx tsc --noEmit` чисто · GUI-перепроверка D1
(после F1-перепроверки D-17).
