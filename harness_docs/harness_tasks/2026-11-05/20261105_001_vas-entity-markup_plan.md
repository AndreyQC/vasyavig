# vas-entity: инлайн-разметка сущностей (T3) — план (Phase 8.5)

> Контекст:
> - диалог: `harness_docs/harness_tasks/2026-11-03/20261103_002_pseudonymization_dialog.md` — В6–В10, D4'/D8'/D9/D11
> - T1/T1b/T2: `harness_docs/harness_tasks/2026-11-04/20261104_00{1,2,3}_*_result.md`
> - решения сессии 2026-11-05: тип в href; строка jsonl `{ulid,type,canonical,forms}`;
>   предложения+кнопка вместо автозаписи (D11)

**Дата:** 2026-11-05
**Фаза:** Phase 8.5, задача **T3**
**Статус:** план
**Объём:** ~600–800 строк + тесты

---

## 1. Цель

Источник истины по сущностям — **сам документ**: разметка живёт чип-ссылками
`[текст](vas-entity:<type>:<ULID>)`, ULID постоянный во всех документах и
прогонах. Ручная разметка выделением — первичный путь (D11), NER-детектор —
предлагающий. `entities.jsonl` — словарь идентичности (кэш). Приёмка §8 T3:
подсветка в обоих режимах; переход к вхождению; пересчёт при правке;
деградация при отсутствии NER.

## 2. Решения

- **T3-1. Носитель.** `[Иванову И. И.](vas-entity:person:01JBBAABB…)` — тип в
  href (решение пользователя 2026-11-05): переживает редактирование ссылки
  через UI/копипаст, парсинг из одного места; образец структурированного href
  `harness-ulid:<ULID>#<anchor>`. `<type>` — lowercase `EntityType`; ULID —
  Crockford base32 (генератор из T1).
- **T3-2. Склонения.** Идентичность — по ULID, не по тексту: один ULID может
  покрывать разные грамматические формы («Иванову И. И.» / «Ивановым И. И.» /
  «Иванов Иван Иваныч»). Все вхождения → один алиас `[[VAS_PERSON_<ULID>]]`.
  **Каноническая форма** (словарь, unmask, отображение) — первая размеченная
  форма записи этого ULID; детерминированно.
- **T3-3. `entities.jsonl`.** Строка (решение пользователя):
  `{"ulid","type","canonical","forms[]"}` — эталон + все наблюдаемые формы
  (матчинг склонений «форму видел где-то → узнал здесь»). `docs`/`occurrences`
  **не храним** — считаются на лету (UI панели). Инкремент при сохранении
  размеченного документа (merge: forms ∪, canonical и ulid неизменны);
  пересборка полным сканом — T3b. Путь — как `documents.jsonl`
  (`findHarnessIndex` / рядом с workspace). Значения наружу (модель/audit)
  не уходят.
- **T3-4. Парсер разметки.** `parseEntityLinks(markdown)`: regex по raw-тексту
  → спаны (вся конструкция `[…](…)`) + записи `{ulid, type, value}`.
  Конфликт «один ULID — разные type» — не блокирует, флагуется (T3b-панель).
- **T3-5. Реестр и маскирование.** `RunRegistry.registerExisting(ulid, type,
  value)` + resolver `existingFor(value, type) → ulid|null` из индекса.
  `maskText`: спаны разметки → алиасы с постоянным ULID (первично); детекторы
  на неразмеченном тексте → resolver → известное значение получает постоянный
  ULID (связность без разметки), неизвестное — per-run (R3-fallback).
  Unmask — canonical (T3-2).
- **T3-6. Чипы WYSIWYG.** Декорация над link-mark с `href="vas-entity:…"`
  (паттерн `harnessUlidExtension`): класс `vas-entity-link`, data-атрибуты.
  Клик — мини-поповер: тип, canonical, алиас, **«Снять разметку»** (снять
  link-mark). Богатый поповер (вхождения по всем документам, переходы) — T3b/T4.
- **T3-7. Чипы Markup.** CodeMirror-декорация по regex (паттерн
  `harnessUlidMarkupExtension`), клик — тот же поповер.
- **T3-8. Превью.** `vas-entity` в `PREVIEW_ALLOWED_SCHEMES` + DOMPurify RE
  (рецепт 20261027_002) + DOM-проход: href снимается, класс-чип + бейдж типа.
