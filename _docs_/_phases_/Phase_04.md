# Phase 4: Кириллица в ссылках и авто-оглавление

> Дата: 2026-08-27 | Статус: завершена (в `dev`, ожидает PR в `main`)
> План: `_tasks_/2026-08-27/20260827_003_phase4_links_and_toc_final.md`
> Результат: `_tasks_/2026-08-27/20260827_003_phase4_links_and_toc_result.md`
> Код: `f58aeff` (фаза) + `7eaf216` (дополнение: навигация в WYSIWYG)

## Цель фазы

1. Открытие/правка/сохранение markdown в Vasyavig не кодирует кириллицу в URL
   (`#1-введение` вместо `#1-%D0%B2%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D0%B5`).
2. Кнопка «Восстановить кириллицу» для уже побитых файлов (конвертация anydoc,
   прошлые сохранения).
3. Кнопка «Составить оглавление»: TOC из заголовков, якоря кликабельны в превью
   и в WYSIWYG.

Контекст проблемы: markdown-it применяет `normalizeLink` при парсинге, Gravity
сериализатор пишет href как есть — любое редактирование в WYSIWYG переписывало
URL файла в %-виде (исследование 2026-08-27, см. result §1).

## Что сделано

### Расширения редактора

| Файл | Что |
|---|---|
| `src/lib/preserveUrlsExtension.ts` | `builder.configureMd`: `md.normalizeLink`/`normalizeLinkText` = identity — URL не кодируются при round-trip WYSIWYG |
| `src/lib/anchorNavigationExtension.ts` | ProseMirror `handleClick` по `a[href^="#"]`: плавный scrollIntoView к заголовку + курсор |
| `src/lib/anchorMatcher.ts` | Сопоставление якорь -> заголовок: github-слаг, транслит-слаг, custom-id `{#id}`; дубли и %-фрагменты |
| `src/lib/combineExtensions.ts` | Объединение extensions (`wysiwygConfig.extensions` принимает один) |

### Утилиты

| Файл | Что |
|---|---|
| `src/lib/restoreCyrillicUrls.ts` | Декодер %-кириллицы в URL: inline-ссылки/картинки (баланс скобок, angle, title) + link reference definitions; полное декодирование при валидности, bare-dest с пробелами -> `<angle>` |
| `src/lib/generateToc.ts` | TOC H1–H4: markdown-it + github-slugger (паритет питания слаггера с transform), custom-id, поиск блока «Оглавление» (H1–H2), `applyTocReplace`/`applyTocInsert` |
| `src/lib/editorRegistry.ts` | Реестр editor-instances по path — доступ кнопок тулбара к редактору вкладки |

### UI

| Файл | Что |
|---|---|
| `src/components/Toolbar/MainToolbar.tsx` | Кнопки «Восстановить кириллицу» и «Оглавление» (слева, только markdown) |
| `src/components/Modals/TocModal.tsx` | «Заменить блок / вставить новый / отмена» при найденном блоке оглавления |
| `src/hooks/useMarkdownTools.ts` | Обработчики; правки через `editor.replace()` -> store -> dirty; toast «нечего делать» |
| `src/components/EditorArea/MarkdownEditor.tsx` | Подключены 3 extension + реестр |
| `src/components/EditorArea/SplitPreview.tsx` | `transform(..., {supportGithubAnchors: true})` — кириллические якоря у заголовков |
| `src/store/uiStore.ts`, `src/locales/{ru,en}` | `pendingTocPath`; строки кнопок/модалки |

### Зависимости

`markdown-it@13.0.2`, `github-slugger@1.5.0`, `slugify@1.6.6` — прямые
(версии совпадают с транзитивными `@gravity-ui/markdown-editor` /
`@diplodoc/transform`, чтобы правила слагов были идентичны).

## Ключевые архитектурные решения

- **Identity `normalizeLink`** вместо пост-обработки при сохранении: фикс в точке
  возникновения проблемы (парсер), не лечит симптомы. `validateLink` остаётся
  штатным — защита протоколов не ослаблена.
- **Якоря превью — два вида**: дефолтные id у transform — транслит (`1-vvedenie`),
  кириллические github-якоря включаются `supportGithubAnchors: true` (добавляются
  рядом, транслит сохраняется для обратной совместимости). Генератор TOC и
  клики WYSIWYG используют те же правила слагов — тест сверяет с `transform()`.
- **Кнопки применяют правки через `editor.replace()`**, а не напрямую в store:
  редактор — источник правды, вкладка честно становится dirty, сохранение за
  пользователем.
- **Декодер — полное декодирование dest при валидности** (включая `%20`), при
  пробелах/скобках — `<angle>`-форма; частично битые последовательности —
  консервативно по цепочкам. Чистый ASCII (`%20` без кириллицы) не трогается.
- **Заголовок «Оглавление» исключается из TOC**, но слаггер им питается — иначе
  счётчики дублей разошлись бы с transform.
- **pnpm**: проект ставится pnpm 11.24 (store v11); глобальный pnpm 10.x падает
  с `ERR_PNPM_UNEXPECTED_STORE` — использовать `npx pnpm@11.24.0`.

## Проверки

- `pnpm test` — 53/53 (было 27; +8 restoreCyrillicUrls, +9 generateToc,
  +7 anchorMatcher — включая сверку слагов с `transform()`).
- `npx tsc --noEmit` — чисто.
- Ручная проверка пользователем (2026-08-27, подтверждено): якоря не
  перекодируются при переключении режимов; кнопка восстановления декодирует
  файл; TOC генерируется, клики в превью ведут на разделы; сохранение пишет
  чистые якоря; прокрутка по клику в WYSIWYG работает.

## Известные ограничения / NOT done

- Undo в WYSIWYG сбрасывается после кнопок (в markup работает).
- Сериализация Gravity канонизирует форматирование при переключении режимов
  (не байт-в-байт) — ограничение редактора.
- Веб-ссылки с %-кириллицей кнопка тоже декодирует (браузер кодирует обратно).
- Отображение локальных изображений — Phase 5 (roadmap).

## Где читать дальше

1. `_tasks_/2026-08-27/20260827_003_phase4_links_and_toc_result.md` — детали и решения по ходу.
2. `_docs_/roadmap.md` — Phase 5 (изображения) и беклог.
3. `_docs_/_checkpoints_/20260827_002_checkpoint.md` — текущий снапшот.
