# Phase 4: кириллица в ссылках и авто-оглавление (result)

> Дата: 2026-08-27
> Контекст:
> - `_docs_/_tasks_/2026-08-27/20260827_003_phase4_links_and_toc_final.md` — утверждённый план
> - `_docs_/roadmap.md` — Phase 4
> Коммит: `f58aeff feat(app): phase 4 — кириллица в ссылках (фикс перекодирования + восстановление) и авто-оглавление`

Статус: реализовано; автоматические проверки зелёные, ручная проверка в приложении —
за пользователем (список шагов в §4).

## 1. Что сделано

| Файл | Что изменилось |
|---|---|
| `src/lib/preserveUrlsExtension.ts` | extension: `md.normalizeLink`/`normalizeLinkText` = identity через `builder.configureMd` — URL больше не %-кодируются при round-trip WYSIWYG |
| `src/lib/editorRegistry.ts` | реестр editor-instances по path (доступ кнопок тулбара к редактору активной вкладки) |
| `src/lib/combineExtensions.ts` | хелпер объединения extensions (`wysiwygConfig.extensions` принимает один) |
| `src/lib/restoreCyrillicUrls.ts` | декодер: inline-ссылки/картинки (баланс скобок, angle-dest, title) + link reference definitions; полное декодирование при валидности, иначе консервативно по цепочкам; bare-dest с пробелами -> `<angle>` форма |
| `src/lib/generateToc.ts` | заголовки H1–H4 через markdown-it + github-slugger (та же схема питания слаггера, что у transform с `supportGithubAnchors`); custom-id `{#id}` поддержаны; поиск блока «Оглавление» (H1–H2) + диапазона списка; `applyTocReplace`/`applyTocInsert` |
| `src/hooks/useMarkdownTools.ts` | обработчики кнопок; правки через `editor.replace()` -> store -> dirty; toast при отсутствии работы |
| `src/components/Modals/TocModal.tsx` | модалка «заменить блок / вставить новый / отмена» (решение USER_INPUT #2) |
| `src/components/Toolbar/MainToolbar.tsx` | кнопки «Восстановить кириллицу» и «Оглавление» слева тулбара (решение USER_INPUT #3) |
| `src/components/EditorArea/MarkdownEditor.tsx` | подключены preserveUrlsExtension + реестр |
| `src/components/EditorArea/SplitPreview.tsx` | `supportGithubAnchors: true` — заголовки получают кириллические якоря рядом с транслит-id |
| `src/store/uiStore.ts` | транзитный `pendingTocPath` |
| `src/locales/{ru,en}/translation.json` | строки tools/modal |
| `package.json` | прямые зависимости: `markdown-it@13.0.2`, `github-slugger@1.5.0` (+ типы) |

## 2. Решения по ходу реализации (отличия от final)

- Заголовок «Оглавление» исключается из самого списка TOC, но слаггер им питается —
  иначе счётчики дублей разошлись бы с transform.
- `listRange` подрезает хвостовые пустые строки — замена блока не съедает отступ
  перед следующим заголовком.
- Декодер: сначала полное `decodeURIComponent` dest (если валидно и даёт не-ASCII —
  применяется целиком, включая `%20`); при битых последовательностях — по цепочкам.
  Иначе путь `V2_%D0%A2%D0%97%20Total...` декодировался бы частично («ТЗ %20Total»).
- `wysiwygConfig.extensions` принимает одиночное расширение — добавлен
  `combineExtensions` (открылось на typecheck).

## 3. Автоматические проверки

- `pnpm test` — **46/46** (было 27; +8 restoreCyrillicUrls, +9 generateToc),
  включая тест-сверку слагов TOC с `transform(..., {supportGithubAnchors: true})`
  и кейсы custom-id, дублей заголовков, angle/bare dest.
- `npx tsc --noEmit` — чисто.
- Rust не менялся; `cargo test` не требуется.

## 4. Ручная проверка (за пользователем)

На файле `V2_ТЗ Total Salary ... for fix.md`:

1. Открыть (WYSIWYG) -> переключить в Markup: якоря оглавления НЕ перекодируются,
   вкладка не становится dirty от самого переключения.
2. Кнопка «Восстановить кириллицу»: якоря `#55-%D0%B0...` -> `#55-алгоритм...`,
   пути картинок -> кириллица в `<angle>` форме; повторное нажатие — «нечего делать».
3. Кнопка «Оглавление»: модалка «заменить/вставить»; заменить — блок под
   «## Оглавление» перегенерирован; клики по пунктам в превью (split) ведут на разделы.
4. Сохранить (Ctrl+S) -> в файле на диске чистые кириллические якоря (проверить
   внешним редактором).
5. Заодно проверить пункт 5 из плана: какие ещё изменения вносит сериализация при
   переключении режимов (ожидание: только форматирование, не URL).

## 5. Известные ограничения

- Undo сбрасывается в WYSIWYG после кнопок (replace пересоздаёт документ);
  в markup-режиме undo работает.
- Сериализация Gravity в целом не байт-в-байт: переключение режимов канонизирует
  форматирование (это ограничение редактора, не фазы).
- Веб-ссылки с %-кодированной кириллицей тоже декодируются кнопкой — ожидаемое
  поведение (браузер кодирует обратно при переходе).
- Транслит-id (`#1-vvedenie`) на h-тегах остаются — обратная совместимость;
  кириллические якоря добавляются рядом.

## 7. Дополнение после ручной проверки: навигация по якорям в WYSIWYG

Пользователь подтвердил работу фазы (2026-08-27) и запросил: клик по пункту
оглавления в WYSIWYG должен скроллить к заголовку. Реализовано (`7eaf216`):

- `src/lib/anchorMatcher.ts` — сопоставление якоря со заголовком: github-слаг,
  транслит-слаг (slugify с параметрами transform), custom-id; дубли и
  percent-кодированные фрагменты учтены.
- `src/lib/anchorNavigationExtension.ts` — ProseMirror-плагин: `handleClick`
  перехватывает клики по `a[href^="#"]`, находит заголовок и делает плавный
  `scrollIntoView` + ставит курсор к заголовку.
- Подключено третьим extension в `MarkdownEditor.tsx`.
- Проверки: `pnpm test` 53/53 (+7 anchorMatcher), `tsc` чисто.
- Ручная проверка: в WYSIWYG кликнуть пункт оглавления — документ
  прокручивается к разделу.

## 6. Коммиты фазы

- `6477a19` — docs(tasks): draft
- `7f61244` — docs(tasks): final
- `f58aeff` — feat(app): реализация
- этот файл — docs(tasks): result