- **T3-9. Ручная разметка (D11, первичный путь).** Кнопка в тулбаре (рядом с
  NER): выделение → выбор типа (PERSON по умолчанию) → ULID → оборачивание в
  ссылку. Значение известно из индекса → предложить реюз с показом canonical.
  Пересечение с существующей разметкой — запрет с notice. WYSIWYG: addMark
  через зарегистрированный PM-view (паттерн mermaid); Markup: CM-транзакция;
  секретные типы (SECRET/EMAIL/PHONE/URL_CRED) размечаются без NER (D11).
- **T3-10. Панель NER (расширение T2-дропдауна).** Секции: «Размечено»
  (значение, тип, canonical при расхождении, кнопка «Снять») и «Предложения»
  (NER-спаны вне разметки: «известная сущность» — бейдж с canonical, реюз
  ULID; «новая»); кнопка «Разметить все известные». Счётчик кнопки =
  NER-вхождения (как в T2) + размеченные.
- **T3-11. Save-хук.** Сохранение markdown-вкладки → если есть разметка,
  инкремент `entities.jsonl` (T3-3). Чтение индекса — лениво при первом
  использовании в workspace.
- **T3-12.** i18n ru/en; фикстуры без правдоподобных секретов (§16).

## 3. Файлы

| Файл | Что |
|---|---|
| `src/lib/agent/masking/vasEntityLink.ts` | разбор/сборка href `vas-entity:<type>:<ULID>` |
| `src/lib/agent/masking/vasEntityMarkup.ts` | `parseEntityLinks(markdown)` → спаны+записи |
| `src/lib/agent/masking/registry.ts` | `registerExisting`, resolver, canonical |
| `src/lib/agent/masking/mask.ts` | спаны разметки первичны, детекторы — fallback |
| `src/lib/entitiesIndex.ts` | jsonl: parse/serialize/merge/load; путь как documents.jsonl |
| `src/lib/vasEntityExtension.ts` | WYSIWYG: декорации + PM-view-регистрация + mark/unmark-команды |
| `src/lib/vasEntityMarkupExtension.ts` | Markup: CM-декорации + wrap/unwrap-команды |
| `src/components/Toolbar/EntityMarkButton.tsx` | ручная разметка: выбор типа, реюз из индекса |
| `src/components/Toolbar/NerButton.tsx` | секции «Размечено»/«Предложения», «Разметить все известные» |
| `src/lib/previewLinks.ts`, превью-компонент | схемы + DOM-проход + CSS-чип |
| `src/components/EditorArea/MarkdownEditor.tsx` | подключение расширений |
| `src/hooks/useSaveActions.ts` (точка сохранения) | инкремент entities.jsonl |
| `src/store/agentStore.ts` | prepare: разметка → реестр; resolver из индекса |
| CSS (`EditorArea.css`), i18n ru/en | стили чипов, ключи |

## 4. Проверки

1. `vasEntityLink/vasEntityMarkup` — parse/build round-trip, склонения
   (один ULID, разные тексты), конфликт типов, мусорные href → null.
2. `entitiesIndex` — merge (forms растёт, canonical стабилен), путь
   harness/обычный, битые строки игнорируются.
3. `mask` интеграция — размеченное → постоянный алиас (ULID из href);
   неразмеченное-известное → постоянный; неразмеченное-новое → per-run;
   unmask → canonical; audit без значений.
4. agentStore — превью показывает сущности с постоянными ULID; send не
   содержит значений; словарь «алиас → тип» (D9).
5. `pnpm test`, `npx tsc --noEmit`, `npx vite build`. GUI-приёмка — с
   пользователем (разметка выделением, чипы в 3 режимах, снять разметку).

## 5. Риски / NOT done (в T3b)

- Частичное выделение существующей сущности/вложенные ссылки — запрет, но
  пограничные случаи (выделение через границу ссылки) — GUI-приёмка.
- Лингвистический матчинг незнакомых склонений (обратная склонялка lvovich) —
  бэклог: работает только по известным `forms`.
- Полный скан-пересборка индекса, changed/исчезнувшие, панель re-markup,
  богатый поповер — T3b.
- Текст ссылки, содержащий `]`/скобки — regex-парсер сырого текста берёт
  простые случаи; экзотика — через WYSIWYG-правку ссылки.
