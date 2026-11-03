# Re-markup и производный индекс (T3b) — результат (Phase 8.5)

> Контекст:
> - план: `harness_docs/harness_tasks/2026-11-05/20261105_003_re-markup_plan.md` — B-1…B-7
> - диалог: `harness_docs/harness_tasks/2026-11-03/20261103_002_pseudonymization_dialog.md` — В9 (цикл re-markup), §7 T3b
> - T3/T3c: `20261105_001_vas-entity-markup_result.md`, `20261105_002_harness-yaml_result.md`

**Дата:** 2026-11-05
**Статус:** выполнено (`934ca9d` план, `4359fe2` код); GUI-приёмка — за пользователем
**Фаза:** Phase 8.5, задача T3b — **последняя кодовая задача очереди §7**

---

## Что сделано

| Файл | Что |
|---|---|
| `src/lib/entityScan.ts` | новый: `listMarkdownFiles` (обход FileNode-дерева, скрытые/node_modules пропускаются, глубина 8), `scanMarkdownContents` (разметка → вхождения per-ULID; fenced-код пропущен), `diffEntitiesScan` (B-2: changed/missing/unknown-known), `scanToIndexEntries` (сводка для rebuild; canonical переживает пересборку) |
| `src/store/entityScanStore.ts` | новый: `scan(root)` (список .md из fileStore-дерева или рекурсивный listDirectory; открытые вкладки — источник правды, остальное с диска), `rebuildIndex` (пересборка jsonl одним write + повторный diff), `resolveChanged` («та же» → форма в forms; «новая» → href вхождения переписан на свежий ULID — только открытая вкладка), `removeMissing` (строка удалена из jsonl) |
| `src/lib/entitiesIndex.ts` | `invalidateEntitiesIndex(path)` — сброс кэша по пути файла; `writeEntitiesIndex` — запись + обновление кэша |
| `src/hooks/useFileWatcher.ts` | fs-change по `entities.jsonl` → сброс кэша (B-5): внешний make/git не оставляет устаревший словарь |
| `src/components/Toolbar/NerButton.tsx` | секция **«Репо»** (B-4): «Скан репо», сводка «документов · changed · исчезнувших · известных неразмеченных», «Пересобрать индекс»; строки changed («Та же»/«Новая»), missing («Вывести»), unknown-known (переход в документ) |
| CSS, i18n ru/en | `.ner-panel__section--repo`, `.ner-panel__rebuild`; ключи `entity.repo*`, `changeSame/New` |

Цикл В9 закрыт полностью: правки документа → скан → changed (решает
пользователь: опечатка — «Та же», смена значения — «Новая») → неразмеченные
известные значения (предложение разметить с ULID из индекса) → исчезнувшие
(«Вывести» из реестра); `entities.jsonl` пересобирается тем же сканом.

## Проверки

| Команда | Результат (2026-11-05) |
|---|---|
| `pnpm test` | **647 passed / 54 файла** (было 641/53): +6 `entityScan.test.ts` |
| `npx tsc --noEmit` | чисто |
| `npx vite build` | собрано (1 мин 30 с) |
| Rust | не менялся |

Кейсы `entityScan.test.ts`: обход дерева (скрытые/node_modules/не-md
пропускаются); вхождения per-ULID, fenced-код не считается; правка текста
ссылки → changed (value vs canonical), ULID без вхождений → missing;
известная форма вне разметки → unknown-known ровно один раз, внутри
разметки — нет; rebuild: canonical из старого индекса переживает, новый
ULID — canonical = первая форма.

## Известные ограничения / NOT done

- Скан ручной (кнопка), кэш до следующего скана — автоскан не делали
  (большие репо).
- NER по всему репо не запускается (дорого) — неразмеченные ищутся точным
  совпадением значений индекса; NER-предложения остаются документными
  (NerButton, T3-10).
- «Новая» для закрытой вкладки недоступна — тост `repoOpenRequired`; запись
  в нередактируемые файлы не делаем (B-6).
- unknown-known в панели — первые 20 строк (остальное после приёмки, если
  нужно).
- Конфликт типов ULID (T3-флаг) в панели не выводится.
- Позиции вхождения фиксируются сканом; перед replace контент вкладки
  актуален (действия берут tab.content), но правка между сканом и кликом
  может сместить спан — при промахе просто ничего не происходит (safe-replace
  по валидации href).
- GUI-приёмка не выполнялась — `pnpm tauri dev` вместе с пользователем.

## Где читать

1. План `20261105_003_re-markup_plan.md` — B-1…B-7.
2. `src/lib/entityScan.ts` — чистые функции скана/diff.
3. `src/store/entityScanStore.ts` — решения пользователя и запись индекса.
4. Диалог `20261103_002` §7 — очередь выполнена: T1 ✓ T1b ✓ T2 ✓ T3 ✓ T3b ✓;
   остались T4 (GUI-приёмка) и T5 (Phase 8.6).
