# Правила-детекторы как данные (T6-9) — план

> Контекст:
> - сводный план T6: `20261105_007_registry-first_plan.md` (шаг T6-9)
> - источник: `C:\repos\personal\GITHUB\guardrails-llm-filter`
>   (`docs/rules-engine/README.md`, `pkg/guardrails/regex/`, `configs/guardrails_regex_rules.yaml`)
> - текущий код: `src/lib/agent/masking/detectors.ts`, `registry.ts`, `unmask.ts`
> - `LESSONS_LEARNED.md` §16 (фикстуры)

**Дата:** 2026-11-05
**Статус:** план
**Фаза:** Phase 8.5, задача **T6-9** — движок правил-детекторов и корпус

---

## Цель

Перевести детекторы из кода в **данные** (описание правила), добавить
пост-валидаторы контрольных сумм, корректное разрешение пересечений и
fail-open контракт — по образцу `guardrails-llm-filter`.

## Формат правила

```yaml
rules:
  - rule_id: pii.fio-ru
    type: person
    regex: '(?:^|[^ЁА-Яёа-я])(...)'
    capture_groups: [1]        # семантический span (1-based)
    min_length: 8
    keywords: ["иванов"]       # префильтр (только при prefilter_safe: true)
    prefilter_safe: false
    banlist: ["иван"]
    entropy: 2.5
    validators: [fio_ru]
```

- TS-типы: `DetectorRule` в `src/lib/agent/masking/rules.ts`.
- Правила живут в `harness.yaml` (`entities.rules:`) — per-repo, как словари NER,
  либо во встроенном наборе приложения (дефолт).

## Что переносится из guardrails

| # | Что | Как |
|---|---|---|
| 1 | Формат правила | `DetectorRule` + загрузчик из YAML (в текущем проекте YAML уже читается — `harness.yaml`) |
| 2 | Корпус русских PII-правил (46) + gitleaks-секреты (220) | конвертация YAML → наш формат; `(?i)` → флаг `case_insensitive`; `(?-i:…)` → отдельное правило; lookaround в корпусе отсутствует |
| 3 | Валидаторы | Luhn, СНИЛС, ИНН физ/юр, ОГРН, ОГРНИП, IBAN mod-97, email ASCII — чистые функции TS |
| 4 | Union-span при пересечении | переписать `mergeSpans`: пересекающиеся спаны объединяются в `[minStart,maxEnd)`, атрибуция — самому длинному |
| 5 | Семантический span | `capture_groups` вместо ручного срезания пунктуации |
| 6 | Keyword-gated fallback | пары «строгое + ослабленное контекстное правило» |
| 7 | Fail-open | ошибка правила → «правило не применилось», текст не трогаем; `maskText` не выбрасывает фрагменты |
| 8 | Резерв алиасов | литералы `[[VAS_…]]`, уже присутствующие в тексте, не выдаются повторно |
| 9 | Толерантный к дрейфу регекс алиаса | ≤3 символа дрейфа, регистронезависимо — в `unmaskText` |
| 10 | Регрессионный корпус | ~250 кейсов из `tests/rules/rules_cases_test.go` → vitest (позитивные + негативные с реальными FP) |

## Файлы

| Файл | Что |
|---|---|
| `src/lib/agent/masking/rules.ts` | типы правил, загрузка, компиляция, prefilter |
| `src/lib/agent/masking/validators.ts` | контрольные суммы, banlist, энтропия |
| `src/lib/agent/masking/detectors.ts` | исполнитель правил поверх `rules.ts` (бывшие regex-детекторы → правила) |
| `src/lib/agent/masking/validators.test.ts` | тесты валидаторов |
| `src/lib/agent/masking/rules.test.ts` | тесты движка правил |
| `src/lib/agent/masking/rules.corpus.test.ts` | регрессионный корпус (позитив/негатив) |
| `harness_docs/harness_tasks/2026-11-05/20261105_009_detector-rules_result.md` | результат |

## Совместимость

- Текущие детекторы (`email`, `phone`, `secrets`, `url_credentials`) и NER
  продолжают работать; новые правила **добавляются** к ним, не заменяют.
- Дефолтный набор правил встроен в приложение (не зависит от `harness.yaml`),
  чтобы работать в обычной папке.

## Проверки

| Команда | Ожидание |
|---|---|
| `pnpm test` | ≥ 690 passed (валидаторы + движок + корпус) |
| `npx tsc --noEmit` | чисто |
| `npx vite build` | собрано |

## Риски

1. RE2→JS: инлайн-флаги; каждый конвертированный паттерн закрывается кейсом.
2. Ложные срабатывания на русском тексте (адреса, «Красная Площадь») — решается
   негативными кейсами корпуса.
3. Производительность: правила применяются к каждому документу → префильтр по
   ключевым словам (явный флаг) и кэш скомпилированных правил.
